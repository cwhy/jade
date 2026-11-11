// SPDX-License-Identifier: MPL-2.0
// Capture the authored side of a coincident logical cut in the immutable gap.
// Neighbour IDs alone cannot distinguish the end of its left partition from
// the start of its right partition once Undo has joined those partitions.
// Only coincident cuts need this extra information; ordinary positions retain
// their existing atom-relative representation. This includes empty partitions.
export function listGapAffinities(state, block, offset) {
  const family = Object.values(state.listFamilies).find((f) =>
    f.layout.blocks.includes(block),
  );
  if (!family) return {};
  const bases = new Map();
  let total = 0;
  for (const id of family.layout.blocks) {
    bases.set(id, total);
    total += state.replicas[state.nodes[id].text].length;
  }
  const position = bases.get(block) + offset,
    part = family.layout.blocks.indexOf(block);
  const active = family.order.filter(
      (id) => id !== "home" && family.cuts[id].active,
    ),
    listAffinity = {};
  for (const c of Object.values(family.cuts)) {
    const marker = state.boundaries[c.marker];
    if (bases.get(marker.block) + marker.offset !== position) continue;
    // Active cut order disambiguates adjacent empty partitions. An inactive
    // cut at an interior caret defaults to its right; an explicit end is left.
    listAffinity[c.marker] = c.active
      ? part <= active.indexOf(c.id)
        ? "left"
        : "right"
      : offset === state.replicas[state.nodes[block].text].length && offset > 0
        ? "left"
        : "right";
  }
  return Object.keys(listAffinity).length ? { listAffinity } : {};
}
