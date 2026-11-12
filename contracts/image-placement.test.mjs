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
import { planInsertBlock, planEnter } from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  stream: "s",
  id: `${actor}:s:${seq}`,
  epoch: 1,
  intent,
});
function fixture(cell = false) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: cell ? ["t"] : ["p"] },
    p: { id: "p", type: "paragraph", live: true },
  };
  if (cell)
    Object.assign(nodes, {
      t: { id: "t", type: "table", live: true, children: ["r"] },
      r: { id: "r", type: "row", live: true, children: ["c"] },
      c: { id: "c", type: "cell", live: true, children: ["p"] },
    });
  return seed(nodes, {
    p: [
      { text: "ab", marks: ["strong"] },
      { text: "中文", marks: ["em"] },
      { text: "cd", marks: [] },
    ],
  });
}
const range = (s, a, b = a) =>
  captureRange(s, { block: "p", offset: a }, { block: "p", offset: b });
const options = {
  type: "image",
  slot: "mock-placement-slot-0001",
  width: 80,
  height: 40,
};
const placement = (s, a = 2, b = a) =>
  op("A", 1, planInsertBlock(s, range(s, a, b), op("A", 1), options).intent);
const undo = (s, actor = "A", seq = 2, target = "A:s:1") =>
  apply(s, op(actor, seq, { kind: "undo", target }));
const atoms = (s) =>
  Object.values(s.nodes)
    .filter((n) => n.live && n.type === "paragraph")
    .flatMap((n) => text(s, n.id));
const complete = (generation = "A:s:1") =>
  op("host", 1, {
    kind: "imageComplete",
    image: "A:s:1:image",
    generation,
    asset: "a".repeat(64),
    mime: "image/png",
    bytes: 80,
    width: 80,
    height: 40,
  });
for (const cell of [false, true])
  for (const [a, b] of [
    [0, 0],
    [2, 2],
    [2, 4],
    [4, 2],
    [0, 6],
  ])
    test(`image placement exact text/marks/anchors and repeated Undo cell=${cell} selection=${a}:${b}`, () => {
      const s = fixture(cell),
        original = text(s, "p"),
        anchor = anchorAt(s, "p", 0, 6),
        o = placement(s, a, b),
        n = apply(s, o),
        parent = cell ? "c" : "doc";
      validate(n);
      assert.deepEqual(n.nodes[parent].children, [
        "p",
        "A:s:1:image",
        "A:s:1:cut:paragraph",
      ]);
      assert.deepEqual(text(n, "p"), original.slice(0, Math.min(a, b)));
      assert.deepEqual(
        text(n, "A:s:1:cut:paragraph"),
        original.slice(Math.max(a, b)),
      );
      let current = apply(n, complete());
      for (let i = 0; i < 3; i++) {
        current = undo(
          current,
          "A",
          2 + i * 2,
          i === 0 ? "A:s:1" : `A:s:${1 + i * 2}`,
        );
        assert.deepEqual(text(current, "p"), original);
        assert.deepEqual(current.nodes[parent].children, ["p"]);
        assert.deepEqual(
          resolveAnchor(current, anchor).segments.map((x) => x.id),
          anchor.atoms,
        );
        current = undo(current, "A", 3 + i * 2, `A:s:${2 + i * 2}`);
        validate(current);
        assert.deepEqual(
          current.nodes[parent].children,
          n.nodes[parent].children,
        );
        assert.deepEqual(text(current, "p"), text(n, "p"));
        assert.deepEqual(
          text(current, "A:s:1:cut:paragraph"),
          text(n, "A:s:1:cut:paragraph"),
        );
        assert.equal(current.nodes["A:s:1:image"].asset, "a".repeat(64));
      }
    });
for (const first of [false, true])
  for (const offset of [0, 2, 3, 4, 6])
    for (const replaced of [false, true])
      test(`offline typing + placement + Undo arrival=${first} offset=${offset} replace=${replaced}`, () => {
        const s = fixture(true),
          o = placement(s, 2, replaced ? 4 : 2),
          peer = op("B", 1, {
            kind: "insert",
            at: gapAt(s, "p", offset),
            text: "友",
            marks: ["underline"],
          });
        let n = s;
        for (const x of first ? [peer, o] : [o, peer]) n = apply(n, x);
        assert.equal(atoms(n).filter((a) => a.id.startsWith("B:")).length, 1);
        n = undo(n);
        assert.deepEqual(text(n, "p"), text(apply(s, peer), "p"));
        validate(n);
        n = undo(n, "B", 2, "B:s:1");
        assert.deepEqual(text(n, "p"), text(s, "p"));
      });
for (const replaced of [false, true])
  for (const first of [false, true])
    for (const offset of [0, 1, 2, 3, 4, 6])
      test(`concurrent Enter retains peer boundary through placement Undo/Redo first=${first} offset=${offset} replace=${replaced}`, () => {
        const s = fixture(),
          o = placement(s, 2, replaced ? 4 : 2),
          peer = op("B", 1, planEnter(s, range(s, offset), op("B", 1)).intent);
        let n = s;
        for (const x of first ? [peer, o] : [o, peer]) n = apply(n, x);
        n = undo(n);
        const expected = apply(s, peer);
        assert.deepEqual(n.nodes.doc.children, expected.nodes.doc.children);
        for (const id of n.nodes.doc.children)
          assert.deepEqual(text(n, id), text(expected, id));
        n = undo(n, "A", 3, "A:s:2");
        validate(n);
        const ids = n.nodes.doc.children;
        assert.equal(
          ids[ids.indexOf("A:s:1:image") + 1],
          "A:s:1:cut:paragraph",
        );
        n = undo(n, "A", 4, "A:s:3");
        n = undo(n, "B", 2, "B:s:1");
        assert.deepEqual(n.nodes.doc.children, ["p"]);
        assert.deepEqual(text(n, "p"), text(s, "p"));
      });
test("uncertain delivery, persisted reload, replay and stale completion are deterministic", () => {
  const s = fixture(),
    o = placement(s, 2, 4),
    room = new Room(s);
  let record = room.snapshot();
  for (const x of [
    o,
    op("A", 2, { kind: "undo", target: o.id }),
    op("A", 3, { kind: "undo", target: "A:s:2" }),
  ]) {
    const receipt = room.accept(x);
    assert.equal(receipt.outcome, "accepted");
    record = replay(record, { op: x, receipt });
    assert.deepEqual(room.accept(x), receipt);
    const restarted = new Room(null, JSON.parse(JSON.stringify(room.record)));
    assert.deepEqual(restarted.accept(x), receipt);
    assert.deepEqual(restarted.record, record);
  }
  assert.equal(room.accept(complete()).outcome, "rejected");
  assert.equal(
    room.accept({ ...complete("A:s:3"), seq: 2, id: "host:s:2" }).outcome,
    "accepted",
  );
});
test("range changed during preparation requires review; no mutation", () => {
  const s = fixture(),
    r = range(s, 2, 4),
    n = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "p", 3),
        text: "友",
        marks: [],
      }),
    );
  assert.throws(
    () => planInsertBlock(n, r, op("A", 1), options),
    /Destination changed/,
  );
  assert.equal(n.nodes["A:s:1:image"], undefined);
});
for (const bad of [
  { ids: ["fake", "fake"] },
  { ids: [1] },
  { width: 0 },
  { ids: "all" },
  { parent: "fake" },
])
  test("malformed placement rejects atomically " + JSON.stringify(bad), () => {
    const s = fixture(),
      o = placement(s);
    o.intent = { ...o.intent, ...bad };
    assert.throws(() => apply(s, o));
    assert.deepEqual(s, fixture());
  });
for (const first of [false, true])
  for (const replace of [false, true])
    test(`two image placements at the same gap keep separate Undo owners first=${first} replace=${replace}`, () => {
      const s = fixture(),
        a = placement(s, 2, replace ? 4 : 2),
        b = op(
          "B",
          1,
          planInsertBlock(s, range(s, 2), op("B", 1), {
            ...options,
            slot: "mock-placement-slot-0002",
          }).intent,
        );
      let n = s;
      for (const x of first ? [b, a] : [a, b]) n = apply(n, x);
      n = undo(n);
      assert.equal(n.nodes["B:s:1:image"].live, true);
      n = undo(n, "B", 2, "B:s:1");
      assert.deepEqual(n.nodes.doc.children, ["p"]);
      assert.deepEqual(text(n, "p"), text(s, "p"));
    });
for (const order of ["before-undo", "after-undo", "after-redo"])
  test(`offline text inside erased range retains exact source identity ${order}`, () => {
    const s = fixture(),
      a = placement(s, 2, 4),
      peer = op("B", 1, {
        kind: "insert",
        at: gapAt(s, "p", 3),
        text: "友",
        marks: ["underline"],
      });
    let n = apply(s, a);
    if (order === "before-undo") n = apply(n, peer);
    n = undo(n);
    if (order === "after-undo") n = apply(n, peer);
    n = undo(n, "A", 3, "A:s:2");
    if (order === "after-redo") n = apply(n, peer);
    n = undo(n, "A", 4, "A:s:3");
    assert.deepEqual(text(n, "p"), text(apply(s, peer), "p"));
    validate(n);
  });
test("multi-paragraph selections remain guarded without partial erasure", () => {
  let s = fixture();
  s = apply(s, op("B", 1, planEnter(s, range(s, 3), op("B", 1)).intent));
  const r = captureRange(
    s,
    { block: "p", offset: 1 },
    { block: "B:s:1:paragraph", offset: 1 },
  );
  assert.throws(
    () => planInsertBlock(s, r, op("A", 1), options),
    /Place a caret/,
  );
  assert.equal(s.nodes["A:s:1:image"], undefined);
});
test("cross-cell erased identities reject the entire image operation", () => {
  const s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["t"] },
      t: { id: "t", type: "table", live: true, children: ["r"] },
      r: { id: "r", type: "row", live: true, children: ["c", "d"] },
      c: { id: "c", type: "cell", live: true, children: ["p"] },
      d: { id: "d", type: "cell", live: true, children: ["q"] },
      p: { id: "p", type: "paragraph", live: true },
      q: { id: "q", type: "paragraph", live: true },
    },
    { p: [{ text: "abcd" }], q: [{ text: "other" }] },
  );
  const o = placement(s);
  o.intent.ids = text(s, "q").map((a) => a.id);
  assert.throws(() => apply(s, o), /crosses a container/);
  assert.equal(s.nodes["A:s:1:image"], undefined);
  assert.equal(
    text(s, "q")
      .map((a) => a.char)
      .join(""),
    "other",
  );
});
