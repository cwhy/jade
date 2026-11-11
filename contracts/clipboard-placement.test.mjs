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
const chars = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const range = (s) =>
  captureRange(s, { block: para, offset: 1 }, { block: para, offset: 5 });
const fragment = {
  version: 1,
  blocks: [
    {
      type: "paragraph",
      content: [{ text: "XY", marks: [{ type: "underline" }] }],
    },
  ],
};
for (const type of ["image", "code"])
  for (const offset of [0, 2, 4])
    for (const outdent of [false, true])
      for (const kind of ["replace", "cut"])
        for (const peerFirst of [false, true]) {
          if (!outdent && offset === 0) continue;
          test(`Retained ${kind}: ${type}, paste=${offset}, outdent=${outdent}, peerFirst=${peerFirst}`, () => {
            const initial = fixture(),
              a = paste(initial, type, offset);
            let s = run(initial, a);
            const b = op("B", 1);
            b.intent = planListIndent(s, point(s, para, 0), b, {
              outdent,
            }).intent;
            s = run(s, b);
            const moved = s;
            const c = op("C", 1);
            c.intent = (
              kind === "cut"
                ? planCut(s, previewCut(s, range(s)), c)
                : planReplace(s, range(s), fragment, c, { strict: true })
            ).intent;
            const d = op("D", 1, {
              kind: "insert",
              at: gapAt(s, para, 3),
              text: "中",
              marks: ["strong"],
            });
            const expectedPeer = run(moved, d);
            for (const o of peerFirst ? [d, c] : [c, d]) s = run(s, o);
            const edited = text(s, para);
            assert.equal(edited.filter((x) => x.id.startsWith("D:")).length, 1);
            assert.equal(s.nodes[attachment].live, true);
            const anchor = anchorAt(
              s,
              para,
              edited.findIndex((x) => x.id.startsWith("D:")),
              1,
            );
            s = run(s, op("A", 2, { kind: "undo", target: a.id }));
            assert.deepEqual(
              text(s, para),
              edited,
              "birth Undo preserves held edits",
            );
            assert.equal(chars(s, "p"), "ABCD");
            assert.equal(s.nodes[attachment].live, true);
            s = run(s, op("C", 2, { kind: "undo", target: c.id }));
            assert.deepEqual(
              text(s, para),
              text(expectedPeer, para),
              "Cut/replacement Undo restores exact source identities and keeps peer typing",
            );
            s = run(s, op("C", 3, { kind: "undo", target: "C:s:2" }));
            assert.deepEqual(
              text(s, para),
              edited,
              "Redo restores deletion and replacement without hiding peer",
            );
            s = run(s, op("C", 4, { kind: "undo", target: "C:s:3" }));
            s = run(s, op("B", 2, { kind: "undo", target: b.id }));
            assert.equal(chars(s, para), "中");
            assert.equal(s.nodes[attachment].live, false);
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            s = run(s, op("D", 2, { kind: "undo", target: d.id }));
            assert.deepEqual(visible(s), visible(initial));
          });
        }
for (const type of ["image", "code"])
  for (const outdent of [false, true])
    for (const kind of ["replace", "cut"])
      test(`Cut lease and strict replacement guard ${type} outdent=${outdent} ${kind}`, () => {
        let s = run(fixture(), paste(fixture(), type, 4));
        const b = op("B", 1);
        b.intent = planListIndent(s, point(s, para, 0), b, { outdent }).intent;
        s = run(s, b);
        const captured = kind === "cut" ? previewCut(s, range(s)) : range(s),
          before = JSON.stringify(s);
        const peer = run(
            s,
            op("D", 1, { kind: "insert", at: gapAt(s, para, 3), text: "中" }),
          ),
          peerBytes = JSON.stringify(peer);
        assert.throws(
          () =>
            kind === "cut"
              ? planCut(peer, captured, op("C", 1))
              : planReplace(peer, captured, fragment, op("C", 1), {
                  strict: true,
                }),
          /changed/i,
        );
        assert.equal(JSON.stringify(s), before);
        assert.equal(JSON.stringify(peer), peerBytes);
      });
