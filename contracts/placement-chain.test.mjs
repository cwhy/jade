// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { immutable } from "@cwhy/jade-core/immutability";
import { text, gapAt, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
import { planListIndent } from "@cwhy/jade-core/commands";
import { validate, apply } from "@cwhy/jade-core/admission";
import {
  fixture,
  paste,
  op,
  point,
  run,
  visible,
  para,
  attachment,
  parent,
} from "./placement-chain-fixture.mjs";
const move = (s, actor, seq, outdent = false) => {
  const o = op(actor, seq);
  o.intent = planListIndent(s, point(s, para, 0), o, { outdent }).intent;
  return o;
};
const roundtrip = (s) => {
  const next = immutable(JSON.parse(JSON.stringify(s)));
  validate(next);
  return next;
};

for (const type of ["image", "code"])
  for (const offset of [2, 4])
    for (const birthActive of [false, true])
      for (const first of ["B", "C"])
        test(`Accepted destination cycles ${type} offset=${offset} birth=${birthActive} first=${first}`, () => {
          const initial = immutable(fixture()),
            a = paste(initial, type, offset),
            pasted = run(initial, a);
          let s = pasted;
          const b = move(s, "B", 1);
          s = run(s, b);
          const bPlaced = visible(s),
            c = move(s, "C", 1, true);
          s = run(s, c);
          const cPlaced = visible(s);
          const d = op("D", 1, {
            kind: "insert",
            at: gapAt(s, para, 2),
            text: "peer",
            marks: ["strong"],
          });
          s = run(s, d);
          const anchor = anchorAt(s, para, 2, 4);
          if (!birthActive)
            s = run(s, op("A", 2, { kind: "undo", target: a.id }));
          const held = visible(s),
            refs = { B: b.id, C: c.id },
            seq = { B: 1, C: 1 };
          const toggle = (actor) => {
            const o = op(actor, ++seq[actor], {
              kind: "undo",
              target: refs[actor],
            });
            s = run(s, o);
            refs[actor] = o.id;
            s = roundtrip(s);
          };
          for (let i = 0; i < 8; i++) {
            toggle(first);
            assert.equal(
              text(s, para)
                .map((x) => x.char)
                .join(""),
              "Copeerpied",
            );
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            assert.equal(s.nodes[attachment].live, true);
            if (first === "B")
              assert.deepEqual(
                visible(s),
                held,
                "Removing earlier activity cannot reinterpret later accepted destination",
              );
            else
              assert.equal(
                parent(s, s.creations[a.id].root).id,
                b.id + ":list:1",
                "Removing latest reveals original earlier destination",
              );
            toggle(first);
            assert.deepEqual(
              visible(s),
              held,
              "Redo beneath later placement leaves its destination unchanged",
            );
          }
          toggle(first);
          toggle(first === "B" ? "C" : "B");
          assert.equal(
            text(s, para)
              .map((x) => x.char)
              .join(""),
            birthActive ? "Copeerpied" : "peer",
          );
          assert.equal(s.nodes[attachment].live, birthActive);
          s = run(s, op("D", 2, { kind: "undo", target: d.id }));
          assert.deepEqual(
            visible(s),
            birthActive ? visible(pasted) : visible(initial),
          );
        });
for (const undoOrder of [
  ["B", "C", "D"],
  ["D", "C", "B"],
  ["C", "B", "D"],
  ["B", "D", "C"],
])
  test(`Three accepted placements release ${undoOrder}`, () => {
    const initial = immutable(fixture()),
      a = paste(initial, "image", 4);
    let s = run(initial, a);
    const ops = {};
    for (const [actor, lift] of [
      ["B", false],
      ["C", true],
      ["D", false],
    ]) {
      const o = move(s, actor, 1, lift);
      s = run(s, o);
      ops[actor] = o;
    }
    s = run(s, op("A", 2, { kind: "undo", target: a.id }));
    const final = visible(s);
    for (let i = 0; i < undoOrder.length; i++) {
      const actor = undoOrder[i];
      s = run(s, op(actor, 2, { kind: "undo", target: ops[actor].id }));
      s = roundtrip(s);
      const active = ["B", "C", "D"].filter(
        (x) => !undoOrder.slice(0, i + 1).includes(x),
      );
      if (active.includes("D"))
        assert.deepEqual(
          visible(s),
          final,
          "Latest accepted chain includes inactive predecessors",
        );
      if (active.length) {
        assert.equal(
          text(s, para)
            .map((x) => x.char)
            .join(""),
          "Copied",
        );
        assert.equal(s.nodes[attachment].live, true);
      } else assert.deepEqual(visible(s), visible(initial));
    }
  });
for (const field of ["predecessor", "projected", "intent", "hold"])
  test(`Reject corrupted accepted-placement ${field}`, () => {
    let s = run(immutable(fixture()), paste(fixture(), "image", 4));
    const b = move(s, "B", 1);
    s = run(s, b);
    s = JSON.parse(JSON.stringify(s));
    if (field === "predecessor") s.creationPlacements[b.id].predecessor = b.id;
    if (field === "projected") s.creationPlacements[b.id].projected = false;
    if (field === "intent") s.creationPlacements[b.id].intent.root = "q";
    if (field === "hold") s.creations["A:s:1"].holds[b.id] = false;
    assert.throws(() => validate(s));
  });

for (const type of ["image", "code"])
  for (const offset of [2, 4])
    for (const undoBirth of [false, true])
      test(`Offline destination survives predecessor Undo ${type} offset=${offset} birthUndo=${undoBirth}`, () => {
        const initial = immutable(fixture()),
          a = paste(initial, type, offset),
          pasted = run(initial, a),
          b = move(pasted, "B", 1);
        let s = run(pasted, b);
        const c = move(s, "C", 1, true),
          expected = run(s, c);
        if (undoBirth) s = run(s, op("A", 2, { kind: "undo", target: a.id }));
        s = run(s, op("B", 2, { kind: "undo", target: b.id }));
        s = run(roundtrip(s), c);
        assert.equal(
          parent(s, s.creations[a.id].root)?.id,
          "list",
          "Offline outdent keeps its authored destination, not another level",
        );
        assert.equal(
          text(s, para)
            .map((x) => x.char)
            .join(""),
          "Copied",
        );
        assert.equal(s.nodes[attachment].live, true);
        s = run(s, op("C", 2, { kind: "undo", target: c.id }));
        assert.deepEqual(
          visible(s),
          undoBirth ? visible(initial) : visible(pasted),
        );
      });
for (const type of ["image", "code"])
  for (const offset of [2, 4])
    test(`Concurrent same-origin indent ${type} offset=${offset}`, () => {
      const initial = immutable(fixture()),
        a = paste(initial, type, offset),
        pasted = run(initial, a),
        b = move(pasted, "B", 1),
        c = move(pasted, "C", 1);
      let s = run(run(pasted, b), c);
      assert.equal(parent(s, s.creations[a.id].root).id, c.id + ":list:1");
      s = run(s, op("A", 2, { kind: "undo", target: a.id }));
      const placed = visible(s);
      s = run(s, op("B", 2, { kind: "undo", target: b.id }));
      assert.deepEqual(visible(s), placed);
      s = run(s, op("C", 2, { kind: "undo", target: c.id }));
      assert.deepEqual(visible(s), visible(initial));
    });

for (const basis of ["missing", 42, {}, "A:s:1"])
  test(`Reject invalid move basis ${JSON.stringify(basis)}`, () => {
    const initial = immutable(fixture()),
      a = paste(initial, "image", 4),
      pasted = run(initial, a),
      b = move(pasted, "B", 1);
    b.intent = { ...b.intent, basis };
    const before = JSON.stringify(pasted);
    assert.throws(() => apply(pasted, b));
    assert.equal(JSON.stringify(pasted), before);
  });

test("Placement projection survives reordered JSON object keys", () => {
  const initial = immutable(fixture()),
    a = paste(initial, "image", 4);
  let s = run(initial, a),
    b = move(s, "B", 1);
  s = run(s, b);
  const c = move(s, "C", 1, true);
  s = run(s, c);
  s = run(s, op("A", 2, { kind: "undo", target: a.id }));
  const before = visible(s);
  const decoded = JSON.parse(JSON.stringify(s));
  decoded.creationPlacements = Object.fromEntries(
    Object.entries(decoded.creationPlacements).reverse(),
  );
  s = immutable(decoded);
  validate(s);
  s = run(s, op("B", 2, { kind: "undo", target: b.id }));
  assert.deepEqual(visible(s), before);
  s = run(s, op("C", 2, { kind: "undo", target: c.id }));
  assert.deepEqual(visible(s), visible(initial));
});
