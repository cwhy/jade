// SPDX-License-Identifier: MPL-2.0
import { resolveRange, ReviewRequired } from "../selection/range.js";
import { selectionStructure } from "../selection/structure.js";
export function tableContext(state, range) {
  const structure = selectionStructure(state);
  const cellOf = (block) => {
    for (let n = state.nodes[block]; n; n = structure.parent(n.id))
      if (n.type === "cell") return n;
  };
  const { anchor, focus } = resolveRange(state, range),
    cell = cellOf(focus.block);
  if (!cell || cellOf(anchor.block)?.id !== cell.id)
    throw new ReviewRequired("Select text within one cell before navigating");
  const row = structure.parent(cell.id),
    table = row && structure.parent(row.id);
  if (row?.type !== "row" || table?.type !== "table")
    throw new ReviewRequired("Invalid table destination");
  const cells = table.children.flatMap((id) => {
    const r = state.nodes[id];
    if (
      !r?.live ||
      r.type !== "row" ||
      !Array.isArray(r.children) ||
      r.children.length !== row.children.length
    )
      throw new ReviewRequired("Cell navigation requires a regular grid");
    return r.children.map((id) => {
      const c = state.nodes[id];
      if (
        !c?.live ||
        c.type !== "cell" ||
        (c.colspan ?? 1) !== 1 ||
        (c.rowspan ?? 1) !== 1
      )
        throw new ReviewRequired("Cell navigation requires a regular grid");
      return id;
    });
  });
  return { cell, row, table, cells };
}
