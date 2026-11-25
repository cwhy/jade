// SPDX-License-Identifier: MPL-2.0
// Enter partitions the leading paragraph. Following non-list blocks remain
// independent siblings under the original item, before and after boundary Undo.
// A child list has its own traversal/ownership rule and is not a suffix block.
export function isRetainedListSuffix(state, ids) {
  return ids.every((id) =>
    ["paragraph", "code", "image"].includes(state.nodes[id]?.type),
  );
}
