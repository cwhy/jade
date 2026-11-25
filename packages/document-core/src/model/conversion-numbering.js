// SPDX-License-Identifier: MPL-2.0
// Conversion owns a fixed set of authored marker slots. Structural cuts within
// its code remain valid identities, but are not additional visible list numbers.
import { listMarkers, retainedMarker } from "./list-marker.js";
import { runStart } from "./list-numbering.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function captureConversionNumbering(state, scope, items, extentFor) {
  const markers = new Map(listMarkers(state, scope).map((m) => [m.id, m]));
  return items.map((item) => {
    const block = state.nodes[item].children[0];
    return {
      item,
      block,
      extent: extentFor(state, block),
      type: markers.get(item).type,
      start: runStart(state.nodes[block]) ?? null,
    };
  });
}
export function validateConversionNumbering(
  state,
  scope,
  basis,
  windows,
  { review = false } = {},
) {
  if (!Array.isArray(basis) || !basis.length)
    throw Error("Missing conversion numbering basis");
  const seen = new Set(),
    intervals = [];
  const span = (extent) => {
    if (
      !extent ||
      Object.keys(extent).sort().join(",") !== "left,right,source" ||
      typeof extent.source !== "string" ||
      !state.nodes[extent.source]
    )
      throw Error("Invalid numbering source extent");
    const family = Object.values(state.listFamilies).find(
        (f) => f.kind !== "flow" && f.source === extent.source,
      ),
      cuts = family?.order.filter((id) => id !== "home") || [];
    for (const fence of [extent.left, extent.right])
      if (
        fence !== null &&
        (typeof fence !== "string" || !cuts.includes(fence))
      )
        throw Error("Unknown numbering extent fence");
    const from = extent.left === null ? 0 : cuts.indexOf(extent.left) + 1,
      to = extent.right === null ? Infinity : cuts.indexOf(extent.right) + 1;
    if (from >= to) throw Error("Invalid numbering extent order");
    return {
      source: extent.source,
      from,
      to,
      blocks: [extent.source, ...cuts.map((id) => family.cuts[id].block)],
    };
  };
  const selected = windows.map(span);
  for (const slot of basis) {
    if (
      !slot ||
      Object.keys(slot).sort().join(",") !== "block,extent,item,start,type" ||
      typeof slot.block !== "string" ||
      typeof slot.item !== "string" ||
      seen.has(slot.block) ||
      state.nodes[slot.block]?.type !== "paragraph" ||
      state.nodes[slot.item]?.type !== "list_item" ||
      !["ordered_list", "bullet_list"].includes(slot.type) ||
      (slot.start !== null &&
        (!Number.isSafeInteger(slot.start) || slot.start < 1))
    )
      throw Error("Invalid conversion marker slot");
    seen.add(slot.block);
    const own = span(slot.extent),
      index = own.blocks.indexOf(slot.block);
    if (
      index < own.from ||
      index >= own.to ||
      !selected.some(
        (s) => s.source === own.source && s.from <= own.from && s.to >= own.to,
      ) ||
      intervals.some(
        (s) => s.source === own.source && s.from < own.to && own.from < s.to,
      )
    )
      throw Error("Numbering slot is outside selected source");
    intervals.push(own);
    if (
      review &&
      (!same(
        retainedMarker(state, slot.item, slot.block, state.nodes[scope].type),
        slot.type,
      ) ||
        (runStart(state.nodes[slot.block]) ?? null) !== slot.start)
    )
      throw Error("List numbering changed; review conversion again");
  }
}
export function projectedListMarkers(state, scope, entries, groups) {
  const original = new Map(listMarkers(state, scope).map((m) => [m.id, m])),
    result = new Map(),
    used = new Set();
  let next = state.nodes[scope].order ?? 1,
    previous = new Set();
  for (const entry of entries) {
    const owners = groups.filter((g) =>
      entry.leaves.some((id) => g.members.has(id)),
    );
    if (owners.length) {
      for (const group of owners) {
        if (used.has(group.id) && !previous.has(group.id))
          throw Error("Conversion numbering scope is no longer contiguous");
        if (!used.has(group.id)) {
          for (const slot of group.numbering)
            if (slot.type === "ordered_list") {
              next = slot.start ?? next;
              next++;
            }
          used.add(group.id);
        }
      }
      previous = new Set(owners.map((group) => group.id));
      continue;
    }
    previous = new Set();
    const type = original.get(entry.id).type,
      paragraph = state.nodes[state.nodes[entry.id].children[0]];
    if (type === "ordered_list") next = runStart(paragraph) ?? next;
    result.set(entry.id, {
      id: entry.id,
      type,
      ...(type === "ordered_list" ? { number: next++ } : {}),
    });
  }
  return result;
}

// Only retained items consume the group's captured marker slots. Other items
// may have returned to the list after the original conversion was undone.
export function retainedNumbering(state, basis, members, owner) {
  return basis.filter((slot) => {
    const extent = slot.extent,
      family = Object.values(state.listFamilies).find(
        (f) => f.kind !== "flow" && f.source === extent.source,
      );
    const cuts = family?.order.filter((id) => id !== "home") || [];
    const blocks = [extent.source, ...cuts.map((id) => family.cuts[id].block)];
    const from = extent.left === null ? 0 : cuts.indexOf(extent.left) + 1;
    const to =
      extent.right === null ? blocks.length : cuts.indexOf(extent.right) + 1;
    return blocks.slice(from, to).some((id) => {
      let visible = id;
      if (family && !owner.has(id)) {
        const index = blocks.indexOf(id);
        const previous = cuts
          .slice(0, index)
          .findLast((c) => family.cuts[c].active);
        visible = previous ? family.cuts[previous].block : family.source;
      }
      return members.has(owner.get(visible));
    });
  });
}
