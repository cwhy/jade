// SPDX-License-Identifier: MPL-2.0
import { resolveRange, ReviewRequired } from "../selection/range.js";
import { findCharacter, text } from "../model/engine.js";
import { summarizeFormat, planInlineFormat } from "./inline-format.js";
function selected(state, range) {
  if (range?.kind || range?.version !== 1 || range.epoch !== state.epoch)
    throw new ReviewRequired("Choose text in the current document");
  // Bookmarks keep captured identities; a peer insertion inside the visual span
  // is not silently included. Deleted targets are skipped, not replaced by offsets.
  resolveRange(state, range);
  const ids = new Set(range.slices.flatMap((s) => s.atoms.map((a) => a.id))),
    atoms = [],
    blocks = new Map();
  let skippedCode = false;
  for (const id of ids) {
    const found = findCharacter(state, id);
    if (!found) continue;
    if (state.nodes[found.block].type === "code") {
      skippedCode = true;
      continue;
    }
    if (!blocks.has(found.block))
      blocks.set(
        found.block,
        new Map(text(state, found.block).map((a) => [a.id, a])),
      );
    atoms.push(blocks.get(found.block).get(id));
  }
  return { atoms, skippedCode };
}
export function textFormatState(state, range, property) {
  const { atoms, skippedCode } = selected(state, range);
  return { ...summarizeFormat(atoms, property), skippedCode };
}
export function planTextFormat(state, range, op, options) {
  const { atoms, skippedCode } = selected(state, range);
  return {
    ...planInlineFormat(state, range, op, atoms, options),
    notice: skippedCode
      ? "Code text skipped; use whole-cell formatting for code styles"
      : "",
  };
}
