// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { immutable } from "@cwhy/jade-core/immutability";
import { apply, validate } from "@cwhy/jade-core/admission";
import { text, gapAt, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
import { planListIndent, planEnter } from "@cwhy/jade-core/commands";
import {
  fixture,
  paste,
  op,
  point,
  visible,
  para,
  attachment,
  parent,
} from "./placement-chain-fixture.mjs";
const run = (s, o) => {
  const before = JSON.stringify(s);
  try {
    const next = immutable(apply(s, o));
    validate(next);
    return next;
  } finally {
    assert.equal(JSON.stringify(s), before);
  }
};
const chars = (s, id) =>
  text(s, id)
    .map((x) => x.char)
    .join("");
const tail = "D:s:1:paragraph";
function setup(type, offset) {
  const initial = immutable(fixture()),
    a = paste(initial, type, offset);
  let s = run(initial, a);
  const b = op("B", 1);
  b.intent = planListIndent(s, point(s, para, 0), b, { outdent: true }).intent;
  s = run(s, b);
  const d = op("D", 1);
  d.intent = planEnter(s, point(s, para, 3), d).intent;
  return { initial, a, b, d, s };
}

for (const type of ["image", "code"])
  for (const offset of [0, 2, 4])
    for (const cutFirst of [false, true])
      test(`Evolving extent Undo/Redo ${type} offset=${offset} cutFirst=${cutFirst}`, () => {
        const { initial, a, b, d, s: start } = setup(type, offset);
        let s = run(start, d),
          typed = op("D", 2, {
            kind: "insert",
            at: gapAt(s, tail, 0),
            text: "peer",
            marks: ["strong"],
          });
        s = run(s, typed);
        const anchor = anchorAt(s, tail, 0, 4),
          expected = visible(s);
        if (cutFirst) {
          s = run(s, op("D", 3, { kind: "undo", target: d.id }));
          assert.equal(chars(s, para), "Coppeeried");
          s = run(s, op("D", 4, { kind: "undo", target: "D:s:3" }));
          assert.deepEqual(visible(s), expected);
        }
        s = run(s, op("A", 2, { kind: "undo", target: a.id }));
        assert.equal(chars(s, "p"), "ABCD");
        assert.equal(chars(s, tail), "peeried");
        s = run(s, op("B", 2, { kind: "undo", target: b.id }));
        assert.equal(chars(s, para), "");
        assert.equal(chars(s, tail), "peer");
        assert.equal(parent(s, tail).id, a.id + ":attached:item");
        assert.equal(s.nodes[attachment].live, false);
        assert.equal(resolveAnchor(s, anchor).status, "exact");
        s = run(s, op("B", 3, { kind: "undo", target: "B:s:2" }));
        assert.equal(chars(s, tail), "peeried");
        assert.equal(parent(s, tail).type, "cell");
        s = run(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
        assert.deepEqual(visible(s), expected);
        s = run(s, op("A", 4, { kind: "undo", target: "A:s:3" }));
        s = run(s, op("B", 4, { kind: "undo", target: "B:s:3" }));
        s = run(
          s,
          op("D", cutFirst ? 5 : 3, { kind: "undo", target: typed.id }),
        );
        s = run(
          s,
          op("D", cutFirst ? 6 : 4, {
            kind: "undo",
            target: cutFirst ? "D:s:4" : d.id,
          }),
        );
        assert.deepEqual(visible(s), visible(initial));
      });
for (const type of ["image", "code"])
  for (const offset of [0, 2, 4])
    for (const birthUndone of [false, true])
      for (const offlineTyping of [false, true])
        test(`Offline prose Enter after move Undo ${type} offset=${offset} birth=${birthUndone} offlineTyping=${offlineTyping}`, () => {
          const { initial, a, b, d, s: start } = setup(type, offset),
            authored = run(start, d);
          let s = start;
          if (birthUndone)
            s = run(s, op("A", 2, { kind: "undo", target: a.id }));
          s = run(s, op("B", 2, { kind: "undo", target: b.id }));
          s = run(s, d);
          const typed = op("D", 2, {
            kind: "insert",
            at: gapAt(offlineTyping ? authored : s, tail, 0),
            text: "peer",
            marks: ["strong"],
          });
          s = run(s, typed);
          assert.equal(chars(s, tail), birthUndone ? "peer" : "peeried");
          assert.equal(parent(s, tail).id, a.id + ":attached:item");
          if (birthUndone) {
            s = run(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
            assert.equal(chars(s, para), "Cop");
            assert.equal(chars(s, tail), offlineTyping ? "peeried" : "iedpeer");
          }
          s = run(s, op("D", 3, { kind: "undo", target: typed.id }));
          s = run(s, op("D", 4, { kind: "undo", target: d.id }));
          s = run(
            s,
            op("A", birthUndone ? 4 : 2, {
              kind: "undo",
              target: birthUndone ? "A:s:3" : a.id,
            }),
          );
          assert.deepEqual(visible(s), visible(initial));
        });
