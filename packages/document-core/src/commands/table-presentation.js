// SPDX-License-Identifier: MPL-2.0
import { apply } from "../model/engine.js";
import { tableContext } from "./table-context.js";
import { resolveCellRange, captureCellRange } from "../selection/grid.js";
import { validateTableFormat } from "../model/table-format.js";
import {
  distributionWitness,
  validateDistribution,
  distributionWidth,
} from "../model/column-distribution.js";
function context(state, selection) {
  if (selection.kind === "cells") return resolveCellRange(state, selection);
  const c = tableContext(state, selection);
  return captureCellRange(state, c.table.id, c.cell.id);
}
export function previewCellStyle(state, selection) {
  const range = context(state, selection);
  return { table: range.table, targets: range.cells.flat() };
}
export function planCellStyle(state, selection, op, { preview, patch }) {
  const intent = { kind: "tableFormat", ...preview, patch };
  validateTableFormat(state, intent);
  if (
    intent.targets.every((id) =>
      Object.entries(patch).every(
        ([key, value]) => (state.nodes[id][key] ?? null) === value,
      ),
    )
  )
    return { intent: null, state, selection };
  return { intent, state: apply(state, { ...op, intent }), selection };
}
export function planHeaderRow(state, selection, op, { table, value }) {
  return planCellStyle(state, selection, op, {
    preview: { table, targets: [table] },
    patch: { headerRow: value },
  });
}
export const previewDistributeColumns = distributionWitness;
export function planDistributeColumns(state, selection, op, { preview }) {
  const intent = {
      kind: "tableDistributeColumns",
      table: preview?.table,
      expected: preview,
    },
    now = validateDistribution(state, intent),
    width = distributionWidth(now);
  if (
    now.columns.every((c) =>
      c.widths.every((x) => (x.width?.[0] ?? 200) === width),
    )
  )
    return { intent: null, state, selection };
  return { intent, state: apply(state, { ...op, intent }), selection };
}
