// SPDX-License-Identifier: MPL-2.0
// Presentation follows certified source retirement; it never owns retirement.
// A dead physical join source is not retired and must retain its ordinary rules.
export function sourceRecordRetired(state, record) {
  const roots = record.windows?.map((w) => w.source) || [
    record.left?.extent?.source,
    record.right?.extent?.source,
  ];
  let retired = false;
  for (const id of new Set([record.parent, ...roots])) {
    const node = state.nodes[id];
    if (!node) throw Error("Missing retained presentation source");
    const token = node.clearedBy || node.structureDeletedBy;
    if (!token) continue;
    if (
      node.live ||
      node.retiredBy !== token ||
      (node.text && !state.replicas[node.text]?.retired)
    )
      throw Error("Invalid presentation source retirement");
    retired = true;
  }
  return retired;
}
export function cellPresentationWitness(state, cells) {
  const parent = new Set(cells),
    root = state.nodes[state.root];
  const conversions = (root.textConversions || []).filter(
    (e) => parent.has(e.parent) && e.active && !sourceRecordRetired(state, e),
  );
  const joins = (root.displayJoins || []).filter(
    (e) => parent.has(e.parent) && e.active && !sourceRecordRetired(state, e),
  );
  return conversions.length || joins.length ? { conversions, joins } : null;
}
