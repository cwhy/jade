// SPDX-License-Identifier: MPL-2.0
import { tableGrid } from "../selection/grid.js";
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b),
  copy = (x) => structuredClone(x);
export const CELL_STYLE_PROPERTIES = [
  "background",
  "verticalAlign",
  "textAlign",
];
const properties = (n) =>
  n.type === "table"
    ? ["headerRow"]
    : n.type === "cell"
      ? [...CELL_STYLE_PROPERTIES]
      : [];
export function checkTableStyle(property, value) {
  if (
    value === null &&
    [...CELL_STYLE_PROPERTIES, "headerRow"].includes(property)
  )
    return;
  if (property === "headerRow" && typeof value === "boolean") return;
  if (
    property === "background" &&
    typeof value === "string" &&
    /^#[0-9a-f]{6}$/i.test(value)
  )
    return;
  if (
    property === "verticalAlign" &&
    ["top", "middle", "bottom"].includes(value)
  )
    return;
  if (property === "textAlign" && ["left", "center", "right"].includes(value))
    return;
  throw Error("Invalid table style property/value");
}
function project(ledger) {
  const result = { ...ledger.base };
  for (const l of ledger.layers) if (l.active) result[l.property] = l.value;
  return result;
}
function retainedDefault(ledger, key) {
  return (
    ledger.present.includes(key) &&
    !ledger.layers.some((l) => l.active && l.property === key)
  );
}
function materialize(n, ledger) {
  const next = { ...n, tableFormats: ledger };
  for (const [key, value] of Object.entries(project(ledger))) {
    if (value === null && !retainedDefault(ledger, key)) delete next[key];
    else next[key] = value;
  }
  return next;
}
export function validateTableFormat(state, intent) {
  const grid = tableGrid(state, intent.table),
    cells = new Set(grid.cells.flat()),
    targets = intent.targets,
    patch = intent.patch;
  if (
    !Array.isArray(targets) ||
    !targets.length ||
    new Set(targets).size !== targets.length ||
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    !Object.keys(patch).length
  )
    throw Error("Invalid table formatting targets/patch");
  const header = Object.hasOwn(patch, "headerRow");
  if (
    (header &&
      (targets.length !== 1 ||
        targets[0] !== intent.table ||
        Object.keys(patch).length !== 1)) ||
    (!header && targets.some((id) => !cells.has(id)))
  )
    throw Error("Table formatting targets changed");
  for (const [key, value] of Object.entries(patch)) {
    checkTableStyle(key, value);
    if (!header && !CELL_STYLE_PROPERTIES.includes(key))
      throw Error("Invalid cell style");
  }
  return targets;
}
export function executeTableFormat(state, intent, action, { write, fail }) {
  const adding = intent.kind === "tableFormat",
    targets = intent.targets;
  if (adding) validateTableFormat(state, intent);
  else {
    tableGrid(state, intent.table);
    for (const id of targets) {
      const n = state.nodes[id];
      if (
        !n?.live ||
        !n.tableFormats ||
        !n.tableFormats.layers.some((l) => l.id === intent.target)
      )
        throw fail(
          "Formatted target is unavailable; restore its structure before Undo",
        );
    }
  }
  // Validate every target before writing. One action may contribute multiple
  // properties; Undo toggles only those layers, leaving later contributions live.
  for (const id of targets) {
    const n = state.nodes[id],
      ledger = n.tableFormats || {
        base: Object.fromEntries(
          properties(n).map((key) => [key, n[key] ?? null]),
        ),
        present: properties(n).filter((key) => Object.hasOwn(n, key)),
        layers: [],
      };
    let layers;
    if (adding) {
      if (ledger.layers.some((l) => l.id === action))
        throw fail("Table formatting identity reused");
      layers = [
        ...ledger.layers,
        ...Object.entries(intent.patch).map(([property, value]) => ({
          id: action,
          property,
          value: copy(value),
          active: true,
        })),
      ];
    } else
      layers = ledger.layers.map((l) =>
        l.id === intent.target ? { ...l, active: intent.active } : l,
      );
    write("nodes")[id] = materialize(n, {
      base: ledger.base,
      present: ledger.present,
      layers,
    });
  }
  return {
    kind: "tableFormatActive",
    table: intent.table,
    targets: [...targets],
    target: adding ? action : intent.target,
    active: adding ? false : !intent.active,
  };
}
export function validateTableFormats(state) {
  for (const n of Object.values(state.nodes)) {
    for (const key of [...CELL_STYLE_PROPERTIES, "headerRow"])
      if (n[key] !== undefined) {
        if (!properties(n).includes(key)) throw Error("Style on invalid node");
        checkTableStyle(key, n[key]);
      }
    const f = n.tableFormats;
    if (f === undefined) continue;
    if (
      !["cell", "table"].includes(n.type) ||
      !f ||
      typeof f !== "object" ||
      !f.base ||
      typeof f.base !== "object" ||
      Array.isArray(f.base) ||
      !Array.isArray(f.layers) ||
      !Array.isArray(f.present) ||
      new Set(f.present).size !== f.present.length ||
      f.present.some((key) => !properties(n).includes(key)) ||
      !equal(Object.keys(f.base).sort(), properties(n).sort())
    )
      throw Error("Invalid table format ledger");
    for (const [key, value] of Object.entries(f.base))
      checkTableStyle(key, value);
    const seen = new Set();
    for (const l of f.layers) {
      const key = JSON.stringify([l.id, l.property]);
      if (
        typeof l.id !== "string" ||
        !l.id ||
        seen.has(key) ||
        !properties(n).includes(l.property) ||
        typeof l.active !== "boolean"
      )
        throw Error("Invalid table format contribution");
      seen.add(key);
      checkTableStyle(l.property, l.value);
    }
    for (const [key, value] of Object.entries(project(f)))
      if (
        !equal(n[key] ?? null, value) ||
        Object.hasOwn(n, key) !== (value !== null || retainedDefault(f, key))
      )
        throw Error("Table formatting projection mismatch");
  }
}

// Inactive style history has no live contribution. Keep it in storage for Redo,
// but do not treat it as a dependency preventing structural Undo. Visible
// properties still participate in the caller's exact shape comparison.
export function structuralStyleShape(node) {
  if (
    !node.tableFormats ||
    node.tableFormats.layers.some((layer) => layer.active)
  )
    return node;
  const { tableFormats, ...shape } = node;
  return shape;
}
