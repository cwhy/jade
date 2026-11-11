// SPDX-License-Identifier: MPL-2.0
import { apply, gapAt } from "../model/engine.js";
import { validateDestination, ReviewRequired } from "../selection/range.js";
import { validateRichSlice } from "../rich-slice.js";
import { planReplace } from "./replace.js";

export function planRichInsert(state, range, value, op) {
  validateDestination(state, range);
  const slice = validateRichSlice(value);
  if (
    !range.collapsed ||
    range.slices.length !== 1 ||
    range.slices[0].type !== "paragraph"
  )
    throw new ReviewRequired(
      "Rich caret paste requires a collapsed paragraph selection; destination unchanged",
    );
  if (slice.blocks.every((b) => b.type === "paragraph"))
    return planReplace(state, range, { version: 1, blocks: slice.blocks }, op, {
      strict: true,
    });
  const intent = {
      kind: "richInsert",
      parent: range.slices[0].parent,
      at: range.start,
      slice,
    },
    next = apply(state, { ...op, intent });
  if (next.nodes[`${op.id}:attached:paragraph`]) {
    const suffix = `${op.id}:cut:list-tail`,
      attachment = `${op.id}:attached:attachment`,
      paragraph = `${op.id}:attached:paragraph`;
    const block = next.nodes[suffix]?.live
      ? suffix
      : next.nodes[attachment]?.text
        ? attachment
        : paragraph;
    return {
      intent,
      state: next,
      after: gapAt(
        next,
        block,
        block === suffix ? 0 : next.replicas[next.nodes[block].text].length,
      ),
    };
  }
  let last = slice.blocks.at(-1);
  while (["ordered_list", "bullet_list"].includes(last.type))
    last = last.children.at(-1).children.at(-1);
  const offset =
    last.type === "paragraph"
      ? last.content.reduce((n, r) => n + [...r.text].length, 0)
      : 0;
  const flatTail = `${op.id}:flat-cut:${slice.blocks[0].children?.length - 2}:list-tail`;
  const tail = next.nodes[flatTail]
    ? flatTail
    : `${op.id}:cut:${state.nodes[range.slices[0].parent].type === "list_item" ? "list-tail" : "paragraph"}`;
  return {
    intent,
    state: next,
    after: gapAt(next, next.nodes[tail] ? tail : range.slices[0].block, offset),
  };
}
