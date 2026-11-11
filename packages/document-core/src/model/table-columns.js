// SPDX-License-Identifier: MPL-2.0
import { structuralStyleShape } from "./table-format.js";
import { createReplica } from "../text/pieces.js";
import { isImmutable } from "./immutable.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => structuredClone(x);
// Columns are logical grid identities, not content-tree nodes. Each entry maps
// retained row identities to their cell identity; row.children is the live view.
export function columnView(state, table) {
  if (table.columnOrder)
    return { order: table.columnOrder, columns: table.columns };
  const rows = table.rowOrder || table.children,
    first = state.nodes[table.children[0]];
  if (!first?.children?.length) throw Error("Invalid table columns");
  const order = first.children.map((_, i) => `${table.id}:column:seed:${i}`),
    columns = {};
  for (const [i, id] of order.entries()) {
    const cells = {};
    for (const rowId of rows) {
      const row = state.nodes[rowId];
      if (!row || row.type !== "row" || row.children.length !== order.length)
        throw Error("Retained row geometry differs");
      cells[rowId] = row.children[i];
    }
    columns[id] = { id, active: true, cells };
  }
  return { order, columns };
}
export const columnIds = (action, row) => {
  const key = `${action}:column-row:${row.length}:${row}`;
  return {
    cell: key + ":cell",
    paragraph: key + ":paragraph",
    text: key + ":text",
  };
};
export const columnIdentity = (table, action) =>
  `${table}:column:operation:${action}`;
export function registerColumnRow(state, table, row, cells) {
  if (!table.columnOrder) return null;
  const active = table.columnOrder.filter((id) => table.columns[id].active);
  if (active.length !== cells.length) throw Error("New row geometry differs");
  const columns = { ...table.columns };
  for (const [i, id] of active.entries())
    columns[id] = {
      ...columns[id],
      cells: { ...columns[id].cells, [row]: cells[i] },
    };
  return columns;
}
export function checkRowColumns(state, table, row) {
  if (!table.columnOrder) return;
  const expected = table.columnOrder
    .filter((id) => table.columns[id].active)
    .map((id) => table.columns[id].cells[row.id]);
  if (expected.some((id) => !id) || !same(row.children, expected))
    throw Error(
      "Column structure changed; restore its dependencies before row Undo/Redo",
    );
}
const checked = new WeakSet();
export function validateTableColumns(state) {
  if (isImmutable(state.nodes) && checked.has(state.nodes)) return;
  for (const table of Object.values(state.nodes)) {
    if (!table.live || table.type !== "table") continue;
    if (!table.columnOrder) {
      if (table.columns) throw Error("Column registry has no order");
      continue;
    }
    const { order, columns } = columnView(state, table),
      rows = new Set(table.rowOrder || table.children),
      seen = new Set();
    if (
      !Array.isArray(order) ||
      !order.length ||
      new Set(order).size !== order.length ||
      !columns ||
      Object.keys(columns).length !== order.length
    )
      throw Error("Invalid retained column order");
    if (!order.some((id) => columns[id]?.active))
      throw Error("Table has no active column");
    for (const id of order) {
      const c = columns[id];
      if (
        !c ||
        c.id !== id ||
        typeof c.active !== "boolean" ||
        !c.cells ||
        (!c.active && !c.retiredBy) ||
        (c.structureDeletedBy &&
          (c.active || c.retiredBy !== c.structureDeletedBy))
      )
        throw Error("Invalid retained column");
      for (const [row, cell] of Object.entries(c.cells)) {
        if (
          !rows.has(row) ||
          state.nodes[cell]?.type !== "cell" ||
          seen.has(cell)
        )
          throw Error("Invalid column cell ownership");
        seen.add(cell);
        if (c.active && state.nodes[row].live && !state.nodes[cell].live)
          throw Error("Active column has retired cell");
        if (!c.active && state.nodes[row].live && state.nodes[cell].live)
          throw Error("Retired column has live cell");
      }
    }
    for (const id of table.children)
      checkRowColumns(state, table, state.nodes[id]);
  }
  if (isImmutable(state.nodes)) checked.add(state.nodes);
}
const shape = (n) => {
  const { live, retiredBy, ...content } = n;
  return structuralStyleShape(content);
};
const logicalShape = (n) => {
  const { text, ...content } = shape(n);
  return content;
};
export function executeTableColumn(
  state,
  intent,
  action,
  { write, remember, fail },
) {
  const table = state.nodes[intent.table];
  if (!table?.live || table.type !== "table")
    throw fail("Column table is unavailable");
  const current = columnView(state, table),
    columns = { ...current.columns },
    order = [...current.order];
  function project() {
    const active = order.filter((id) => columns[id].active);
    for (const row of table.children) {
      const cells = active.map((id) => columns[id].cells[row]);
      if (cells.some((id) => !id || !state.nodes[id]?.live))
        throw fail("Column row dependencies changed");
      write("nodes")[row] = { ...state.nodes[row], children: cells };
    }
    write("nodes")[table.id] = {
      ...state.nodes[table.id],
      columnOrder: order,
      columns,
    };
  }
  if (intent.kind === "tableInsertColumn") {
    const template = columns[intent.template];
    if (
      !template?.active ||
      !(intent.before === null || columns[intent.before]?.active)
    )
      throw fail("Column insertion boundary changed");
    const id = columnIdentity(table.id, action);
    if (columns[id]) throw fail("Column identity reused");
    const rows = [...table.children],
      cells = {},
      manifest = [],
      texts = [];
    for (const row of rows) {
      const source = state.nodes[template.cells[row]];
      if (
        !source?.live ||
        (source.colspan ?? 1) !== 1 ||
        (source.rowspan ?? 1) !== 1
      )
        throw fail("Column insertion requires a regular grid");
      const width = source.colwidth ?? [200];
      if (
        !Array.isArray(width) ||
        width.length !== 1 ||
        !Number.isFinite(width[0]) ||
        width[0] <= 0
      )
        throw fail("Invalid column width");
      const ids = columnIds(action, row);
      if (
        state.nodes[ids.cell] ||
        state.nodes[ids.paragraph] ||
        state.replicas[ids.text] ||
        state.boundaries[ids.text + ":empty"]
      )
        throw fail("Column identity reused");
      write("nodes")[ids.cell] = {
        id: ids.cell,
        type: "cell",
        live: true,
        children: [ids.paragraph],
        colwidth: clone(width),
      };
      write("nodes")[ids.paragraph] = {
        id: ids.paragraph,
        type: "paragraph",
        live: true,
        text: ids.text,
      };
      write("replicas")[ids.text] = createReplica(
        ids.text,
        ids.paragraph,
        [],
        action,
      );
      remember(ids.text + ":empty", ids.paragraph, 0);
      cells[row] = ids.cell;
      manifest.push(
        clone(shape(state.nodes[ids.cell])),
        clone(shape(state.nodes[ids.paragraph])),
      );
      texts.push(ids.text);
    }
    columns[id] = { id, active: true, cells, owner: action, lifecycle: action };
    order.splice(
      intent.before === null ? order.length : order.indexOf(intent.before),
      0,
      id,
    );
    project();
    return {
      kind: "tableColumnActive",
      table: table.id,
      column: id,
      active: false,
      expected: action,
      orderOwner: table.columnOrderOwner ?? null,
      rows,
      manifest,
      texts,
    };
  }
  if (intent.kind !== "tableColumnActive")
    throw fail("Unknown column lifecycle");
  if ((table.columnOrderOwner ?? null) !== (intent.orderOwner ?? null))
    throw fail("Column order changed; Undo cannot remove a moved column");
  const column = columns[intent.column];
  if (
    !column ||
    column.lifecycle !== intent.expected ||
    column.active === intent.active
  )
    throw fail("Column lifecycle changed");
  if (!same([...table.children].sort(), [...intent.rows].sort()))
    throw fail("Column has row dependencies; restore them before Undo/Redo");
  for (const original of intent.manifest) {
    const n = state.nodes[original.id];
    if (
      !n ||
      n.live !== !intent.active ||
      !same(logicalShape(n), logicalShape(original))
    )
      throw fail("Column has structural dependencies; Undo cannot remove them");
  }
  const texts = intent.manifest
    .filter((n) => n.text)
    .map((n) => state.nodes[n.id].text);
  for (const id of texts) {
    const r = state.replicas[id];
    if (!r || r.length !== 0 || r.retired !== intent.active)
      throw fail("Column has content; Undo cannot remove it");
  }
  const blocks = new Set(
    intent.manifest.filter((n) => n.text).map((n) => n.id),
  );
  for (const original of intent.manifest) {
    const n = { ...state.nodes[original.id], live: intent.active };
    if (intent.active) delete n.retiredBy;
    else n.retiredBy = action;
    write("nodes")[n.id] = n;
  }
  for (const id of texts)
    write("replicas")[id] = { ...state.replicas[id], retired: !intent.active };
  for (const [id, cut] of Object.entries(state.boundaries))
    if (blocks.has(cut.block)) {
      const next = { ...cut };
      if (intent.active) delete next.retiredBy;
      else next.retiredBy = action;
      write("boundaries")[id] = next;
    }
  columns[column.id] = { ...column, active: intent.active, lifecycle: action };
  if (intent.active) delete columns[column.id].retiredBy;
  else columns[column.id].retiredBy = action;
  project();
  return { ...intent, texts, active: !intent.active, expected: action };
}
