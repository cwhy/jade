// SPDX-License-Identifier: MPL-2.0
import { planDelete as baseDelete } from "./list-routing.js";
import { planListForwardDelete } from "../model/join-commands.js";
import { resolveGap } from "../model/engine.js";
import { treeParent } from "../model/tree.js";
export { planEnter, planCodeIndent, planListIndent } from "./list-routing.js";
export { planReplace } from "./replace.js";
export { planNavigateCell } from "./table-navigation.js";
export { planInsertRow } from "./table-insertion.js";
export function planDelete(state, range, direction, op) {
  const at = resolveGap(state, range.start),
    node = state.nodes[at.block];
  if (
    direction === "forward" &&
    range.collapsed &&
    node.type === "paragraph" &&
    treeParent(state, node.id)?.type === "list_item" &&
    at.offset === state.replicas[node.text].length
  )
    return planListForwardDelete(state, range, op);
  return baseDelete(state, range, direction, op);
}

export { planBoundaryParagraph } from "./boundary-paragraph.js";

export { planClearCells } from "./cell-clear.js";

export { copyCells, previewCellPaste, planPasteCells } from "./cell-paste.js";

export { planInsertColumn } from "./column-insertion.js";

export { previewTableDelete, planTableDelete } from "./table-deletion.js";

export {
  previewColumnResize,
  planColumnResize,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
} from "./column-resize.js";

export { previewTableMove, planTableMove } from "./table-reorder.js";

export {
  previewRowResize,
  planRowResize,
  MIN_ROW_HEIGHT,
  MAX_ROW_HEIGHT,
} from "./row-resize.js";

export {
  previewCellStyle,
  planCellStyle,
  planHeaderRow,
  previewDistributeColumns,
  planDistributeColumns,
} from "./table-presentation.js";

export { textFormatState, planTextFormat } from "./text-format.js";
export { cellTextFormatState, planCellTextFormat } from "./cell-text-format.js";

export {
  linkContext,
  checkLinkTarget,
  planLink,
  validateLinkURL,
} from "./link.js";

export { previewCut, planCut } from "./cut.js";

export { copyRange, copyBlocks } from "./copy.js";

export { planRichInsert } from "./rich-insert.js";
