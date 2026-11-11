// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { text, gapAt, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planListIndent,
  planReplace,
  previewCut,
  planCut,
  planEnter,
} from "@cwhy/jade-core/commands";
import {
  fixture,
  paste,
  op,
  point,
  run,
  visible,
  para,
  attachment,
} from "./placement-chain-fixture.mjs";
const tail = "E:s:1:paragraph",
  chars = (s, id) =>
    text(s, id)
      .map((a) => a.char)
      .join("");
const fragment = {
  version: 1,
  blocks: [
    {
      type: "paragraph",
      content: [{ text: "XY", marks: [{ type: "underline" }] }],
    },
    {
      type: "paragraph",
      content: [
        { text: "蓝", marks: [{ type: "color", attrs: { color: "blue" } }] },
      ],
    },
  ],
};
for (const type of ["image", "code"])
  for (const offset of [0, 2, 4])
    for (const kind of ["replace", "cut"])
      for (const peerFirst of [false, true])
        for (const releaseFirst of [false, true])
          test(`Prose ${kind} through retained placement: ${type}, offset=${offset}, peerFirst=${peerFirst}, releaseFirst=${releaseFirst}`, () => {
            const initial = fixture(),
              a = paste(initial, type, offset);
            let s = run(initial, a);
            const b = op("B", 1);
            b.intent = planListIndent(s, point(s, para, 0), b, {
              outdent: true,
            }).intent;
            s = run(s, b);
            const e = op("E", 1);
            e.intent = planEnter(s, point(s, para, 3), e).intent;
            s = run(s, e);
            const basis = s;
            const range = captureRange(
                s,
                { block: para, offset: 1 },
                { block: tail, offset: 2 },
              ),
              c = op("C", 1);
            c.intent = (
              kind === "cut"
                ? planCut(s, previewCut(s, range), c)
                : planReplace(s, range, fragment, c, { strict: true })
            ).intent;
            const d = op("D", 1, {
                kind: "insert",
                at: gapAt(s, tail, 1),
                text: "中",
                marks: ["strong"],
              }),
              expectedPeer = run(basis, d);
            for (const o of peerFirst ? [d, c] : [c, d]) s = run(s, o);
            const peerAtoms = () =>
              Object.values(s.nodes)
                .filter((n) => n.live && n.text)
                .flatMap((n) => text(s, n.id))
                .filter((x) => x.id.startsWith("D:"));
            assert.equal(peerAtoms().length, 1);
            const edited = visible(s);
            s = run(s, op("A", 2, { kind: "undo", target: a.id }));
            assert.equal(peerAtoms().length, 1);
            assert.equal(chars(s, "p"), "ABCD");
            assert.equal(s.nodes[attachment].live, true);
            if (releaseFirst)
              s = run(s, op("B", 2, { kind: "undo", target: b.id }));
            s = run(s, op("C", 2, { kind: "undo", target: c.id }));
            if (!releaseFirst) {
              assert.deepEqual(text(s, para), text(expectedPeer, para));
              assert.deepEqual(text(s, tail), text(expectedPeer, tail));
              s = run(s, op("C", 3, { kind: "undo", target: "C:s:2" }));
              assert.equal(peerAtoms().length, 1);
              s = run(s, op("C", 4, { kind: "undo", target: "C:s:3" }));
              s = run(s, op("B", 2, { kind: "undo", target: b.id }));
            }
            assert.equal(peerAtoms().length, 1);
            assert.equal(chars(s, para), "");
            assert.equal(chars(s, tail), "中");
            assert.equal(s.nodes[attachment].live, false);
            s = run(s, op("D", 2, { kind: "undo", target: d.id }));
            s = run(s, op("E", 2, { kind: "undo", target: e.id }));
            assert.deepEqual(visible(s), visible(initial));
          });
