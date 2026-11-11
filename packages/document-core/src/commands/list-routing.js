// SPDX-License-Identifier: MPL-2.0
// Isolated list feature routing. Existing prose/code commands remain separate.
import {
  planEnter as proseEnter,
  planDelete as proseDelete,
  planCodeIndent as codeIndent,
} from "./prose.js";
import {
  planListEnter,
  planListIndent,
  planListBackspace,
} from "../model/commands.js";
import { apply, gapAt, resolveGap } from "../model/engine.js";
import { selectionStructure } from "../selection/structure.js";
import { planProseJoin } from "./prose-join.js";
import { publicPlan, planReplace } from "./replace.js";
import { plainFragment } from "../fragment.js";
import { insertionMarks } from "../selection/range.js";
export { planListIndent };
export const planCodeIndent = (...args) => publicPlan(codeIndent(...args));
function context(state, range) {
  const at = resolveGap(state, range.start);
  return {
    at,
    node: state.nodes[at.block],
    parent: selectionStructure(state).parent(at.block),
  };
}
export function planEnter(state, range, op, options = {}) {
  const { node, parent } = context(state, range);
  if (
    !options.soft &&
    node.type === "paragraph" &&
    parent?.type === "list_item"
  )
    return planListEnter(state, range, op);
  if (
    !options.soft &&
    range.collapsed &&
    node.type === "paragraph" &&
    ["doc", "cell"].includes(parent?.type)
  ) {
    const intent = { kind: "proseEnter", at: range.start },
      next = apply(state, { ...op, intent });
    return { intent, state: next, after: gapAt(next, `${op.id}:paragraph`, 0) };
  }
  if (
    !options.soft &&
    node.type === "paragraph" &&
    ["doc", "cell"].includes(parent?.type)
  )
    return planReplace(state, range, plainFragment("\n"), op, {
      strict: true,
      inheritedMarks: options.inheritedMarks ?? insertionMarks(state, range),
    });
  return publicPlan(proseEnter(state, range, op, options));
}
export function planDelete(state, range, direction, op) {
  const { at, node, parent } = context(state, range);
  if (
    direction === "backward" &&
    range.collapsed &&
    at.offset === 0 &&
    node.type === "paragraph" &&
    parent?.type === "list_item"
  )
    return planListBackspace(state, range, op);
  if (
    range.collapsed &&
    node.type === "paragraph" &&
    ["doc", "cell"].includes(parent?.type) &&
    (direction === "backward"
      ? at.offset === 0
      : at.offset === state.replicas[node.text].length)
  )
    return planProseJoin(state, range, direction, op);
  if (
    !range.collapsed &&
    range.slices.length > 1 &&
    range.slices.every((s) => s.type === "paragraph")
  )
    return planReplace(state, range, plainFragment(""), op, { strict: true });
  return publicPlan(proseDelete(state, range, direction, op));
}
