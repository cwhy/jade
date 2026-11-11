// SPDX-License-Identifier: MPL-2.0
import { apply, gapAt } from "../model/engine.js";
import { resolveCellRange } from "../selection/grid.js";
import { rowIds } from "../model/table-rows.js";
import { ReviewRequired } from "../selection/range.js";
import { tableContext } from "./table-context.js";

export function planInsertRow(
  state,
  range,
  op,
  { side = "below", focusFirst = false } = {},
) {
  if (!["above", "below"].includes(side))
    throw new ReviewRequired("Invalid row insertion side");
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
  const before =
    side === "above"
      ? row.id
      : (table.children[table.children.indexOf(row.id) + 1] ?? null);
  const intent = {
    kind: "tableInsertRow",
    table: table.id,
    template: row.id,
    before,
    columns: [...row.children],
  };
  const next = apply(state, { ...op, intent }),
    ids = rowIds(op.id, row.children.length),
    column = focusFirst ? 0 : row.children.indexOf(cell.id);
  return { intent, state: next, after: gapAt(next, ids.paragraphs[column], 0) };
}
