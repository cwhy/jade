// SPDX-License-Identifier: MPL-2.0
import { selectionStructure } from "./structure.js";
import { captureRange, ReviewRequired } from "./range.js";
const fail = (message) => {
  throw new ReviewRequired(message);
};
import * as grid from "./grid.js";
const selectionQuery =
  (fn) =>
  (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      throw new ReviewRequired(error.message);
    }
  };
const tableGrid = selectionQuery(grid.tableGrid);
export const captureCellRange = selectionQuery(grid.captureCellRange);
export const resolveCellRange = selectionQuery(grid.resolveCellRange);
export function captureTableBoundary(state, tableId) {
  const { table } = tableGrid(state, tableId),
    parent = selectionStructure(state).parent(table.id);
  return {
    kind: "boundary",
    version: 1,
    epoch: state.epoch,
    parent: parent.id,
    before: table.id,
  };
}
export function resolveTableBoundary(state, range) {
  if (
    range?.kind !== "boundary" ||
    range.version !== 1 ||
    range.epoch !== state.epoch
  )
    fail("Document changed; select the table boundary again");
  const now = captureTableBoundary(state, range.before);
  if (now.parent !== range.parent)
    fail("Table boundary moved; select it again");
  return now;
}
export function firstCellText(state, cell) {
  function walk(id) {
    const n = state.nodes[id];
    if (!n?.live) return;
    if (n.text) return id;
    for (const child of n.children || []) {
      const found = walk(child);
      if (found) return found;
    }
  }
  const block = walk(cell);
  if (!block)
    fail(
      "Destination has no editable text; creating a paragraph is not qualified yet",
    );
  return captureRange(state, { block, offset: 0 }, { block, offset: 0 });
}
export function leaveTableSelection(state, range) {
  if (range.kind === "cells") {
    const current = resolveCellRange(state, range);
    return firstCellText(state, current.focus);
  }
  const current = resolveTableBoundary(state, range),
    grid = tableGrid(state, current.before);
  return firstCellText(state, grid.cells[0][0]);
}
