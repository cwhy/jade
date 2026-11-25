// SPDX-License-Identifier: MPL-2.0
import { bodyConversionFor } from "../model/text-conversion.js";
// Convert effective ranges to the existing identity-owned text/erasure/join
// transaction. There is no second storage reducer or separate Undo pipeline.
import { apply, gapAt, resolveGap, findCharacter } from "../model/engine.js";
import {
  captureDisplayJoin,
  needsDisplayBoundary,
} from "../model/display-boundary.js";
import { joinTarget } from "../model/join-ledger.js";
import { treeParent } from "../model/tree.js";
import { documentView } from "./read.js";
import {
  captureRange,
  validateDestination,
  ReviewRequired,
} from "../selection/range.js";
export function planLogicalReplacement(
  state,
  range,
  fragment,
  op,
  { strict = false, inheritedMarks } = {},
) {
  if (range.epoch !== state.epoch)
    throw new ReviewRequired("Document epoch changed");
  if (strict) validateDestination(state, range);
  const slice = range.slices[0],
    view = documentView(state),
    parent = view.parent(slice.block);
  if (!["doc", "cell"].includes(parent?.type))
    throw new ReviewRequired("Conversion container is not qualified");
  if (range.slices.length > 1) {
    const index = parent.children.indexOf(slice.block);
    if (
      range.slices.some(
        (s, i) =>
          s.type !== "paragraph" ||
          s.parent !== parent.id ||
          parent.children[index + i] !== s.block,
      )
    )
      throw new ReviewRequired(
        "Select adjacent Body paragraphs within one container",
      );
  }
  const rawBlocks = range.slices.flatMap((s) => view.group(s.block).blocks),
    conversions = [];
  for (const id of rawBlocks)
    if (treeParent(state, id)?.id !== parent.id) {
      const record = bodyConversionFor(state, id);
      // A native code block preserved between converted sections has no
      // conversion owner. Its current visible parent is already captured here;
      // admission verifies that same projected membership.
      if (record && !conversions.includes(record.id))
        conversions.push(record.id);
    }
  const capturedJoin = (left, right) =>
    needsDisplayBoundary(state, left, right)
      ? captureDisplayJoin(state, parent.id, left, right)
      : joinTarget(state, right);
  const joins = range.slices.flatMap((s) =>
    s.atoms
      .filter((a) => a.boundary)
      .map((a) => {
        const blocks = view.group(s.block).blocks;
        return capturedJoin(blocks[blocks.indexOf(a.right) - 1], a.right);
      }),
  );
  for (let i = 1; i < range.slices.length; i++)
    joins.push(
      capturedJoin(
        view.group(range.slices[i - 1].block).blocks.at(-1),
        view.group(range.slices[i].block).blocks[0],
      ),
    );
  const content = [];
  for (const [i, block] of fragment.blocks.entries()) {
    if (!["paragraph", "code"].includes(block.type))
      throw new ReviewRequired("Choose a text-only edit");
    if (i) content.push({ text: "\n", marks: [] });
    for (const run of block.content)
      content.push({
        text: run.text,
        marks:
          slice.type === "code"
            ? []
            : structuredClone(inheritedMarks ?? run.marks),
      });
  }
  const intent = {
    kind: "proseReplace",
    ...(conversions.length ? { conversions } : {}),
    parent: parent.id,
    at: range.start,
    end: range.end,
    ids: range.slices.flatMap((s) =>
      s.atoms.filter((a) => !a.boundary).map((a) => a.id),
    ),
    joins,
    fragment: { version: 1, blocks: [{ type: "paragraph", content }] },
  };
  if (
    !intent.ids.length &&
    !intent.joins.length &&
    !content.some((r) => r.text.length)
  )
    return { intent: null, state, after: range.start };
  if (!intent.ids.length && !intent.joins.length) {
    const insert = { kind: "insert", at: range.start, runs: content },
      next = apply(state, { ...op, intent: insert }),
      size = content.reduce((n, r) => n + [...r.text].length, 0),
      lastInserted = `${op.id}:char:${size - 1}`,
      found = findCharacter(next, lastInserted);
    return {
      intent: insert,
      state: next,
      lastInserted,
      after: gapAt(next, found.block, found.offset + 1),
    };
  }
  const next = apply(state, { ...op, intent }),
    size = content.reduce((n, r) => n + [...r.text].length, 0),
    lastInserted = size ? `${op.id}:insert:0:char:${size - 1}` : null,
    found = lastInserted && findCharacter(next, lastInserted),
    at = found
      ? { block: found.block, offset: found.offset + 1 }
      : resolveGap(next, range.start);
  return {
    intent,
    state: next,
    after: gapAt(next, at.block, at.offset),
    lastInserted,
  };
}
export function logicalCaretRange(state, range, from, to = from) {
  const view = documentView(state),
    point = view.resolveGap(range.start);
  return captureRange(
    state,
    { block: point.block, offset: from },
    { block: point.block, offset: to },
  );
}
