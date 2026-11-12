// SPDX-License-Identifier: MPL-2.0
import { createReplica } from "../text/pieces.js";
import { treeParent } from "./tree.js";
const shape = (node) => {
  const { live, retiredBy, tableCreationOwner, ...value } = node;
  return value;
};
export function validateTableCreate(state, intent, { resolve, fail }) {
  if (
    Object.keys(intent).some(
      (k) => !["kind", "at", "rows", "columns"].includes(k),
    ) ||
    !Number.isInteger(intent.rows) ||
    !Number.isInteger(intent.columns) ||
    intent.rows < 1 ||
    intent.rows > 20 ||
    intent.columns < 1 ||
    intent.columns > 12
  )
    throw fail("Choose 1–20 rows and 1–12 columns");
  const point = resolve(intent.at),
    node = state.nodes[point.block],
    parent = treeParent(state, point.block);
  if (
    node?.type !== "paragraph" ||
    parent?.type !== "doc" ||
    point.offset !== state.replicas[node.text].length
  )
    throw fail(
      "Place the caret at the end of a body paragraph to insert a table",
    );
  return { point, parent };
}
export function executeTableCreate(
  state,
  intent,
  action,
  { write, remember, resolve, fail },
) {
  if (intent.kind === "tableCreate") {
    const { point, parent } = validateTableCreate(state, intent, {
        resolve,
        fail,
      }),
      table = action + ":table",
      nodes = [],
      texts = [];
    const put = (node) => {
      if (state.nodes[node.id]) throw fail("Table identity reused");
      write("nodes")[node.id] = node;
      nodes.push(node.id);
    };
    const rows = [];
    for (let r = 0; r < intent.rows; r++) {
      const row = `${table}:row:${r}`,
        cells = [];
      for (let c = 0; c < intent.columns; c++) {
        const cell = `${row}:cell:${c}`,
          paragraph = cell + ":paragraph",
          text = paragraph + ":text";
        if (state.replicas[text] || state.boundaries[text + ":empty"])
          throw fail("Table text identity reused");
        put({ id: paragraph, type: "paragraph", live: true, text });
        write("replicas")[text] = createReplica(text, paragraph, [], action);
        texts.push(text);
        remember(text + ":empty", paragraph, 0);
        put({
          id: cell,
          type: "cell",
          live: true,
          children: [paragraph],
          colwidth: [200],
        });
        cells.push(cell);
      }
      put({ id: row, type: "row", live: true, children: cells });
      rows.push(row);
    }
    put({
      id: table,
      type: "table",
      live: true,
      children: rows,
      tableCreationOwner: action,
    });
    const children = [...parent.children];
    children.splice(children.indexOf(point.block) + 1, 0, table);
    write("nodes")[parent.id] = { ...parent, children };
    return {
      kind: "tableCreationActive",
      table,
      parent: parent.id,
      after: point.block,
      active: false,
      expected: action,
      texts,
      manifest: nodes.map((id) => structuredClone(shape(state.nodes[id]))),
    };
  }
  const table = state.nodes[intent.table],
    parent = state.nodes[intent.parent];
  if (
    !table ||
    table.tableCreationOwner !== intent.expected ||
    table.live === intent.active ||
    !parent?.live ||
    parent.type !== "doc"
  )
    throw fail("Table creation changed; cannot undo this insertion");
  if (
    !intent.active &&
    (!parent.children.includes(table.id) ||
      treeParent(state, table.id)?.id !== parent.id)
  )
    throw fail("Table moved; cannot undo this insertion");
  if (intent.active && !parent.children.includes(intent.after))
    throw fail("Table insertion boundary was removed");
  for (const original of intent.manifest) {
    const current = state.nodes[original.id];
    if (
      !current ||
      current.live === intent.active ||
      JSON.stringify(shape(current)) !== JSON.stringify(original)
    )
      throw fail("Table has structural changes; Undo cannot remove them");
  }
  for (const id of intent.texts) {
    const replica = state.replicas[id];
    if (!replica || replica.length || replica.retired !== intent.active)
      throw fail("Table has content; Undo cannot remove it");
  }
  const blocks = new Set(
    intent.manifest.filter((n) => n.text).map((n) => n.id),
  );
  for (const original of intent.manifest) {
    const node = { ...state.nodes[original.id], live: intent.active };
    if (intent.active) delete node.retiredBy;
    else node.retiredBy = action;
    write("nodes")[node.id] = node;
  }
  write("nodes")[table.id] = {
    ...state.nodes[table.id],
    tableCreationOwner: action,
  };
  for (const id of intent.texts)
    write("replicas")[id] = { ...state.replicas[id], retired: !intent.active };
  for (const [id, cut] of Object.entries(state.boundaries))
    if (blocks.has(cut.block)) {
      const next = { ...cut };
      if (intent.active) delete next.retiredBy;
      else next.retiredBy = action;
      write("boundaries")[id] = next;
    }
  const children = parent.children.filter((id) => id !== table.id);
  if (intent.active)
    children.splice(children.indexOf(intent.after) + 1, 0, table.id);
  write("nodes")[parent.id] = { ...parent, children };
  return { ...intent, active: !intent.active, expected: action };
}
