// SPDX-License-Identifier: MPL-2.0
import { tableGrid } from "../selection/grid.js";
import { columnView } from "./table-columns.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const field = (axis) =>
  axis === "rows" ? "rowOrderOwner" : "columnOrderOwner";
export function tableOrderWitness(state, tableId, axis) {
  if (!["rows", "columns"].includes(axis)) throw Error("Invalid move axis");
  const { table, rows } = tableGrid(state, tableId),
    v = columnView(state, table);
  return {
    order:
      axis === "rows"
        ? [...rows]
        : v.order.filter((id) => v.columns[id].active),
    owner: table[field(axis)] ?? null,
  };
}
export function reordered(order, targets, before) {
  if (
    !Array.isArray(targets) ||
    !targets.length ||
    new Set(targets).size !== targets.length
  )
    throw Error("Select adjacent rows or columns");
  const start = order.indexOf(targets[0]);
  if (start < 0 || !same(order.slice(start, start + targets.length), targets))
    throw Error("Move selection changed; select again");
  if (before !== null && (!order.includes(before) || targets.includes(before)))
    throw Error("Move destination is unavailable");
  const rest = order.filter((id) => !targets.includes(id));
  rest.splice(
    before === null ? rest.length : rest.indexOf(before),
    0,
    ...targets,
  );
  return rest;
}
export function validateTableMove(state, intent) {
  const current = tableOrderWitness(state, intent.table, intent.axis);
  if (!same(current, intent.expected))
    throw Error("Table order changed; review the move again");
  return reordered(current.order, intent.targets, intent.before);
}
export function validateTableOrderOwners(state) {
  for (const n of Object.values(state.nodes))
    for (const f of ["rowOrderOwner", "columnOrderOwner"])
      if (
        n[f] !== undefined &&
        (n.type !== "table" || typeof n[f] !== "string" || !n[f])
      )
        throw Error("Invalid table order ownership");
}
// A move permutes only live slots. Retired slots stay in the retained sequence,
// so deletion/insertion lifecycle records are neither discarded nor recreated.
// The whole-axis witness is deliberately conservative: same-axis structural
// changes invalidate a preview/inverse; text, widths and other-axis moves do not.
export function executeTableMove(state, intent, action, { write, fail }) {
  const current = tableOrderWitness(state, intent.table, intent.axis);
  if (!same(current, intent.expected))
    throw fail("Table order changed; Undo/Redo cannot overwrite it");
  const next =
    intent.kind === "tableMove"
      ? reordered(current.order, intent.targets, intent.before)
      : intent.order;
  if (
    !Array.isArray(next) ||
    !same([...next].sort(), [...current.order].sort())
  )
    throw fail("Move restoration membership changed");
  const table = state.nodes[intent.table],
    key = field(intent.axis),
    owner = intent.kind === "tableMove" ? action : intent.owner;
  const patch = { ...table };
  if (owner === null) delete patch[key];
  else patch[key] = owner;
  let at = 0;
  if (intent.axis === "rows") {
    patch.rowOrder = (table.rowOrder || table.children).map((id) =>
      state.nodes[id].live ? next[at++] : id,
    );
    patch.children = [...next];
  } else {
    const view = columnView(state, table);
    patch.columnOrder = view.order.map((id) =>
      view.columns[id].active ? next[at++] : id,
    );
    patch.columns = view.columns;
    for (const row of table.children)
      write("nodes")[row] = {
        ...state.nodes[row],
        children: next.map((id) => view.columns[id].cells[row]),
      };
  }
  write("nodes")[table.id] = patch;
  return {
    kind: "restoreTableOrder",
    table: table.id,
    axis: intent.axis,
    expected: tableOrderWitness(state, table.id, intent.axis),
    order: current.order,
    owner: current.owner,
  };
}
