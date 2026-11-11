// SPDX-License-Identifier: MPL-2.0
import {
  captureSpecialSelection,
  installSpecialSelection,
  clearSpecialSelection,
} from "./special.js";
export { clearSpecialSelection } from "./special.js";
import {
  captureRange,
  resolveRange,
  ReviewRequired,
} from "@cwhy/jade-core/selection";
function leaf(node, root) {
  const el = (node.nodeType === 1 ? node : node.parentElement)?.closest(
    "[data-block]",
  );
  if (!el || !root.contains(el))
    throw new ReviewRequired("Select text inside the document");
  return el;
}
export function captureDOMRange(
  state,
  root,
  selection = root.ownerDocument.getSelection(),
) {
  const special = captureSpecialSelection(state, root);
  if (special) return special;
  if (!selection?.rangeCount) throw new ReviewRequired("No document selection");
  const endpoint = (node, offset) => {
    const el = leaf(node, root),
      r = root.ownerDocument.createRange();
    r.selectNodeContents(el);
    r.setEnd(node, offset);
    return { block: el.dataset.block, offset: [...r.toString()].length };
  };
  return captureRange(
    state,
    endpoint(selection.anchorNode, selection.anchorOffset),
    endpoint(selection.focusNode, selection.focusOffset),
  );
}
export function installDOMRange(state, root, range) {
  if (installSpecialSelection(state, root, range)) return;
  clearSpecialSelection(root);
  const { anchor, focus } = resolveRange(state, range);

  const a = endpoint(root, anchor),
    f = endpoint(root, focus);
  root.ownerDocument.getSelection().setBaseAndExtent(...a, ...f);
}

function endpoint(root, p) {
  const escape = root.ownerDocument.defaultView.CSS.escape,
    el = root.querySelector(`[data-block="${escape(p.block)}"]`);
  if (!el) throw new ReviewRequired("Selection is not rendered");
  let remaining = p.offset;
  const walker = root.ownerDocument.createTreeWalker(el, 4);
  let n;
  while ((n = walker.nextNode())) {
    if (remaining === 0) return [n, 0];
    let units = 0;
    for (const char of n.data) {
      units += char.length;
      if (--remaining === 0) return [n, units];
    }
  }
  // An empty editable paragraph contains a placeholder BR. The caret must
  // precede it; placing it after BR can make native composition leave the block.
  if (p.offset === 0) return [el, 0];
  throw new ReviewRequired("Selection offset exceeds rendered text");
}
export function rangeToDOM(state, root, range) {
  const { anchor, focus } = resolveRange(state, range),
    a = endpoint(root, anchor),
    f = endpoint(root, focus),
    r = root.ownerDocument.createRange(),
    other = root.ownerDocument.createRange();
  r.setStart(...a);
  r.collapse(true);
  other.setStart(...f);
  other.collapse(true);
  if (r.compareBoundaryPoints(0, other) <= 0) r.setEnd(...f);
  else {
    r.setStart(...f);
    r.setEnd(...a);
  }
  return r;
}
