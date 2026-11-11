// SPDX-License-Identifier: MPL-2.0
import { createReplica } from "../text/pieces.js";
import { isImmutable } from "./immutable.js";
// Split/join may replace a text replica while restoring the same logical
// paragraph. Lifecycle ownership follows the block, not its text generation.
const shape = ({
  live,
  boundaryLifecycle,
  retiredBy,
  text,
  placement,
  ...rest
}) => ({ ...rest, placement: placement ?? null });
export const boundaryParagraphIds = (action) => ({
  block: `${action}:paragraph`,
  text: `${action}:text`,
});
const checked = new WeakSet();
export function validateBoundaryParagraphs(state) {
  if (isImmutable(state.nodes) && checked.has(state.nodes)) return;
  for (const table of Object.values(state.nodes)) {
    if (table.beforeParagraphs === undefined) continue;
    const order = table.beforeParagraphs;
    if (
      table.type !== "table" ||
      !Array.isArray(order) ||
      new Set(order).size !== order.length
    )
      throw Error("Invalid boundary paragraph order");
    for (const id of order) {
      const node = state.nodes[id];
      if (
        !node ||
        node.boundaryTable !== table.id ||
        typeof node.boundaryParent !== "string" ||
        !node.boundaryLifecycle
      )
        throw Error("Invalid boundary paragraph identity");
    }
  }
  if (isImmutable(state.nodes)) checked.add(state.nodes);
}
// Birth order is retained on the table for restoring independent creations.
// It is not a second projection of arbitrary document children: ordinary prose
// split/join continues to own that topology. Changed birth shapes block removal.
export function executeBoundaryParagraph(
  state,
  intent,
  action,
  { write, remember, insert, fail },
) {
  const parent = state.nodes[intent.parent],
    table = state.nodes[intent.table];
  if (
    !parent?.live ||
    parent.type !== "doc" ||
    !table?.live ||
    table.type !== "table" ||
    !parent.children.includes(table.id)
  )
    throw fail("Table boundary changed; review paragraph creation");
  const set = (id, patch) => {
    write("nodes")[id] = { ...state.nodes[id], ...patch };
  };
  if (intent.kind === "insertBoundaryParagraph") {
    const ids = boundaryParagraphIds(action);
    if (
      Object.hasOwn(state.nodes, ids.block) ||
      Object.hasOwn(state.replicas, ids.text) ||
      Object.hasOwn(state.boundaries, `${ids.text}:empty`)
    )
      throw fail("Boundary paragraph identity reused");
    const node = {
      id: ids.block,
      type: "paragraph",
      live: true,
      text: ids.text,
      boundaryTable: table.id,
      boundaryParent: parent.id,
      boundaryLifecycle: action,
    };
    write("nodes")[ids.block] = node;
    write("replicas")[ids.text] = createReplica(
      ids.text,
      ids.block,
      [],
      action,
    );
    remember(`${ids.text}:empty`, ids.block, 0);
    const siblings = [...parent.children];
    siblings.splice(siblings.indexOf(table.id), 0, ids.block);
    set(parent.id, { children: siblings });
    set(table.id, {
      beforeParagraphs: [...(table.beforeParagraphs || []), ids.block],
    });
    const inverse = {
      kind: "boundaryParagraphActive",
      parent: parent.id,
      table: table.id,
      block: ids.block,
      active: false,
      expected: action,
      manifest: shape(node),
    };
    if (!intent.text) return inverse;
    const removeText = insert(
      {
        kind: "insert",
        at: { codec: 3, boundary: `${ids.text}:empty` },
        text: intent.text,
        marks: [],
      },
      `${action}:text`,
    );
    return { kind: "batch", intents: [removeText, inverse] };
  }
  if (intent.kind !== "boundaryParagraphActive")
    throw fail("Unknown boundary paragraph lifecycle");
  const node = state.nodes[intent.block],
    order = table.beforeParagraphs,
    replica = state.replicas[node?.text];
  if (
    !node ||
    node.live === intent.active ||
    node.boundaryLifecycle !== intent.expected ||
    !order?.includes(node.id) ||
    JSON.stringify(shape(node)) !== JSON.stringify(intent.manifest)
  )
    throw fail("Paragraph has structural dependencies; review Undo");
  if (!replica || replica.length !== 0 || replica.retired !== intent.active)
    throw fail("Paragraph has content; Undo cannot remove it");
  let siblings = [...parent.children];
  if (!intent.active) {
    if (!siblings.includes(node.id)) throw fail("Paragraph moved; review Undo");
    siblings = siblings.filter((id) => id !== node.id);
  } else {
    let before = table.id;
    for (const id of order.slice(order.indexOf(node.id) + 1))
      if (state.nodes[id]?.live) {
        if (
          !siblings.includes(id) ||
          siblings.indexOf(id) > siblings.indexOf(table.id)
        )
          throw fail("Paragraph restoration boundary changed");
        before = id;
        break;
      }
    siblings.splice(siblings.indexOf(before), 0, node.id);
  }
  const restored = { ...node, live: intent.active, boundaryLifecycle: action };
  if (intent.active) delete restored.retiredBy;
  else restored.retiredBy = action;
  write("nodes")[node.id] = restored;
  write("replicas")[node.text] = { ...replica, retired: !intent.active };
  for (const [id, cut] of Object.entries(state.boundaries))
    if (cut.block === node.id) {
      const next = { ...cut };
      if (intent.active) delete next.retiredBy;
      else next.retiredBy = action;
      write("boundaries")[id] = next;
    }
  set(parent.id, { children: siblings });
  return { ...intent, active: !intent.active, expected: action };
}
