// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import {
  previewColumnResize,
  planColumnResize,
  planInsertRow,
  planInsertColumn,
  previewTableDelete,
  planTableDelete,
  copyCells,
  planDelete,
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
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const point = (s, id = "first") =>
  captureRange(s, { block: id, offset: 1 }, { block: id, offset: 1 });
const resize = (s, cell = "cell", width = 320, a = "A", seq = 1) => {
  const preview = previewColumnResize(s, cell),
    p = planColumnResize(s, point(s), op(a, seq), { preview, width });
  return { ...p, preview, op: op(a, seq, p.intent) };
};
const undo = (s, target, n = 2, a = "A") =>
  apply(s, op(a, n, { kind: "undo", target }));
const rich = (s) =>
  copyCells(s, captureCellRange(s, "table", "cell", "last-cell"));
for (const cell of ["cell", "list-cell", "code-cell"])
  for (const width of [120, 320, 10000])
    test(`resize ${cell} to ${width}: only that column changes; content/anchors and Undo/Redo exact`, () => {
      const s = tableFixture(),
        before = JSON.stringify(s),
        p = resize(s, cell, width),
        anchor = anchorAt(s, "first", 1, 4);
      assert.equal(JSON.stringify(s), before);
      const n = apply(s, p.op);
      validate(n);
      assert.deepEqual(rich(n), rich(s));
      assert.equal(resolveAnchor(n, anchor).status, "exact");
      assert.deepEqual(p.selection, point(s));
      assert.equal(Object.keys(n.effects).length, 1);
      for (const [id, node] of Object.entries(s.nodes)) {
        if (p.preview.cells.includes(id)) {
          assert.deepEqual(n.nodes[id].colwidth, [width]);
          assert.equal(n.nodes[id].widthOwner, p.op.id);
        } else assert.deepEqual(n.nodes[id], node);
      }
      const back = undo(n, p.op.id);
      validate(back);
      assert.deepEqual(back.nodes, s.nodes);
      const again = undo(back, "A:s:2", 3);
      assert.deepEqual(again.nodes, n.nodes);
    });
test("no-op resize emits no operation and preserves Redo ownership metadata", () => {
  const s = tableFixture(),
    p = resize(s, "cell", 200);
  assert.equal(p.intent, null);
  assert.equal(p.state, s);
});
test("absent and unequal legacy widths restore their exact per-cell values", () => {
  const s = tableFixture();
  delete s.nodes.cell.colwidth;
  s.nodes["empty-cell"].colwidth = [260];
  const p = resize(s, "cell", 300),
    back = undo(p.state, p.op.id);
  assert.deepEqual(back.nodes, s.nodes);
  assert.deepEqual(p.state.nodes.cell.colwidth, [300]);
  assert.deepEqual(p.state.nodes["empty-cell"].colwidth, [300]);
});
for (const width of [119, 10001, 1.5, -1, Infinity, NaN, "250", null])
  test(`invalid width ${String(width)} rejects without mutation`, () => {
    const s = tableFixture(),
      before = JSON.stringify(s);
    assert.throws(() => resize(s, "cell", width), /integer/);
    assert.equal(JSON.stringify(s), before);
  });
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  test(`concurrent same-column resize ${arrival} accepts one frozen proposal only`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      ops = {
        A: resize(s, "cell", 300, "A").op,
        B: resize(s, "cell", 450, "B").op,
      };
    const accepted = room.accept(ops[arrival[0]]);
    assert.equal(accepted.outcome, "accepted");
    const before = room.record.state,
      rejected = room.accept(ops[arrival[1]]);
    assert.equal(rejected.outcome, "rejected");
    assert.equal(rejected.bytes, JSON.stringify(ops[arrival[1]]));
    assert.deepEqual(room.record.state, before);
  });
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const reverse of [false, true])
    test(`independent columns ${arrival}, inverse order=${reverse} preserve both widths and Undo ownership`, () => {
      const room = new Room(tableFixture()),
        s = room.record.state,
        ops = {
          A: resize(s, "cell", 300, "A").op,
          B: resize(s, "list-cell", 450, "B").op,
        };
      for (const a of arrival)
        assert.equal(room.accept(ops[a]).outcome, "accepted");
      assert.deepEqual(room.record.state.nodes.cell.colwidth, [300]);
      assert.deepEqual(room.record.state.nodes["list-cell"].colwidth, [450]);
      for (const a of reverse ? arrival.toReversed() : arrival)
        assert.equal(
          room.accept(op(a, 2, { kind: "undo", target: ops[a].id })).outcome,
          "accepted",
        );
      assert.deepEqual(room.record.state.nodes, s.nodes);
    });
test("later width owner blocks earlier Undo even if width numerically returns to same value", () => {
  const room = new Room(tableFixture()),
    first = resize(room.record.state, "cell", 300).op;
  room.accept(first);
  room.accept(resize(room.record.state, "cell", 450, "B", 1).op);
  room.accept(resize(room.record.state, "cell", 300, "B", 2).op);
  const before = room.record.state;
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: first.id })).outcome,
    "rejected",
  );
  assert.deepEqual(room.record.state, before);
  room.accept(op("B", 3, { kind: "undo", target: "B:s:2" }));
  room.accept(op("B", 4, { kind: "undo", target: "B:s:1" }));
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: first.id })).outcome,
    "accepted",
  );
  assert.deepEqual(room.record.state.nodes.cell.colwidth, [200]);
});
test("peer text/marks and neighbor widths survive resize and Undo", () => {
  const s = tableFixture(),
    p = resize(s),
    n = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "first", 1),
        text: "PEER",
        marks: ["strong"],
      }),
    ),
    peer = apply(n, resize(n, "list-cell", 400, "B", 2).op),
    back = undo(apply(peer, p.op), p.op.id);
  assert.equal(
    text(back, "first")
      .map((a) => a.char)
      .join(""),
    "FPEERirst cell text",
  );
  assert.deepEqual(back.nodes["list-cell"].colwidth, [400]);
  assert.deepEqual(back.nodes.cell.colwidth, [200]);
});
for (const what of ["row", "delete-column", "delete-table"])
  test(`stale ${what} geometry rejects pending resize atomically`, () => {
    const s = tableFixture(),
      p = resize(s);
    let n;
    if (what === "row")
      n = apply(s, op("B", 1, planInsertRow(s, point(s), op("B", 1)).intent));
    else {
      const range = captureCellRange(s, "table", "cell"),
        preview = previewTableDelete(
          s,
          range,
          what === "delete-table" ? "table" : "columns",
        );
      n = apply(
        s,
        op("B", 1, planTableDelete(s, range, op("B", 1), { preview }).intent),
      );
    }
    const before = JSON.stringify(n);
    assert.throws(() => apply(n, p.op), /changed|unavailable/);
    assert.equal(JSON.stringify(n), before);
  });
test("column insertion beside a frozen resize retains its stable target", () => {
  const s = tableFixture(),
    p = resize(s),
    n = apply(
      s,
      op(
        "B",
        1,
        planInsertColumn(s, point(s), op("B", 1), { side: "left" }).intent,
      ),
    ),
    resized = apply(n, p.op);
  assert.deepEqual(resized.nodes.cell.colwidth, [320]);
  assert.deepEqual(resized.nodes[resized.nodes.row.children[0]].colwidth, [
    200,
  ]);
});
test("row created at resized width blocks width Undo until removed", () => {
  const p = resize(tableFixture()),
    s = p.state,
    row = op("B", 1, planInsertRow(s, point(s), op("B", 1)).intent),
    n = apply(s, row),
    before = JSON.stringify(n);
  assert.throws(() => undo(n, p.op.id), /changed/);
  assert.equal(JSON.stringify(n), before);
  const back = undo(undo(n, row.id, 2, "B"), p.op.id);
  assert.deepEqual(back.nodes.cell.colwidth, [200]);
});
test("birth resize Undo then insertion Undo preserve original identities", () => {
  const s = tableFixture(),
    birth = op("A", 1, planInsertColumn(s, point(s), op("A", 1)).intent),
    n = apply(s, birth),
    cell = n.nodes.row.children[1],
    p = resize(n, cell, 300, "A", 2),
    back = undo(undo(p.state, p.op.id, 3), birth.id, 4);
  assert.deepEqual(back.nodes.row.children, s.nodes.row.children);
  validate(back);
});
test("delete/restoration after resize retains ownership for its later Undo", () => {
  const p = resize(tableFixture()),
    s = p.state,
    r = captureCellRange(s, "table", "cell"),
    del = op(
      "B",
      1,
      planTableDelete(s, r, op("B", 1), {
        preview: previewTableDelete(s, r, "columns"),
      }).intent,
    ),
    n = undo(apply(s, del), del.id, 2, "B"),
    back = undo(n, p.op.id);
  assert.deepEqual(back.nodes.cell.colwidth, [200]);
  assert.equal(back.nodes.cell.widthOwner, undefined);
});
test("joined rich list and anchor survive width changes without altering content", () => {
  let s = listFixture({ cell: true, parent: true, rich: true });
  s = apply(
    s,
    op(
      "B",
      1,
      planDelete(
        s,
        captureRange(s, { block: "ap", offset: 4 }, { block: "ap", offset: 4 }),
        "forward",
        op("B", 1),
      ).intent,
    ),
  );
  const r = captureRange(
      s,
      { block: "ap", offset: 2 },
      { block: "ap", offset: 2 },
    ),
    preview = previewColumnResize(s, "cell"),
    o = op("A", 1),
    p = planColumnResize(s, r, o, { preview, width: 350 }),
    anchor = anchorAt(s, "ap", 1, 3),
    n = apply(s, { ...o, intent: p.intent });
  validate(n);
  assert.equal(resolveAnchor(n, anchor).status, "exact");
  assert.deepEqual(
    copyCells(n, captureCellRange(n, "table", "cell", "other-cell")),
    copyCells(s, captureCellRange(s, "table", "cell", "other-cell")),
  );
  validate(undo(n, o.id));
});
test("duplicate, replay and decoded inverse restore exact widths and owner", () => {
  const room = new Room(tableFixture()),
    record = room.record,
    p = resize(record.state),
    receipt = room.accept(p.op);
  assert.equal(receipt.outcome, "accepted");
  assert.deepEqual(room.accept(p.op), receipt);
  assert.deepEqual(
    replay(record, { op: p.op, receipt }).state,
    room.record.state,
  );
  const back = undo(JSON.parse(JSON.stringify(room.record.state)), p.op.id);
  assert.deepEqual(back.nodes, record.state.nodes);
});
for (const defect of [
  "extra",
  "batch",
  "private inverse",
  "forged witness",
  "missing column",
])
  test(`untrusted ${defect} refuses resize`, () => {
    const room = new Room(tableFixture()),
      p = resize(room.record.state);
    if (defect === "extra") p.op.intent.values = [];
    if (defect === "batch")
      p.op.intent = { kind: "batch", intents: [p.op.intent] };
    if (defect === "private inverse")
      p.op.intent = p.state.effects[p.op.id].inverse;
    if (defect === "forged witness")
      p.op.intent.expected.widths[0].owner = "invented";
    if (defect === "missing column") p.op.intent.column = "unknown";
    const before = room.record.state;
    assert.equal(room.accept(p.op).outcome, "rejected");
    assert.deepEqual(room.record.state, before);
  });
