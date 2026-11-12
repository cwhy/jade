// SPDX-License-Identifier: MPL-2.0
import {imageCopy} from "../model/image-size.js";
import { listMarkers } from "../model/list-marker.js";
import { CELL_STYLE_PROPERTIES } from "../model/table-format.js";
import { expansionPlan } from "../model/expanding-paste.js";
import { text, apply } from "../model/engine.js";
import {
  captureCellRange,
  resolveCellRange,
  tableGrid,
} from "../selection/grid.js";
import { cellWitness } from "../model/cell-clear.js";
import { validateGridFragment, validateGridAssets } from "../grid-fragment.js";
export function copyCells(state, range) {
  return cellFragment(state, range, false);
}
// Read-only destructive preview can label an unresolved image; transfer cannot.
export function previewCells(state, range) {
  return cellFragment(state, range, true);
}
function cellFragment(state, range, preview) {
  const r = resolveCellRange(state, range);
  function block(id) {
    const n = state.nodes[id];
    if (n.type === "image" && !n.asset) {
      if (!preview)
        throw Error(
          "Image upload is incomplete; finish uploading before copying",
        );
      return {
        type: "paragraph",
        content: [{ text: "[Image upload pending]", marks: [] }],
      };
    }
    if(n.type === "image")return imageCopy(n);
    const attrs = {};
    for (const k of ["language", "order", "asset", "alt", "width", "height"])
      if (n[k] !== undefined) attrs[k] = n[k];
    if (n.text) {
      const content = [];
      for (const a of text(state, id)) {
        const marks = a.marks.map((m) =>
            typeof m === "string"
              ? { type: m }
              : { type: m.type, attrs: m.attrs || m },
          ),
          last = content.at(-1);
        if (last && JSON.stringify(last.marks) === JSON.stringify(marks))
          last.text += a.char;
        else content.push({ text: a.char, marks });
      }
      return { type: n.type, ...attrs, content };
    }
    if (["ordered_list", "bullet_list"].includes(n.type)) {
      const groups = [];
      for (const m of listMarkers(state, n.id)) {
        let g = groups.at(-1);
        if (
          !g ||
          g.type !== m.type ||
          (m.type === "ordered_list" &&
            m.number !== (g.order ?? 1) + g.children.length)
        ) {
          g = {
            type: m.type,
            children: [],
            ...(m.type === "ordered_list" &&
            (n.order !== undefined || m.number !== 1 || m.type !== n.type)
              ? { order: m.number }
              : {}),
          };
          groups.push(g);
        }
        g.children.push(block(m.id));
      }
      return groups;
    }
    return {
      type: n.type,
      ...attrs,
      ...(n.children ? { children: n.children.flatMap(block) } : {}),
    };
  }
  return validateGridFragment({
    version: 2,
    styles: r.cells.map((row) =>
      row.map((id) =>
        Object.fromEntries(
          CELL_STYLE_PROPERTIES.map((key) => [
            key,
            state.nodes[id][key] ?? null,
          ]),
        ),
      ),
    ),
    rows: r.cells.map((row) =>
      row.map((id) => state.nodes[id].children.flatMap(block)),
    ),
  });
}
export function previewCellPaste(state, selection, input, mode = "match") {
  const selected = resolveCellRange(state, selection),
    fragment = validateGridFragment(input);
  validateGridAssets(state, fragment);
  let range = selected,
    rows = fragment.rows,
    styles = fragment.styles;
  if (mode === "expand") {
    const p = expansionPlan(state, selected, fragment),
      existing = p.cells.flat().filter(Boolean),
      outside = existing.filter((id) => !selected.cells.flat().includes(id));
    const before = {
      version: 2,
      styles: p.cells.map((row) =>
        row.map((id) =>
          Object.fromEntries(
            CELL_STYLE_PROPERTIES.map((key) => [
              key,
              id ? (state.nodes[id][key] ?? null) : null,
            ]),
          ),
        ),
      ),
      rows: p.cells.map((row) =>
        row.map((id) =>
          id
            ? previewCells(state, captureCellRange(state, selected.table, id))
                .rows[0][0]
            : [{ type: "paragraph", content: [] }],
        ),
      ),
    };
    return {
      version: 1,
      mode,
      selection: selected,
      range: { table: selected.table, cells: p.cells },
      fragment: p.fragment,
      witness: p.witness,
      geometry: p.geometry,
      outside,
      before,
      expansion: {
        top: p.top,
        left: p.left,
        rows: p.addRows,
        columns: p.addColumns,
      },
    };
  } else if (mode === "fill") {
    if (rows.length !== 1 || rows[0].length !== 1)
      throw Error("Fill selected cells requires one source cell");
    rows = selected.cells.map((row) => row.map(() => rows[0][0]));
    if (styles)
      styles = selected.cells.map((row) => row.map(() => styles[0][0]));
  } else if (mode === "start") {
    const grid = tableGrid(state, selected.table),
      first = selected.cells[0][0],
      top = grid.cells.findIndex((row) => row.includes(first)),
      left = grid.cells[top].indexOf(first);
    const last = grid.cells[top + rows.length - 1]?.[left + rows[0].length - 1];
    if (!last)
      throw Error("Paste needs table expansion; no content was changed");
    range = captureCellRange(state, selected.table, first, last);
  } else if (mode !== "match") throw Error("Unknown paste mapping");
  if (
    range.cells.length !== rows.length ||
    range.cells[0].length !== rows[0].length
  )
    throw Error(
      "Clipboard size differs; choose Fill selected cells or Paste from starting cell",
    );
  const fragmentMapped = validateGridFragment({
      version: fragment.version,
      rows,
      ...(styles ? { styles } : {}),
    }),
    outside = range.cells
      .flat()
      .filter((id) => !selected.cells.flat().includes(id));
  return {
    version: 1,
    range,
    fragment: fragmentMapped,
    witness: cellWitness(state, range.cells.flat()),
    outside,
    mode,
  };
}
export function planPasteCells(state, selection, op, { preview }) {
  if (preview?.version !== 1)
    throw Error("Preview cell destinations before pasting");
  if (preview.mode === "expand") {
    const intent = {
        kind: "expandPasteCells",
        selection: preview.selection,
        geometry: preview.geometry,
        witness: preview.witness,
        fragment: preview.fragment,
      },
      next = apply(state, { ...op, intent });
    const grid = tableGrid(next, preview.selection.table),
      { top, left } = preview.expansion;
    return {
      intent,
      state: next,
      selection: captureCellRange(
        next,
        grid.table.id,
        grid.cells[top][left],
        grid.cells[top + preview.fragment.rows.length - 1][
          left + preview.fragment.rows[0].length - 1
        ],
      ),
    };
  }
  const intent = {
    kind: "pasteCells",
    range: preview.range,
    witness: preview.witness,
    fragment: preview.fragment,
  };
  return {
    intent,
    state: apply(state, { ...op, intent }),
    selection: preview.range,
  };
}
