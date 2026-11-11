// SPDX-License-Identifier: MPL-2.0
// An Enter's right-hand text partition retains its authored marker even when
// boundary materialization assigns that paragraph to a different wrapper.
import { treeParent } from "./tree.js";
import { runStart } from "./list-numbering.js";
const isType = (t) => ["ordered_list", "bullet_list"].includes(t);
function projectMarker(node, fallback, paragraph) {
  let type = paragraph?.listMarkerBase ?? node.markerBase ?? fallback;
  for (const layer of node.markerLayers || [])
    if (layer.active) type = layer.type;
  for (const layer of paragraph?.markerLayers || [])
    if (layer.active) type = layer.type;
  return type;
}
export function itemMarker(state, id) {
  const n = state.nodes[id],
    list = treeParent(state, id);
  if (n?.type !== "list_item" || !isType(list?.type))
    throw Error("Marker requires a list item");
  return projectMarker(n, list.type, state.nodes[n.children[0]]);
}
export function validateMarkerType(type) {
  if (!isType(type)) throw Error("Invalid list marker type");
}
export function executeMarker(state, intent, action, { write, fail }) {
  const key = intent.block ? "block" : "item",
    n = state.nodes[intent[key]];
  if (
    !n ||
    n.type !== (key === "block" ? "paragraph" : "list_item") ||
    (intent.kind === "listMarker" && !n.live)
  )
    throw fail("Marker item unavailable");
  const layers = n.markerLayers || [];
  let next;
  if (intent.kind === "listMarker") {
    validateMarkerType(intent.type);
    if (layers.some((l) => l.id === action))
      throw fail("Reused marker contribution");
    next = [...layers, { id: action, type: intent.type, active: true }];
  } else {
    const l = layers.find((l) => l.id === intent.target);
    if (!l || typeof intent.active !== "boolean" || l.active === intent.active)
      throw fail("Marker lifecycle changed");
    next = layers.map((l) =>
      l.id === intent.target ? { ...l, active: intent.active } : l,
    );
  }
  write("nodes")[n.id] = { ...n, markerLayers: next };
  return {
    kind: "listMarkerActive",
    [key]: n.id,
    target: intent.kind === "listMarker" ? action : intent.target,
    active: intent.kind === "listMarker" ? false : !intent.active,
  };
}
export function validateMarkers(state) {
  for (const n of Object.values(state.nodes)) {
    if (n.listMarkerBase !== undefined) {
      if (n.type !== "paragraph")
        throw Error("Inherited list marker on non-paragraph");
      validateMarkerType(n.listMarkerBase);
    }
    if (n.markerBase !== undefined) {
      if (n.type !== "list_item") throw Error("Marker base on non-item");
      validateMarkerType(n.markerBase);
    }
    if (n.markerLayers !== undefined) {
      if (
        !["list_item", "paragraph"].includes(n.type) ||
        !Array.isArray(n.markerLayers)
      )
        throw Error("Invalid marker layers");
      const seen = new Set();
      for (const l of n.markerLayers) {
        if (
          typeof l.id !== "string" ||
          !l.id ||
          seen.has(l.id) ||
          typeof l.active !== "boolean"
        )
          throw Error("Invalid marker contribution");
        seen.add(l.id);
        validateMarkerType(l.type);
      }
    }
  }
}

// Derived presentation only. Ordered counters skip bullet items; changing one
// item's marker never mutates the other items' stored style or numbering.
export function listMarkers(state, list) {
  const n = state.nodes[list];
  if (!isType(n?.type)) throw Error("Not a list");
  let next = n.order ?? 1;
  return n.children.map((id) => {
    const item = state.nodes[id],
      paragraph = state.nodes[item.children[0]],
      type = projectMarker(item, n.type, paragraph);
    if (type === "ordered_list") next = runStart(paragraph) ?? next;
    return { id, type, ...(type === "ordered_list" ? { number: next++ } : {}) };
  });
}

export function enterMarker(state, item, offset) {
  const n = state.nodes[item],
    explicit =
      (state.nodes[n.children[0]]?.markerLayers || []).some((l) => l.active) ||
      state.nodes[n.children[0]]?.listMarkerBase !== undefined ||
      n.markerBase !== undefined ||
      (n.markerLayers || []).some((l) => l.active),
    child = state.nodes[n.children[1]];
  return !explicit && offset > 0 && isType(child?.type)
    ? child.type
    : itemMarker(state, item);
}

// Inactive style history is retained for Redo but is not a live topology edit.
export function structuralMarkerShape(node) {
  if (!node.markerLayers || node.markerLayers.some((l) => l.active))
    return node;
  const { markerLayers, ...rest } = node;
  return rest;
}
