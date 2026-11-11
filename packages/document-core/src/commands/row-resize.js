// SPDX-License-Identifier: MPL-2.0
import { apply } from "../model/engine.js";
import { selectionStructure } from "../selection/structure.js";
import { rowResizeWitness, validateRowResize } from "../model/row-resize.js";
export { MIN_ROW_HEIGHT, MAX_ROW_HEIGHT } from "../model/row-resize.js";
export function previewRowResize(state, cellId) {
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
    throw Error("Resize target is unavailable; choose another row");
  return rowResizeWitness(state, table.id, row.id);
}
export function planRowResize(state, selection, op, { preview, height }) {
  const intent = {
    kind: "tableResizeRow",
    table: preview?.table,
    row: preview?.row,
    expected: preview,
    height,
  };
  validateRowResize(state, intent);
  if (preview.height === height) return { intent: null, state, selection };
  return { intent, state: apply(state, { ...op, intent }), selection };
}
