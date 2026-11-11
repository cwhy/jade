// SPDX-License-Identifier: MPL-2.0
import {
  resolveCellRange,
  resolveTableBoundary,
} from "@cwhy/jade-core/table-selection";
const active = new WeakMap();
const find = (root, id) =>
  root.querySelector(
    `[data-node="${root.ownerDocument.defaultView.CSS.escape(id)}"]`,
  );
const native = (root) => {
  const s = root.ownerDocument.getSelection();
  return s && [s.anchorNode, s.anchorOffset, s.focusNode, s.focusOffset];
};
const same = (a, b) => a && b && a.every((x, i) => x === b[i]);
function visualClear(root) {
  for (const n of root.querySelectorAll(
    "[data-selected-cell],[data-table-boundary]",
  )) {
    n.removeAttribute("data-selected-cell");
    n.removeAttribute("data-table-boundary");
  }
  root.removeAttribute("data-selection-kind");
}
export function clearSpecialSelection(root, { removeRange = false } = {}) {
  const hadSelection =
    active.has(root) || root.hasAttribute("data-selection-kind");
  active.delete(root);
  if (hadSelection) visualClear(root);
  if (removeRange) root.ownerDocument.getSelection()?.removeAllRanges();
}
export function captureSpecialSelection(state, root) {
  const saved = active.get(root);
  if (!saved) return null;
  if (!same(saved.native, native(root))) {
    clearSpecialSelection(root);
    return null;
  }
  try {
    return saved.range.kind === "cells"
      ? resolveCellRange(state, saved.range)
      : resolveTableBoundary(state, saved.range);
  } catch (error) {
    clearSpecialSelection(root, { removeRange: true });
    throw error;
  }
}
export function installSpecialSelection(state, root, range) {
  if (!["cells", "boundary"].includes(range?.kind)) return false;
  try {
    const checked =
      range.kind === "cells"
        ? resolveCellRange(state, range)
        : resolveTableBoundary(state, range);
    const target = find(
      root,
      checked.kind === "cells" ? checked.focus : checked.before,
    );
    if (!target) throw Error("Selection is not rendered");
    visualClear(root);
    if (checked.kind === "cells")
      for (const id of checked.cells.flat()) {
        const el = find(root, id);
        if (!el) throw Error("Selected cell is not rendered");
        el.setAttribute("data-selected-cell", "true");
      }
    else target.setAttribute("data-table-boundary", "before");
    root.dataset.selectionKind = checked.kind;
    // A cell selection has a native span inside its focus cell. A collapsed TR
    // boundary beside noneditable media can be normalized by Chrome to the root
    // after this event, losing the selection fingerprint. The span is structural,
    // never a text-editing target; commands still require the explicit kind.
    const s = root.ownerDocument.getSelection();
    if (checked.kind === "cells")
      s.setBaseAndExtent(target, 0, target, target.childNodes.length);
    else {
      const parent = target.parentNode,
        offset = [...parent.childNodes].indexOf(target);
      s.setBaseAndExtent(parent, offset, parent, offset);
    }
    active.set(root, { range: structuredClone(checked), native: native(root) });
    return true;
  } catch (error) {
    clearSpecialSelection(root, { removeRange: true });
    throw error;
  }
}
