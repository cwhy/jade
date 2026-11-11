// SPDX-License-Identifier: MPL-2.0
import { apply, gapAt, resolveGap, text } from "../model/engine.js";
import {
  captureRange,
  insertionMarks,
  planReplace,
  ReviewRequired,
  validateDestination,
} from "../selection/range.js";
import { plainFragment } from "../fragment.js";
import { selectionStructure } from "../selection/structure.js";

// Pure contextual commands emit the same identity-based intents as typing.
// No DOM offsets or grapheme indexes enter persistent storage. Segmentation is
// local command intent; peers replay the exact captured character identities.
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
const literal = (value) => ({
  version: 1,
  blocks: [{ type: "paragraph", content: [{ text: value, marks: [] }] }],
});
const noop = (state, range) => ({ intent: null, state, after: range.start });
const length = (state, block) => state.replicas[state.nodes[block].text].length;

export function planDelete(state, range, direction, op) {
  if (!["backward", "forward"].includes(direction))
    throw new ReviewRequired("Unknown deletion direction");
  validateDestination(state, range);
  if (!range.collapsed) return planReplace(state, range, plainFragment(""), op);
  const at = resolveGap(state, range.start),
    node = state.nodes[at.block],
    size = length(state, at.block);
  if (
    (direction === "backward" && at.offset > 0) ||
    (direction === "forward" && at.offset < size)
  ) {
    let from = 0;
    for (const { segment } of segmenter.segment(
      text(state, at.block)
        .map((a) => a.char)
        .join(""),
    )) {
      const to = from + [...segment].length;
      if (
        direction === "backward"
          ? from < at.offset && at.offset <= to
          : from <= at.offset && at.offset < to
      ) {
        return planReplace(
          state,
          captureRange(
            state,
            { block: at.block, offset: from },
            { block: at.block, offset: to },
          ),
          plainFragment(""),
          op,
        );
      }
      from = to;
    }
    throw new ReviewRequired("No grapheme at deletion target");
  }
  if (node.type !== "paragraph") return noop(state, range);
  const owner = selectionStructure(state).parent(node.id),
    index = owner.children.indexOf(node.id);
  if (
    owner.type === "list_item" &&
    (direction === "backward"
      ? index === 0
      : index === owner.children.length - 1)
  ) {
    throw new ReviewRequired(
      "List boundary restructuring is not qualified yet",
    );
  }
  const adjacent =
    state.nodes[owner.children[index + (direction === "backward" ? -1 : 1)]];
  if (adjacent?.type !== "paragraph") return noop(state, range);
  const left = direction === "backward" ? adjacent : node,
    right = direction === "backward" ? node : adjacent;
  return planReplace(
    state,
    captureRange(
      state,
      { block: left.id, offset: length(state, left.id) },
      { block: right.id, offset: 0 },
    ),
    plainFragment(""),
    op,
  );
}

export function planEnter(
  state,
  range,
  op,
  { soft = false, inheritedMarks } = {},
) {
  validateDestination(state, range);
  const at = resolveGap(state, range.start),
    node = state.nodes[at.block];
  if (soft || node.type === "code")
    return planReplace(state, range, literal("\n"), op, {
      inheritedMarks: inheritedMarks ?? insertionMarks(state, range),
    });
  const owner = selectionStructure(state).parent(node.id);
  if (owner.type === "list_item") {
    const children = state.nodes[owner.children[1]];
    if (
      range.collapsed &&
      at.offset > 0 &&
      owner.children[0] === node.id &&
      ["bullet_list", "ordered_list"].includes(children?.type)
    ) {
      const tail = `${op.id}:enter-tail`,
        intent = {
          kind: "listSplit",
          at: range.start,
          tail,
          item: `${op.id}:enter-item`,
          children: children.id,
        };
      const next = apply(state, { ...op, intent });
      return { intent, state: next, after: gapAt(next, tail, 0) };
    }
    throw new ReviewRequired(
      "List Enter requires an unqualified structural command",
    );
  }
  // A range ending inside a list must not accidentally split its text as prose.
  if (
    range.slices.some(
      (s) => selectionStructure(state).parent(s.block)?.type === "list_item",
    )
  )
    throw new ReviewRequired(
      "List Enter requires an unqualified structural command",
    );
  return planReplace(state, range, plainFragment("\n"), op, {
    inheritedMarks: inheritedMarks ?? insertionMarks(state, range),
  });
}

export function planCodeIndent(state, range, op, { outdent = false } = {}) {
  validateDestination(state, range);
  if (range.slices.length !== 1 || range.slices[0].type !== "code")
    throw new ReviewRequired("Indent requires a single code block");
  if (range.collapsed && !outdent)
    return planReplace(state, range, literal("  "), op);
  const slice = range.slices[0],
    atoms = text(state, slice.block),
    starts = [0];
  for (let i = 0; i < atoms.length; i++)
    if (atoms[i].char === "\n") starts.push(i + 1);
  const first = starts.findLastIndex((p) => p <= slice.from),
    end = range.collapsed ? slice.to : Math.max(slice.from, slice.to - 1),
    last = starts.findLastIndex((p) => p <= end),
    intents = [];
  for (const offset of starts.slice(first, last + 1)) {
    if (outdent) {
      const ids = [];
      for (let i = offset; i < offset + 2 && atoms[i]?.char === " "; i++)
        ids.push(atoms[i].id);
      if (ids.length) intents.push({ kind: "delete", ids });
    } else
      intents.push({
        kind: "insert",
        at: gapAt(state, slice.block, offset),
        text: "  ",
        marks: [],
      });
  }
  if (!intents.length) return noop(state, range);
  const intent = { kind: "batch", intents },
    next = apply(state, { ...op, intent });
  // Preserve selected identities and direction, not stale offsets. Inserted
  // indentation at a selection endpoint lies before the original first atom.
  return {
    intent,
    state: next,
    selection: { epoch: range.epoch, anchor: range.anchor, focus: range.focus },
    after: range.start,
  };
}
