// SPDX-License-Identifier: MPL-2.0
import { tableGrid } from "../selection/grid.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const MIN_ROW_HEIGHT = 24;
export const MAX_ROW_HEIGHT = 10000; // Defensive lab bound; content may grow beyond it.
const valid = (value) =>
  Number.isSafeInteger(value) &&
  value >= MIN_ROW_HEIGHT &&
  value <= MAX_ROW_HEIGHT;
export function rowResizeWitness(state, tableId, rowId) {
  const grid = tableGrid(state, tableId),
    row = state.nodes[rowId];
  if (!grid.rows.includes(rowId) || !row?.live || row.type !== "row")
    throw Error("Resize row is unavailable");
  return {
    table: tableId,
    row: rowId,
    height: row.minHeight ?? null,
    owner: row.heightOwner ?? null,
  };
}
export function validateRowResize(state, intent) {
  if (intent.height !== null && !valid(intent.height))
    throw Error(
      "Row minimum height must be an integer between 24 and 10000 pixels, or null for automatic",
    );
  const current = rowResizeWitness(state, intent.table, intent.row);
  if (!same(current, intent.expected))
    throw Error("Row height changed; start resizing again");
  return current;
}
export function validateRowHeightOwners(state) {
  for (const n of Object.values(state.nodes))
    if (n.minHeight !== undefined || n.heightOwner !== undefined) {
      if (
        n.type !== "row" ||
        (n.minHeight !== undefined && !valid(n.minHeight)) ||
        (n.heightOwner !== undefined &&
          (typeof n.heightOwner !== "string" || !n.heightOwner))
      )
        throw Error("Invalid row height ownership");
    }
}
export function executeRowResize(state, intent, action, { write, fail }) {
  const current = rowResizeWitness(state, intent.table, intent.row);
  if (!same(current, intent.expected))
    throw fail("Row height changed; Undo/Redo cannot overwrite it");
  const height = intent.height,
    owner = intent.kind === "tableResizeRow" ? action : intent.owner;
  if (
    (height !== null && !valid(height)) ||
    (owner !== null && (typeof owner !== "string" || !owner))
  )
    throw fail("Invalid row height restoration");
  const row = { ...state.nodes[current.row] };
  if (height === null) delete row.minHeight;
  else row.minHeight = height;
  if (owner === null) delete row.heightOwner;
  else row.heightOwner = owner;
  write("nodes")[row.id] = row;
  return {
    kind: "restoreRowHeight",
    table: current.table,
    row: current.row,
    expected: rowResizeWitness(state, current.table, current.row),
    height: current.height,
    owner: current.owner,
  };
}
