// SPDX-License-Identifier: MPL-2.0
import { selectionStructure } from "../selection/structure.js";
import { resolveCellRange } from "../selection/grid.js";
import {
  validateDestination,
  fragmentOf,
  ReviewRequired,
} from "../selection/range.js";
import { validateFragment, plainFragment } from "../fragment.js";
import { cellWitness, validateClearRequest } from "../model/cell-clear.js";
import { copyCells } from "./cell-paste.js";
import { planClearCells } from "./cell-clear.js";
import { planReplace } from "./replace.js";
// A Cut lease is local command state, never a durable operation. Capture the
// transferable content before the clipboard write; revalidate before removal.
export function previewCut(state, selection) {
  if (selection?.kind === "cells") {
    const range = resolveCellRange(state, selection);
    return {
      version: 1,
      kind: "cells",
      range,
      fragment: copyCells(state, range),
      witness: cellWitness(state, range.cells.flat()),
    };
  }
  if (selection?.kind)
    throw new ReviewRequired("Select text or a cell rectangle to cut");
  const range = validateDestination(state, selection);
  if (range.collapsed) return null;
  if (range.slices.length > 1) {
    const parent = selectionStructure(state).parent(range.slices[0].block),
      start = parent?.children.indexOf(range.slices[0].block);
    if (
      !["doc", "cell"].includes(parent?.type) ||
      range.slices.some(
        (s, i) =>
          s.type !== "paragraph" ||
          s.parent !== parent.id ||
          parent.children[start + i] !== s.block,
      )
    )
      throw new ReviewRequired(
        "Cut across these block boundaries needs structural clipboard support; select prose within one container or whole cells",
      );
  }
  return {
    version: 1,
    kind: "text",
    range,
    fragment: validateFragment(fragmentOf(range)),
  };
}
export function planCut(state, preview, op) {
  if (preview?.version !== 1)
    throw new ReviewRequired("Cut selection is unavailable");
  if (preview.kind === "cells") {
    validateClearRequest(state, preview);
    return planClearCells(state, preview.range, op);
  }
  if (preview.kind !== "text")
    throw new ReviewRequired("Unknown cut selection");
  validateDestination(state, preview.range);
  return planReplace(state, preview.range, plainFragment(""), op, {
    strict: true,
  });
}
