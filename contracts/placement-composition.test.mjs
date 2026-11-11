// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { immutable } from "@cwhy/jade-core/immutability";
import { apply, validate } from "@cwhy/jade-core/admission";
import { text, gapAt, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
import {
  planListIndent,
  planEnter,
  planDelete,
} from "@cwhy/jade-core/commands";
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
    assert.equal(
      JSON.stringify(s),
      before,
      "success or rejection must preserve input",
    );
  }
};
const chars = (s, id) =>
  text(s, id)
    .map((x) => x.char)
    .join("");
const move = (s, actor, seq, outdent = false) => {
  const o = op(actor, seq);
  o.intent = planListIndent(s, point(s, para, 0), o, { outdent }).intent;
  return o;
};
const enter = (s) =>
  op("D", 1, planEnter(s, point(s, para, 3), op("D", 1)).intent);
const tail = "D:s:1:list-tail";

for (const type of ["image", "code"])
  for (const offset of [2, 4])
    for (const stage of ["before", "between", "after"])
      for (const late of [false, true])
        test(`Enter with placement ${type} offset=${offset} stage=${stage} late=${late}`, () => {
          const initial = immutable(fixture()),
            a = paste(initial, type, offset);
          let s = run(initial, a),
            d;
          if (stage === "before") {
            d = enter(s);
            if (!late) s = run(s, d);
          }
          const b = move(s, "B", 1);
          s = run(s, b);
          if (stage === "between") {
            d = enter(s);
            if (!late) s = run(s, d);
          }
          const c = move(s, "C", 1, true);
          s = run(s, c);
          if (stage === "after") d = enter(s);
          if (late || stage === "after") s = run(s, d);
          const typing = op("D", 2, {
            kind: "insert",
            at: gapAt(s, tail, 0),
            text: "peer",
            marks: ["strong"],
          });
          s = run(s, typing);
          const anchor = anchorAt(s, tail, 0, 4);
          assert.equal(chars(s, para), "Cop");
          assert.equal(chars(s, tail), "peeried");
          s = run(s, op("A", 2, { kind: "undo", target: a.id }));
          assert.equal(chars(s, "p"), "ABCD");
          assert.equal(chars(s, para), "Cop");
          assert.equal(chars(s, tail), "peeried");
          assert.equal(s.nodes[attachment].live, true);
          const before = visible(s);
          s = run(s, op("B", 2, { kind: "undo", target: b.id }));
          assert.deepEqual(visible(s), before);
          assert.equal(resolveAnchor(s, anchor).status, "exact");
          s = run(s, op("C", 2, { kind: "undo", target: c.id }));
          assert.equal(chars(s, tail), "peer");
          assert.equal(s.nodes[attachment].live, false);
          assert.equal(resolveAnchor(s, anchor).status, "exact");
          s = run(s, op("D", 3, { kind: "undo", target: typing.id }));
          s = run(s, op("D", 4, { kind: "undo", target: d.id }));
          assert.deepEqual(visible(s), visible(initial));
        });
for (const type of ["image", "code"])
  for (const offset of [2, 4])
    for (const afterSecond of [false, true])
      test(`Delete join with placement ${type} offset=${offset} afterSecond=${afterSecond}`, () => {
        const initial = immutable(fixture()),
          a = paste(initial, type, offset);
        let s = run(initial, a),
          b = move(s, "B", 1);
        s = run(s, b);
        if (afterSecond) {
          const c = move(s, "C", 1, true);
          s = run(s, c);
        }
        const d = enter(s);
        s = run(s, d);
        const typed = op("D", 2, {
          kind: "insert",
          at: gapAt(s, tail, 0),
          text: "peer",
          marks: ["strong"],
        });
        s = run(s, typed);
        const before = visible(s),
          anchor = anchorAt(s, tail, 0, 4);
        const join = op("E", 1);
        join.intent = planDelete(s, point(s, para, 3), "forward", join).intent;
        assert.ok(join.intent, "Delete at parent boundary has a join action");
        s = run(s, join);
        assert.equal(chars(s, para), "Coppeeried");
        assert.equal(s.nodes[attachment].live, true);
        assert.equal(resolveAnchor(s, anchor).status, "exact");
        s = run(s, op("E", 2, { kind: "undo", target: join.id }));
        assert.deepEqual(visible(s), before);
        assert.equal(resolveAnchor(s, anchor).status, "exact");
      });

for (const type of ["image", "code"])
  for (const offset of [2, 4])
    for (const edge of [0, 6])
      for (const stage of ["before", "between", "after"])
        for (const late of [false, true])
          test(`Endpoint Enter with placement ${type} paste=${offset} enter=${edge} stage=${stage} late=${late}`, () => {
            const initial = immutable(fixture()),
              a = paste(initial, type, offset);
            let s = run(initial, a),
              d;
            const makeEnter = () =>
              op("D", 1, planEnter(s, point(s, para, edge), op("D", 1)).intent);
            const makeMove = (actor, lift = false) => {
              const o = op(actor, 1),
                root = s.creations[a.id].root;
              o.intent = planListIndent(
                s,
                point(s, s.nodes[root].children[0], 0),
                o,
                { outdent: lift },
              ).intent;
              return o;
            };
            if (stage === "before") {
              d = makeEnter();
              if (!late) s = run(s, d);
            }
            const b = makeMove("B");
            s = run(s, b);
            if (stage === "between") {
              d = makeEnter();
              if (!late) s = run(s, d);
            }
            const c = makeMove("C", true);
            s = run(s, c);
            if (stage === "after") d = makeEnter();
            if (late || stage === "after") s = run(s, d);
            const typing = op("D", 2, {
              kind: "insert",
              at: gapAt(s, tail, 0),
              text: "peer",
              marks: ["strong"],
            });
            s = run(s, typing);
            const anchor = anchorAt(s, tail, 0, 4);
            assert.equal(chars(s, para), edge === 0 ? "" : "Copied");
            assert.equal(chars(s, tail), edge === 0 ? "peerCopied" : "peer");
            s = run(s, op("A", 2, { kind: "undo", target: a.id }));
            assert.equal(chars(s, "p"), "ABCD");
            assert.equal(chars(s, tail), edge === 0 ? "peerCopied" : "peer");
            assert.equal(s.nodes[attachment].live, true);
            const before = visible(s);
            s = run(s, op("B", 2, { kind: "undo", target: b.id }));
            assert.deepEqual(visible(s), before);
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            s = run(s, op("C", 2, { kind: "undo", target: c.id }));
            assert.equal(chars(s, tail), "peer");
            assert.equal(s.nodes[attachment].live, false);
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            s = run(s, op("D", 3, { kind: "undo", target: typing.id }));
            s = run(s, op("D", 4, { kind: "undo", target: d.id }));
            assert.deepEqual(visible(s), visible(initial));
          });
for (const type of ["image", "code"])
  for (const offset of [2, 4])
    for (const releaseJoinFirst of [false, true])
      test(`Joined content lifetime ${type} offset=${offset} joinFirst=${releaseJoinFirst}`, () => {
        const initial = immutable(fixture()),
          a = paste(initial, type, offset);
        let s = run(initial, a),
          b = move(s, "B", 1);
        s = run(s, b);
        const d = enter(s);
        s = run(s, d);
        const typing = op("D", 2, {
          kind: "insert",
          at: gapAt(s, tail, 0),
          text: "peer",
          marks: ["strong"],
        });
        s = run(s, typing);
        const anchor = anchorAt(s, tail, 0, 4);
        const c = move(s, "C", 1, true);
        s = run(s, c);
        const e = op("E", 1);
        e.intent = planDelete(s, point(s, para, 3), "forward", e).intent;
        s = run(s, e);
        s = run(s, op("A", 2, { kind: "undo", target: a.id }));
        assert.equal(chars(s, para), "Coppeeried");
        assert.equal(chars(s, "p"), "ABCD");
        assert.equal(s.nodes[attachment].live, true);
        assert.equal(resolveAnchor(s, anchor).status, "exact");
        if (releaseJoinFirst)
          s = run(s, op("E", 2, { kind: "undo", target: e.id }));
        s = run(s, op("B", 2, { kind: "undo", target: b.id }));
        s = run(s, op("C", 2, { kind: "undo", target: c.id }));
        assert.equal(chars(s, releaseJoinFirst ? tail : para), "peer");
        assert.equal(s.nodes[attachment].live, false);
        assert.equal(resolveAnchor(s, anchor).status, "exact");
        if (!releaseJoinFirst)
          s = run(s, op("E", 2, { kind: "undo", target: e.id }));
        s = run(s, op("D", 3, { kind: "undo", target: typing.id }));
        s = run(s, op("D", 4, { kind: "undo", target: d.id }));
        assert.deepEqual(visible(s), visible(initial));
      });

for (const type of ["image", "code"])
  for (const offset of [2, 4])
    test(`Typing in retained join ${type} offset=${offset}`, () => {
      const initial = immutable(fixture()),
        a = paste(initial, type, offset);
      let s = run(initial, a),
        b = move(s, "B", 1);
      s = run(s, b);
      const d = enter(s);
      s = run(s, d);
      const typed = op("D", 2, {
        kind: "insert",
        at: gapAt(s, tail, 0),
        text: "peer",
        marks: ["strong"],
      });
      s = run(s, typed);
      const anchor = anchorAt(s, tail, 0, 4);
      const join = op("E", 1);
      join.intent = planDelete(s, point(s, para, 3), "forward", join).intent;
      s = run(s, join);
      s = run(s, op("A", 2, { kind: "undo", target: a.id }));
      s = run(s, op("B", 2, { kind: "undo", target: b.id }));
      assert.equal(chars(s, para), "peer");
      const edit = op("D", 3, {
        kind: "insert",
        at: gapAt(s, para, 2),
        text: "!",
        marks: ["em"],
      });
      s = run(s, edit);
      assert.equal(chars(s, para), "pe!er");
      s = run(s, op("D", 4, { kind: "undo", target: edit.id }));
      assert.equal(chars(s, para), "peer");
      assert.equal(resolveAnchor(s, anchor).status, "exact");
      s = run(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
      assert.equal(chars(s, para), "Coppeeried");
      assert.equal(s.nodes[attachment].live, true);
      s = run(s, op("A", 4, { kind: "undo", target: "A:s:3" }));
      assert.equal(chars(s, para), "peer");
      s = run(s, op("E", 2, { kind: "undo", target: join.id }));
      s = run(s, op("D", 5, { kind: "undo", target: typed.id }));
      s = run(s, op("D", 6, { kind: "undo", target: d.id }));
      assert.deepEqual(visible(s), visible(initial));
    });
