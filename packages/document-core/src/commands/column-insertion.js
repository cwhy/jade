// SPDX-License-Identifier: MPL-2.0
import { apply, gapAt } from "../model/engine.js";
import { columnView, columnIds } from "../model/table-columns.js";
import { tableContext } from "./table-context.js";
import { resolveCellRange } from "../selection/grid.js";
import { ReviewRequired } from "../selection/range.js";
export function planInsertColumn(state, range, op, { side = "right" } = {}) {
  if (!["left", "right"].includes(side))
    throw new ReviewRequired("Invalid column insertion side");
  let table, row, cell;
  if (range.kind === "cells") {
    const selected = resolveCellRange(state, range);
    table = state.nodes[selected.table];
    row =
      state.nodes[
        selected.rows.find((id) =>
          state.nodes[id].children.includes(selected.focus),
        )
      ];
    cell = state.nodes[selected.focus];
  } else ({ table, row, cell } = tableContext(state, range));
  const view = columnView(state, table),
    active = view.order.filter((id) => view.columns[id].active),
    at = row.children.indexOf(cell.id),
    template = active[at];
  const before = side === "left" ? template : (active[at + 1] ?? null),
    intent = { kind: "tableInsertColumn", table: table.id, template, before };
  const next = apply(state, { ...op, intent }),
    ids = columnIds(op.id, row.id);
  return { intent, state: next, after: gapAt(next, ids.paragraph, 0) };
}
