// SPDX-License-Identifier: MPL-2.0
import { selectionStructure } from "./structure.js";
import { ReviewRequired } from "./range.js";

const allowed = new Set([
  "paragraph",
  "code",
  "image",
  "ordered_list",
  "bullet_list",
  "list_item",
]);
const fail = (message) => {
  throw new ReviewRequired(message);
};

// Whole blocks have structural endpoints. In particular, an image-ending item
// must not borrow a caret from the next item merely to become copyable.
export function captureBlockRange(state, anchor, focus = anchor) {
  const structure = selectionStructure(state),
    a = state.nodes[anchor],
    f = state.nodes[focus];
  const parent = a && structure.parent(anchor);
  if (
    !a?.live ||
    !f?.live ||
    !parent ||
    structure.parent(focus)?.id !== parent.id
  )
    fail("Select whole blocks within one container");
  const ai = parent.children.indexOf(anchor),
    fi = parent.children.indexOf(focus);
  if (ai < 0 || fi < 0) fail("Selected blocks are unavailable");
  const blocks = parent.children.slice(Math.min(ai, fi), Math.max(ai, fi) + 1);
  if (blocks.some((id) => !allowed.has(state.nodes[id]?.type)))
    fail("Use whole-cell selection for table content");
  return {
    kind: "blocks",
    version: 1,
    epoch: state.epoch,
    parent: parent.id,
    anchor,
    focus,
    backwards: ai > fi,
    blocks,
  };
}

export function resolveBlockRange(state, range) {
  if (
    range?.kind !== "blocks" ||
    range.version !== 1 ||
    range.epoch !== state.epoch
  )
    fail("Document changed; select the blocks again");
  const now = captureBlockRange(state, range.anchor, range.focus);
  if (
    now.parent !== range.parent ||
    JSON.stringify(now.blocks) !== JSON.stringify(range.blocks)
  )
    fail("Selected block structure changed; select it again");
  // As with whole-cell copy, read the current contents of the selected live
  // identities. Text edits do not invalidate an otherwise intact selection.
  return now;
}
