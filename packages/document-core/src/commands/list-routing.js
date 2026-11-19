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
import { creationProseContainer } from "../model/creation-extent.js";
import { orderedCreationPlacements } from "../model/creation-placement-projection.js";
import { paragraphCreation } from "../model/paragraph-exit.js";
import { paragraphForEnter } from "../model/list-boundary.js";
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
  const continuation =
    node.type === "paragraph" &&
    parent?.type === "list_item" &&
    parent.children[0] !== node.id &&
    (creationProseContainer(state, node.id, parent) ||
      paragraphCreation(state, node.id));
  if (
    !options.soft &&
    range.collapsed &&
    continuation &&
    parent.children.at(-1) === node.id &&
    state.replicas[node.text].length === 0
  ) {
    const intent = {
      kind: "creationParagraphExit",
      root: node.id,
      creation: paragraphCreation(state, node.id).id,
      basis:
        orderedCreationPlacements(state)
          .filter(
            (p) =>
              p.active &&
              p.intent.kind === "creationParagraphExit" &&
              p.intent.root === node.id,
          )
          .at(-1)?.id ?? null,
    };
    const next = apply(state, { ...op, intent });
    return { intent, state: next, after: gapAt(next, node.id, 0) };
  }
  if (
    !options.soft &&
    node.type === "paragraph" &&
    parent?.type === "list_item" &&
    !continuation
  )
    return planListEnter(state, range, op);
  if (
    !options.soft &&
    range.collapsed &&
    node.type === "paragraph" &&
    (["doc", "cell"].includes(parent?.type) || continuation)
  ) {
    const intent = { kind: "proseEnter", at: range.start },
      next = apply(state, { ...op, intent });
    const tail = paragraphForEnter(next, op.id);
    return { intent, state: next, after: gapAt(next, tail, 0) };
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
