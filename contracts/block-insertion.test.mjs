// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, gapAt, text } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import {
  planInsertBlock,
  planInsertRow,
  planInsertColumn,
} from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const initial = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["first", "last"] },
      first: { id: "first", type: "paragraph", live: true },
      last: { id: "last", type: "paragraph", live: true },
    },
    { first: [{ text: "Notes" }], last: [{ text: "After" }] },
  );
const op = (actor, seq, intent) => ({
  actor,
  stream: "blocks",
  seq,
  id: `${actor}:blocks:${seq}`,
  epoch: 1,
  intent,
});
const range = (s, block = "first", offset = 5) =>
  captureRange(s, { block, offset }, { block, offset });
const insert = (
  s,
  options = { type: "table", rows: 2, columns: 3 },
  actor = "A",
  seq = 1,
) => {
  const o = op(actor, seq);
  return { ...o, intent: planInsertBlock(s, range(s), o, options).intent };
};
const undo = (s, target, seq = 2) =>
  apply(s, op("A", seq, { kind: "undo", target }));
for (const [rows, columns] of [
  [1, 1],
  [2, 3],
  [20, 12],
])
  test(`create ${rows}x${columns} table and owned Undo/Redo preserve identities`, () => {
    const s = initial(),
      o = insert(s, { type: "table", rows, columns }),
      n = apply(s, o);
    validate(n);
    assert.deepEqual(n.nodes.doc.children, ["first", o.id + ":table", "last"]);
    const t = n.nodes[o.id + ":table"];
    assert.equal(t.children.length, rows);
    for (const row of t.children)
      assert.equal(n.nodes[row].children.length, columns);
    assert.equal(
      text(n, "first")
        .map((a) => a.char)
        .join(""),
      "Notes",
    );
    const back = undo(n, o.id);
    assert.deepEqual(back.nodes.doc.children, s.nodes.doc.children);
    const again = undo(back, "A:blocks:2", 3);
    validate(again);
    assert.deepEqual(again.nodes.doc.children, n.nodes.doc.children);
    assert.deepEqual(again.nodes[t.id].children, t.children);
  });
for (const options of [
  { rows: 0, columns: 2 },
  { rows: 21, columns: 2 },
  { rows: 2, columns: 13 },
  { rows: 1.5, columns: 2 },
])
  test(`reject invalid table dimensions ${JSON.stringify(options)}`, () =>
    assert.throws(() => insert(initial(), { type: "table", ...options })));
test("admission rejects nested/midparagraph tables and forged lifecycle commands", () => {
  const s = initial(),
    o = op("A", 1);
  assert.throws(() =>
    planInsertBlock(s, range(s, "first", 2), o, { type: "table" }),
  );
  const n = apply(s, insert(s)),
    block = "A:blocks:1:table:row:0:cell:0:paragraph";
  assert.throws(() =>
    planInsertBlock(n, range(n, block, 0), op("A", 2), { type: "table" }),
  );
  assert.throws(() =>
    apply(
      n,
      op("A", 2, {
        kind: "tableCreationActive",
        table: "A:blocks:1:table",
        active: false,
      }),
    ),
  );
  assert.throws(() =>
    apply(s, op("A", 1, { ...insert(s).intent, extra: "forged" })),
  );
});
test("table creation Undo refuses to remove peer text, without mutating accepted state", () => {
  const s = initial(),
    o = insert(s),
    n = apply(s, o),
    block = o.id + ":table:row:0:cell:0:paragraph";
  const edited = apply(
      n,
      op("B", 1, {
        kind: "insert",
        at: gapAt(n, block, 0),
        text: "Peer",
        marks: [],
      }),
    ),
    snapshot = JSON.stringify(edited);
  assert.throws(() => undo(edited, o.id), /content/);
  assert.equal(JSON.stringify(edited), snapshot);
  assert.equal(
    text(edited, block)
      .map((a) => a.char)
      .join(""),
    "Peer",
  );
});
for (const kind of ["row", "column"])
  test(`table creation Undo preserves a peer-added ${kind}`, () => {
    const n = apply(initial(), insert(initial())),
      o = op("B", 1),
      r = range(n, "A:blocks:1:table:row:0:cell:0:paragraph", 0);
    const plan =
      kind === "row" ? planInsertRow(n, r, o) : planInsertColumn(n, r, o);
    const changed = apply(n, { ...o, intent: plan.intent });
    assert.throws(() => undo(changed, "A:blocks:1"), /structural/);
    validate(changed);
  });
test("concurrent creations at the same boundary converge in both accepted arrival orders", () => {
  for (const actors of [
    ["A", "B"],
    ["B", "A"],
  ]) {
    let s = initial();
    const operations = actors.map((a) =>
      insert(s, { type: "table", rows: 1, columns: 1 }, a),
    );
    for (const o of operations) s = apply(s, o);
    validate(s);
    assert.equal(s.nodes.doc.children.length, 4);
    assert.equal(new Set(s.nodes.doc.children).size, 4);
    const restored = undo(s, "A:blocks:1");
    assert.equal(
      restored.nodes.doc.children.includes("B:blocks:1:table"),
      true,
    );
  }
});
test("creation survives room persistence, duplicate receipt and replay", () => {
  const room = new Room(initial()),
    before = room.snapshot(),
    o = insert(initial());
  const event = room.accept(o);
  assert.equal(event.outcome, "accepted");
  assert.deepEqual(room.accept(o), event);
  const restored = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
  assert.deepEqual(restored.record.state, room.record.state);
  assert.deepEqual(
    replay(before, { op: o, receipt: event }).state,
    room.record.state,
  );
});
for (const type of ["bullet_list", "ordered_list", "code"])
  test(`insert empty ${type} uses existing rich insertion and focuses its text`, () => {
    const s = initial(),
      o = op("A", 1),
      plan = planInsertBlock(s, range(s), o, { type });
    const n = apply(s, { ...o, intent: plan.intent });
    validate(n);
    assert.ok(Object.values(n.nodes).some((x) => x.live && x.type === type));
    assert.ok(plan.after);
    const back = undo(n, o.id);
    validate(back);
    assert.equal(
      text(back, "first")
        .map((a) => a.char)
        .join(""),
      "Notes",
    );
  });

test("independent optimistic clients rebase concurrent creation and text in both receipt orders", async () => {
  const { Client } = await import("@cwhy/jade-collaboration/client");
  for (const order of [
    ["A", "B"],
    ["B", "A"],
  ]) {
    const room = new Room(initial()),
      a = new Client("A", "blocks", room.snapshot()),
      b = new Client("B", "blocks", room.snapshot());
    a.prepare(insert(a.state).intent);
    b.prepare({
      kind: "insert",
      at: gapAt(b.state, "last", 5),
      text: " peer",
      marks: [],
    });
    const clients = { A: a, B: b };
    for (const actor of order)
      assert.equal(room.accept(clients[actor].pending[0]).outcome, "accepted");
    a.receive(room.snapshot());
    b.receive(room.snapshot());
    assert.deepEqual(a.state, b.state);
    assert.equal(
      text(a.state, "last")
        .map((x) => x.char)
        .join(""),
      "After peer",
    );
    assert.ok(a.state.nodes["A:blocks:1:table"].live);
  }
});
