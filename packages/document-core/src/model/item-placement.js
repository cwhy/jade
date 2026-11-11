// SPDX-License-Identifier: MPL-2.0
import { treeParent, executeTree, withTreeProjection } from "./tree.js";
const list = (n) => ["bullet_list", "ordered_list"].includes(n?.type);
function outdent(b, ids, owner) {
  const parent = b.parent(owner.id),
    at = owner.children.indexOf(ids[0]),
    after = owner.children[at + ids.length] ?? null;
  if (parent.type === "list_item") {
    const grand = b.parent(parent.id);
    if (!list(grand)) throw new Error("Invalid nested list");
    // Following siblings become children of the last lifted item, retaining
    // document traversal order and all existing descendants.
    const following = [...b.node(owner.id).children.slice(at + ids.length)];
    if (following.length) {
      const wrapper = b.wrap(following, owner.type);
      b.place(wrapper, ids.at(-1), null);
    }
    const before =
      grand.children[grand.children.indexOf(parent.id) + 1] ?? null;
    for (const id of ids) b.place(id, grand.id, before);
    b.prune(owner.id);
    return;
  }
  if (!["doc", "cell"].includes(parent.type))
    throw new Error("List exit would cross a container boundary");
  const following = [...b.node(owner.id).children.slice(at + ids.length)];
  let before = parent.children[parent.children.indexOf(owner.id) + 1] ?? null;
  if (following.length) {
    const trailing = b.wrap(following, owner.type);
    b.place(trailing, parent.id, before);
    before = trailing;
  }
  for (const id of ids) {
    b.place(id, parent.id, before);
    b.unwrap(id);
  }
  b.prune(owner.id);
}
export function appendItemPlacement(b, ids, owner, lift) {
  if (lift) {
    outdent(b, ids, owner);
    return;
  }
  const previous = owner.children[owner.children.indexOf(ids[0]) - 1];
  if (!previous) return;
  const previousItem = b.node(previous),
    last = b.node(previousItem.children.at(-1));
  if (list(last) && last.type === owner.type)
    for (const id of ids) b.place(id, last.id, null);
  else {
    const wrapper = b.wrap(ids, owner.type);
    b.place(wrapper, previous, null);
  }
}

// Semantic single-item placement is resolved at acceptance, after prerequisite
// birth content is materialized. No saved temporary suffix is a destination.
export function creationItemSteps(state, intent, action, fail, revive = false) {
  const root = state.nodes[intent.root],
    owner = treeParent(state, intent.root);
  if (root?.type !== "list_item" || !root.live || !list(owner))
    throw fail("Whole-item placement target unavailable");
  return withTreeProjection(state, (projected) => {
    const steps = [];
    let counter = 0;
    const node = (id) => projected.nodes[id],
      parent = (id) => treeParent(projected, id);
    const add = (i) => {
      executeTree(projected, i, `${action}:part:${steps.length}`, {
        write: () => projected.nodes,
        fail,
      });
      steps.push(i);
    };
    const b = {
      node,
      parent,
      place(id, dest, before = null) {
        add({
          kind: "treePlace",
          node: id,
          from: parent(id).id,
          parent: dest,
          before,
          expected: node(id).placement ?? null,
        });
      },
      wrap(ids, type) {
        const id = `${action}:list:${++counter}`;
        add({
          kind: "treeWrap",
          id,
          type,
          nodes: ids,
          from: parent(ids[0]).id,
          expected: ids.map((id) => node(id).placement ?? null),
          ...(revive ? { revive: true } : {}),
        });
        return id;
      },
      unwrap(id) {
        add({
          kind: "treeUnwrap",
          node: id,
          expected: node(id).placement ?? null,
        });
      },
      prune(id) {
        if (node(id)?.live && list(node(id)) && !node(id).children.length)
          add({
            kind: "treePrune",
            node: id,
            expected: node(id).placement ?? null,
          });
      },
    };
    appendItemPlacement(b, [root.id], owner, intent.outdent);
    if (!steps.length) throw fail("Whole-item placement became a no-op");
    return { kind: "batch", intents: steps };
  });
}
