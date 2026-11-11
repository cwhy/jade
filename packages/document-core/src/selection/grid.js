// SPDX-License-Identifier: MPL-2.0
// Pure grid identity queries shared by view selection and authority admission.
// No text engine/planner import: the server must not depend on range planning.
import { selectionStructure } from "./structure.js";
const fail = (message) => {
  throw new Error(message);
};
export function tableGrid(state, tableId) {
  const table = state.nodes[tableId],
    structure = selectionStructure(state);
  if (!table?.live || table.type !== "table" || !structure.parent(tableId))
    fail("Table selection target is unavailable");
  const rows = table.children,
    cells = rows.map((id) => {
      const row = state.nodes[id];
      if (!row?.live || row.type !== "row" || !row.children.length)
        fail("Invalid table grid");
      return row.children.map((id) => {
        const c = state.nodes[id];
        if (
          !c?.live ||
          c.type !== "cell" ||
          (c.colspan ?? 1) !== 1 ||
          (c.rowspan ?? 1) !== 1
        )
          fail("Selection requires a regular grid");
        return id;
      });
    });
  if (!rows.length || cells.some((row) => row.length !== cells[0].length))
    fail("Selection requires a regular grid");
  return { table, rows, cells };
}
function locate(grid, id) {
  for (let row = 0; row < grid.cells.length; row++) {
    const col = grid.cells[row].indexOf(id);
    if (col >= 0) return { row, col };
  }
  fail("Selected cell is no longer in this table");
}
// Local view state only. Identity snapshots prevent a changed rectangle from
// silently expanding its targets after a peer inserts or moves a row/column.
export function captureCellRange(state, table, anchor, focus = anchor) {
  const grid = tableGrid(state, table),
    a = locate(grid, anchor),
    f = locate(grid, focus);
  const top = Math.min(a.row, f.row),
    bottom = Math.max(a.row, f.row),
    left = Math.min(a.col, f.col),
    right = Math.max(a.col, f.col);
  return {
    kind: "cells",
    version: 1,
    epoch: state.epoch,
    table,
    anchor,
    focus,
    rows: grid.rows.slice(top, bottom + 1),
    cells: grid.cells
      .slice(top, bottom + 1)
      .map((row) => row.slice(left, right + 1)),
  };
}
export function resolveCellRange(state, range) {
  if (
    range?.kind !== "cells" ||
    range.version !== 1 ||
    range.epoch !== state.epoch
  )
    fail("Document changed; select cells again");
  const now = captureCellRange(state, range.table, range.anchor, range.focus);
  if (
    JSON.stringify(now.rows) !== JSON.stringify(range.rows) ||
    JSON.stringify(now.cells) !== JSON.stringify(range.cells)
  )
    fail("Table structure changed; select cells again");
  return now;
}
