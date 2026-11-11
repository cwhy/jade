// SPDX-License-Identifier: MPL-2.0
import {
  tableGrid,
  resolveCellRange,
  captureCellRange,
} from "../selection/grid.js";
import { columnView } from "./table-columns.js";
import { cellWitness, cellsAlreadyEmpty } from "./cell-clear.js";
import { createReplica } from "../text/pieces.js";
const clone = (x) => structuredClone(x),
  same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const activeColumns = (state, table) => {
  const v = columnView(state, table);
  return v.order.filter((id) => v.columns[id].active);
};
const cellAttributes = (state, cells) =>
  cells.map((id) => {
    const { children, clearOwner, ...n } = state.nodes[id];
    return n;
  });
export function deletionPlan(state, selection, axis) {
  if (!["rows", "columns", "table"].includes(axis))
    throw Error("Unknown table deletion scope");
  const selected = resolveCellRange(state, selection),
    g = tableGrid(state, selected.table),
    view = columnView(state, g.table);
  const top = g.rows.indexOf(selected.rows[0]),
    left = g.cells[top].indexOf(selected.cells[0][0]);
  const targets =
    axis === "rows"
      ? selected.rows
      : axis === "columns"
        ? view.order
            .filter((id) => view.columns[id].active)
            .slice(left, left + selected.cells[0].length)
        : [g.table.id];
  const whole =
    axis === "table" ||
    targets.length === (axis === "rows" ? g.rows.length : g.cells[0].length);
  const rows = whole || axis === "columns" ? g.rows : selected.rows;
  const cells = rows.map((id) => {
    const row = state.nodes[id].children;
    return whole || axis === "rows"
      ? [...row]
      : row.slice(left, left + targets.length);
  });
  const range = captureCellRange(
    state,
    g.table.id,
    cells[0][0],
    cells.at(-1).at(-1),
  );
  const geometry = {
    rows: [...g.rows],
    cells: g.cells.map((row) => [...row]),
    widths: g.cells.map((row) =>
      row.map((id) => state.nodes[id].colwidth ?? null),
    ),
  };
  return {
    axis,
    targets,
    whole,
    range,
    geometry,
    witness: cellWitness(state, cells.flat()),
    empty: cellsAlreadyEmpty(state, cells.flat()),
    top: whole || axis === "columns" ? 0 : top,
    left: whole || axis === "rows" ? 0 : left,
  };
}
export function validateTableDelete(state, intent) {
  const p = deletionPlan(state, intent.selection, intent.axis);
  if (!same(p.geometry, intent.geometry))
    throw Error("Table geometry changed; review deletion again");
  if (!same(p.witness, intent.witness))
    throw Error("Table contents changed; review deletion again");
  return p;
}
export function validateDeletedStructures(state) {
  for (const n of Object.values(state.nodes))
    if (n.structureDeletedBy) {
      if (
        typeof n.structureDeletedBy !== "string" ||
        n.live ||
        n.retiredBy !== n.structureDeletedBy
      )
        throw Error("Invalid deleted structure lifecycle");
      if (n.text && !state.replicas[n.text]?.retired)
        throw Error("Deleted text replica is live");
    }
}
function forest(state, roots) {
  const result = [],
    seen = new Set();
  function walk(id) {
    const n = state.nodes[id];
    if (!n?.live || seen.has(id)) throw Error("Deletion target is unavailable");
    seen.add(id);
    result.push(clone(n));
    for (const c of n.children || []) walk(c);
  }
  roots.forEach(walk);
  return result;
}
function parent(state, id) {
  return Object.values(state.nodes).find(
    (n) => n.live && n.children?.includes(id),
  );
}
export function executeTableDelete(
  state,
  intent,
  action,
  { write, remember, fail },
) {
  const set = (id, patch) => {
    write("nodes")[id] = { ...state.nodes[id], ...patch };
  };
  const getTable = (id) => {
    const n = state.nodes[id];
    if (!n?.live || n.type !== "table")
      throw fail("Deletion table is unavailable");
    return n;
  };
  function initialize(table) {
    const v = columnView(state, table);
    set(table.id, {
      rowOrder: [...(table.rowOrder || table.children)],
      columnOrder: [...v.order],
      columns: clone(v.columns),
    });
  }
  function snapshot(table, axis, targets, whole) {
    const g = tableGrid(state, table.id),
      view = columnView(state, table),
      roots = whole
        ? [table.id]
        : axis === "rows"
          ? targets
          : g.rows.flatMap((row) =>
              targets.map((id) => view.columns[id].cells[row]),
            );
    const cells = whole
      ? g.cells.flat()
      : axis === "rows"
        ? targets.flatMap((id) => state.nodes[id].children)
        : roots;
    const nodes = forest(state, roots),
      ids = new Set(nodes.map((n) => n.id));
    return {
      table: table.id,
      axis,
      targets,
      whole,
      cells,
      nodes,
      rows: [...g.rows],
      columns: activeColumns(state, table),
      grid: g.cells.map((row) => [...row]),
      parent: parent(state, table.id)?.id,
      witness: cellWitness(state, cells),
      attributes: cellAttributes(state, cells),
      joins: Object.values(state.listJoins)
        .filter((j) => ids.has(j.right))
        .map(clone),
      texts: nodes
        .filter((n) => n.text)
        .map((n) => clone(state.replicas[n.text])),
    };
  }
  function checkShape(record) {
    const table = getTable(record.table),
      g = tableGrid(state, table.id),
      columns = activeColumns(state, table);
    if (record.whole) {
      if (
        parent(state, table.id)?.id !== record.parent ||
        !same(g.rows, record.rows) ||
        !same(g.cells, record.grid)
      )
        throw fail("Table changed; Redo cannot delete new structure");
    } else if (record.axis === "rows") {
      if (
        !record.targets.every((id) => g.rows.includes(id)) ||
        !same(columns, record.columns) ||
        !same(
          record.targets.flatMap((id) => state.nodes[id].children),
          record.cells,
        )
      )
        throw fail("Row dependencies changed; restore them before Undo/Redo");
    } else if (
      !record.targets.every((id) => columns.includes(id)) ||
      !same(g.rows, record.rows) ||
      !same(
        g.rows.flatMap((row) =>
          record.targets.map((id) => table.columns[id].cells[row]),
        ),
        record.cells,
      )
    )
      throw fail("Column dependencies changed; restore them before Undo/Redo");
    if (
      !same(cellWitness(state, record.cells), record.witness) ||
      !same(cellAttributes(state, record.cells), record.attributes)
    )
      throw fail(
        "Deleted scope has new content or attributes; Redo cannot remove it",
      );
    return table;
  }
  function retire(record) {
    for (const original of record.nodes) {
      const n = {
        ...state.nodes[original.id],
        live: false,
        retiredBy: action,
        structureDeletedBy: action,
      };
      if (n.type === "row" && !record.whole) n.rowOwnerTable = record.table;
      write("nodes")[n.id] = n;
      if (n.text)
        write("replicas")[n.text] = {
          ...state.replicas[n.text],
          retired: true,
        };
    }
    const ids = new Set(record.nodes.map((n) => n.id));
    for (const [id, b] of Object.entries(state.boundaries))
      if (ids.has(b.block))
        write("boundaries")[id] = { ...b, retiredBy: action };
    for (const j of record.joins)
      write("listJoins")[j.id] = {
        ...state.listJoins[j.id],
        suspendedBy: action,
      };
  }
  function replaceWithParagraph(record, previous) {
    const id = previous?.id || `${action}:table-replacement`,
      textId = previous ? state.nodes[id]?.text : `${id}:text`,
      p = state.nodes[record.parent];
    if (!p?.live || !p.children?.includes(record.table))
      throw fail("Table parent changed");
    if (previous) {
      const n = state.nodes[id],
        replica = state.replicas[textId];
      if (
        !n ||
        n.live ||
        n.structureDeletedBy !== previous.retirement ||
        !replica?.retired ||
        replica.length
      )
        throw fail("Replacement paragraph lifecycle changed");
      const next = { ...n, live: true };
      delete next.retiredBy;
      delete next.structureDeletedBy;
      write("nodes")[id] = next;
      write("replicas")[textId] = { ...replica, retired: false };
      for (const [bid, b] of Object.entries(state.boundaries))
        if (b.block === id) {
          const next = { ...b };
          delete next.retiredBy;
          write("boundaries")[bid] = next;
        }
    } else {
      if (state.nodes[id] || state.replicas[textId])
        throw fail("Replacement identity reused");
      write("nodes")[id] = { id, type: "paragraph", live: true, text: textId };
      write("replicas")[textId] = createReplica(textId, id, [], action);
      remember(textId + ":empty", id, 0);
    }
    set(p.id, {
      children: p.children.map((c) => (c === record.table ? id : c)),
    });
    return { id };
  }
  function remove(record, previous) {
    retire(record);
    let placeholder = null;
    if (record.whole) placeholder = replaceWithParagraph(record, previous);
    else {
      const table = state.nodes[record.table];
      if (record.axis === "rows")
        set(table.id, {
          children: table.children.filter((id) => !record.targets.includes(id)),
        });
      else {
        const columns = { ...table.columns };
        for (const id of record.targets)
          columns[id] = {
            ...columns[id],
            active: false,
            retiredBy: action,
            structureDeletedBy: action,
          };
        set(table.id, { columns });
        for (const row of table.children)
          set(row, {
            children: state.nodes[row].children.filter(
              (id) => !record.cells.includes(id),
            ),
          });
      }
    }
    return {
      kind: "tableDeletionActive",
      active: false,
      expected: action,
      record,
      placeholder,
    };
  }
  if (intent.kind === "tableDelete") {
    const p = deletionPlan(state, intent.selection, intent.axis),
      table = getTable(p.range.table);
    if (!p.whole) initialize(table);
    return remove(
      snapshot(state.nodes[table.id], intent.axis, p.targets, p.whole),
    );
  }
  if (intent.kind !== "tableDeletionActive")
    throw fail("Unknown structure lifecycle");
  const old = intent.record;
  if (intent.active) {
    const table = checkShape(old);
    return remove(
      snapshot(table, old.axis, old.targets, old.whole),
      intent.placeholder,
    );
  }
  // Restoration checks the exact retained payload; never overwrite live nodes.
  for (const original of old.nodes) {
    const expected = {
      ...original,
      live: false,
      retiredBy: intent.expected,
      structureDeletedBy: intent.expected,
    };
    if (expected.type === "row" && !old.whole)
      expected.rowOwnerTable = old.table;
    if (!same(state.nodes[original.id], expected))
      throw fail("Retained deletion lifecycle changed");
  }
  for (const r of old.texts)
    if (!same(state.replicas[r.id], { ...r, retired: true }))
      throw fail("Retained deleted text changed");
  for (const j of old.joins)
    if (!same(state.listJoins[j.id], { ...j, suspendedBy: intent.expected }))
      throw fail("Retained list contributions changed");
  let placeholder = intent.placeholder;
  if (old.whole) {
    const n = state.nodes[placeholder.id],
      p = state.nodes[old.parent],
      replica = n && state.replicas[n.text];
    if (
      !p?.live ||
      !p.children?.includes(n?.id) ||
      !n.live ||
      n.type !== "paragraph" ||
      !replica ||
      replica.retired ||
      replica.length
    )
      throw fail(
        "Replacement paragraph has content or dependencies; Undo cannot remove it",
      );
  } else {
    const table = getTable(old.table),
      columns = activeColumns(state, table);
    if (old.axis === "rows") {
      if (
        !same(columns, old.columns) ||
        !old.targets.every((id) => table.rowOrder?.includes(id))
      )
        throw fail("Column dependencies changed; restore them before row Undo");
    } else {
      if (
        !same(table.children, old.rows) ||
        !old.targets.every(
          (id) =>
            table.columns?.[id]?.structureDeletedBy === intent.expected &&
            !table.columns[id].active,
        )
      )
        throw fail(
          "Row or column dependencies changed; restore them before column Undo",
        );
    }
  }
  for (const n of old.nodes) write("nodes")[n.id] = clone(n);
  for (const r of old.texts) write("replicas")[r.id] = clone(r);
  const restored = new Set(old.nodes.map((n) => n.id));
  for (const [id, b] of Object.entries(state.boundaries))
    if (restored.has(b.block)) {
      const next = { ...b };
      delete next.retiredBy;
      write("boundaries")[id] = next;
    }
  for (const j of old.joins) write("listJoins")[j.id] = clone(j);
  if (old.whole) {
    const n = state.nodes[placeholder.id],
      p = state.nodes[old.parent];
    set(n.id, { live: false, retiredBy: action, structureDeletedBy: action });
    write("replicas")[n.text] = { ...state.replicas[n.text], retired: true };
    for (const [id, b] of Object.entries(state.boundaries))
      if (b.block === n.id)
        write("boundaries")[id] = { ...b, retiredBy: action };
    set(p.id, {
      children: p.children.map((id) => (id === n.id ? old.table : id)),
    });
    placeholder = { id: n.id, retirement: action };
  } else {
    const table = state.nodes[old.table];
    if (old.axis === "rows")
      set(table.id, {
        children: table.rowOrder.filter((id) => state.nodes[id].live),
      });
    else {
      const columns = { ...table.columns };
      for (const id of old.targets) {
        const c = { ...columns[id], active: true };
        delete c.retiredBy;
        delete c.structureDeletedBy;
        columns[id] = c;
      }
      set(table.id, { columns });
      for (const row of table.children)
        set(row, {
          children: table.columnOrder
            .filter((id) => columns[id].active)
            .map((id) => columns[id].cells[row]),
        });
    }
  }
  return {
    kind: "tableDeletionActive",
    active: true,
    expected: action,
    record: old,
    placeholder,
  };
}
