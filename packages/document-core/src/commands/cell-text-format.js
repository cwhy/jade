// SPDX-License-Identifier: MPL-2.0
import { text } from "../model/engine.js";
import { resolveCellRange } from "../selection/grid.js";
import { summarizeFormat, planInlineFormat } from "./inline-format.js";
// Freeze character identities at invocation; later peer text is excluded.
function selected(state, selection) {
  const range = resolveCellRange(state, selection),
    atoms = [];
  function walk(id) {
    const n = state.nodes[id];
    if (!n?.live) throw Error("Selected content is unavailable");
    if (n.text) {
      for (const a of text(state, id)) atoms.push(a);
    } else for (const child of n.children || []) walk(child);
  }
  for (const id of range.cells.flat()) walk(id);
  return { atoms, cells: range.cells.flat().length };
}
export function cellTextFormatState(state, selection, property) {
  const { atoms, cells } = selected(state, selection);
  return { ...summarizeFormat(atoms, property), cells };
}
export function planCellTextFormat(state, selection, op, options) {
  if (options.property === "link")
    throw Error("Use a text selection to edit a link");
  return planInlineFormat(
    state,
    selection,
    op,
    selected(state, selection).atoms,
    options,
  );
}
