// SPDX-License-Identifier: MPL-2.0
import { apply, gapAt } from "../model/engine.js";
import { captureRange } from "../selection/range.js";
import { adjacentParagraphTarget } from "../model/adjacent-paragraph.js";
export function planAdjacentParagraph(
  state,
  block,
  op,
  { side = "after", reuse = false } = {},
) {
  const { parent } = adjacentParagraphTarget(state, block, side),
    index = parent.children.indexOf(block),
    next = state.nodes[parent.children[index + (side === "after" ? 1 : -1)]];
  if (reuse && next?.live && next.type === "paragraph") {
    const range = captureRange(
      state,
      { block: next.id, offset: 0 },
      { block: next.id, offset: 0 },
    );
    return {
      state,
      selection: {
        epoch: range.epoch,
        anchor: range.anchor,
        focus: range.focus,
      },
    };
  }
  const intent = { kind: "insertAdjacentParagraph", block, side },
    nextState = apply(state, { ...op, intent });
  return {
    intent,
    state: nextState,
    after: gapAt(nextState, op.id + ":paragraph", 0),
  };
}
