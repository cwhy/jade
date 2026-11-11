// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { immutable } from "@cwhy/jade-core/immutability";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planListIndent,
  planReplace,
  previewCut,
  planCut,
  planClearCells,
  copyCells,
  previewCellPaste,
  planPasteCells,
} from "@cwhy/jade-core/commands";
import {
  fixture as baseFixture,
  paste,
  op,
  point,
  visible,
  para,
  attachment,
} from "./placement-chain-fixture.mjs";
function fixture() {
  const old = baseFixture(),
    nodes = structuredClone(old.nodes),
    contents = {};
  for (const n of Object.values(nodes))
    if (n.text) {
      contents[n.id] = text(old, n.id).map((a) => ({
        text: a.char,
        marks: a.marks,
      }));
      delete n.text;
    }
  nodes.row.children.push("other-cell");
  nodes["other-cell"] = {
    id: "other-cell",
    type: "cell",
    live: true,
    children: ["other-p", "other-code"],
  };
  nodes["other-p"] = { id: "other-p", type: "paragraph", live: true };
  nodes["other-code"] = {
    id: "other-code",
    type: "code",
    live: true,
    language: "javascript",
  };
  contents["other-p"] = [{ text: "Other 中文🙂", marks: ["strong"] }];
  contents["other-code"] = [{ text: "const other = 1;\n", marks: [] }];
  return immutable(seed(nodes, contents));
}
// Every accepted step crosses a serialized checkpoint, and must leave its input unchanged.
function run(s, o) {
  const before = JSON.stringify(s),
    next = immutable(apply(s, o));
  assert.equal(JSON.stringify(s), before);
  validate(next);
  return immutable(JSON.parse(JSON.stringify(next)));
}
const cell = (s, id) => captureCellRange(s, "table", id, id),
  copied = (s, id) => copyCells(s, cell(s, id)),
  words = (s, id) =>
    text(s, id)
      .map((a) => a.char)
      .join("");
function setup(type, kind, peerFirst) {
  const initial = fixture(),
    a = paste(initial, type, 4);
  let s = run(initial, a);
  const b = op("B", 1);
  b.intent = planListIndent(s, point(s, para, 0), b).intent;
  s = run(s, b);
  const moved = s,
    r = captureRange(s, { block: para, offset: 1 }, { block: para, offset: 5 }),
    c = op("C", 1);
  c.intent = (
    kind === "cut"
      ? planCut(s, previewCut(s, r), c)
      : planReplace(
          s,
          r,
          {
            version: 1,
            blocks: [
              {
                type: "paragraph",
                content: [{ text: "新🙂", marks: [{ type: "underline" }] }],
              },
            ],
          },
          c,
          { strict: true },
        )
  ).intent;
  const d = op("D", 1, {
    kind: "insert",
    at: gapAt(s, para, 3),
    text: "中",
    marks: ["strong"],
  });
  for (const o of peerFirst ? [d, c] : [c, d]) s = run(s, o);
  return { initial, a, b, c, d, moved, s };
}

export { fixture, run, cell, copied, words, setup };
