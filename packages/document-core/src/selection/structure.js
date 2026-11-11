// SPDX-License-Identifier: MPL-2.0
import { isImmutable } from "../model/immutable.js";

// Only transitively host-sealed node maps can certify stable parent/order data.
// The cache owns no document or predecessor; mutable/shallow-frozen input uses
// a fresh traversal. A different root is a different view of the same forest.
const forests = new WeakMap();
export function selectionStructure(state) {
  const stable = isImmutable(state.nodes),
    cached = stable && forests.get(state.nodes)?.get(state.root);
  if (cached) return cached;
  const order = [],
    positions = new Map(),
    parents = new Map(),
    visited = new Set();
  function walk(id, parent) {
    const node = state.nodes[id];
    if (!node?.live || visited.has(id))
      throw Error("Selection structure is unavailable");
    visited.add(id);
    parents.set(id, parent);
    if (node.text) {
      positions.set(id, order.length);
      order.push(id);
    }
    for (const child of node.children || []) walk(child, node);
  }
  walk(state.root, undefined);
  const value = Object.freeze({
    order: Object.freeze(order),
    position: (id) => positions.get(id),
    parent: (id) => parents.get(id),
  });
  if (stable) {
    let roots = forests.get(state.nodes);
    if (!roots) {
      roots = new Map();
      forests.set(state.nodes, roots);
    }
    roots.set(state.root, value);
  }
  return value;
}
