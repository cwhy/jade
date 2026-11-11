// SPDX-License-Identifier: MPL-2.0
import { captureRange, ReviewRequired } from "../selection/range.js";
import { tableContext } from "./table-context.js";
import { captureTableBoundary } from "../selection/table.js";
import { planInsertRow } from "./table-insertion.js";

// Existing-cell movement is selection only; the last-cell boundary delegates
// to the same structural insertion planner as the explicit row controls.
export function planNavigateCell(state, range, op, { direction = 1 } = {}) {
  if (direction !== 1 && direction !== -1)
    throw new ReviewRequired("Invalid cell direction");
  const { cell, cells, table } = tableContext(state, range);
  const target = cells[cells.indexOf(cell.id) + direction];
  if (!target) {
    if (direction === 1)
      return planInsertRow(state, range, op, {
        side: "below",
        focusFirst: true,
      });
    return {
      intent: null,
      state,
      selection: captureTableBoundary(state, table.id),
    };
  }
  function firstText(id) {
    const n = state.nodes[id];
    if (!n?.live) return;
    if (n.text) return id;
    for (const child of n.children || []) {
      const found = firstText(child);
      if (found) return found;
    }
  }
  const block = firstText(target);
  if (!block)
    throw new ReviewRequired(
      "Destination has no editable text; creating a paragraph is not qualified yet",
    );
  const point = { block, offset: 0 };
  return { intent: null, state, selection: captureRange(state, point, point) };
}
