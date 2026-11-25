// SPDX-License-Identifier: MPL-2.0
import {
  captureDisplayJoin,
  needsDisplayBoundary,
} from "../model/display-boundary.js";
import { apply } from "../model/engine.js";
import { documentView } from "../document/read.js";
import { boundaryJoinIntent, joinTarget } from "../model/join-ledger.js";
import { ReviewRequired, validateDestination } from "../selection/range.js";
export function planProseJoin(state, range, direction, op) {
  if (!["backward", "forward"].includes(direction))
    throw new ReviewRequired("Unknown deletion direction");
  validateDestination(state, range);
  const view = documentView(state),
    at = view.resolveGap(range.start),
    node = view.node(at.block),
    owner = view.parent(node.id),
    index = owner?.children.indexOf(node.id);
  if (
    !range.collapsed ||
    node.type !== "paragraph" ||
    !["doc", "cell"].includes(owner?.type)
  )
    throw new ReviewRequired("Choose a prose paragraph boundary");
  const left =
      direction === "backward" ? view.node(owner.children[index - 1]) : node,
    right =
      direction === "backward" ? node : view.node(owner.children[index + 1]);
  if (left?.type !== "paragraph" || right?.type !== "paragraph")
    return { intent: null, state, after: range.start };
  const offset = view.length(left.id),
    after = view.gapAt(left.id, offset),
    rightSource = view.group(right.id).blocks[0],
    rightStart = view.gapAt(right.id, 0),
    leftSource = view.group(left.id).blocks.at(-1),
    intent = needsDisplayBoundary(state, leftSource, rightSource)
      ? captureDisplayJoin(state, owner.id, leftSource, rightSource)
      : boundaryJoinIntent(state, joinTarget(state, rightSource)),
    next = apply(state, { ...op, intent });
  const result = documentView(next);
  if (result.resolveGap(rightStart).block !== result.resolveGap(after).block)
    throw new ReviewRequired("Selected Body boundary did not join");
  return { intent, state: next, after };
}
