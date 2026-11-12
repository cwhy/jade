// SPDX-License-Identifier: MPL-2.0
import { apply, gapAt } from "../model/engine.js";
import { validateDestination, ReviewRequired } from "../selection/range.js";
import { planRichInsert } from "./rich-insert.js";
export function planInsertBlock(
  state,
  range,
  op,
  { type, rows = 2, columns = 3, slot, width, height } = {},
) {
  validateDestination(state, range);
  if (
    range.kind ||
    !range.collapsed ||
    range.slices.length !== 1 ||
    range.slices[0].type !== "paragraph"
  )
    throw new ReviewRequired("Place a caret in a paragraph to insert a block");
  if (type === "image") {
    const intent = {
        kind: "imageInsert",
        at: range.start,
        slot,
        width,
        height,
      },
      next = apply(state, { ...op, intent });
    return { intent, state: next, after: range.start };
  }
  if (type === "table") {
    const intent = { kind: "tableCreate", at: range.start, rows, columns },
      next = apply(state, { ...op, intent });
    return {
      intent,
      state: next,
      after: gapAt(next, op.id + ":table:row:0:cell:0:paragraph", 0),
    };
  }
  if (!["bullet_list", "ordered_list", "code"].includes(type))
    throw new ReviewRequired("Unsupported block type");
  const paragraph = { type: "paragraph", content: [] },
    block =
      type === "code"
        ? { type: "code", content: [] }
        : { type, children: [{ type: "list_item", children: [paragraph] }] };
  const plan = planRichInsert(
    state,
    range,
    {
      version: 1,
      edges: { start: "boundary", end: "boundary" },
      blocks: [block],
    },
    op,
  );
  let inserted = plan.state.nodes[op.id + ":rich:0"];
  while (inserted?.children?.length)
    inserted = plan.state.nodes[inserted.children[0]];
  if (!inserted) throw new ReviewRequired("No editable insertion target");
  return { ...plan, after: gapAt(plan.state, inserted.id, 0) };
}
