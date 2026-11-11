// SPDX-License-Identifier: MPL-2.0
import { selectionStructure } from "./structure.js";
import { visible } from "../text/formatting-contributions.js";
// Logical range capture/planning. No DOM, offsets persisted across edits, or new storage commands.
import {
  text,
  gapAt,
  resolveGap,
  apply,
  findCharacter,
} from "../model/engine.js";
export class ReviewRequired extends Error {}
import { validateFragment } from "../fragment.js";
const clone = (x) => structuredClone(x);
export function textOrder(state) {
  return [...selectionStructure(state).order];
}
function owner(state, id) {
  return selectionStructure(state).parent(id);
}
function point(state, p) {
  const n = state.nodes[p.block],
    replica = n?.live && n.text && state.replicas[n.text];
  if (
    !replica ||
    !Number.isInteger(p.offset) ||
    p.offset < 0 ||
    p.offset > replica.length
  )
    throw new ReviewRequired("Invalid selection endpoint");
  return {
    gap: gapAt(state, p.block, p.offset),
    block: p.block,
    offset: p.offset,
  };
}
export function captureRange(state, anchor, focus) {
  const structure = selectionStructure(state),
    order = structure.order,
    a = point(state, anchor),
    f = point(state, focus),
    ai = structure.position(a.block),
    fi = structure.position(f.block);
  if (ai === undefined || fi === undefined)
    throw new ReviewRequired("Selection target is not reachable");
  const backwards = ai > fi || (ai === fi && a.offset > f.offset),
    start = backwards ? f : a,
    end = backwards ? a : f;
  const blocks = order.slice(
    structure.position(start.block),
    structure.position(end.block) + 1,
  );
  const slices = blocks.map((block, i) => {
    const n = state.nodes[block],
      from = i === 0 ? start.offset : 0,
      to = i === blocks.length - 1 ? end.offset : state.replicas[n.text].length;
    return {
      block,
      type: n.type,
      parent: structure.parent(block)?.id,
      from,
      to,
      atoms: from === to ? [] : clone(text(state, block).slice(from, to)),
    };
  });
  // Object/container boundaries are explicit. Text deletion never removes grid/list/image objects.
  return {
    version: 1,
    epoch: state.epoch,
    anchor: a.gap,
    focus: f.gap,
    backwards,
    start: start.gap,
    end: end.gap,
    slices,
    collapsed: a.block === f.block && a.offset === f.offset,
  };
}
export function resolveRange(state, range) {
  if (range.epoch !== state.epoch)
    throw new ReviewRequired("Document changed; select a new destination");
  return {
    anchor: resolveGap(state, range.anchor),
    focus: resolveGap(state, range.focus),
  };
}
export function validateDestination(state, range) {
  const p = resolveRange(state, range),
    now = captureRange(state, p.anchor, p.focus);
  const signature = (r) =>
    r.slices.map((s) => [
      s.block,
      s.parent,
      s.type,
      s.atoms.map((a) => [a.id, a.char, a.marks]),
    ]);
  if (JSON.stringify(signature(now)) !== JSON.stringify(signature(range)))
    throw new ReviewRequired("Destination changed; review the paste again");
  return now;
}
export function fragmentOf(range) {
  return {
    version: 1,
    blocks: range.slices.map((s) => ({
      type: s.type,
      content: s.atoms.map((a) => ({ text: a.char, marks: clone(a.marks) })),
    })),
  };
}
// Native typing inherits the selected text's style, or the preceding character
// at a caret (the following character at block start). Preserve internal mark
// representations; clipboard normalization is a separate, external boundary.
export function insertionMarks(state, range) {
  const selected = range.slices[0]?.atoms[0];
  if (selected) return clone(selected.marks);
  const p = resolveGap(state, range.start),
    gap = gapAt(state, p.block, p.offset),
    atom = findCharacter(state, gap.left || gap.right)?.atom;
  return clone(
    atom
      ? state.formats?.[atom.id]
        ? visible(state.formats[atom.id])
        : atom.marks
      : [],
  );
}
export function planReplace(
  state,
  range,
  fragment,
  op,
  { strict = false, inheritedMarks } = {},
) {
  fragment = validateFragment(fragment);
  if (strict) validateDestination(state, range);
  if (range.epoch !== state.epoch)
    throw new ReviewRequired("Document epoch changed");
  const intents = [];
  let staged = state;
  const push = (i) => {
    intents.push(i);
    staged = apply(state, { ...op, intent: { kind: "batch", intents } });
  };
  const first = range.slices[0];
  // Join before deleting: Undo restores selected identities before splitting at
  // the original owned boundaries. Deleting first loses the old cut affiliation.
  const parent = owner(state, first.block),
    selected = range.slices.map((s) => s.block);
  const adjacent =
    range.slices.every(
      (s) => s.type === "paragraph" && s.parent === parent?.id,
    ) &&
    selected.every(
      (id, i) =>
        parent.children[parent.children.indexOf(first.block) + i] === id,
    );
  if (adjacent)
    for (const s of range.slices.slice(1))
      push({ kind: "join", left: first.block, right: s.block });
  const before = resolveGap(staged, range.start),
    destination = gapAt(staged, before.block, before.offset);
  const ids = range.slices.flatMap((s) => s.atoms.map((a) => a.id));
  if (ids.length) push({ kind: "delete", ids });
  const after = resolveGap(staged, destination),
    insertion = gapAt(staged, after.block, after.offset);
  let at = resolveGap(staged, insertion),
    lastInserted = null;
  const code = staged.nodes[at.block].type === "code";
  const blocks = code
    ? [
        {
          type: "code",
          content: [
            {
              text: fragment.blocks
                .map((b) => b.content.map((c) => c.text).join(""))
                .join("\n"),
              marks: [],
            },
          ],
        },
      ]
    : fragment.blocks;
  if (
    blocks.some((b) => b.type !== "paragraph" && !(code && b.type === "code"))
  )
    throw new ReviewRequired(
      "This block type needs a structural paste command",
    );
  for (const [i, b] of blocks.entries()) {
    if (i) {
      const tail = `${op.id}:paste-block:${i}`;
      push({ kind: "split", at: gapAt(staged, at.block, at.offset), tail });
      at = { block: tail, offset: 0 };
    }
    const part = intents.length,
      atoms = [];
    for (const run of b.content)
      for (const char of run.text)
        atoms.push({
          id: `${op.id}:part:${part}:char:${atoms.length}`,
          char,
          marks: code
            ? clone(
                (inheritedMarks || []).filter((m) =>
                  [
                    "strong",
                    "em",
                    "underline",
                    "strike",
                    "highlight",
                    "color",
                  ].includes(typeof m === "string" ? m : m.type),
                ),
              )
            : clone(inheritedMarks ?? run.marks),
        });
    if (atoms.length) {
      const gap = gapAt(staged, at.block, at.offset);
      // A complete replacement can create an empty-text marker while staging its
      // deletion. The public batch must still refer to a gap present at admission;
      // the captured pre-deletion gap resolves through the retained erasure.
      const insertion =
        i === 0 && gap.codec === 3 && !state.boundaries[gap.boundary]
          ? destination
          : gap;
      push({ kind: "insert", at: insertion, atoms });
      lastInserted = atoms.at(-1).id;
      const found = findCharacter(staged, lastInserted);
      at = { block: found.block, offset: found.offset + 1 };
    }
  }
  return {
    intent: intents.length ? { kind: "batch", intents } : null,
    after: gapAt(staged, at.block, at.offset),
    state: staged,
    lastInserted,
  };
}
