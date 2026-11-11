// SPDX-License-Identifier: MPL-2.0
import { structuralStyleShape } from "./table-format.js";
import { registerColumnRow, checkRowColumns } from "./table-columns.js";
import { createReplica } from "../text/pieces.js";
import { isImmutable } from "./immutable.js";

const clone = (value) => structuredClone(value);
const shape = (node) => {
  const { live, rowLifecycle, retiredBy, ...content } = node;
  return structuralStyleShape(content);
};
export const rowIds = (action, count) => ({
  row: `${action}:row`,
  cells: Array.from({ length: count }, (_, i) => `${action}:cell:${i}`),
  paragraphs: Array.from(
    { length: count },
    (_, i) => `${action}:paragraph:${i}`,
  ),
  texts: Array.from({ length: count }, (_, i) => `${action}:text:${i}`),
});

// rowOrder retains retired identities; children is its live projection. Redo
// restores a row in place even when other inserted rows were also undone.
const checked = new WeakSet();
export function validateTableRows(state) {
  if (isImmutable(state.nodes) && checked.has(state.nodes)) return;
  for (const table of Object.values(state.nodes)) {
    if (!table.live || table.type !== "table" || !table.rowOrder) continue;
    if (
      !Array.isArray(table.rowOrder) ||
      new Set(table.rowOrder).size !== table.rowOrder.length
    )
      throw Error("Invalid retained row order");
    for (const id of table.rowOrder) {
      const row = state.nodes[id];
      if (
        !row ||
        row.type !== "row" ||
        (!row.live && (!row.retiredBy || row.rowOwnerTable !== table.id))
      )
        throw Error("Invalid retained row identity");
    }
    if (
      JSON.stringify(table.children) !==
      JSON.stringify(table.rowOrder.filter((id) => state.nodes[id].live))
    )
      throw Error("Row order projection mismatch");
  }
  if (isImmutable(state.nodes)) checked.add(state.nodes);
}

export function executeTableRow(
  state,
  intent,
  action,
  { write, remember, fail },
) {
  const need = (id, type) => {
    const n = state.nodes[id];
    if (!n?.live || n.type !== type)
      throw fail("Table insertion target changed");
    return n;
  };
  const set = (id, patch) => {
    write("nodes")[id] = { ...state.nodes[id], ...patch };
  };
  const table = need(intent.table, "table");
  const project = (order) =>
    set(table.id, {
      rowOrder: order,
      children: order.filter((id) => state.nodes[id].live),
    });
  if (intent.kind === "tableInsertRow") {
    const template = need(intent.template, "row");
    if (!table.children.includes(template.id))
      throw fail("Row insertion template changed");
    const positions = intent.columns.map((id) => template.children.indexOf(id));
    if (
      positions.some((at, i) => at < 0 || (i > 0 && at <= positions[i - 1])) ||
      (!table.columnOrder &&
        JSON.stringify(template.children) !== JSON.stringify(intent.columns))
    )
      throw fail("Table columns changed; review row insertion");
    const widths = template.children.map((id) => {
      const cell = need(id, "cell");
      if ((cell.colspan ?? 1) !== 1 || (cell.rowspan ?? 1) !== 1)
        throw fail("Row insertion requires a regular grid");
      if (
        cell.colwidth !== undefined &&
        (!Array.isArray(cell.colwidth) ||
          cell.colwidth.length !== 1 ||
          !Number.isFinite(cell.colwidth[0]) ||
          cell.colwidth[0] <= 0)
      )
        throw fail("Invalid column width");
      return cell.colwidth && clone(cell.colwidth);
    });
    if (intent.before !== null && !table.children.includes(intent.before))
      throw fail("Row insertion boundary changed");
    const ids = rowIds(action, widths.length);
    // Keep IDs predicted by the author for known columns. A concurrently added
    // column gets row-owned IDs derived from its stable column ID, not a shifted
    // ordinal, so the author's intended caret still addresses the same column.
    for (const [i, cell] of template.children.entries()) {
      const seen = intent.columns.indexOf(cell);
      if (seen >= 0) {
        ids.cells[i] = `${action}:cell:${seen}`;
        ids.paragraphs[i] = `${action}:paragraph:${seen}`;
        ids.texts[i] = `${action}:text:${seen}`;
      } else {
        const column = table.columnOrder.find(
          (id) =>
            table.columns[id].active &&
            table.columns[id].cells[template.id] === cell,
        );
        if (!column) throw fail("Unknown concurrent column");
        const key = `${action}:additional-column:${column.length}:${column}`;
        ids.cells[i] = key + ":cell";
        ids.paragraphs[i] = key + ":paragraph";
        ids.texts[i] = key + ":text";
      }
    }
    const all = [ids.row, ...ids.cells, ...ids.paragraphs];
    if (
      all.some((id) => Object.hasOwn(state.nodes, id)) ||
      ids.texts.some(
        (id) =>
          Object.hasOwn(state.replicas, id) ||
          Object.hasOwn(state.boundaries, `${id}:empty`),
      )
    )
      throw fail("Row identity reused");
    write("nodes")[ids.row] = {
      id: ids.row,
      type: "row",
      live: true,
      children: ids.cells,
      rowOwnerTable: table.id,
      rowLifecycle: action,
    };
    for (let i = 0; i < widths.length; i++) {
      write("nodes")[ids.cells[i]] = {
        id: ids.cells[i],
        type: "cell",
        live: true,
        children: [ids.paragraphs[i]],
        ...(widths[i] ? { colwidth: widths[i] } : {}),
      };
      write("nodes")[ids.paragraphs[i]] = {
        id: ids.paragraphs[i],
        type: "paragraph",
        live: true,
        text: ids.texts[i],
      };
      write("replicas")[ids.texts[i]] = createReplica(
        ids.texts[i],
        ids.paragraphs[i],
        [],
        action,
      );
      remember(`${ids.texts[i]}:empty`, ids.paragraphs[i], 0);
    }
    const order = [...(table.rowOrder || table.children)];
    order.splice(
      intent.before === null ? order.length : order.indexOf(intent.before),
      0,
      ids.row,
    );
    project(order);
    const columns = registerColumnRow(state, table, ids.row, ids.cells);
    if (columns) set(table.id, { columns });
    return {
      kind: "tableRowActive",
      table: table.id,
      row: ids.row,
      active: false,
      expected: action,
      orderOwner: table.rowOrderOwner ?? null,
      manifest: all.map((id) => clone(shape(state.nodes[id]))),
      texts: ids.texts,
    };
  }
  if (intent.kind !== "tableRowActive")
    throw fail("Unknown row lifecycle operation");
  const row = state.nodes[intent.row];
  if (
    !row ||
    row.rowLifecycle !== intent.expected ||
    row.live === intent.active ||
    !table.rowOrder?.includes(row.id)
  )
    throw fail("Row lifecycle changed; review Undo");
  if ((table.rowOrderOwner ?? null) !== (intent.orderOwner ?? null))
    throw fail("Row order changed; Undo cannot remove a moved row");
  checkRowColumns(state, table, row);
  // Conditional removal: no whole-document rollback, no removal of live text
  // or changed structure. A failed check leaves the entire operation unchanged.
  for (const original of intent.manifest) {
    const current = state.nodes[original.id];
    if (
      !current ||
      current.live !== !intent.active ||
      JSON.stringify(shape(current)) !== JSON.stringify(original)
    )
      throw fail("Row has structural dependencies; Undo cannot remove them");
  }
  for (const id of intent.texts) {
    const replica = state.replicas[id];
    if (!replica || replica.length !== 0 || replica.retired !== intent.active)
      throw fail("Row has content; Undo cannot remove it");
  }
  const blocks = new Set(
    intent.manifest.filter((n) => n.text).map((n) => n.id),
  );
  for (const original of intent.manifest) {
    const current = { ...state.nodes[original.id], live: intent.active };
    if (intent.active) delete current.retiredBy;
    else current.retiredBy = action;
    write("nodes")[original.id] = current;
  }
  set(row.id, { rowLifecycle: action });
  for (const id of intent.texts)
    write("replicas")[id] = { ...state.replicas[id], retired: !intent.active };
  for (const [id, cut] of Object.entries(state.boundaries))
    if (blocks.has(cut.block)) {
      const next = { ...cut };
      if (intent.active) delete next.retiredBy;
      else next.retiredBy = action;
      write("boundaries")[id] = next;
    }
  project(table.rowOrder);
  return { ...intent, active: !intent.active, expected: action };
}
