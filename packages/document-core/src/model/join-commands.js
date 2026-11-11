// SPDX-License-Identifier: MPL-2.0
import { apply, resolveGap, gapAt, Conflict } from "./engine.js";
import { treeParent } from "./tree.js";
import { joinTarget, supportedJoinLeft } from "./join-ledger.js";
import { ReviewRequired } from "../selection/range.js";

// Bounded forward Delete: only a collapsed caret at the end of a list's
// first paragraph. Attachment and topology checks remain authoritative in
// the model; the UI converts a refused plan into the existing lab notice.
export function planListForwardDelete(state, range, op) {
  const at = resolveGap(state, range.start),
    left = state.nodes[at.block];
  const item = treeParent(state, left.id),
    owner = item && treeParent(state, item.id);
  if (
    !range.collapsed ||
    left.type !== "paragraph" ||
    item?.type !== "list_item" ||
    item.children[0] !== left.id ||
    at.offset !== state.replicas[left.text].length
  )
    throw new ReviewRequired("This list Delete selection is not qualified");
  const child = state.nodes[item.children[1]],
    nested = ["ordered_list", "bullet_list"].includes(child?.type);
  if (!supportedJoinLeft(state, item, nested))
    throw new ReviewRequired(
      "Delete beside mixed attachments is not qualified",
    );
  const right =
    state.nodes[
      nested
        ? child.children[0]
        : owner.children[owner.children.indexOf(item.id) + 1]
    ];
  if (!right) return { intent: null, state, after: range.start };
  const intent = {
    kind: "listJoin",
    target: joinTarget(state, right.children[0]),
  };
  try {
    const next = apply(state, { ...op, intent });
    return { intent, state: next, after: gapAt(next, left.id, at.offset) };
  } catch (error) {
    if (error instanceof Conflict)
      throw new ReviewRequired(
        "This list Delete shape is not qualified: " + error.message,
      );
    throw error;
  }
}
