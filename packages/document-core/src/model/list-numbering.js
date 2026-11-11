// SPDX-License-Identifier: MPL-2.0
// List numbering is a contribution ledger, not an incidental renderer counter.
// Acceptance order determines the visible start. Undo toggles only its layer;
// removing all layers restores the exact original attribute presence and value.
const valid = (n) => Number.isSafeInteger(n) && n >= 1;
// A restart belongs to a paragraph partition, not its current list wrapper or
// the physical list that happens to contain it. Enter creates a continuation
// without copying this ledger. Undo removes only the author's restart layer.
export function runStart(paragraph) {
  let value;
  for (const layer of paragraph?.listStartLayers || [])
    if (layer.active) value = layer.value;
  return value;
}
export function executeRunStart(state, intent, action, { write, fail }) {
  const n = state.nodes[intent.block],
    adding = intent.kind === "listRunStart";
  if (n?.type !== "paragraph" || (adding && (!n.live || !valid(intent.start))))
    throw fail("Numbered run start is unavailable");
  const layers = n.listStartLayers || [];
  let next;
  if (adding) {
    if (layers.some((l) => l.id === action))
      throw fail("Numbering identity reused");
    next = [...layers, { id: action, value: intent.start, active: true }];
  } else {
    const layer = layers.find((l) => l.id === intent.target);
    if (
      !layer ||
      typeof intent.active !== "boolean" ||
      layer.active === intent.active
    )
      throw fail("Numbering contribution changed");
    next = layers.map((l) =>
      l.id === intent.target ? { ...l, active: intent.active } : l,
    );
  }
  write("nodes")[n.id] = { ...n, listStartLayers: next };
  return {
    kind: "listRunStartActive",
    block: n.id,
    target: adding ? action : intent.target,
    active: adding ? false : !intent.active,
  };
}
function projection(ledger) {
  let value = ledger.base,
    present = ledger.present;
  for (const l of ledger.layers)
    if (l.active) {
      value = l.value;
      present = true;
    }
  return { value, present };
}
function materialize(node, ledger) {
  const n = { ...node, numbering: ledger },
    p = projection(ledger);
  if (p.present) n.order = p.value;
  else delete n.order;
  return n;
}
export function validateListNumbering(state, intent) {
  if (
    !intent ||
    Object.keys(intent).some((k) => !["kind", "list", "start"].includes(k)) ||
    typeof intent.list !== "string" ||
    !valid(intent.start) ||
    !state.nodes[intent.list]?.live ||
    state.nodes[intent.list].type !== "ordered_list"
  )
    throw Error("Invalid list numbering target/start");
}
export function executeListNumbering(state, intent, action, { write, fail }) {
  const adding = intent.kind === "listNumbering";
  if (adding) validateListNumbering(state, intent);
  // Owned activation may update a retained wrapper after an independent
  // conversion retired it. This does not revive the wrapper or bypass deletion.
  const n = state.nodes[intent.list];
  if (
    !n ||
    n.type !== "ordered_list" ||
    (!n.live &&
      (adding || n.clearedBy || n.structureDeletedBy || n.richRetiredBy))
  )
    throw fail("Numbered list is unavailable");
  const ledger = n.numbering || {
    base: n.order ?? 1,
    present: Object.hasOwn(n, "order"),
    layers: [],
  };
  let layers;
  if (adding) {
    if (ledger.layers.some((l) => l.id === action))
      throw fail("Numbering identity reused");
    layers = [
      ...ledger.layers,
      { id: action, value: intent.start, active: true },
    ];
  } else {
    const layer = ledger.layers.find((l) => l.id === intent.target);
    if (
      !layer ||
      typeof intent.active !== "boolean" ||
      layer.active === intent.active
    )
      throw fail("Numbering contribution changed");
    layers = ledger.layers.map((l) =>
      l.id === intent.target ? { ...l, active: intent.active } : l,
    );
  }
  write("nodes")[n.id] = materialize(n, {
    base: ledger.base,
    present: ledger.present,
    layers,
  });
  return {
    kind: "listNumberingActive",
    list: n.id,
    target: adding ? action : intent.target,
    active: adding ? false : !intent.active,
  };
}
export function validateListNumberings(state) {
  for (const n of Object.values(state.nodes)) {
    if (n.listStartLayers !== undefined) {
      if (n.type !== "paragraph" || !Array.isArray(n.listStartLayers))
        throw Error("Invalid run numbering ledger");
      const seen = new Set();
      for (const l of n.listStartLayers) {
        if (
          !l ||
          typeof l.id !== "string" ||
          !l.id ||
          seen.has(l.id) ||
          !valid(l.value) ||
          typeof l.active !== "boolean"
        )
          throw Error("Invalid run numbering contribution");
        seen.add(l.id);
      }
    }
    const f = n.numbering;
    if (f === undefined) continue;
    if (
      n.type !== "ordered_list" ||
      !f ||
      !valid(f.base) ||
      typeof f.present !== "boolean" ||
      !Array.isArray(f.layers)
    )
      throw Error("Invalid numbering ledger");
    const seen = new Set();
    for (const l of f.layers) {
      if (
        typeof l.id !== "string" ||
        !l.id ||
        seen.has(l.id) ||
        !valid(l.value) ||
        typeof l.active !== "boolean"
      )
        throw Error("Invalid numbering contribution");
      seen.add(l.id);
    }
    const p = projection(f);
    if (Object.hasOwn(n, "order") !== p.present || (n.order ?? 1) !== p.value)
      throw Error("Numbering projection mismatch");
  }
}
export function structuralNumberingShape(n) {
  let result = n;
  if (n.numbering && !n.numbering.layers.some((l) => l.active)) {
    const { numbering, ...rest } = result;
    result = rest;
  }
  if (n.listStartLayers && !n.listStartLayers.some((l) => l.active)) {
    const { listStartLayers, ...rest } = result;
    result = rest;
  }
  return result;
}
