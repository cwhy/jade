// SPDX-License-Identifier: MPL-2.0
import { marks } from "../fragment.js";
// Shared behavioral reducer; neither editor framework nor text storage lives here.
export const formattingMark = "__formatContributions";
export const propertyOf = (mark) =>
  typeof mark === "string" ? mark : mark.type;
export function checkFormat(property, value) {
  if (
    ![
      "strong",
      "em",
      "strike",
      "underline",
      "highlight",
      "color",
      "link",
    ].includes(property)
  )
    throw Error("Unsupported formatting property");
  if (value !== null && propertyOf(value) !== property)
    throw Error("Formatting property mismatch");
  if (property === "color" && value !== null) marks([value]);
  if (
    property === "link" &&
    value !== null &&
    !/^(https?:|mailto:)/i.test(value.attrs?.href || "")
  )
    throw Error("Unsafe format link");
}
export function contribute(previous, base, id, property, value) {
  checkFormat(property, value);
  const cell = previous || { base: structuredClone(base), layers: [] };
  const old = cell.layers.find((l) => l.id === id);
  if (
    old &&
    (old.property !== property ||
      JSON.stringify(old.value) !== JSON.stringify(value))
  )
    throw Error("Formatting identity reused");
  if (old?.active) return cell;
  // Re-applying a speculative command after authority rebase takes its accepted
  // order. Redo uses activate(), retaining its original order instead.
  return {
    ...cell,
    layers: [
      ...cell.layers.filter((l) => l.id !== id),
      { id, property, value: structuredClone(value), active: true },
    ],
  };
}
export function activate(cell, id, active) {
  if (!cell || !cell.layers.some((l) => l.id === id)) return cell;
  return {
    ...cell,
    layers: cell.layers.map((l) => (l.id === id ? { ...l, active } : l)),
  };
}
export function visible(cell) {
  let marks = [...cell.base];
  for (const layer of cell.layers) {
    if (!layer.active) continue;
    marks = marks.filter((m) => propertyOf(m) !== layer.property);
    if (layer.value !== null) marks.push(layer.value);
  }
  return marks;
}
