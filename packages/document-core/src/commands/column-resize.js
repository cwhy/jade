// SPDX-License-Identifier: MPL-2.0
import { apply } from "../model/engine.js";
import { selectionStructure } from "../selection/structure.js";
import { columnView } from "../model/table-columns.js";
import {
  columnResizeWitness,
  validateColumnResize,
} from "../model/column-resize.js";
export { MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH } from "../model/column-resize.js";
export function previewColumnResize(state, cellId) {
  const structure = selectionStructure(state),
    cell = state.nodes[cellId],
    row = structure.parent(cellId),
    table = row && structure.parent(row.id);
  if (
    !cell?.live ||
    cell.type !== "cell" ||
    row?.type !== "row" ||
    table?.type !== "table"
  )
    throw Error("Resize target is unavailable; choose another column");
  const view = columnView(state, table),
    column = view.order.find(
      (id) =>
        view.columns[id].active && view.columns[id].cells[row.id] === cellId,
    );
  return columnResizeWitness(state, table.id, column);
}
export function planColumnResize(state, selection, op, { preview, width }) {
  const intent = {
    kind: "tableResizeColumn",
    table: preview?.table,
    column: preview?.column,
    expected: preview,
    width,
  };
  validateColumnResize(state, intent);
  if (preview.widths.every((x) => (x.width?.[0] ?? 200) === width))
    return { intent: null, state, selection };
  return { intent, state: apply(state, { ...op, intent }), selection };
}
