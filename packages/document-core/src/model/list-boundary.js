// SPDX-License-Identifier: MPL-2.0
import {
  creationProseContainer,
  creationProseParent,
} from "./creation-extent.js";
import { creationGapAfterStart } from "./creation-lifecycle.js";

// The logical cut owns the new paragraph identity. Visible prose may use a
// retained list partition, so callers must not infer its ID from UI grammar.
export function paragraphForEnter(state, action) {
  for (const family of Object.values(state.listFamilies)) {
    const cut = family.cuts[`${action}:cut`];
    if (cut) return cut.block;
  }
  throw Error("Enter has no retained paragraph boundary");
}

// Creator activity and structural retention are separate contributions.
export function executeListBoundary(state, intent, action, host) {
  if (intent.kind !== "listBoundaryActive")
    return projectListBoundary(state, intent, action, host);
  const original = state.listFamilies[intent.family],
    c = original?.cuts[intent.boundary];
  if (!c || c.ownerActive === undefined)
    return projectListBoundary(state, intent, action, host);
  if (c.ownerActive === intent.active)
    throw host.fail("List boundary ownership changed");
  const effective = intent.active || c.holds.some((h) => h.active);
  if (effective !== c.active)
    projectListBoundary(state, { ...intent, active: effective }, action, host);
  const family = structuredClone(state.listFamilies[intent.family]);
  family.cuts[intent.boundary].ownerActive = intent.active;
  host.write("listFamilies")[family.id] = family;
  return { ...intent, active: !intent.active };
}
export function executeListHold(state, intent, action, host) {
  const original = state.listFamilies[intent.family],
    cut = original?.cuts[intent.boundary];
  if (!cut || typeof cut.wrapper !== "string")
    throw host.fail("Unknown retained list boundary");
  const owner = cut.ownerActive ?? cut.active,
    holds = structuredClone(cut.holds || []);
  let id;
  if (intent.kind === "listHold") {
    id = action;
    if (holds.some((h) => h.id === id)) throw host.fail("Repeated list hold");
    holds.push({ id, active: true });
  } else {
    id = intent.target;
    const h = holds.find((h) => h.id === id);
    if (!h || h.active === intent.active)
      throw host.fail("List hold activity changed");
    h.active = intent.active;
  }
  const effective = owner || holds.some((h) => h.active);
  if (effective !== cut.active)
    projectListBoundary(
      state,
      {
        kind: "listBoundaryActive",
        family: original.id,
        boundary: cut.id,
        active: effective,
      },
      action,
      host,
    );
  const family = structuredClone(state.listFamilies[original.id]);
  Object.assign(family.cuts[cut.id], { ownerActive: owner, holds });
  host.write("listFamilies")[family.id] = family;
  return {
    kind: "listHoldActive",
    family: family.id,
    boundary: cut.id,
    target: id,
    active: intent.kind === "listHold" ? false : !intent.active,
  };
}
import { needsFlow, executeFlowBoundary } from "./flow-boundary.js";
import { compareErasedBoundaries } from "./boundaries.js";
// Shared paragraph partitions. A cut has identity and activation independent
// of prose adjacency or a list wrapper. The registry/Undo names are retained
// internally; family.kind distinguishes prose from legacy list families.
import { concatPieces, slicePieces } from "../text/pieces.js";
const isList = (n) => ["bullet_list", "ordered_list"].includes(n?.type);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function projectListBoundary(state, intent, action, host) {
  const { parent, resolve, fail, write, remember, repartition } = host;
  if (needsFlow(state, intent, parent, resolve))
    return executeFlowBoundary(
      state,
      intent,
      action,
      host,
      executeListBoundary,
    );
  const node = (id) => {
    const n = state.nodes[id];
    if (!n?.live) throw fail("List partition target is unavailable");
    return n;
  };
  const set = (id, patch) => {
    write("nodes")[id] = { ...state.nodes[id], ...patch };
  };
  const children = (id, ids) => set(id, { children: ids });
  const len = (id) => state.replicas[node(id).text].length;
  let family, cut;
  if (intent.kind === "listBoundaryActive") {
    const original = state.listFamilies[intent.family];
    if (!original) throw fail("Unknown logical list family");
    family = structuredClone(original);
    cut = family.cuts[intent.boundary];
    if (!cut || cut.active === intent.active)
      throw fail("List boundary activation changed");
  } else {
    const at = resolve(intent.at),
      p = node(at.block),
      item = parent(p.id),
      list = item && parent(item.id);
    const prose = intent.kind === "proseEnter";
    if (
      p.type !== "paragraph" ||
      (prose
        ? !(
            ["doc", "cell"].includes(item?.type) ||
            creationProseContainer(state, p.id, item)
          )
        : item?.type !== "list_item" ||
          !isList(list) ||
          item.children[0] !== p.id)
    )
      throw fail("Paragraph Enter context changed");
    const existing = Object.values(state.listFamilies).find((f) =>
      f.layout.blocks.includes(p.id),
    );
    if (existing) {
      if ((existing.kind === "prose") !== prose)
        throw fail("Paragraph family grammar changed");
      family = structuredClone(existing);
    } else if (prose)
      family = {
        id: `${action}:family`,
        kind: "prose",
        source: p.id,
        parent: item.id,
        order: ["home"],
        cuts: {},
        layout: { blocks: [p.id], home: 0 },
      };
    else {
      const child = state.nodes[item.children[1]];
      const attachments = item.children.slice(1);
      const generated = attachments.length && !isList(child);
      if (
        generated &&
        !attachments.every((id) => ["code", "image"].includes(node(id).type))
      )
        throw fail("List Enter beside mixed content requires review");
      const generatedId = generated ? `${action}:attachment-children` : null;
      if (generated) {
        if (state.nodes[generatedId])
          throw fail("Attachment child identity reused");
        write("nodes")[generatedId] = {
          id: generatedId,
          type: list.type,
          live: false,
          children: [],
        };
      }
      family = {
        id: `${action}:family`,
        source: p.id,
        homeItem: item.id,
        list: list.id,
        childList: isList(child) ? child.id : generatedId,
        ...(generated ? { generatedChildList: true } : {}),
        rest: item.children.slice(1),
        order: ["home"],
        cuts: {},
        layout: {
          blocks: [p.id],
          parentItems: [item.id],
          childItems: [],
          home: 0,
        },
        placements: { [item.id]: item.placement ?? null },
      };
    }
  }
  if (family.kind === "prose") {
    const owner = creationProseParent(state, family, parent);
    if (owner) family.parent = owner.id;
  }
  const layout = family.layout,
    sourceNodes = layout.blocks.map(node),
    baseOffsets = new Map();
  let total = 0;
  for (const n of sourceNodes) {
    baseOffsets.set(n.id, total);
    total += len(n.id);
  }
  const absolute = (marker) => {
    const m = state.boundaries[marker];
    if (!m || !baseOffsets.has(m.block))
      throw fail("List cut left its partition lineage");
    return baseOffsets.get(m.block) + m.offset;
  };
  // Check only participating topology. Unrelated siblings and all descendant
  // text may change. A real competing move/attachment produces a conflict.
  const prose = family.kind === "prose";
  let list, home, start, childList;
  const activeIds = family.order.filter(
    (id) => id !== "home" && family.cuts[id].active,
  );
  if (prose) {
    list = node(family.parent);
    start = list.children.indexOf(layout.blocks[0]);
    const members = new Set(layout.blocks);
    if (
      !(
        ["doc", "cell"].includes(list.type) ||
        creationProseContainer(state, family.source, list)
      ) ||
      start < 0 ||
      !same(
        list.children.filter((id) => members.has(id)),
        layout.blocks,
      ) ||
      sourceNodes.some(
        (n) => n.type !== "paragraph" || parent(n.id)?.id !== list.id,
      )
    )
      throw fail("Prose family acquired a structural dependency");
    // Foreign sibling blocks do not prevent Enter inside a paragraph. Removing
    // a cut must still not join text across any intervening structural content.
    if (intent.kind === "listBoundaryActive" && !intent.active) {
      const right = layout.blocks.indexOf(cut.block),
        at = list.children.indexOf(cut.block);
      if (right < 1 || list.children[at - 1] !== layout.blocks[right - 1])
        throw fail("Prose boundary has intervening structure; review Undo");
    }
  } else {
    list = node(family.list);
    home = node(family.homeItem);
    start = list.children.indexOf(layout.parentItems[0]);
    if (
      start < 0 ||
      !same(
        list.children.slice(start, start + layout.parentItems.length),
        layout.parentItems,
      ) ||
      parent(home.id)?.id !== list.id ||
      !same(home.children, [
        layout.blocks[layout.home],
        ...(family.generatedChildList && state.nodes[family.childList]?.live
          ? [family.childList]
          : []),
        ...family.rest.filter((id) => !state.nodes[id]?.creationHidden),
      ])
    )
      throw fail("List family acquired a structural dependency");
    for (const [id, token] of Object.entries(family.placements))
      if ((node(id).placement ?? null) !== token)
        throw fail("List item placement changed");
    for (const [i, block] of layout.blocks.entries())
      if (i !== layout.home) {
        const boundary = family.cuts[activeIds[i < layout.home ? i : i - 1]],
          wrapper = node(boundary.wrapper);
        if (!same(wrapper.children, [block]))
          throw fail("List item acquired a structural dependency");
      }
    childList =
      family.childList &&
      (family.generatedChildList
        ? state.nodes[family.childList]
        : node(family.childList));
    if (
      family.generatedChildList &&
      (!isList(childList) || childList.live !== !!childList.children.length)
    )
      throw fail("Generated child list lifecycle changed");
    if (
      childList &&
      !same(
        childList.children.slice(0, layout.childItems.length),
        layout.childItems,
      )
    )
      throw fail("First-child boundary placement changed");
  }
  if (intent.kind === "listBoundaryActive") cut.active = intent.active;
  else {
    const at = resolve(intent.at),
      part = layout.blocks.indexOf(at.block);
    if (part < 0) throw fail("List Enter left its source partitions");
    const position = baseOffsets.get(at.block) + at.offset,
      previous = part ? activeIds[part - 1] : null,
      next = activeIds[part] ?? null;
    let lo = previous ? family.order.indexOf(previous) + 1 : 0,
      hi = next ? family.order.indexOf(next) : family.order.length;
    const homeIndex = family.order.indexOf("home"),
      beforeHome =
        !prose &&
        (part < layout.home ||
          (part === layout.home &&
            at.offset === 0 &&
            !creationGapAfterStart(state, intent.at)));
    if (beforeHome) hi = Math.min(hi, homeIndex);
    else lo = Math.max(lo, homeIndex + 1);
    const id = `${action}:cut`,
      marker = `${action}:${prose ? "prose" : "list"}-cut`;
    remember(marker, at.block, at.offset, intent.at);
    let index = lo;
    while (index < hi) {
      const prior = family.cuts[family.order[index]].marker,
        offset = absolute(prior);
      if (
        offset > position ||
        (offset === position &&
          compareErasedBoundaries(state, prior, marker) > 0)
      )
        break;
      index++;
    }
    cut = {
      id,
      marker,
      block: prose ? `${action}:paragraph` : `${action}:list-tail`,
      ...(prose ? {} : { wrapper: `${action}:list-item` }),
      active: true,
    };
    family.cuts[id] = cut;
    family.order.splice(index, 0, id);
  }
  const active = family.order.filter(
      (id) => id !== "home" && family.cuts[id].active,
    ),
    homeIndex = family.order.indexOf("home"),
    homePart = family.order
      .slice(0, homeIndex)
      .filter((id) => family.cuts[id]?.active).length;
  const offsets = active.map((id) => absolute(family.cuts[id].marker));
  if (offsets.some((x, i) => x < 0 || x > total || (i && x < offsets[i - 1])))
    throw fail("List boundary order changed");
  const blocks = [family.source, ...active.map((id) => family.cuts[id].block)],
    pieces = concatPieces(
      ...sourceNodes.map((n) => state.replicas[n.text].pieces),
    ),
    cuts = [0, ...offsets, total];
  for (const block of blocks)
    if (!state.nodes[block])
      write("nodes")[block] = { id: block, type: "paragraph", live: false };
  repartition(
    layout.blocks,
    blocks.map((block, i) => ({
      block,
      pieces: slicePieces(pieces, cuts[i], cuts[i + 1]),
    })),
    action,
    active.map((id, i) => ({
      marker: family.cuts[id].marker,
      right: blocks[i + 1],
    })),
  );
  // An active cut is the structural start of its right partition, not a
  // right-affine text cursor. Insertions in that partition must stay after it.
  // Inactive cuts become ordinary retained positions until reactivation.
  for (const c of Object.values(family.cuts)) {
    const { edge, ...marker } = state.boundaries[c.marker];
    const index = active.indexOf(c.id);
    write("boundaries")[c.marker] =
      index < 0
        ? marker
        : { ...marker, block: blocks[index + 1], offset: 0, edge: "start" };
  }
  for (const block of layout.blocks)
    if (!blocks.includes(block)) set(block, { live: false });
  if (prose) {
    // Rewrite only family members, preserving every interleaved sibling at its
    // existing slot. New cuts belong immediately after their preceding member.
    const previous = new Set(layout.blocks),
      groups = new Map();
    let group;
    for (const block of blocks) {
      if (previous.has(block)) {
        group = [];
        groups.set(block, group);
      }
      group.push(block);
    }
    children(
      family.parent,
      list.children.flatMap((id) =>
        previous.has(id) ? groups.get(id) || [] : [id],
      ),
    );
    family.layout = { blocks, home: 0 };
  } else {
    const before = [],
      after = [],
      placements = {};
    for (const [i, block] of blocks.entries()) {
      if (i === homePart) continue;
      const boundary = family.cuts[active[i < homePart ? i : i - 1]],
        id = boundary.wrapper;
      write("nodes")[id] = {
        ...state.nodes[id],
        id,
        type: "list_item",
        live: true,
        children: [block],
        placement: state.nodes[id]?.placement ?? action,
      };
      placements[id] = state.nodes[id].placement;
      (i < homePart ? before : after).push(id);
    }
    for (const c of Object.values(family.cuts))
      if (!active.includes(c.id) && state.nodes[c.wrapper])
        set(c.wrapper, { live: false, children: [] });
    const parentItems = [
      ...before,
      family.homeItem,
      ...(childList ? [] : after),
    ];
    children(family.list, [
      ...list.children.slice(0, start),
      ...parentItems,
      ...list.children.slice(start + layout.parentItems.length),
    ]);
    if (childList) {
      const next = [
        ...after,
        ...childList.children.slice(layout.childItems.length),
      ];
      set(childList.id, {
        children: next,
        ...(family.generatedChildList ? { live: !!next.length } : {}),
      });
    }
    children(family.homeItem, [
      blocks[homePart],
      ...(family.generatedChildList && state.nodes[family.childList].live
        ? [family.childList]
        : []),
      ...family.rest.filter((id) => !state.nodes[id]?.creationHidden),
    ]);
    placements[family.homeItem] = home.placement ?? null;
    family.layout = {
      blocks,
      parentItems,
      childItems: childList ? after : [],
      home: homePart,
    };
    family.placements = placements;
  }
  write("listFamilies")[family.id] = family;
  return {
    kind: "listBoundaryActive",
    family: family.id,
    boundary: cut.id,
    active: !cut.active,
  };
}
