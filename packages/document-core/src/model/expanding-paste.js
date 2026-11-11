// SPDX-License-Identifier: MPL-2.0
import {
  tableGrid,
  resolveCellRange,
  captureCellRange,
} from "../selection/grid.js";
import { validateGridFragment, validateGridAssets } from "../grid-fragment.js";
import { cellWitness } from "./cell-clear.js";
import { columnView } from "./table-columns.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Freeze grid identities and widths, but witness only existing destinations:
// unrelated peer typing remains admissible; reshaping requires a fresh review.
export function expansionPlan(state, selection, input) {
  const selected = resolveCellRange(state, selection),
    fragment = validateGridFragment(input);
  validateGridAssets(state, fragment);
  const grid = tableGrid(state, selected.table),
    first = selected.cells[0][0];
  const top = grid.cells.findIndex((row) => row.includes(first)),
    left = grid.cells[top].indexOf(first);
  const addRows = Math.max(0, top + fragment.rows.length - grid.rows.length),
    addColumns = Math.max(
      0,
      left + fragment.rows[0].length - grid.cells[0].length,
    );
  if (!addRows && !addColumns) throw Error("Table expansion is not needed");
  // Bound cells created outside the pasted rectangle as well as the clipboard.
  const born =
    (grid.rows.length + addRows) * (grid.cells[0].length + addColumns) -
    grid.rows.length * grid.cells[0].length;
  if (born > 2000)
    throw Error("Table expansion exceeds the 2000 new-cell lab limit");
  const cells = fragment.rows.map((row, i) =>
    row.map((_, j) => grid.cells[top + i]?.[left + j] ?? null),
  );
  const geometry = {
    rows: [...grid.rows],
    cells: grid.cells.map((row) => [...row]),
    widths: grid.cells.map((row) =>
      row.map((id) => state.nodes[id].colwidth ?? null),
    ),
  };
  return {
    top,
    left,
    addRows,
    addColumns,
    cells,
    geometry,
    witness: cellWitness(state, cells.flat().filter(Boolean)),
    fragment,
    selected,
  };
}
export function validateExpandingPaste(state, intent) {
  const plan = expansionPlan(state, intent.selection, intent.fragment);
  if (!same(plan.geometry, intent.geometry))
    throw Error("Table geometry changed; review expansion again");
  if (!same(plan.witness, intent.witness))
    throw Error("Destination content changed; review expansion again");
  return plan;
}
export function executeExpandingPaste(state, intent, action, execute) {
  // Admission checked the visible projection before join materialization. The
  // executor only derives new identities; no raw client batch can reach it.
  const grid = tableGrid(state, intent.selection.table),
    first = intent.selection.cells[0][0];
  const top = grid.cells.findIndex((row) => row.includes(first)),
    left = grid.cells[top].indexOf(first),
    table = grid.table.id;
  const addRows = Math.max(
      0,
      top + intent.fragment.rows.length - grid.rows.length,
    ),
    addColumns = Math.max(
      0,
      left + intent.fragment.rows[0].length - grid.cells[0].length,
    ),
    inverses = [];
  for (let i = 0; i < addColumns; i++) {
    const view = columnView(state, state.nodes[table]),
      template = view.order.filter((id) => view.columns[id].active).at(-1);
    inverses.push(
      execute(
        { kind: "tableInsertColumn", table, template, before: null },
        `${action}:expand-column:${i}`,
      ),
    );
  }
  for (let i = 0; i < addRows; i++) {
    const template = state.nodes[table].children.at(-1);
    inverses.push(
      execute(
        {
          kind: "tableInsertRow",
          table,
          template,
          before: null,
          columns: [...state.nodes[template].children],
        },
        `${action}:expand-row:${i}`,
      ),
    );
  }
  const expanded = tableGrid(state, table),
    last =
      expanded.cells[top + intent.fragment.rows.length - 1][
        left + intent.fragment.rows[0].length - 1
      ];
  const range = captureCellRange(state, table, first, last);
  inverses.push(
    execute(
      { kind: "pasteCells", range, fragment: intent.fragment },
      `${action}:expand-content`,
    ),
  );
  return { kind: "batch", intents: inverses.reverse() };
}
