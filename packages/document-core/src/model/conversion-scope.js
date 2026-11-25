// SPDX-License-Identifier: MPL-2.0
// Conversion changes presentation, not the retained container of an authored
// boundary. Selected item scopes retain authored grammar and numbering.
import { projectedListMarkers } from "./conversion-numbering.js";
export function listScopeLeaves(state, parent, scope) {
  const container = state.nodes[parent],
    root = state.nodes[scope];
  if (
    !container?.live ||
    !["doc", "cell"].includes(container.type) ||
    !container.children?.includes(scope) ||
    !root?.live ||
    !["ordered_list", "bullet_list"].includes(root.type)
  )
    throw Error("List conversion scope changed");
  const leaves = [],
    seen = new Set();
  function walk(id) {
    const node = state.nodes[id];
    if (!node?.live || seen.has(id))
      throw Error("Invalid list conversion tree");
    seen.add(id);
    if (["paragraph", "code", "image"].includes(node.type)) {
      leaves.push(id);
      return;
    }
    if (!["ordered_list", "bullet_list", "list_item"].includes(node.type))
      throw Error("List conversion shape is not qualified");
    for (const child of node.children || []) walk(child);
  }
  walk(scope);
  return leaves;
}
export function scopeProjection(state, parent, scope) {
  const children = listScopeLeaves(state, parent, scope);
  const owner = new Map(children.map((id) => [id, id]));
  for (const projection of [...state.joinProjection].reverse()) {
    const entry = state.listJoins[projection.boundary],
      marker = state.boundaries[`projection-cut:${entry?.id}`],
      at = children.indexOf(marker?.block);
    if (at < 0) continue;
    if (!state.nodes[marker.block]?.live || state.nodes[entry.right]?.live)
      throw Error("Invalid projected list source");
    children.splice(at + 1, 0, entry.right);
    owner.set(entry.right, owner.get(marker.block));
  }
  const sources = new Map();
  for (const id of children) {
    const visible = owner.get(id);
    if (!sources.has(visible)) sources.set(visible, []);
    sources.get(visible).push(id);
  }
  return { children, owner, sources };
}
export function listScopeSections(
  state,
  parent,
  scope,
  leaves = listScopeLeaves(state, parent, scope),
) {
  const sections = [];
  let current = [];
  for (const id of leaves) {
    if (["image", "code"].includes(state.nodes[id].type)) {
      if (current.length) sections.push(current);
      current = [];
    } else current.push(id);
  }
  if (current.length) sections.push(current);
  return sections;
}

// Item selection is captured as text extents, not mutable wrapper positions.
// Admission and projection derive current whole items from those same extents.
function itemLeaves(state, item) {
  const result = [];
  function walk(id) {
    const n = state.nodes[id];
    if (["paragraph", "code", "image"].includes(n.type)) result.push(id);
    else for (const child of n.children || []) walk(child);
  }
  walk(item);
  return result;
}
export function captureListItems(state, parent, scope, items) {
  listScopeLeaves(state, parent, scope);
  const all = state.nodes[scope].children;
  if (
    !Array.isArray(items) ||
    !items.length ||
    new Set(items).size !== items.length ||
    items.some(
      (id, i) =>
        !all.includes(id) ||
        (i && all.indexOf(id) !== all.indexOf(items[i - 1]) + 1),
    )
  )
    throw Error("Select contiguous whole sibling items");
  return items.flatMap((id) => itemLeaves(state, id));
}
export function selectedListLeaves(
  state,
  parent,
  scope,
  selected,
  { contiguous = true } = {},
) {
  listScopeLeaves(state, parent, scope);
  const entries = state.nodes[scope].children.map((id) => {
    const leaves = itemLeaves(state, id),
      text = leaves.filter((x) => state.nodes[x].type === "paragraph");
    const matches = text.filter((x) => selected.has(x));
    if (matches.length && matches.length !== text.length)
      throw Error("Partial item subtree conversion is not qualified");
    return { id, leaves, selected: !!matches.length };
  });
  const chosen = entries.filter((e) => e.selected);
  if (
    contiguous &&
    chosen.some(
      (e, i) => i && entries.indexOf(e) !== entries.indexOf(chosen[i - 1]) + 1,
    )
  )
    throw Error("Selected list items are no longer contiguous");
  return { entries, leaves: chosen.flatMap((e) => e.leaves) };
}
// A dependent style retains the containing item as a structural unit. This
// expands presentation membership only; no extra text receives its style.
export function retainedItemMembers(state, scope, selected) {
  const retained = new Set(selected);
  for (const item of state.nodes[scope].children) {
    const leaves = itemLeaves(state, item);
    if (leaves.some((id) => selected.has(id)))
      for (const id of leaves)
        if (state.nodes[id].type === "paragraph") retained.add(id);
  }
  return retained;
}
// Virtual list runs are read-only views, never new stored identities or commands.
// Marker values come from the full canonical sequence, including converted items.
export function projectListScope(state, parent, scope, groups) {
  const selected = new Set(groups.flatMap((g) => [...g.members]));
  const { entries } = selectedListLeaves(state, parent, scope, selected, {
      contiguous: false,
    }),
    markers = projectedListMarkers(state, scope, entries, groups);
  const result = [];
  let run = null;
  for (const entry of entries) {
    if (entry.selected) {
      run = null;
      result.push(...entry.leaves);
      continue;
    }
    const marker = markers.get(entry.id);
    if (!run || run.type !== marker.type) {
      let id = "view:list-run:" + JSON.stringify([scope, entry.id]);
      while (state.nodes[id]) id += ":";
      run = {
        id,
        type: marker.type,
        live: true,
        children: [],
        sourceList: scope,
        markers: [],
        ...(marker.number !== undefined ? { order: marker.number } : {}),
      };
      result.push(run);
    }
    run.children.push(entry.id);
    run.markers.push(marker);
  }
  return result.map((n) =>
    typeof n === "string"
      ? n
      : Object.freeze({
          ...n,
          children: Object.freeze(n.children),
          markers: Object.freeze(n.markers.map(Object.freeze)),
        }),
  );
}
