// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { planBoundaryParagraph, planEnter } from "@cwhy/jade-core/commands";
import { captureTableBoundary } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  apply,
  validate,
  gapAt,
  resolveGap,
  text,
} from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
import { Client } from "@cwhy/jade-collaboration/client";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  stream: "s",
  seq,
  id: `${actor}:s:${seq}`,
  epoch: 1,
  intent,
});
const create = (s, actor = "A", value = "note") => {
  const o = op(actor, 1);
  return {
    ...o,
    intent: planBoundaryParagraph(s, captureTableBoundary(s, "table"), o, {
      text: value,
    }).intent,
  };
};
const content = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const inverse = (s, target, seq, actor = "A") =>
  apply(s, op(actor, seq, { kind: "undo", target }));
for (const value of ["", "Hello", "你好 👩🏽‍💻 é", "\n"])
  test(`boundary creation ${JSON.stringify(value)} is one reversible operation`, () => {
    const s = tableFixture(),
      o = create(s, "A", value),
      n = apply(s, o),
      id = "A:s:1:paragraph",
      point = gapAt(n, id, [...value].length);
    validate(n);
    assert.deepEqual(n.nodes.doc.children, [id, "table"]);
    assert.equal(content(n, id), value);
    assert.deepEqual(n.nodes.table.children, s.nodes.table.children);
    assert.deepEqual(n.nodes.row, s.nodes.row);
    const gone = inverse(n, o.id, 2);
    validate(gone);
    assert.deepEqual(gone.nodes.doc.children, ["table"]);
    assert.throws(
      () => resolveGap(gone, point),
      /no longer live|No surviving target/,
    );
    const back = inverse(gone, "A:s:2", 3);
    validate(back);
    assert.deepEqual(text(back, id), text(n, id));
    assert.deepEqual(resolveGap(back, point), {
      block: id,
      offset: [...value].length,
    });
    assert.equal(back.nodes[id].text, n.nodes[id].text);
  });
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const undo of [
    ["A", "B"],
    ["B", "A"],
  ])
    for (const redo of [
      ["A", "B"],
      ["B", "A"],
    ])
      test(`two independent boundary paragraphs arrival ${arrival} Undo ${undo} Redo ${redo}`, () => {
        const room = new Room(tableFixture()),
          operations = Object.fromEntries(
            ["A", "B"].map((a) => [a, create(room.record.state, a, a)]),
          );
        for (const a of arrival) room.accept(operations[a]);
        const expected = arrival
          .map((a) => `${a}:s:1:paragraph`)
          .concat("table");
        assert.deepEqual(room.record.state.nodes.doc.children, expected);
        const original = Object.fromEntries(
          arrival.map((a) => [
            a,
            text(room.record.state, `${a}:s:1:paragraph`),
          ]),
        );
        for (const a of undo) {
          const receipt = room.accept(
            op(a, 2, { kind: "undo", target: operations[a].id }),
          );
          assert.equal(receipt.outcome, "accepted");
        }
        assert.deepEqual(room.record.state.nodes.doc.children, ["table"]);
        let restored = new Room(null, JSON.parse(JSON.stringify(room.record)));
        for (const a of redo)
          assert.equal(
            restored.accept(op(a, 3, { kind: "undo", target: `${a}:s:2` }))
              .outcome,
            "accepted",
          );
        assert.deepEqual(restored.record.state.nodes.doc.children, expected);
        for (const a of arrival)
          assert.deepEqual(
            text(restored.record.state, `${a}:s:1:paragraph`),
            original[a],
          );
      });
test("peer text prevents atomic birth Undo without deleting either contribution", () => {
  const room = new Room(tableFixture());
  room.accept(create(room.record.state));
  const id = "A:s:1:paragraph";
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, id, 2),
      text: "PEER",
      marks: [],
    }),
  );
  const before = room.record.state;
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: "A:s:1" })).outcome,
    "rejected",
  );
  assert.deepEqual(room.record.state, before);
  assert.equal(content(room.record.state, id), "noPEERte");
  room.accept(op("B", 2, { kind: "undo", target: "B:s:1" }));
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: "A:s:1" })).outcome,
    "accepted",
  );
  assert.deepEqual(room.record.state.nodes.doc.children, ["table"]);
});
test("offline typing after birth Undo is rejected with exact immutable payload", () => {
  const room = new Room(tableFixture());
  room.accept(create(room.record.state));
  const late = op("B", 1, {
    kind: "insert",
    at: gapAt(room.record.state, "A:s:1:paragraph", 2),
    text: "offline note",
    marks: [],
  });
  room.accept(op("A", 2, { kind: "undo", target: "A:s:1" }));
  const r = room.accept(late);
  assert.equal(r.outcome, "rejected");
  assert.equal(r.bytes, JSON.stringify(late));
  assert.deepEqual(room.record.state.nodes.doc.children, ["table"]);
});
test("optimistic rejected Undo restores original history and later text entry", () => {
  const room = new Room(tableFixture()),
    c = new Client("A", "s", room.record);
  c.prepare(create(c.state).intent);
  room.accept(c.pending[0]);
  c.receive(room.record);
  c.undo();
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, "A:s:1:paragraph", 0),
      text: "peer",
      marks: [],
    }),
  );
  room.accept(c.pending[0]);
  c.receive(room.record);
  assert.deepEqual(
    c.undoStack.map((g) => g.ids),
    [["A:s:1"]],
  );
  assert.deepEqual(c.redoStack, []);
  assert.equal(content(c.state, "A:s:1:paragraph"), "peernote");
});
test("split and its Undo change replica generations but do not strand paragraph-creation Undo", () => {
  const room = new Room(tableFixture());
  room.accept(create(room.record.state));
  const id = "A:s:1:paragraph",
    r = captureRange(
      room.record.state,
      { block: id, offset: 2 },
      { block: id, offset: 2 },
    ),
    o = op("A", 2);
  const plan = planEnter(room.record.state, r, o);
  assert.equal(room.accept({ ...o, intent: plan.intent }).outcome, "accepted");
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: o.id })).outcome,
    "accepted",
  );
  assert.equal(content(room.record.state, id), "note");
  assert.notEqual(room.record.state.nodes[id].text, "A:s:1:text");
  assert.equal(
    room.accept(op("A", 4, { kind: "undo", target: "A:s:1" })).outcome,
    "accepted",
  );
  assert.deepEqual(room.record.state.nodes.doc.children, ["table"]);
  room.accept(op("A", 5, { kind: "undo", target: "A:s:4" }));
  assert.equal(content(room.record.state, id), "note");
});
test("duplicate delivery and decision replay preserve identities and exact content", () => {
  const room = new Room(tableFixture()),
    start = room.record,
    o = create(room.record.state);
  const receipt = room.accept(o),
    saved = JSON.parse(JSON.stringify(room.record));
  assert.deepEqual(room.accept(o), receipt);
  assert.deepEqual(room.record, saved);
  assert.deepEqual(replay(start, { op: o, receipt }), room.record);
});
for (const mutate of [
  (i) => (i.parent = "row"),
  (i) => (i.table = "missing"),
  (i) => (i.extra = "forged"),
  (i) => (i.text = 4),
])
  test(`boundary admission rejects malformed request ${mutate}`, () => {
    const s = tableFixture(),
      o = create(s);
    mutate(o.intent);
    const before = JSON.stringify(s);
    assert.throws(() => apply(s, o));
    assert.equal(JSON.stringify(s), before);
  });
test("private lifecycle, foreign Undo, old codec and malformed retained order reject", () => {
  const s = tableFixture(),
    n = apply(s, create(s));
  assert.throws(
    () => apply(n, op("B", 1, { kind: "undo", target: "A:s:1" })),
    /another actor/,
  );
  assert.throws(
    () => apply(n, op("A", 2, { kind: "boundaryParagraphActive" })),
    /unsupported|internal/,
  );
  assert.throws(() => apply({ ...s, storageCodec: 11 }, create(s)), /codec/);
  const bad = structuredClone(n);
  bad.nodes.table.beforeParagraphs.push("missing");
  assert.throws(() => validate(bad), /identity/);
});
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const undo of [
    ["A", "B"],
    ["B", "A"],
  ])
    test(`prose Enter after boundary birth, concurrent arrival ${arrival}, Undo ${undo}`, () => {
      const room = new Room(tableFixture());
      room.accept(create(room.record.state));
      const id = "A:s:1:paragraph",
        base = room.record.state,
        r = captureRange(
          base,
          { block: id, offset: 2 },
          { block: id, offset: 2 },
        ),
        ops = {};
      for (const a of ["A", "B"]) {
        const o = op(a, a === "A" ? 2 : 1);
        ops[a] = { ...o, intent: planEnter(base, r, o).intent };
      }
      const original = text(base, id);
      for (const a of arrival)
        assert.equal(room.accept(ops[a]).outcome, "accepted");
      assert.deepEqual(
        room.record.state.nodes.doc.children
          .filter((x) => x !== "table")
          .flatMap((x) => text(room.record.state, x)),
        original,
      );
      for (const a of undo)
        assert.equal(
          room.accept(
            op(a, a === "A" ? 3 : 2, { kind: "undo", target: ops[a].id }),
          ).outcome,
          "accepted",
        );
      assert.deepEqual(room.record.state.nodes.doc.children, [id, "table"]);
      assert.deepEqual(text(room.record.state, id), original);
      assert.equal(
        room.accept(op("A", 4, { kind: "undo", target: "A:s:1" })).outcome,
        "accepted",
      );
    });
for (const peerFirst of [false, true])
  test(`prose Enter maps offline peer typing and own Undo, peerFirst=${peerFirst}`, () => {
    const room = new Room(tableFixture());
    room.accept(create(room.record.state));
    const id = "A:s:1:paragraph",
      base = room.record.state,
      o = op("A", 2),
      split = {
        ...o,
        intent: planEnter(
          base,
          captureRange(
            base,
            { block: id, offset: 2 },
            { block: id, offset: 2 },
          ),
          o,
        ).intent,
      },
      peer = op("B", 1, {
        kind: "insert",
        at: gapAt(base, id, 3),
        text: "Q",
        marks: [],
      });
    for (const action of peerFirst ? [peer, split] : [split, peer])
      assert.equal(room.accept(action).outcome, "accepted");
    assert.equal(
      room.accept(op("A", 3, { kind: "undo", target: split.id })).outcome,
      "accepted",
    );
    assert.equal(content(room.record.state, id), "notQe");
    assert.equal(
      room.accept(op("A", 4, { kind: "undo", target: "A:s:1" })).outcome,
      "rejected",
    );
    assert.equal(content(room.record.state, id), "notQe");
  });
test("prose Enter rejects forged tail identity, batch admission, code and list targets", () => {
  const s = tableFixture();
  for (const intent of [
    { kind: "proseEnter", at: gapAt(s, "first", 1), tail: "forged" },
    {
      kind: "batch",
      intents: [{ kind: "proseEnter", at: gapAt(s, "first", 1) }],
    },
    { kind: "proseEnter", at: gapAt(s, "code", 1) },
    { kind: "proseEnter", at: gapAt(s, "list-text", 1) },
  ])
    assert.throws(() => apply(s, op("A", 1, intent)));
});
