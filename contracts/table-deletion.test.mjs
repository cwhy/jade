// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import {
  previewTableDelete,
  planTableDelete,
  copyCells,
  planInsertRow,
  planInsertColumn,
  planDelete,
  planEnter,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  apply,
  validate,
  text,
  gapAt,
  resolveGap,
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
const range = (s, a = "cell", b = a) => captureCellRange(s, "table", a, b);
const rich = (s) => copyCells(s, range(s, "cell", "last-cell"));
const point = (s, id = "last") =>
  captureRange(s, { block: id, offset: 0 }, { block: id, offset: 0 });
const plan = (s, axis = "rows", a = "cell", b = a, actor = "A", seq = 1) => {
  const selection = range(s, a, b),
    preview = previewTableDelete(s, selection, axis),
    p = planTableDelete(s, selection, op(actor, seq), { preview });
  return { ...p, preview, op: op(actor, seq, p.intent) };
};
const undo = (s, target, seq = 2, actor = "A") =>
  apply(s, op(actor, seq, { kind: "undo", target }));
const shape = (s) => s.nodes.table.children.map((id) => s.nodes[id].children);
for (const [axis, a, b, rows, columns] of [
  ["rows", "cell", "code-cell", 1, 3],
  ["rows", "last-cell", "empty-cell", 1, 3],
  ["columns", "cell", "empty-cell", 2, 2],
  ["columns", "image-cell", "last-cell", 2, 1],
])
  test(`${axis} delete ${a}..${b}, exact content/anchors/geometry and Undo/Redo`, () => {
    const s = tableFixture(),
      before = JSON.stringify(s),
      anchor = anchorAt(s, a === "cell" ? "first" : "last", 0, 3),
      p = plan(s, axis, a, b);
    assert.equal(JSON.stringify(s), before);
    const n = apply(s, p.op);
    validate(n);
    assert.equal(shape(n).length, rows);
    assert.ok(shape(n).every((r) => r.length === columns));
    assert.equal(Object.keys(n.effects).length, 1);
    for (const cell of p.preview.range.cells.flat())
      assert.equal(n.nodes[cell].live, false);
    for (const id of shape(n).flat())
      assert.deepEqual(n.nodes[id], s.nodes[id]);
    const back = undo(n, p.op.id);
    validate(back);
    assert.deepEqual(shape(back), shape(s));
    assert.deepEqual(rich(back), rich(s));
    assert.equal(resolveAnchor(back, anchor).status, "exact");
    for (const cell of p.preview.range.cells.flat())
      assert.deepEqual(back.nodes[cell], s.nodes[cell]);
    const again = undo(back, "A:s:2", 3);
    validate(again);
    assert.deepEqual(shape(again), shape(n));
    assert.deepEqual(again.nodes.table.columnOrder, n.nodes.table.columnOrder);
  });
for (const axis of ["rows", "columns", "table"])
  test(`${axis} entire scope removes table and keeps one reusable editable paragraph`, () => {
    const s = tableFixture(),
      p = plan(s, axis, "cell", "last-cell"),
      n = apply(s, p.op),
      replacement = resolveGap(n, p.after).block;
    validate(n);
    assert.equal(n.nodes.table.live, false);
    assert.deepEqual(n.nodes.doc.children, [replacement]);
    assert.equal(n.nodes[replacement].type, "paragraph");
    assert.equal(text(n, replacement).length, 0);
    const back = undo(n, p.op.id);
    validate(back);
    assert.deepEqual(back.nodes.doc.children, ["table"]);
    assert.deepEqual(rich(back), rich(s));
    const again = undo(back, "A:s:2", 3);
    validate(again);
    assert.deepEqual(again.nodes.doc.children, [replacement]);
    assert.equal(text(again, replacement).length, 0);
  });
for (const axis of ["rows", "columns"])
  test(`deleting the final ${axis} after earlier deletion removes table; ordered Undo restores both`, () => {
    let s = tableFixture();
    const first = plan(
      s,
      axis,
      "cell",
      axis === "columns" ? "list-cell" : "cell",
    );
    s = apply(s, first.op);
    const last = s.nodes[s.nodes.table.children[0]].children[0],
      p = plan(s, axis, last, last, "A", 2);
    assert.equal(p.preview.whole, true);
    s = apply(s, p.op);
    assert.equal(s.nodes.table.live, false);
    s = undo(s, p.op.id, 3);
    s = undo(s, first.op.id, 4);
    validate(s);
    assert.deepEqual(rich(s), rich(tableFixture()));
  });
test("empty row preview is immediate while populated code/image/list scopes require review", () => {
  let s = tableFixture();
  const inserted = op("B", 1, planInsertRow(s, point(s), op("B", 1)).intent);
  s = apply(s, inserted);
  const row = s.nodes.table.children.at(-1),
    cell = s.nodes[row].children[0];
  assert.equal(plan(s, "rows", cell).preview.empty, true);
  for (const axis of ["rows", "columns", "table"])
    assert.equal(plan(tableFixture(), axis, "image-cell").preview.empty, false);
});
for (const what of ["text", "format", "width", "row", "column"])
  test(`changed ${what} invalidates exact delete preview with no partial mutation`, () => {
    const s = tableFixture(),
      p = plan(s, "columns", "cell");
    let n;
    if (what === "text")
      n = apply(
        s,
        op("B", 1, {
          kind: "insert",
          at: gapAt(s, "first", 1),
          text: "peer",
          marks: [],
        }),
      );
    if (what === "format")
      n = apply(
        s,
        op("B", 1, {
          kind: "format",
          ids: [text(s, "first")[0].id],
          property: "strong",
          value: "strong",
        }),
      );
    if (what === "width") {
      n = structuredClone(s);
      n.nodes.cell.colwidth = [300];
    }
    if (what === "row")
      n = apply(s, op("B", 1, planInsertRow(s, point(s), op("B", 1)).intent));
    if (what === "column")
      n = apply(
        s,
        op("B", 1, planInsertColumn(s, point(s), op("B", 1)).intent),
      );
    const before = JSON.stringify(n);
    assert.throws(() => apply(n, p.op), /changed/);
    assert.equal(JSON.stringify(n), before);
  });
for (const kind of ["insert", "delete", "format"])
  test(`late ${kind} in retired rich structure rejects payload; Undo restores original contribution`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      p = plan(s, "rows"),
      id = text(s, "first")[0].id,
      late = op(
        "B",
        1,
        kind === "insert"
          ? {
              kind: "insert",
              at: gapAt(s, "first", 1),
              text: "offline",
              marks: [],
            }
          : kind === "delete"
            ? { kind: "delete", ids: [id] }
            : {
                kind: "format",
                ids: [id],
                property: "strong",
                value: "strong",
              },
      );
    assert.equal(room.accept(p.op).outcome, "accepted");
    const before = room.record.state,
      r = room.accept(late);
    assert.equal(r.outcome, "rejected");
    assert.match(r.reason, /deleted/);
    assert.equal(r.bytes, JSON.stringify(late));
    assert.deepEqual(room.record.state, before);
    assert.equal(
      room.accept(op("A", 2, { kind: "undo", target: p.op.id })).outcome,
      "accepted",
    );
    assert.deepEqual(rich(room.record.state), rich(s));
  });
for (const axis of ["rows", "columns"])
  test(`${axis} deletion allows unrelated typing and independent same-axis insertion before restoration`, () => {
    let s = tableFixture();
    const p = plan(s, axis, "cell"),
      n = apply(s, p.op),
      peer = apply(
        n,
        op("B", 1, {
          kind: "insert",
          at: gapAt(n, "last", 0),
          text: "peer ",
          marks: [],
        }),
      ),
      inserted = apply(
        peer,
        op(
          "B",
          2,
          (axis === "rows"
            ? planInsertRow(peer, point(peer), op("B", 2))
            : planInsertColumn(peer, point(peer), op("B", 2))
          ).intent,
        ),
      );
    const back = undo(inserted, p.op.id);
    validate(back);
    assert.equal(
      text(back, "last")
        .map((a) => a.char)
        .join(""),
      "peer Last cell text",
    );
    assert.equal(shape(back).length, axis === "rows" ? 3 : 2);
    assert.equal(shape(back)[0].length, axis === "columns" ? 4 : 3);
  });
for (const axis of ["rows", "columns"])
  test(`${axis} restoration waits for perpendicular structural dependency, then succeeds`, () => {
    const s = tableFixture(),
      p = plan(s, axis, "cell"),
      n = apply(s, p.op),
      peer = op(
        "B",
        1,
        (axis === "rows"
          ? planInsertColumn(n, point(n), op("B", 1))
          : planInsertRow(n, point(n), op("B", 1))
        ).intent,
      ),
      changed = apply(n, peer),
      before = JSON.stringify(changed);
    assert.throws(() => undo(changed, p.op.id), /dependencies/);
    assert.equal(JSON.stringify(changed), before);
    const back = undo(undo(changed, peer.id, 2, "B"), p.op.id);
    validate(back);
    assert.deepEqual(rich(back), rich(s));
  });
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  for (const axis of ["rows", "columns"])
    test(`disjoint ${axis} delete ${order}; fresh previews and independent Undo retain order`, () => {
      const room = new Room(tableFixture()),
        original = room.record.state;
      for (const a of order) {
        const cell = a === "A" ? "cell" : "last-cell";
        const p = plan(room.record.state, axis, cell, cell, a);
        assert.equal(room.accept(p.op).outcome, "accepted");
      }
      for (const a of order.toReversed())
        assert.equal(
          room.accept(op(a, 2, { kind: "undo", target: `${a}:s:1` })).outcome,
          "accepted",
        );
      validate(room.record.state);
      assert.deepEqual(rich(room.record.state), rich(original));
    });
test("peer typing in the replacement paragraph blocks whole-table Undo until peer Undo", () => {
  const room = new Room(tableFixture()),
    p = plan(room.record.state, "table"),
    s = p.state,
    id = resolveGap(s, p.after).block;
  room.accept(p.op);
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(s, id, 0),
      text: "peer",
      marks: [],
    }),
  );
  const before = room.record.state;
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: p.op.id })).outcome,
    "rejected",
  );
  assert.deepEqual(room.record.state, before);
  room.accept(op("B", 2, { kind: "undo", target: "B:s:1" }));
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: p.op.id })).outcome,
    "accepted",
  );
  assert.deepEqual(rich(room.record.state), rich(tableFixture()));
});
for (const axis of ["rows", "columns", "table"])
  test(`${axis} Redo preserves new peer contribution after restoration`, () => {
    const s = tableFixture(),
      p = plan(s, axis),
      back = undo(apply(s, p.op), p.op.id),
      changed = apply(
        back,
        op("B", 1, {
          kind: "insert",
          at: gapAt(back, "first", 0),
          text: "peer",
          marks: [],
        }),
      ),
      before = JSON.stringify(changed);
    assert.throws(() => undo(changed, "A:s:2", 3), /content/);
    assert.equal(JSON.stringify(changed), before);
  });
for (const axis of ["rows", "columns", "table"])
  test(`${axis} duplicate, replay and decode retain deletion and exact restoration`, () => {
    const room = new Room(tableFixture()),
      record = room.record,
      p = plan(record.state, axis),
      receipt = room.accept(p.op);
    assert.equal(receipt.outcome, "accepted");
    assert.deepEqual(room.accept(p.op), receipt);
    assert.deepEqual(
      replay(record, { op: p.op, receipt }).state,
      room.record.state,
    );
    const back = undo(JSON.parse(JSON.stringify(room.record.state)), p.op.id);
    validate(back);
    assert.deepEqual(rich(back), rich(record.state));
  });
for (const axis of ["columns", "table"])
  test(`${axis} deletes and restores active projected rich list joins`, () => {
    let s = listFixture({ cell: true, parent: true, rich: true });
    s = apply(
      s,
      op(
        "B",
        1,
        planDelete(
          s,
          captureRange(
            s,
            { block: "ap", offset: 4 },
            { block: "ap", offset: 4 },
          ),
          "forward",
          op("B", 1),
        ).intent,
      ),
    );
    const original = copyCells(s, range(s, "cell", "other-cell")),
      p = plan(s, axis),
      n = apply(s, p.op);
    validate(n);
    const back = undo(n, p.op.id);
    validate(back);
    assert.deepEqual(
      copyCells(back, range(back, "cell", "other-cell")),
      original,
    );
    const again = undo(back, "A:s:2", 3);
    validate(again);
  });
for (const defect of ["axis", "extra", "batch", "lifecycle", "witness"])
  test(`malformed ${defect} refuses public destructive action`, () => {
    const room = new Room(tableFixture()),
      p = plan(room.record.state);
    if (defect === "axis") p.op.intent.axis = "unknown";
    if (defect === "extra") p.op.intent.targets = ["doc"];
    if (defect === "batch")
      p.op.intent = { kind: "batch", intents: [p.op.intent] };
    if (defect === "lifecycle") p.op.intent = p.state.effects[p.op.id].inverse;
    if (defect === "witness") p.op.intent.witness = {};
    const before = room.record.state;
    assert.equal(room.accept(p.op).outcome, "rejected");
    assert.deepEqual(room.record.state, before);
  });
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  test(`offline deletion against same geometry accepts first only: ${order}`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      ops = {
        A: plan(s, "columns", "cell", "cell", "A").op,
        B: plan(s, "rows", "last-cell", "last-cell", "B").op,
      };
    assert.equal(room.accept(ops[order[0]]).outcome, "accepted");
    const before = room.record.state,
      r = room.accept(ops[order[1]]);
    assert.equal(r.outcome, "rejected");
    assert.equal(r.bytes, JSON.stringify(ops[order[1]]));
    assert.deepEqual(room.record.state, before);
  });
for (const axis of ["rows", "columns", "table"])
  test(`own Enter and Undo before ${axis} deletion does not strand restoration`, () => {
    let s = tableFixture();
    s = apply(
      s,
      op(
        "B",
        1,
        planEnter(
          s,
          captureRange(
            s,
            { block: "first", offset: 4 },
            { block: "first", offset: 4 },
          ),
          op("B", 1),
        ).intent,
      ),
    );
    s = undo(s, "B:s:1", 2, "B");
    const original = rich(s),
      p = plan(s, axis),
      back = undo(apply(s, p.op), p.op.id);
    validate(back);
    assert.deepEqual(rich(back), original);
  });
test("whole-table restoration preserves a new sibling paragraph but never deletes its content", () => {
  let s = tableFixture();
  const p = plan(s, "table"),
    n = apply(s, p.op),
    id = resolveGap(n, p.after).block;
  const entered = apply(
    n,
    op(
      "B",
      1,
      planEnter(
        n,
        captureRange(n, { block: id, offset: 0 }, { block: id, offset: 0 }),
        op("B", 1),
      ).intent,
    ),
  );
  const tail = entered.nodes.doc.children.at(-1),
    typed = apply(
      entered,
      op("B", 2, {
        kind: "insert",
        at: gapAt(entered, tail, 0),
        text: "keep sibling",
        marks: [],
      }),
    ),
    back = undo(typed, p.op.id);
  validate(back);
  assert.deepEqual(back.nodes.doc.children, ["table", tail]);
  assert.equal(
    text(back, tail)
      .map((a) => a.char)
      .join(""),
    "keep sibling",
  );
  assert.deepEqual(rich(back), rich(s));
});
for (const mutation of ["live marker", "wrong token", "live replica"])
  test(`codec validation rejects ${mutation}`, () => {
    const s = plan(tableFixture()).state,
      n = JSON.parse(JSON.stringify(s));
    if (mutation === "live marker") n.nodes.first.live = true;
    if (mutation === "wrong token") n.nodes.first.structureDeletedBy = "wrong";
    if (mutation === "live replica")
      n.replicas[n.nodes.first.text].retired = false;
    assert.throws(() => validate(n), /deleted|Deleted/);
  });
for (const axis of ["rows", "columns", "table"])
  test(`offline original-position edit arriving after ${axis} Undo uses restored identity`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      late = op("B", 1, {
        kind: "insert",
        at: gapAt(s, "first", 4),
        text: "LATE",
        marks: [],
      }),
      p = plan(s, axis);
    room.accept(p.op);
    room.accept(op("A", 2, { kind: "undo", target: p.op.id }));
    assert.equal(room.accept(late).outcome, "accepted");
    assert.equal(
      text(room.record.state, "first")
        .map((a) => a.char)
        .join(""),
      "FirsLATEt cell text",
    );
    assert.equal(
      room.accept(op("B", 2, { kind: "undo", target: late.id })).outcome,
      "accepted",
    );
    assert.deepEqual(rich(room.record.state), rich(s));
  });
