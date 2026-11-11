// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  previewRowResize,
  planRowResize,
  previewColumnResize,
  planColumnResize,
  planInsertRow,
  planInsertColumn,
  previewTableDelete,
  planTableDelete,
  previewTableMove,
  planTableMove,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  apply,
  validate,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const point = (s) =>
  captureRange(s, { block: "first", offset: 1 }, { block: "first", offset: 1 });
const resize = (s, cell = "cell", height = 300, a = "A", seq = 1) => {
  const preview = previewRowResize(s, cell),
    p = planRowResize(s, point(s), op(a, seq), { preview, height });
  return { ...p, preview, op: op(a, seq, p.intent) };
};
const undo = (s, target, n = 2, a = "A") =>
  apply(s, op(a, n, { kind: "undo", target }));
for (const cell of ["cell", "last-cell"])
  for (const height of [24, 300, 10000])
    test(`row ${cell} min ${height}: only row metadata changes, exact Undo/Redo and anchors`, () => {
      const s = tableFixture(),
        before = JSON.stringify(s),
        p = resize(s, cell, height),
        anchor = anchorAt(s, "first", 1, 4);
      assert.equal(JSON.stringify(s), before);
      const n = apply(s, p.op);
      validate(n);
      assert.deepEqual(n.replicas, s.replicas);
      assert.deepEqual(n.runs, s.runs);
      assert.equal(resolveAnchor(n, anchor).status, "exact");
      for (const [id, node] of Object.entries(s.nodes))
        assert.deepEqual(
          n.nodes[id],
          id === p.preview.row
            ? { ...node, minHeight: height, heightOwner: p.op.id }
            : node,
        );
      const back = undo(n, p.op.id);
      assert.deepEqual(back.nodes, s.nodes);
      assert.deepEqual(undo(back, "A:s:2", 3).nodes, n.nodes);
    });
test("Reset removes only the minimum, carries ownership and Undo restores the exact prior value", () => {
  const s = tableFixture(),
    p = resize(s),
    reset = resize(p.state, "cell", null, "A", 2);
  assert.equal(reset.state.nodes.row.minHeight, undefined);
  assert.equal(reset.state.nodes.row.heightOwner, "A:s:2");
  assert.deepEqual(undo(reset.state, reset.op.id, 3).nodes, p.state.nodes);
});
for (const height of [23, 10001, 1.5, -1, Infinity, NaN, "250", undefined])
  test(`invalid minimum ${String(height)} rejects unchanged`, () => {
    const s = tableFixture(),
      before = JSON.stringify(s);
    const p = previewRowResize(s, "cell");
    assert.throws(
      () => planRowResize(s, point(s), op("A", 1), { preview: p, height }),
      /integer/,
    );
    assert.equal(JSON.stringify(s), before);
  });
for (const initial of [null, 300])
  test(`same minimum ${initial} is a no-op`, () => {
    const s = initial === null ? tableFixture() : resize(tableFixture()).state,
      p = resize(s, "cell", initial);
    assert.equal(p.intent, null);
    assert.equal(p.state, s);
  });
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  test(`same row concurrent proposals ${order} accept one and retain rejected bytes`, () => {
    const s = tableFixture(),
      room = new Room(s),
      ops = { A: resize(s).op, B: resize(s, "cell", 400, "B").op };
    assert.equal(room.accept(ops[order[0]]).outcome, "accepted");
    const before = room.record.state,
      r = room.accept(ops[order[1]]);
    assert.equal(r.outcome, "rejected");
    assert.equal(r.bytes, JSON.stringify(ops[order[1]]));
    assert.deepEqual(room.record.state, before);
  });
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  test(`independent rows ${order} resize and undo independently`, () => {
    const s = tableFixture(),
      room = new Room(s),
      ops = { A: resize(s).op, B: resize(s, "last-cell", 400, "B").op };
    for (const a of order)
      assert.equal(room.accept(ops[a]).outcome, "accepted");
    for (const a of order.toReversed())
      assert.equal(
        room.accept(op(a, 2, { kind: "undo", target: ops[a].id })).outcome,
        "accepted",
      );
    assert.deepEqual(room.record.state.nodes, s.nodes);
  });
test("newer height ownership blocks old Undo even when the numeric minimum matches again", () => {
  const s = tableFixture(),
    a = resize(s),
    b = resize(a.state, "cell", 400, "B"),
    c = resize(b.state, "cell", 300, "B", 2);
  assert.throws(() => undo(c.state, a.op.id), /cannot overwrite/);
  let back = undo(c.state, c.op.id, 3, "B");
  back = undo(back, b.op.id, 4, "B");
  assert.deepEqual(undo(back, a.op.id).nodes, s.nodes);
});
test("peer text, marks and column resize survive row resize and Undo", () => {
  const s = tableFixture(),
    a = resize(s),
    b = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "first", 1),
        text: "PEER",
        marks: ["strong"],
      }),
    ),
    c = planColumnResize(b, point(b), op("B", 2), {
      preview: previewColumnResize(b, "cell"),
      width: 350,
    }).state,
    back = undo(apply(c, a.op), a.op.id);
  assert.deepEqual(back.nodes.cell.colwidth, [350]);
  assert.equal(
    text(back, "first")
      .map((x) => x.char)
      .join(""),
    "FPEERirst cell text",
  );
  assert.equal(back.nodes.row.minHeight, undefined);
});
for (const kind of ["row", "column", "move"])
  test(`stable row minimum survives unrelated ${kind} structure`, () => {
    const s = tableFixture(),
      a = resize(s),
      o = op("B", 1);
    let p;
    if (kind === "row") p = planInsertRow(s, point(s), o);
    else if (kind === "column")
      p = planInsertColumn(s, point(s), o, { side: "left" });
    else
      p = planTableMove(s, point(s), o, {
        preview: previewTableMove(
          s,
          captureCellRange(s, "table", "cell"),
          "rows",
        ),
        before: null,
      });
    const n = apply(p.state, a.op),
      back = undo(n, a.op.id);
    assert.equal(n.nodes.row.minHeight, 300);
    assert.deepEqual(back.nodes, p.state.nodes);
  });
test("a new row remains automatic beside a manually sized row", () => {
  const a = resize(tableFixture()),
    p = planInsertRow(a.state, point(a.state), op("B", 1));
  const row = Object.values(p.state.nodes).find(
    (n) => n.type === "row" && !a.state.nodes[n.id],
  );
  assert.equal(row.minHeight, undefined);
  assert.equal(row.heightOwner, undefined);
});
test("resizing an inserted row blocks insertion Undo until the resize is undone", () => {
  const s = tableFixture(),
    p = planInsertRow(s, point(s), op("A", 1)),
    row = Object.values(p.state.nodes).find(
      (n) => n.type === "row" && !s.nodes[n.id],
    ),
    b = resize(p.state, row.children[0], 300, "B");
  assert.throws(() => undo(b.state, "A:s:1"), /dependencies/);
  const restored = undo(b.state, b.op.id, 2, "B");
  assert.doesNotThrow(() => undo(restored, "A:s:1"));
});
test("row deletion rejects stale resize; deletion Undo restores its height and allows height Undo", () => {
  const s = tableFixture(),
    a = resize(s),
    range = captureCellRange(a.state, "table", "cell"),
    p = planTableDelete(a.state, range, op("B", 1), {
      preview: previewTableDelete(a.state, range, "rows"),
    });
  assert.throws(() => apply(p.state, a.op), /unavailable|Duplicate|duplicate/);
  const restored = undo(p.state, "B:s:1", 2, "B");
  assert.equal(restored.nodes.row.minHeight, 300);
  assert.deepEqual(undo(restored, a.op.id).nodes.row, s.nodes.row);
});
for (const patch of [
  { minHeight: 0 },
  { minHeight: 10001 },
  { minHeight: "300" },
  { heightOwner: "" },
  { heightOwner: 4 },
])
  test(`invalid persisted height metadata ${JSON.stringify(patch)} rejected`, () => {
    const s = tableFixture();
    Object.assign(s.nodes.row, patch);
    assert.throws(() => validate(s), /row height/);
  });
test("non-row height metadata, raw restoration and batch bypass are refused", () => {
  const s = tableFixture();
  s.nodes.cell.minHeight = 300;
  assert.throws(() => validate(s), /row height/);
  const clean = tableFixture(),
    p = resize(clean);
  for (const intent of [
    { kind: "restoreRowHeight" },
    { kind: "batch", intents: [p.intent] },
    { ...p.intent, owner: "forged" },
  ])
    assert.throws(
      () => apply(clean, op("A", 1, intent)),
      /internal|unsupported|invalid/,
    );
});
