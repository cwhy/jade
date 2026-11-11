// SPDX-License-Identifier: MPL-2.0
import { apply } from "../model/engine.js";
import {
  tableOrderWitness,
  validateTableMove,
} from "../model/table-reorder.js";
import { tableContext } from "./table-context.js";
import {
  captureCellRange,
  resolveCellRange,
  tableGrid,
} from "../selection/grid.js";
export function previewTableMove(state, selection, axis) {
  const r =
    selection.kind === "cells"
      ? resolveCellRange(state, selection)
      : (() => {
          const c = tableContext(state, selection);
          return captureCellRange(state, c.table.id, c.cell.id);
        })();
  const grid = tableGrid(state, r.table),
    expected = tableOrderWitness(state, r.table, axis);
  const column = grid.cells
      .find((row) => row.includes(r.anchor))
      .indexOf(r.anchor),
    focus = grid.cells.find((row) => row.includes(r.focus)).indexOf(r.focus);
  const targets =
    axis === "rows"
      ? [...r.rows]
      : expected.order.slice(
          Math.min(column, focus),
          Math.max(column, focus) + 1,
        );
  return { table: r.table, axis, targets, expected };
}
export function planTableMove(state, selection, op, { preview, before }) {
  if (selection.kind === "cells") resolveCellRange(state, selection);
  const intent = { kind: "tableMove", ...preview, before },
    order = validateTableMove(state, intent);
  if (JSON.stringify(order) === JSON.stringify(preview.expected.order))
    return { intent: null, state, selection };
  const next = apply(state, { ...op, intent });
  return {
    intent,
    state: next,
    selection:
      selection.kind === "cells"
        ? captureCellRange(
            next,
            selection.table,
            selection.anchor,
            selection.focus,
          )
        : selection,
  };
}
