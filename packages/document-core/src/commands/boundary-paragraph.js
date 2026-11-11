// SPDX-License-Identifier: MPL-2.0
import { resolveTableBoundary } from "../selection/table.js";
import { ReviewRequired } from "../selection/range.js";
import { apply, gapAt } from "../model/engine.js";
import { boundaryParagraphIds } from "../model/boundary-paragraph.js";
export function planBoundaryParagraph(state, range, op, { text = "" } = {}) {
  const at = resolveTableBoundary(state, range);
  if (typeof text !== "string")
    throw new ReviewRequired("Boundary text must be a string");
  if (state.nodes[at.parent].type !== "doc")
    throw new ReviewRequired(
      "Typing at a nested table boundary is not qualified yet",
    );
  const intent = {
      kind: "insertBoundaryParagraph",
      parent: at.parent,
      table: at.before,
      text,
    },
    next = apply(state, { ...op, intent });
  return {
    intent,
    state: next,
    after: gapAt(next, boundaryParagraphIds(op.id).block, [...text].length),
  };
}
