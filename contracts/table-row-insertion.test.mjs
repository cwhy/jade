// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { planInsertRow, planNavigateCell } from "@cwhy/jade-core/commands";
import {
  apply,
  validate,
  gapAt,
  resolveGap,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { immutable } from "@cwhy/jade-core/immutability";
import { Room } from "@cwhy/jade-collaboration/room";
import { Client } from "@cwhy/jade-collaboration/client";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  stream: "rows",
  seq,
  id: `${actor}:rows:${seq}`,
  epoch: 1,
  intent,
});
const range = (s, block = "last") =>
  captureRange(s, { block, offset: 0 }, { block, offset: 0 });
const insertion = (s, actor = "A", block = "last", side = "below") => {
  const o = op(actor, 1);
  return {
    ...o,
    intent: planInsertRow(s, range(s, block), o, { side }).intent,
  };
};
const undo = (s, target, seq = 2, actor = "A") =>
  immutable(apply(s, op(actor, seq, { kind: "undo", target })));
const content = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
for (const side of ["above", "below"])
  test(`row ${side} preserves source text/widths and selects active column`, () => {
    const s = immutable(tableFixture()),
      o = op("A", 1),
      p = planInsertRow(s, range(s, "code"), o, { side }),
      n = immutable(apply(s, { ...o, intent: p.intent }));
    validate(n);
    assert.deepEqual(
      n.nodes.table.children,
      side === "above"
        ? ["A:rows:1:row", "row", "row-two"]
        : ["row", "A:rows:1:row", "row-two"],
    );
    assert.deepEqual(resolveGap(n, p.after), {
      block: "A:rows:1:paragraph:2",
      offset: 0,
    });
    for (const [id, node] of Object.entries(s.nodes))
      if (id !== "table") assert.equal(n.nodes[id], node);
    for (let i = 0; i < 3; i++) {
      assert.equal(content(n, `A:rows:1:paragraph:${i}`), "");
      assert.deepEqual(n.nodes[`A:rows:1:cell:${i}`].colwidth, [200]);
    }
    assert.deepEqual(s.nodes.table.children, ["row", "row-two"]);
  });
test("last-cell navigation appends one row and starts at its first cell", () => {
  const s = tableFixture(),
    o = op("A", 1),
    p = planNavigateCell(s, range(s), o);
  assert.equal(p.intent.kind, "tableInsertRow");
  assert.deepEqual(resolveGap(p.state, p.after), {
    block: "A:rows:1:paragraph:0",
    offset: 0,
  });
  assert.equal(p.state.nodes.table.children.length, 3);
});
test("row Undo/Redo retires and restores the same empty anchors and replicas", () => {
  const s = tableFixture(),
    o = insertion(s),
    n = immutable(apply(s, o)),
    at = gapAt(n, "A:rows:1:paragraph:0", 0);
  const gone = undo(n, o.id);
  validate(gone);
  assert.deepEqual(gone.nodes.table.children, s.nodes.table.children);
  assert.throws(() => resolveGap(gone, at), /no longer live/);
  assert.equal(gone.boundaries[at.boundary].retiredBy, "A:rows:2");
  const back = undo(gone, "A:rows:2", 3);
  validate(back);
  assert.deepEqual(resolveGap(back, at), {
    block: "A:rows:1:paragraph:0",
    offset: 0,
  });
  assert.equal(
    back.nodes["A:rows:1:paragraph:0"].text,
    n.nodes["A:rows:1:paragraph:0"].text,
  );
  assert.equal(back.boundaries[at.boundary].retiredBy, undefined);
});
test("own text Undo, row Undo, row Redo and text Redo restore exact character identity", () => {
  let s = tableFixture();
  s = immutable(apply(s, insertion(s)));
  s = immutable(
    apply(
      s,
      op("A", 2, {
        kind: "insert",
        at: gapAt(s, "A:rows:1:paragraph:0", 0),
        text: "note",
        marks: ["em"],
      }),
    ),
  );
  const anchor = anchorAt(s, "A:rows:1:paragraph:0", 0, 4);
  s = undo(s, "A:rows:2", 3);
  s = undo(s, "A:rows:1", 4);
  s = undo(s, "A:rows:4", 5);
  s = undo(s, "A:rows:3", 6);
  validate(s);
  assert.equal(content(s, "A:rows:1:paragraph:0"), "note");
  assert.equal(resolveAnchor(s, anchor).status, "exact");
});
for (const arrivals of [
  ["A", "B"],
  ["B", "A"],
])
  for (const undos of [
    ["A", "B"],
    ["B", "A"],
  ])
    for (const redos of [
      ["A", "B"],
      ["B", "A"],
    ])
      test(`concurrent row insert ${arrivals}; Undo ${undos}; Redo ${redos}`, () => {
        const original = tableFixture(),
          ops = Object.fromEntries(
            ["A", "B"].map((a) => [a, insertion(original, a)]),
          );
        let s = original;
        for (const a of arrivals) s = immutable(apply(s, ops[a]));
        const order = [...s.nodes.table.children];
        assert.deepEqual(order, [
          "row",
          "row-two",
          ...arrivals.map((a) => `${a}:rows:1:row`),
        ]);
        for (const a of undos) s = undo(s, ops[a].id, 2, a);
        assert.deepEqual(s.nodes.table.children, ["row", "row-two"]);
        validate(s);
        s = JSON.parse(JSON.stringify(s));
        for (const a of redos) s = undo(s, `${a}:rows:2`, 3, a);
        validate(s);
        assert.deepEqual(s.nodes.table.children, order);
      });
for (const arrival of ["peer-first", "undo-first"])
  test(`accepted peer contribution and row Undo race: ${arrival}`, () => {
    const room = new Room(tableFixture()),
      a = new Client("A", "rows", room.snapshot()),
      b = new Client("B", "rows", room.snapshot());
    const add = a.prepare(
      planInsertRow(a.state, range(a.state), op("A", 1)).intent,
    );
    room.accept(add);
    a.receive(room.snapshot());
    b.receive(room.snapshot());
    const typing = b.prepare({
      kind: "insert",
      at: gapAt(b.state, "A:rows:1:paragraph:0", 0),
      text: "peer",
      marks: ["strong"],
    });
    assert.equal(a.undo(), true);
    const remove = a.pending.at(-1);
    for (const o of arrival === "peer-first"
      ? [typing, remove]
      : [remove, typing])
      room.accept(o);
    a.receive(room.snapshot());
    b.receive(room.snapshot());
    validate(a.state);
    assert.deepEqual(a.state, b.state);
    if (arrival === "peer-first") {
      assert.equal(content(a.state, "A:rows:1:paragraph:0"), "peer");
      assert.equal(room.record.receipts[remove.id].outcome, "rejected");
      assert.equal(a.recovery[0].id, remove.id);
    } else {
      assert.equal(a.state.nodes["A:rows:1:row"].live, false);
      assert.equal(room.record.receipts[typing.id].outcome, "rejected");
      assert.equal(b.recovery[0].id, typing.id);
      assert.equal(
        JSON.parse(room.record.receipts[typing.id].bytes).intent.text,
        "peer",
      );
    }
  });
test("rejected optimistic Undo restores its history entry without losing later edits", () => {
  const room = new Room(tableFixture()),
    a = new Client("A", "rows", room.snapshot()),
    b = new Client("B", "rows", room.snapshot());
  const add = a.prepare(
    planInsertRow(a.state, range(a.state), op("A", 1)).intent,
  );
  room.accept(add);
  a.receive(room.snapshot());
  b.receive(room.snapshot());
  const peer = b.prepare({
    kind: "insert",
    at: gapAt(b.state, "A:rows:1:paragraph:0", 0),
    text: "peer",
    marks: [],
  });
  a.undo();
  const removal = a.pending.at(-1);
  const later = a.prepare({
    kind: "insert",
    at: gapAt(a.state, "first", 0),
    text: "later",
    marks: [],
  });
  for (const o of [peer, removal, later]) room.accept(o);
  a.receive(room.snapshot());
  assert.deepEqual(
    a.undoStack.map((g) => g.ids),
    [[add.id], [later.id]],
  );
  assert.deepEqual(a.redoStack, []);
  assert.equal(content(a.state, "A:rows:1:paragraph:0"), "peer");
});
test("local blocked Undo allocates no sequence and preserves history and content", () => {
  const room = new Room(tableFixture()),
    a = new Client("A", "rows", room.snapshot());
  const add = a.prepare(
    planInsertRow(a.state, range(a.state), op("A", 1)).intent,
  );
  room.accept(add);
  a.receive(room.snapshot());
  const peer = op("B", 1, {
    kind: "insert",
    at: gapAt(a.state, "A:rows:1:paragraph:1", 0),
    text: "peer",
  });
  room.accept(peer);
  a.receive(room.snapshot());
  const before = a.save();
  assert.throws(() => a.undo(), /Row has content/);
  assert.deepEqual(a.save(), before);
  assert.deepEqual(a.undoStack[0].ids, [add.id]);
});
test("duplicate receipt and full checkpoint/log replay retain row order and lifecycle", () => {
  const initial = tableFixture(),
    room = new Room(initial);
  const events = [];
  const put = (o) => {
    const receipt = room.accept(o);
    events.push({ op: o, receipt });
    return receipt;
  };
  const add = insertion(initial),
    receipt = put(add);
  assert.deepEqual(room.accept(add), receipt);
  assert.equal(room.record.state.nodes.table.children.length, 3);
  put(op("A", 2, { kind: "undo", target: add.id }));
  const checkpoint = JSON.parse(JSON.stringify(room.snapshot()));
  const restore = op("A", 3, { kind: "undo", target: "A:rows:2" });
  put(restore);
  assert.deepEqual(replay(checkpoint, events.at(-1)), room.snapshot());
  let record = new Room(initial).snapshot();
  for (const event of events) record = replay(record, event);
  assert.deepEqual(record, room.snapshot());
});
for (const mutate of [
  (i) => i.columns.reverse(),
  (i) => i.columns.pop(),
  (i) => (i.before = "missing"),
  (i) => (i.table = "doc"),
  (i) => (i.template = "row-other"),
  (i) => (i.extra = "forged"),
])
  test(`row admission rejects stale/forged targets ${mutate}`, () => {
    const room = new Room(tableFixture()),
      o = insertion(room.record.state);
    mutate(o.intent);
    assert.equal(room.accept(o).outcome, "rejected");
    assert.equal(room.record.state.revision, 0);
    assert.deepEqual(room.record.state.nodes.table.children, [
      "row",
      "row-two",
    ]);
  });
test("forged activation and foreign Undo are rejected; codec 10 cannot enter the new engine", () => {
  const s = tableFixture(),
    o = insertion(s),
    n = apply(s, o);
  assert.throws(
    () =>
      apply(
        n,
        op("A", 2, {
          kind: "tableRowActive",
          table: "table",
          row: "A:rows:1:row",
          active: false,
        }),
      ),
    /unsupported|internal/,
  );
  assert.throws(
    () => apply(n, op("B", 1, { kind: "undo", target: o.id })),
    /another actor/,
  );
  assert.throws(() => apply({ ...s, storageCodec: 10 }, o), /codec/);
  const broken = JSON.parse(JSON.stringify(n));
  broken.nodes.table.rowOrder.reverse();
  assert.throws(() => validate(broken), /projection/);
});
test("rejected Undo and dependent Redo preserve the original entry and later contribution", () => {
  const room = new Room(tableFixture()),
    a = new Client("A", "rows", room.snapshot()),
    b = new Client("B", "rows", room.snapshot());
  const add = a.prepare(
    planInsertRow(a.state, range(a.state), op("A", 1)).intent,
  );
  room.accept(add);
  a.receive(room.snapshot());
  b.receive(room.snapshot());
  const peer = b.prepare({
    kind: "insert",
    at: gapAt(b.state, "A:rows:1:paragraph:0", 0),
    text: "peer",
    marks: [],
  });
  a.undo();
  a.redo();
  const later = a.prepare({
    kind: "insert",
    at: gapAt(a.state, "first", 0),
    text: "later",
    marks: [],
  });
  room.accept(peer);
  for (const pending of a.pending) room.accept(pending);
  a.receive(room.snapshot());
  assert.deepEqual(
    a.undoStack.map((g) => g.ids),
    [[add.id], [later.id]],
  );
  assert.deepEqual(a.redoStack, []);
  assert.equal(a.recovery.length, 2);
  assert.equal(content(a.state, "A:rows:1:paragraph:0"), "peer");
});
for (const later of [false, true])
  test(`rejected Redo reconciles history; later edit=${later}`, () => {
    let room = new Room(tableFixture());
    const a = new Client("A", "rows", room.snapshot());
    const first = a.prepare({
      kind: "insert",
      at: gapAt(a.state, "first", 0),
      text: "A",
      marks: [],
    });
    room.accept(first);
    a.receive(room.snapshot());
    a.undo();
    room.accept(a.pending[0]);
    a.receive(room.snapshot());
    const undoId = a.redoStack[0];
    a.redo();
    const redo = a.pending[0];
    let last;
    if (later)
      last = a.prepare({
        kind: "insert",
        at: gapAt(a.state, "last", 0),
        text: "L",
        marks: [],
      });
    // A terminal admission denial (e.g. a capability change) does not mutate state.
    const record = room.snapshot();
    room = new Room(null, {
      ...record,
      receipts: {
        ...record.receipts,
        [redo.id]: {
          bytes: JSON.stringify(redo),
          outcome: "rejected",
          revision: record.state.revision,
          reason: "Test admission denial",
        },
      },
      frontiers: { ...record.frontiers, "A:rows": redo.seq },
    });
    if (last) room.accept(last);
    a.receive(room.snapshot());
    assert.equal(content(a.state, "first"), "First cell text");
    assert.deepEqual(
      a.undoStack.map((g) => g.ids),
      later ? [[last.id]] : [],
    );
    assert.deepEqual(a.redoStack, later ? [] : [undoId]);
    if (!later) {
      a.redo();
      room.accept(a.pending[0]);
      a.receive(room.snapshot());
      assert.equal(content(a.state, "first"), "AFirst cell text");
    }
  });
