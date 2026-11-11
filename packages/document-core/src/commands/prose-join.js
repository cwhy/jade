// SPDX-License-Identifier: MPL-2.0
import { apply, resolveGap, gapAt } from "../model/engine.js";
import { treeParent } from "../model/tree.js";
import { joinTarget } from "../model/join-ledger.js";
import { ReviewRequired } from "../selection/range.js";
export function planProseJoin(state, range, direction, op) {
  const at = resolveGap(state, range.start),
    node = state.nodes[at.block],
    owner = treeParent(state, node.id),
    index = owner?.children.indexOf(node.id);
  if (
    !range.collapsed ||
    node.type !== "paragraph" ||
    !["doc", "cell"].includes(owner?.type)
  )
    throw new ReviewRequired("Choose a prose paragraph boundary");
  const left =
      direction === "backward" ? state.nodes[owner.children[index - 1]] : node,
    right =
      direction === "backward" ? node : state.nodes[owner.children[index + 1]];
  if (left?.type !== "paragraph" || right?.type !== "paragraph")
    return { intent: null, state, after: range.start };
  const offset = state.replicas[left.text].length,
    intent = { kind: "proseJoin", target: joinTarget(state, right.id) },
    next = apply(state, { ...op, intent });
  return { intent, state: next, after: gapAt(next, left.id, offset) };
}
