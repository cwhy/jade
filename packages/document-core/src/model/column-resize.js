// SPDX-License-Identifier: MPL-2.0
import { tableGrid } from "../selection/grid.js";
import { columnView } from "./table-columns.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const MIN_COLUMN_WIDTH = 120;
export const MAX_COLUMN_WIDTH = 10000; // Defensive lab admission bound, not a product capacity promise.
export function columnResizeWitness(state, tableId, column) {
  const grid = tableGrid(state, tableId),
    view = columnView(state, grid.table),
    entry = view.columns[column];
  if (!entry?.active) throw Error("Resize column is unavailable");
  const cells = grid.rows.map((row) => entry.cells[row]);
  const widths = cells.map((id) => {
    const n = state.nodes[id],
      width = n?.colwidth ?? null;
    if (
      !n?.live ||
      n.type !== "cell" ||
      (width !== null &&
        (!Array.isArray(width) ||
          width.length !== 1 ||
          !Number.isFinite(width[0]) ||
          width[0] <= 0))
    )
      throw Error("Invalid existing column width");
    return { id, width: width && [...width], owner: n.widthOwner ?? null };
  });
  return { table: tableId, column, rows: [...grid.rows], cells, widths };
}
export function validateColumnResize(state, intent) {
  if (
    !Number.isSafeInteger(intent.width) ||
    intent.width < MIN_COLUMN_WIDTH ||
    intent.width > MAX_COLUMN_WIDTH
  )
    throw Error("Column width must be an integer between 120 and 10000 pixels");
  const current = columnResizeWitness(state, intent.table, intent.column);
  if (!same(current, intent.expected))
    throw Error("Column width or row structure changed; start resizing again");
  return current;
}
export function validateColumnWidthOwners(state) {
  for (const n of Object.values(state.nodes))
    if (n.widthOwner !== undefined) {
      if (
        n.type !== "cell" ||
        typeof n.widthOwner !== "string" ||
        !n.widthOwner ||
        !Array.isArray(n.colwidth) ||
        n.colwidth.length !== 1 ||
        !Number.isFinite(n.colwidth[0]) ||
        n.colwidth[0] <= 0
      )
        throw Error("Invalid column width ownership");
    }
}
export function executeColumnResize(state, intent, action, { write, fail }) {
  const current = columnResizeWitness(state, intent.table, intent.column);
  if (!same(current, intent.expected))
    throw fail(
      "Column width or row structure changed; Undo/Redo cannot overwrite it",
    );
  const before = current.widths;
  const values =
    intent.kind === "tableResizeColumn"
      ? before.map((x) => ({ id: x.id, width: [intent.width], owner: action }))
      : intent.values;
  if (
    !Array.isArray(values) ||
    !same(
      values.map((x) => x.id),
      current.cells,
    )
  )
    throw fail("Resize restoration identities changed");
  for (const value of values) {
    const n = { ...state.nodes[value.id] };
    if (value.width === null) delete n.colwidth;
    else n.colwidth = [...value.width];
    if (value.owner === null) delete n.widthOwner;
    else n.widthOwner = value.owner;
    write("nodes")[n.id] = n;
  }
  return {
    kind: "restoreColumnWidth",
    table: current.table,
    column: current.column,
    expected: columnResizeWitness(state, current.table, current.column),
    values: before,
  };
}
