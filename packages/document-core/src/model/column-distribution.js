// SPDX-License-Identifier: MPL-2.0
import { tableGrid } from "../selection/grid.js";
import { columnView } from "./table-columns.js";
import {
  columnResizeWitness,
  executeColumnResize,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
} from "./column-resize.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function distributionWitness(state, tableId) {
  const g = tableGrid(state, tableId),
    v = columnView(state, g.table);
  return {
    table: tableId,
    columns: v.order
      .filter((id) => v.columns[id].active)
      .map((id) => columnResizeWitness(state, tableId, id)),
  };
}
export function distributionWidth(witness) {
  const total = witness.columns.reduce(
      (n, c) => n + (c.widths[0].width?.[0] ?? 200),
      0,
    ),
    width = Math.max(MIN_COLUMN_WIDTH, total / witness.columns.length);
  if (!Number.isFinite(width) || width > MAX_COLUMN_WIDTH)
    throw Error("Distributed width exceeds the supported size");
  return width;
}
export function validateDistribution(state, intent) {
  const now = distributionWitness(state, intent.table);
  if (!same(now, intent.expected))
    throw Error("Table widths or structure changed; review distribution again");
  distributionWidth(now);
  return now;
}
export function executeDistribution(state, intent, action, { write, fail }) {
  const now = distributionWitness(state, intent.table);
  if (!same(now, intent.expected))
    throw fail(
      "Table widths or structure changed; Undo/Redo cannot overwrite them",
    );
  const adding = intent.kind === "tableDistributeColumns",
    width = adding ? distributionWidth(now) : null,
    values = adding
      ? now.columns.map((c) =>
          c.widths.map((x) => ({ id: x.id, width: [width], owner: action })),
        )
      : intent.values;
  if (!Array.isArray(values) || values.length !== now.columns.length)
    throw fail("Distribution restoration changed");
  const inverses = now.columns.map((c, i) =>
    executeColumnResize(
      state,
      {
        kind: "restoreColumnWidth",
        table: now.table,
        column: c.column,
        expected: c,
        values: values[i],
      },
      action,
      { write, fail },
    ),
  );
  return {
    kind: "restoreDistributedWidths",
    table: now.table,
    expected: distributionWitness(state, now.table),
    values: inverses.map((x) => x.values),
  };
}
