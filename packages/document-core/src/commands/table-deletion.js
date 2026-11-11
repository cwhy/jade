// SPDX-License-Identifier: MPL-2.0
import { apply, gapAt } from "../model/engine.js";
import { deletionPlan } from "../model/table-deletion.js";
import { tableContext } from "./table-context.js";
import { captureCellRange, tableGrid } from "../selection/grid.js";
import { copyCells } from "./cell-paste.js";
function cells(state, selection) {
  if (selection.kind === "cells") return selection;
  const c = tableContext(state, selection);
  return captureCellRange(state, c.table.id, c.cell.id);
}
export function previewTableDelete(state, selection, axis) {
  const selected = cells(state, selection),
    p = deletionPlan(state, selected, axis);
  return {
    version: 1,
    ...p,
    selection: selected,
    before: copyCells(state, p.range),
  };
}
export function planTableDelete(state, selection, op, { preview }) {
  if (preview?.version !== 1) throw Error("Review table deletion first");
  const intent = {
      kind: "tableDelete",
      axis: preview.axis,
      selection: preview.selection,
      geometry: preview.geometry,
      witness: preview.witness,
    },
    next = apply(state, { ...op, intent });
  if (preview.whole)
    return {
      intent,
      state: next,
      after: gapAt(next, `${op.id}:table-replacement`, 0),
    };
  const old = tableGrid(state, preview.range.table),
    g = tableGrid(next, preview.range.table),
    focus = preview.selection.focus;
  const row = old.cells.findIndex((r) => r.includes(focus)),
    col = old.cells[row].indexOf(focus);
  const target =
    preview.axis === "rows"
      ? g.cells[Math.min(preview.top, g.rows.length - 1)][col]
      : g.cells[row][Math.min(preview.left, g.cells[0].length - 1)];
  return {
    intent,
    state: next,
    selection: captureCellRange(next, g.table.id, target),
  };
}
