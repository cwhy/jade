// SPDX-License-Identifier: MPL-2.0
// Identity-preserving topology operations. Text/replicas are never copied here.
// Structural ownership is compare-and-restore, not whole-tree snapshots. A
// competing placement yields a recoverable conflict; descendant text is free
// to change. Inverse payloads are private to the engine's owned Undo path.
export const treeKinds = new Set([
  "treeWrap",
  "treeUnwrap",
  "treePlace",
  "treePrune",
  "treeRestore",
]);
const containers = new Set(["bullet_list", "ordered_list", "list_item"]);
// These indexes exist only during a synchronous tree-only projection. Every
// write in executeTree updates the scoped index. Other engine mutations use
// the ordinary lookup outside this scope; no cache survives publication.
const parentScopes = new WeakMap();
function parentIndex(state) {
  const result = new Map();
  for (const n of Object.values(state.nodes))
    if (n.live) for (const id of n.children || []) result.set(id, n.id);
  return result;
}
export function withTreeParents(state, run) {
  if (parentScopes.has(state)) return run();
  parentScopes.set(state, parentIndex(state));
  try {
    return run();
  } finally {
    parentScopes.delete(state);
  }
}
export function treeParent(state, id) {
  const index = parentScopes.get(state);
  return index
    ? index.has(id)
      ? state.nodes[index.get(id)]
      : undefined
    : Object.values(state.nodes).find(
        (n) => n.live && n.children?.includes(id),
      );
}
// A planner only needs lookup and staged writes, never enumeration of this
// overlay. It returns operations, not the transient state. Shadowing through
// a get trap also works when the source records are frozen/immutable.
// A fork inherits parent reads while shadowing only changed memberships.
// Deletion needs a tombstone so it cannot fall through to the source index.
// The source scope is stable during synchronous planning; neither fork is
// serialized or kept after its callback returns.
function forkParentIndex(base) {
  const own = new Map(),
    removed = Symbol("removed-parent");
  return {
    has(id) {
      return own.has(id) ? own.get(id) !== removed : base.has(id);
    },
    get(id) {
      const value = own.has(id) ? own.get(id) : base.get(id);
      return value === removed ? undefined : value;
    },
    set(id, parent) {
      own.set(id, parent);
    },
    delete(id) {
      own.set(id, removed);
    },
  };
}
export function withTreeProjection(state, run) {
  const own = Object.create(null),
    nodes = new Proxy(own, {
      get: (target, id) =>
        Object.hasOwn(target, id) ? target[id] : state.nodes[id],
    }),
    projected = { ...state, nodes };
  parentScopes.set(
    projected,
    forkParentIndex(parentScopes.get(state) || parentIndex(state)),
  );
  try {
    return run(projected);
  } finally {
    parentScopes.delete(projected);
  }
}
function putTreeNode(state, id, next, write) {
  const previous = state.nodes[id],
    index = parentScopes.get(state);
  if (index) {
    if (previous?.live)
      for (const child of previous.children || [])
        if (index.get(child) === id) index.delete(child);
    if (next.live)
      for (const child of next.children || []) index.set(child, id);
  }
  write()[id] = next;
}
const token = (n) => n.placement ?? null;
export function executeTree(state, intent, action, { write, fail }) {
  const need = (id) => {
    const n = state.nodes[id];
    if (!n?.live) throw fail("Structural target is no longer live");
    return n;
  };
  const put = (id, next) => putTreeNode(state, id, next, write);
  const set = (id, patch) => put(id, { ...state.nodes[id], ...patch });
  const children = (id, value) => set(id, { children: value });
  const location = (id) => {
    const n = need(id),
      p = treeParent(state, id);
    if (!p) throw fail("Structural target has no parent");
    return {
      id,
      parent: p.id,
      before: p.children[p.children.indexOf(id) + 1] ?? null,
      placement: token(n),
    };
  };
  const expect = (id, expected) => {
    const n = need(id);
    if (token(n) !== expected)
      throw fail("Structural placement changed; review this action");
  };
  const place = (id, parent, before, placement) => {
    const n = need(id),
      from = treeParent(state, id),
      to = need(parent);
    if (!from || !Array.isArray(to.children))
      throw fail("Structural destination is unavailable");
    for (let p = to; p; p = treeParent(state, p.id))
      if (p.id === id) throw fail("Cannot move a node inside its descendant");
    if (before === id) throw fail("Invalid structural neighbour");
    const old = from.children.filter((x) => x !== id),
      dest = from.id === to.id ? old : [...to.children],
      at = before === null ? dest.length : dest.indexOf(before);
    if (at < 0) throw fail("Structural neighbour changed; review this action");
    dest.splice(at, 0, id);
    if (from.id !== to.id) children(from.id, old);
    children(to.id, dest);
    set(n.id, { placement });
  };
  const group = (ids) => {
    if (!ids?.length || new Set(ids).size !== ids.length)
      throw fail("Invalid structural group");
    const p = treeParent(state, ids[0]);
    if (!p) throw fail("Missing structural parent");
    const at = p.children.indexOf(ids[0]);
    if (
      ids.some((id, i) => p.children[at + i] !== id || !state.nodes[id]?.live)
    )
      throw fail("Structural group is no longer contiguous");
    return { parent: p, at };
  };
  if (intent.kind === "treePlace") {
    const old = location(intent.node);
    if (old.parent !== intent.from) throw fail("Structural source changed");
    expect(intent.node, intent.expected);
    place(intent.node, intent.parent, intent.before, action);
    return {
      kind: "treeRestore",
      mode: "place",
      node: intent.node,
      expected: action,
      ...old,
    };
  }
  if (intent.kind === "treeWrap") {
    const { parent, at } = group(intent.nodes);
    if (
      parent.id !== intent.from ||
      !containers.has(intent.type) ||
      (state.nodes[intent.id] &&
        !(
          intent.revive &&
          !state.nodes[intent.id].live &&
          state.nodes[intent.id].type === intent.type
        ))
    )
      throw fail("Invalid or reused wrapper identity");
    intent.nodes.forEach((id, i) => expect(id, intent.expected[i]));
    const previous = intent.nodes.map(location);
    put(intent.id, {
      id: intent.id,
      type: intent.type,
      live: true,
      children: [...intent.nodes],
      placement: action,
      ...(intent.type === "ordered_list" ? { order: 1 } : {}),
    });
    children(parent.id, [
      ...parent.children.slice(0, at),
      intent.id,
      ...parent.children.slice(at + intent.nodes.length),
    ]);
    for (const id of intent.nodes) set(id, { placement: action });
    return {
      kind: "treeRestore",
      mode: "unwrap",
      node: intent.id,
      expected: action,
      children: previous,
    };
  }
  if (intent.kind === "treeUnwrap" || intent.kind === "treePrune") {
    const n = need(intent.node),
      old = location(n.id);
    expect(n.id, intent.expected);
    if (
      !containers.has(n.type) ||
      (intent.kind === "treePrune" && n.children.length)
    )
      throw fail("Wrapper is not empty or cannot be removed");
    const p = need(old.parent),
      at = p.children.indexOf(n.id),
      previous = n.children.map(location);
    children(p.id, [
      ...p.children.slice(0, at),
      ...n.children,
      ...p.children.slice(at + 1),
    ]);
    for (const id of n.children) set(id, { placement: action });
    set(n.id, { live: false, children: [], placement: action });
    return {
      kind: "treeRestore",
      mode: "wrap",
      node: n.id,
      expected: action,
      location: old,
      children: previous,
    };
  }
  if (intent.kind !== "treeRestore") throw fail("Unknown tree operation");
  if (intent.mode === "place") {
    expect(intent.node, intent.expected);
    const old = location(intent.node);
    place(intent.node, intent.parent, intent.before, intent.placement);
    return {
      kind: "treeRestore",
      mode: "place",
      node: intent.node,
      expected: intent.placement,
      ...old,
    };
  }
  if (intent.mode === "unwrap") {
    expect(intent.node, intent.expected);
    const n = need(intent.node),
      old = location(n.id),
      ids = intent.children.map((x) => x.id);
    if (JSON.stringify(n.children) !== JSON.stringify(ids))
      throw fail("Wrapper acquired a structural dependency");
    ids.forEach((id, i) =>
      expect(
        id,
        intent.childExpected ? intent.childExpected[i] : intent.expected,
      ),
    );
    const p = need(old.parent),
      at = p.children.indexOf(n.id),
      current = ids.map(location);
    children(p.id, [
      ...p.children.slice(0, at),
      ...ids,
      ...p.children.slice(at + 1),
    ]);
    for (const child of intent.children)
      set(child.id, { placement: child.placement });
    set(n.id, { live: false, children: [] });
    return {
      kind: "treeRestore",
      mode: "wrap",
      node: n.id,
      expected: intent.expected,
      location: old,
      children: current,
      childExpected: intent.children.map((x) => x.placement),
    };
  }
  if (intent.mode === "wrap") {
    const retired = state.nodes[intent.node],
      ids = intent.children.map((x) => x.id),
      loc = intent.location;
    if (!retired || retired.live || token(retired) !== intent.expected)
      throw fail("Wrapper lifecycle changed");
    const p = need(loc.parent);
    let at;
    if (ids.length) {
      const g = group(ids);
      if (g.parent.id !== p.id) throw fail("Wrapper children changed parent");
      at = g.at;
      ids.forEach((id, i) =>
        expect(
          id,
          intent.childExpected ? intent.childExpected[i] : intent.expected,
        ),
      );
    } else {
      at =
        loc.before === null
          ? p.children.length
          : p.children.indexOf(loc.before);
      if (at < 0) throw fail("Wrapper neighbour changed");
    }
    put(retired.id, {
      ...retired,
      live: true,
      children: ids,
      placement: loc.placement,
    });
    children(p.id, [
      ...p.children.slice(0, at),
      retired.id,
      ...p.children.slice(at + ids.length),
    ]);
    const oldChildren = ids.map((id, i) => ({
      id,
      parent: p.id,
      before: ids[i + 1] ?? p.children[at + ids.length] ?? null,
      placement: intent.childExpected
        ? intent.childExpected[i]
        : intent.expected,
    }));
    for (const child of intent.children)
      set(child.id, { placement: child.placement });
    return {
      kind: "treeRestore",
      mode: "unwrap",
      node: retired.id,
      expected: loc.placement,
      children: oldChildren,
      childExpected: intent.children.map((x) => x.placement),
    };
  }
  throw fail("Unknown structural restoration");
}
