// SPDX-License-Identifier: MPL-2.0
// Codec-10 experiment: logical deletion contributions are authoritative; visible
// text/tree joins are reversible projections. Never expose projection inverses
// as public operations or mix these checkpoints with earlier codecs.
import { conversionJoinCompatible, bodyConversionFor } from "./text-conversion.js";
import { treeParent } from "./tree.js";
import { creationProseParent } from "./creation-extent.js";
const list = (n) => ["ordered_list", "bullet_list"].includes(n?.type);
// Only the first child paragraph is adjacent in traversal order. Atomic blocks
// after its child-list are untouched suffixes, not content crossed by the join.
export function supportedJoinLeft(state, item, firstChild) {
  return firstChild
    ? item.children
        .slice(2)
        .every((id) => ["code", "image"].includes(state.nodes[id]?.type))
    : item.children.length === 1;
}
export function joinTarget(state, right) {
  for (const f of Object.values(state.listFamilies))
    for (const c of Object.values(f.cuts))
      if (c.block === right)
        return { id: c.id, right, creator: { family: f.id, cut: c.id } };
  return { id: `seed:${right}`, right, creator: null };
}
// Boundary identity chooses its retained structural grammar; presentation style
// does not authorize a different join or a new neighbouring source.
export function boundaryJoinIntent(state, target) {
  const existing = state.listJoins[target.id],
    parent = treeParent(state, target.right);
  const mode = existing
    ? existing.mode || "list"
    : parent?.type === "list_item"
      ? "list"
      : ["doc", "cell"].includes(parent?.type)
        ? "prose"
        : null;
  if (!mode) throw Error("Boundary source context is unavailable");
  return { kind: mode === "list" ? "listJoin" : "proseJoin", target };
}
export function executeJoinContribution(
  state,
  intent,
  action,
  { write, fail },
) {
  const joins = write("listJoins");
  if (intent.kind === "listJoinActive") {
    const old = joins[intent.boundary],
      contribution = old?.contributions[intent.contribution];
    if (!contribution || contribution.active === intent.active)
      throw fail("Join contribution changed");
    joins[old.id] = {
      ...old,
      contributions: {
        ...old.contributions,
        [intent.contribution]: { active: intent.active },
      },
    };
    return { ...intent, active: !intent.active };
  }
  const target = intent.target,
    old = joins[target.id];
  if (
    old &&
    (old.right !== target.right ||
      JSON.stringify(old.creator) !== JSON.stringify(target.creator))
  )
    throw fail("Boundary identity changed");
  if (!old && !state.nodes[target.right]?.live)
    throw fail("Join target is unavailable");
  const mode = intent.kind === "proseJoin" ? "prose" : "list";
  if (old && (old.mode || "list") !== mode) throw fail("Join grammar changed");
  if (
    mode === "prose" &&
    !old &&
    !["doc", "cell"].includes(treeParent(state, target.right)?.type)
  )
    throw fail("Prose join context changed");
  joins[target.id] = {
    ...target,
    ...(mode === "prose"
      ? { mode, parent: old?.parent ?? treeParent(state, target.right).id }
      : {}),
    contributions: { ...old?.contributions, [action]: { active: true } },
  };
  return {
    kind: "listJoinActive",
    boundary: target.id,
    contribution: action,
    active: false,
  };
}
export function expandJoins(state, action, host) {
  for (const [i, entry] of [...state.joinProjection].reverse().entries())
    host.execute(entry.inverse, `${action}:expand:${i}`, {
      boundary: entry.boundary,
    });
  const entries = host.write("joinProjection");
  entries.length = 0;
}
function visibleCreator(state, b) {
  return (
    !b.creator ||
    state.listFamilies[b.creator.family]?.cuts[b.creator.cut]?.active
  );
}
function preceding(state, right, fail) {
  const item = treeParent(state, right),
    owner = item && treeParent(state, item.id);
  if (item?.type !== "list_item" || !list(owner))
    throw fail("Join right side changed structure");
  const inItem = item.children.indexOf(right);
  if (inItem > 0) {
    const previous = state.nodes[item.children[inItem - 1]];
    if (previous?.type !== "paragraph")
      throw fail("Join would cross an attachment or descendant");
    return previous.id;
  }
  if (inItem !== 0) throw fail("Join right side changed structure");
  const index = owner.children.indexOf(item.id);
  if (index === 0) {
    const parent = treeParent(state, owner.id);
    if (parent?.type === "list_item" && parent.children[1] === owner.id)
      return parent.children[0];
    return null;
  }
  // A nested list's final text is adjacent to the next outer item in document
  // order. Descend only through trailing lists; images/code are hard barriers.
  let previous = state.nodes[owner.children[index - 1]];
  while (previous?.type === "list_item") {
    const last = state.nodes[previous.children.at(-1)];
    if (last?.type === "paragraph") return last.id;
    if (!list(last) || !last.children.length) break;
    previous = state.nodes[last.children.at(-1)];
  }
  throw fail("Join would cross an attachment or descendant");
}
function projectOne(state, b, action, host) {
  if (b.mode === "prose") {
    const owner = treeParent(state, b.right),
      index = owner?.children.indexOf(b.right),
      left = state.nodes[owner?.children[index - 1]],
      right = state.nodes[b.right];
    // A certified prose cut and its join keep the same paragraph grammar when
    // their creation is rewrapped. Follow that existing family only; a move
    // cannot turn an unrelated neighbouring block into a join predecessor.
    const family = b.creator && state.listFamilies[b.creator.family],
      creation =
        family && state.creations[state.nodes[family.source]?.creation];
    const retained =
      family?.kind === "prose" &&
      family.cuts[b.creator.cut]?.block === b.right &&
      creation &&
      [creation.scope, creation.root].includes(b.parent) &&
      family.layout.blocks.includes(left?.id) &&
      creationProseParent(state, family, (id) => treeParent(state, id))?.id ===
        owner?.id;
    if (
      !owner ||
      !(
        (owner.id === b.parent && ["doc", "cell"].includes(owner.type)) ||
        retained
      ) ||
      !(
        (left?.type === "paragraph" && right?.type === "paragraph") ||
        ([left, right].every(n => ["paragraph", "code"].includes(n?.type)) &&
          [left, right].every(n => (bodyConversionFor(state, n.id)?.target || n.type) === "paragraph")) ||
        (left?.type === "code" &&
          right?.type === "code" &&
          family?.textType === "code" &&
          family.layout.blocks.includes(left.id))
      )
    )
      throw host.fail("Prose join would cross a structural boundary");
    return {
      kind: "batch",
      intents: [
        host.execute(
          { kind: "join", left: left.id, right: right.id },
          `${action}:part:0`,
          { boundary: b.id },
        ),
      ],
    };
  }
  const leftId = preceding(state, b.right, host.fail);
  if (!leftId) throw host.fail("Join predecessor unavailable");
  const left = state.nodes[leftId],
    right = state.nodes[b.right],
    item = treeParent(state, leftId),
    owner = treeParent(state, item.id),
    rightItem = treeParent(state, right.id);
  if (item.id === rightItem.id) {
    if (left.type !== "paragraph" || right.type !== "paragraph")
      throw host.fail("Join requires adjacent paragraph text");
    return {
      kind: "batch",
      intents: [
        host.execute(
          { kind: "join", left: left.id, right: right.id },
          `${action}:part:0`,
          { boundary: b.id },
        ),
      ],
    };
  }
  const child = state.nodes[item.children[1]],
    firstChild = list(child) && child.children[0] === rightItem.id,
    rightChild = state.nodes[rightItem.children[1]];
  if (
    left.type !== "paragraph" ||
    right.type !== "paragraph" ||
    !(
      supportedJoinLeft(state, item, firstChild) ||
      item.children.at(-1) === left.id
    ) ||
    (rightItem.children.length > 1 &&
      (!list(rightChild) || rightItem.children.length !== 2)) ||
    (firstChild && rightChild)
  )
    throw host.fail("Join projection requires a supported text/list shape");
  const inverses = [];
  let part = 0;
  const step = (i) =>
    inverses.unshift(
      host.execute(i, `${action}:part:${part++}`, { boundary: b.id }),
    );
  const place = (id, to, before = null) =>
    step({
      kind: "treePlace",
      node: id,
      from: treeParent(state, id).id,
      parent: to,
      before,
      expected: state.nodes[id].placement ?? null,
    });
  const prune = (id) =>
    step({
      kind: "treePrune",
      node: id,
      expected: state.nodes[id].placement ?? null,
    });
  if (rightChild) {
    const before =
      owner.children[owner.children.indexOf(rightItem.id) + 1] ?? null;
    for (const id of [...rightChild.children]) place(id, owner.id, before);
    prune(rightChild.id);
  }
  place(right.id, item.id, firstChild ? child.id : null);
  step({ kind: "join", left: left.id, right: right.id });
  prune(rightItem.id);
  if (firstChild && !state.nodes[child.id].children.length) prune(child.id);
  return { kind: "batch", intents: inverses };
}
export function styleRetainsBoundary(state, b) {
  if (!state.nodes[b.right]?.live) return false;
  const parent = treeParent(state, b.right);
  const left =
    b.mode === "prose"
      ? parent?.children[parent.children.indexOf(b.right) - 1]
      : preceding(state, b.right, (message) => new Error(message));
  return !!left && !conversionJoinCompatible(state, left, b.right);
}
export function projectJoins(state, action, host) {
  const order = [];
  function walk(id) {
    const n = state.nodes[id];
    if (n.text) order.push(id);
    for (const c of n.children || []) walk(c);
  }
  walk(state.root);
  const joins = Object.values(state.listJoins)
    .filter(
      (b) =>
        !b.suspendedBy &&
        visibleCreator(state, b) &&
        Object.values(b.contributions).some((c) => c.active),
    )
    .sort((a, b) => order.indexOf(a.right) - order.indexOf(b.right));
  for (const [i, b] of joins.entries()) {
    if (!state.nodes[b.right]?.live)
      throw host.fail("Active boundary has no logical right partition");
    if (styleRetainsBoundary(state, b)) continue;
    const inverse = projectOne(state, b, `${action}:project:${i}`, host);
    host.write("joinProjection").push({ boundary: b.id, inverse });
  }
}
export function validateJoins(state) {
  if (!state.listJoins || !Array.isArray(state.joinProjection))
    throw Error("Missing join ledger");
  const projected = new Set();
  for (const p of state.joinProjection) {
    if (
      !state.listJoins[p.boundary] ||
      projected.has(p.boundary) ||
      p.inverse?.kind !== "batch"
    )
      throw Error("Invalid join projection");
    projected.add(p.boundary);
  }
  for (const [id, b] of Object.entries(state.listJoins)) {
    if (
      (b.mode !== undefined && b.mode !== "prose") ||
      (b.mode === "prose" &&
        !["doc", "cell"].includes(state.nodes[b.parent]?.type))
    )
      throw Error("Invalid prose join grammar");
    if (
      b.id !== id ||
      !state.nodes[b.right] ||
      !b.contributions ||
      Object.values(b.contributions).some((c) => typeof c.active !== "boolean")
    )
      throw Error("Invalid join ledger");
    if (
      b.suspendedBy &&
      (typeof b.suspendedBy !== "string" ||
        (state.nodes[b.right]?.clearedBy ??
          state.nodes[b.right]?.structureDeletedBy) !== b.suspendedBy ||
        state.nodes[b.right]?.live)
    )
      throw Error("Invalid suspended join lifecycle");
    const active =
      !b.suspendedBy &&
      !!visibleCreator(state, b) &&
      Object.values(b.contributions).some((c) => c.active);
    if ((active && !styleRetainsBoundary(state, b)) !== projected.has(id))
      throw Error("Join projection disagrees with ledger");
  }
}

// Reuse a projection only when the mutation footprint cannot change its
// partition ownership. Existing retained cut markers track offset changes.
// A seam insertion or any restoration/structural operation reprojects; these
// can distinguish authored sides even when their visible offsets coincide.
export function canReuseJoinProjection(state, intent, host) {
  if (!Object.keys(state.listJoins).length)
    return (
      intent.kind !== "richInsert" &&
      intent.kind !== "richForestActive" &&
      intent.kind !== "proseReplace" &&
      intent.kind !== "proseJoin" &&
      intent.kind !== "listJoin" &&
      intent.kind !== "listJoinActive" &&
      !(
        intent.kind === "batch" &&
        intent.intents.some((i) => !canReuseJoinProjection(state, i, host))
      )
    );
  if (intent.kind === "batch")
    return intent.intents.every((i) => canReuseJoinProjection(state, i, host));
  if (intent.kind === "format" || intent.kind === "formatActive") return true;
  if (
    intent.kind !== "insert" ||
    typeof intent.text !== "string" ||
    intent.erasure ||
    intent.restore ||
    intent.origin
  )
    return false;
  const at = host.resolve(intent.at);
  let safe = true;
  function check(i) {
    if (i.kind === "batch") {
      i.intents.forEach(check);
      return;
    }
    if (i.kind !== "split") return;
    const cut = state.boundaries[i.at.boundary];
    if (cut.block === at.block && cut.offset === at.offset) safe = false;
  }
  state.joinProjection.forEach((p) => check(p.inverse));
  return safe;
}

// Read the retained prose sources behind current physical join projection.
// Ownership is certified by this module's projection ledger, never inferred from
// similar text or an arbitrary dead node. Reverse projection order reconstructs
// source order even when several empty cuts share the same physical offset.
export function proseProjectionSources(state, parent) {
  const children = [...(state.nodes[parent]?.children || [])];
  const owner = new Map(children.map((id) => [id, id]));
  for (const projection of [...state.joinProjection].reverse()) {
    const entry = state.listJoins[projection.boundary];
    if (entry?.mode !== "prose" || entry.parent !== parent) continue;
    const marker = state.boundaries[`projection-cut:${entry.id}`];
    const at = children.indexOf(marker?.block);
    if (
      at < 0 ||
      !state.nodes[marker.block]?.live ||
      state.nodes[entry.right]?.live
    )
      throw Error("Invalid projected prose source");
    children.splice(at + 1, 0, entry.right);
    owner.set(entry.right, marker.block);
  }
  const sources = new Map();
  for (const id of children) {
    const visible = owner.get(id);
    if (!sources.has(visible)) sources.set(visible, []);
    sources.get(visible).push(id);
  }
  return { children, owner, sources };
}
