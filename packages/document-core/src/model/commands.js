// SPDX-License-Identifier: MPL-2.0
import { orderedCreationPlacements } from "./creation-placement-projection.js";
import { appendItemPlacement } from "./item-placement.js";
import { enterMarker } from "./list-marker.js";
// Paragraph/list partition operations share the current document codec.
import { apply, gapAt, resolveGap } from "./engine.js";
import { executeTree, treeParent } from "./tree.js";
import {
  captureRange,
  ReviewRequired,
  validateDestination,
} from "../selection/range.js";
const list = (n) => ["bullet_list", "ordered_list"].includes(n?.type);
const stamp = (n) => n.placement ?? null;
function builder(state, op, initial = []) {
  let current = initial.length
    ? apply(state, { ...op, intent: { kind: "batch", intents: initial } })
    : state;
  let projected = { ...current, nodes: { ...current.nodes } },
    intents = [...initial],
    counter = 0;
  const add = (i) => {
    executeTree(projected, i, `${op.id}:part:${intents.length}`, {
      write: () => projected.nodes,
      fail: (m) => new ReviewRequired(m),
    });
    intents.push(i);
  };
  const parent = (id) => treeParent(projected, id),
    node = (id) => projected.nodes[id];
  const place = (id, dest, before = null) =>
    add({
      kind: "treePlace",
      node: id,
      from: parent(id).id,
      parent: dest,
      before,
      expected: stamp(node(id)),
    });
  const wrap = (ids, type) => {
    const id = `${op.id}:list:${++counter}`;
    add({
      kind: "treeWrap",
      id,
      type,
      nodes: ids,
      from: parent(ids[0]).id,
      expected: ids.map((id) => stamp(node(id))),
    });
    return id;
  };
  const prune = (id) => {
    if (node(id)?.live && list(node(id)) && !node(id).children.length)
      add({ kind: "treePrune", node: id, expected: stamp(node(id)) });
  };
  const unwrap = (id) =>
    add({ kind: "treeUnwrap", node: id, expected: stamp(node(id)) });
  const finish = (range, point) => {
    if (!intents.length) return { intent: null, state, after: range.start };
    const intent = { kind: "batch", intents },
      next = apply(state, { ...op, intent });
    return {
      intent,
      state: next,
      ...(point
        ? { after: gapAt(next, point.block, point.offset) }
        : {
            selection: {
              epoch: range.epoch,
              anchor: range.anchor,
              focus: range.focus,
            },
            after: range.start,
          }),
    };
  };
  return {
    get state() {
      return projected;
    },
    node,
    parent,
    place,
    wrap,
    prune,
    unwrap,
    finish,
  };
}
function context(state, block) {
  const p = state.nodes[block],
    item = treeParent(state, block),
    owner = item && treeParent(state, item.id);
  if (p?.type !== "paragraph" || item?.type !== "list_item" || !list(owner))
    throw new ReviewRequired("Select paragraph text in a list item");
  return { p, item, owner };
}
function selectedItems(state, range) {
  const entries = range.slices.map((s) => context(state, s.block)),
    ids = [...new Set(entries.map((e) => e.item.id))];
  // Ancestors move with descendants. The initial bounded multi-selection only
  // accepts siblings in one list; cross-container selections require review.
  const owner = entries[0].owner;
  if (entries.some((e) => e.owner.id !== owner.id))
    throw new ReviewRequired(
      "Select sibling items in one list for this operation",
    );
  const at = owner.children.indexOf(ids[0]);
  if (ids.some((id, i) => owner.children[at + i] !== id))
    throw new ReviewRequired("List items must be adjacent");
  return { ids, owner };
}
export function planListIndent(
  state,
  range,
  op,
  { outdent: lift = false, adopt = true } = {},
) {
  validateDestination(state, range);
  const { ids, owner } = selectedItems(state, range);
  if (adopt && ids.length === 1 && state.nodes[ids[0]].creation) {
    if (!lift && owner.children[0] === ids[0])
      return { intent: null, state, after: range.start };
    const root = state.nodes[ids[0]],
      intent = {
        kind: "creationItemMove",
        root: root.id,
        creation: root.creation,
        outdent: lift,
        basis:
          orderedCreationPlacements(state)
            .filter((p) => p.active && p.creations[0] === root.creation)
            .at(-1)?.id ?? null,
      };
    const next = apply(state, { ...op, intent });
    return { intent, state: next, after: range.start };
  }
  const holds = [];
  for (const f of Object.values(state.listFamilies))
    for (const c of Object.values(f.cuts))
      if (ids.includes(c.wrapper))
        holds.push({ kind: "listHold", family: f.id, boundary: c.id });
  const b = builder(state, op, holds);
  if (!lift && owner.children[0] === ids[0])
    return { intent: null, state, after: range.start };
  appendItemPlacement(b, ids, owner, lift);
  return b.finish(range);
}
export function planListEnter(state, range, op) {
  validateDestination(state, range);
  if (!range.collapsed) return planListRangeEnter(state, range, op);
  const at = resolveGap(state, range.start),
    { p, item, owner } = context(state, at.block);
  if (item.children[0] !== p.id)
    throw new ReviewRequired(
      "List Enter in a continuation block is not qualified yet",
    );
  const size = state.replicas[p.text].length,
    child = state.nodes[item.children[1]];
  if (!size && item.children.length === 1)
    return planListIndent(state, range, op, { outdent: true, adopt: false });
  if (
    at.offset > 0 &&
    item.children.length > 1 &&
    !list(child) &&
    !item.children
      .slice(1)
      .every((id) => ["code", "image"].includes(state.nodes[id]?.type))
  )
    throw new ReviewRequired(
      "List Enter beside mixed attachments needs a structural review",
    );
  const intent = {
      kind: "listEnter",
      at: range.start,
      marker: enterMarker(state, item.id, at.offset),
    },
    next = apply(state, { ...op, intent }),
    tail = `${op.id}:list-tail`;
  return { intent, state: next, after: gapAt(next, tail, 0) };
}
export function planListBackspace(state, range, op) {
  const at = resolveGap(state, range.start),
    { item } = context(state, at.block);
  if (!range.collapsed || at.offset !== 0 || item.children[0] !== at.block)
    throw new ReviewRequired("Not a list-item start");
  return planListIndent(state, range, op, { outdent: true, adopt: false });
}

// LS-02a: selection Enter is its own command, never collapsed empty-item exit.
// Capture selected identities; split before erasure so Undo restores origin
// affiliations before retiring the cut. Do not recreate text or list wrappers.
function planListRangeEnter(state, range, op) {
  const entries = range.slices.map((s) => context(state, s.block));
  const first = entries[0],
    last = entries.at(-1);
  if (entries.some((e) => e.item.children[0] !== e.p.id))
    throw new ReviewRequired(
      "List range in continuation text is not qualified",
    );
  const simple = (e) => e.item.children.length === 1;
  const parentOnly = (e) =>
    e.item.children.length === 2 && list(state.nodes[e.item.children[1]]);
  const single = entries.length === 1;
  if (single) {
    if (!simple(first) && !parentOnly(first))
      throw new ReviewRequired(
        "List range beside mixed attachments is not qualified",
      );
  } else {
    const siblings =
      entries.length === 2 &&
      simple(first) &&
      simple(last) &&
      first.owner.id === last.owner.id &&
      first.owner.children[first.owner.children.indexOf(first.item.id) + 1] ===
        last.item.id;
    const child =
      entries.length === 2 &&
      parentOnly(first) &&
      simple(last) &&
      first.item.children[1] === last.owner.id &&
      last.owner.children[0] === last.item.id;
    if (!siblings && !child)
      throw new ReviewRequired("This list selection shape is not qualified");
  }
  const ids = range.slices.flatMap((s) => s.atoms.map((a) => a.id));
  // Two existing paragraphs already supply the required boundary; their wrappers
  // and all unselected descendants stay untouched. No join-and-recreate step.
  const intents = single ? [{ kind: "listEnter", at: range.start }] : [];
  if (ids.length) intents.push({ kind: "delete", ids });
  if (!intents.length) return { intent: null, state, after: range.end };
  const intent = { kind: "batch", intents },
    next = apply(state, { ...op, intent });
  const block = single ? `${op.id}:part:0:list-tail` : last.p.id;
  return { intent, state: next, after: gapAt(next, block, 0) };
}
