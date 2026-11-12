// SPDX-License-Identifier: MPL-2.0
import { treeParent } from "../model/tree.js";
import { apply, gapAt, resolveGap } from "../model/engine.js";
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
    (!range.collapsed && type !== "image") ||
    range.slices.length !== 1 ||
    range.slices[0].type !== "paragraph"
  )
    throw new ReviewRequired("Place a caret in a paragraph to insert a block");
  if (type === "image") {
    const point = resolveGap(state, range.start),
      parent = treeParent(state, point.block),
      placement =
        !range.collapsed ||
        point.offset !== state.replicas[state.nodes[point.block].text].length;
    if (placement && !["doc", "cell"].includes(parent?.type))
      throw new ReviewRequired(
        "Image insertion inside a list item currently requires a paragraph-end caret",
      );
    const intent = {
        kind: placement ? "imagePlace" : "imageInsert",
        ...(placement ? { ids: range.slices[0].atoms.map((a) => a.id) } : {}),
        at: range.start,
        slot,
        width,
        height,
      },
      next = apply(state, { ...op, intent });
    return {
      intent,
      state: next,
      after: placement ? gapAt(next, op.id + ":cut:paragraph", 0) : range.start,
    };
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
