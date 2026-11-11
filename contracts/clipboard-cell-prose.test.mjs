// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
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
  planEnter,
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
import {
  fixture,
  run,
  cell,
  copied,
  words,
} from "./clipboard-cell-fixture.mjs";
const tail = "E:s:1:paragraph";
function setup(type, kind, peerFirst) {
  const initial = fixture(),
    a = paste(initial, type, 4);
  let s = run(initial, a);
  const b = op("B", 1);
  b.intent = planListIndent(s, point(s, para, 0), b, { outdent: true }).intent;
  s = run(s, b);
  const enter = op("E", 1);
  enter.intent = planEnter(s, point(s, para, 3), enter).intent;
  s = run(s, enter);
  const moved = s,
    r = captureRange(s, { block: para, offset: 1 }, { block: tail, offset: 2 }),
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
              { type: "paragraph", content: [{ text: "Tail", marks: [] }] },
            ],
          },
          c,
          { strict: true },
        )
  ).intent;
  const d = op("D", 1, {
    kind: "insert",
    at: gapAt(s, tail, 1),
    text: "中",
    marks: ["strong"],
  });
  for (const o of peerFirst ? [d, c] : [c, d]) s = run(s, o);
  return { initial, a, b, c, d, moved, s, enter };
}
for (const type of ["image", "code"])
  for (const kind of ["cut", "replace"])
    for (const peerFirst of [false, true])
      for (const destructive of ["clear", "paste"])
        for (const birthUndoFirst of [false, true])
          test(`Multi-paragraph rich-cell lifecycle ${type} ${kind} peerFirst=${peerFirst} ${destructive} birthUndoFirst=${birthUndoFirst}`, () => {
            const f = setup(type, kind, peerFirst);
            let { s } = f;
            if (birthUndoFirst)
              s = run(s, op("A", 2, { kind: "undo", target: f.a.id }));
            const prior = s,
              expected = visible(s, "cell"),
              peerBlock = Object.values(s.nodes).find(
                (n) =>
                  n.live &&
                  n.text &&
                  text(s, n.id).some((x) => x.id.startsWith("D:")),
              ).id,
              peer = text(s, peerBlock).findIndex((x) => x.id.startsWith("D:")),
              anchor = anchorAt(s, peerBlock, peer, 1),
              e = op("E", 2);
            e.intent =
              destructive === "clear"
                ? planClearCells(s, cell(s, "cell"), e).intent
                : planPasteCells(s, cell(s, "cell"), e, {
                    preview: previewCellPaste(
                      s,
                      cell(s, "cell"),
                      copied(s, "other-cell"),
                    ),
                  }).intent;
            s = run(s, e);
            assert.equal(s.nodes[attachment].live, false);
            for (const o of [
              op("B", 2, { kind: "undo", target: f.b.id }),
              op("A", birthUndoFirst ? 3 : 2, {
                kind: "undo",
                target: birthUndoFirst ? "A:s:2" : f.a.id,
              }),
            ]) {
              const before = JSON.stringify(s);
              assert.throws(() => apply(s, o));
              assert.equal(JSON.stringify(s), before);
            }
            s = run(s, op("E", 3, { kind: "undo", target: e.id }));
            assert.deepEqual(
              visible(s, "cell"),
              expected,
              "restoring the cell preserves all text identities, marks, descendants and media",
            );
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            assert.deepEqual(
              copied(s, "other-cell"),
              copied(prior, "other-cell"),
            );
            if (!birthUndoFirst)
              s = run(s, op("A", 2, { kind: "undo", target: f.a.id }));
            s = run(s, op("C", 2, { kind: "undo", target: f.c.id }));
            assert.deepEqual(text(s, para), text(run(f.moved, f.d), para));
            assert.deepEqual(text(s, tail), text(run(f.moved, f.d), tail));
            s = run(s, op("B", 2, { kind: "undo", target: f.b.id }));
            assert.equal(words(s, para), "");
            assert.equal(words(s, tail), "中");
            assert.equal(s.nodes[attachment].live, false);
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            s = run(s, op("D", 2, { kind: "undo", target: f.d.id }));
            s = run(s, op("E", 4, { kind: "undo", target: f.enter.id }));
            assert.deepEqual(visible(s), visible(f.initial));
          });
