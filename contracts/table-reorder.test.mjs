// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import {
  previewTableMove,
  planTableMove,
  planInsertRow,
  planInsertColumn,
  previewTableDelete,
  planTableDelete,
  previewColumnResize,
  planColumnResize,
  planDelete,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  apply,
  validate,
  anchorAt,
  resolveAnchor,
  gapAt,
  text,
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
const range = (s, cell = "cell", end = cell) =>
  captureCellRange(s, "table", cell, end);
const point = (s) =>
  captureRange(s, { block: "first", offset: 1 }, { block: "first", offset: 1 });
const move = (
  s,
  axis = "columns",
  cell = "cell",
  before = null,
  a = "A",
  n = 1,
  end = cell,
) => {
  const selection = range(s, cell, end),
    preview = previewTableMove(s, selection, axis),
    p = planTableMove(s, selection, op(a, n), { preview, before });
  return { ...p, op: op(a, n, p.intent), preview };
};
const order = (s, axis) => previewTableMove(s, range(s), axis).expected.order;
const undo = (s, target, a = "A", n = 2) =>
  apply(s, op(a, n, { kind: "undo", target }));
const contents = (s) =>
  Object.fromEntries(
    Object.entries(s.nodes).filter(
      ([, n]) => !["table", "row"].includes(n.type),
    ),
  );
for (const axis of ["rows", "columns"])
  for (const mode of ["end", "start", "group"])
    test(`move ${axis} ${mode} preserves rich identity, marks, replicas, anchors and exact live order through Undo/Redo`, () => {
      const s = tableFixture(),
        ids = order(s, axis),
        last = axis === "rows" ? "empty-cell" : "code-cell",
        p =
          mode === "start"
            ? move(s, axis, last, ids[0])
            : move(
                s,
                axis,
                "cell",
                null,
                "A",
                1,
                mode === "group" && axis === "columns" ? "list-cell" : "cell",
              ),
        original = JSON.stringify(s),
        a = anchorAt(s, "first", 1, 4);
      assert.equal(JSON.stringify(s), original);
      const n = apply(s, p.op);
      validate(n);
      assert.deepEqual(contents(n), contents(s));
      assert.deepEqual(n.replicas, s.replicas);
      assert.deepEqual(n.runs, s.runs);
      assert.equal(resolveAnchor(n, a).status, "exact");
      assert.equal(
        n.nodes.table[axis === "rows" ? "rowOrderOwner" : "columnOrderOwner"],
        p.op.id,
      );
      const back = undo(n, p.op.id);
      assert.deepEqual(order(back, axis), ids);
      assert.deepEqual(contents(back), contents(s));
      assert.deepEqual(
        order(undo(back, "A:s:2", "A", 3), axis),
        order(n, axis),
      );
    });
for (const axis of ["rows", "columns"])
  test(`${axis} no-op emits no operation`, () => {
    const s = tableFixture(),
      ids = order(s, axis),
      p = move(s, axis, "cell", ids[1]);
    assert.equal(p.intent, null);
    assert.equal(p.state, s);
  });
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  test(`same-axis stale moves ${arrival} never overwrite first ordering`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      ids = order(s, "columns"),
      ops = {
        A: move(s).op,
        B: move(s, "columns", "code-cell", ids[0], "B").op,
      };
    assert.equal(room.accept(ops[arrival[0]]).outcome, "accepted");
    const before = room.record.state;
    const rejection = room.accept(ops[arrival[1]]);
    assert.equal(rejection.outcome, "rejected");
    assert.equal(rejection.bytes, JSON.stringify(ops[arrival[1]]));
    assert.deepEqual(room.record.state, before);
  });
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const inverse of [
    ["A", "B"],
    ["B", "A"],
  ])
    test(`row/column moves ${arrival}, Undo ${inverse} commute`, () => {
      const room = new Room(tableFixture()),
        s = room.record.state,
        ops = {
          A: move(s, "rows").op,
          B: move(s, "columns", "cell", null, "B").op,
        };
      for (const a of arrival)
        assert.equal(room.accept(ops[a]).outcome, "accepted");
      for (const a of inverse)
        assert.equal(
          room.accept(op(a, 2, { kind: "undo", target: ops[a].id })).outcome,
          "accepted",
        );
      for (const axis of ["rows", "columns"])
        assert.deepEqual(order(room.record.state, axis), order(s, axis));
      assert.deepEqual(contents(room.record.state), contents(s));
    });
test("ABA order ownership blocks stale Undo even when order returns to same permutation", () => {
  let s = move(tableFixture()).state;
  const ids = order(s, "columns");
  s = move(s, "columns", "code-cell", ids[0], "B", 1).state;
  s = move(s, "columns", "code-cell", order(s, "columns")[2], "B", 2).state;
  assert.deepEqual(
    order(s, "columns"),
    order(move(tableFixture()).state, "columns"),
  );
  const before = JSON.stringify(s);
  assert.throws(() => undo(s, "A:s:1"), /order changed/);
  assert.equal(JSON.stringify(s), before);
  s = undo(undo(s, "B:s:2", "B", 3), "B:s:1", "B", 4);
  s = undo(s, "A:s:1");
  assert.deepEqual(order(s, "columns"), order(tableFixture(), "columns"));
});
test("peer text and widths survive pending move and its inverse", () => {
  const s = tableFixture(),
    p = move(s),
    typed = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "first", 1),
        text: "中",
        marks: ["strong"],
      }),
    ),
    width = planColumnResize(typed, point(typed), op("B", 2), {
      preview: previewColumnResize(typed, "cell"),
      width: 350,
    }),
    n = undo(apply(width.state, p.op), p.op.id);
  assert.equal(
    text(n, "first")
      .map((x) => x.char)
      .join(""),
    "F中irst cell text",
  );
  assert.deepEqual(n.nodes.cell.colwidth, [350]);
  assert.equal(n.nodes.cell.widthOwner, "B:s:2");
});
for (const axis of ["rows", "columns"])
  test(`${axis} insertion blocks stale move / Undo and its removal enables Undo again`, () => {
    const s = tableFixture(),
      p = move(s, axis),
      insert = (state) =>
        (axis === "rows"
          ? planInsertRow(state, point(state), op("B", 1))
          : planInsertColumn(state, point(state), op("B", 1))
        ).intent;
    const born = apply(s, op("B", 1, insert(s)));
    assert.throws(() => apply(born, p.op), /order changed/);
    let n = apply(p.state, op("B", 1, insert(p.state)));
    assert.throws(() => undo(n, p.op.id), /order changed/);
    n = undo(n, "B:s:1", "B");
    n = undo(n, p.op.id);
    validate(n);
    assert.deepEqual(order(n, axis), order(s, axis));
  });
for (const axis of ["rows", "columns"])
  test(`peer move prevents Undo of empty ${axis} birth until peer move is undone`, () => {
    const s = tableFixture(),
      birth =
        axis === "rows"
          ? planInsertRow(s, point(s), op("A", 1))
          : planInsertColumn(s, point(s), op("A", 1)),
      n = birth.state || apply(s, op("A", 1, birth.intent)),
      p = move(n, axis, "cell", null, "B");
    assert.throws(() => undo(p.state, "A:s:1"), /order changed/);
    const back = undo(undo(p.state, "B:s:1", "B"), "A:s:1");
    assert.deepEqual(order(back, axis), order(s, axis));
  });
for (const axis of ["rows", "columns"])
  test(`deleted ${axis} target invalidates move without touching its payload`, () => {
    const s = tableFixture(),
      p = move(s, axis),
      r = range(s),
      d = planTableDelete(s, r, op("B", 1), {
        preview: previewTableDelete(s, r, axis),
      }).state;
    assert.throws(() => apply(d, p.op), /order changed/);
  });
test("retired column slots survive move and inverse without changing deletion restore", () => {
  let s = tableFixture();
  const r = range(s, "list-cell"),
    deleted = planTableDelete(s, r, op("B", 1), {
      preview: previewTableDelete(s, r, "columns"),
    }).state,
    p = move(deleted),
    n = undo(p.state, p.op.id),
    back = undo(n, "B:s:1", "B");
  assert.deepEqual(order(back, "columns"), order(s, "columns"));
  assert.deepEqual(contents(back), contents(s));
});
test("projected joined list, its character identities and anchor survive a column move", () => {
  let s = listFixture({ cell: true, parent: true, rich: true });
  const r = captureRange(
    s,
    { block: "ap", offset: 4 },
    { block: "ap", offset: 4 },
  );
  s = apply(s, op("B", 1, planDelete(s, r, "forward", op("B", 1)).intent));
  const a = anchorAt(s, "ap", 1, 3),
    p = move(s);
  validate(p.state);
  assert.equal(resolveAnchor(p.state, a).status, "exact");
  assert.deepEqual(p.state.replicas, s.replicas);
  validate(undo(p.state, p.op.id));
});
test("decoded replay, duplicate receipt and owned inverse preserve exact result", () => {
  const room = new Room(tableFixture()),
    record = room.record,
    p = move(record.state),
    receipt = room.accept(p.op);
  assert.equal(receipt.outcome, "accepted");
  assert.deepEqual(room.accept(p.op), receipt);
  assert.deepEqual(
    replay(record, { op: p.op, receipt }).state,
    room.record.state,
  );
  const n = undo(JSON.parse(JSON.stringify(room.record.state)), p.op.id);
  assert.deepEqual(order(n, "columns"), order(record.state, "columns"));
});
for (const defect of [
  "extra",
  "batch",
  "private",
  "axis",
  "target",
  "duplicate",
  "noncontiguous",
  "destination",
  "witness",
])
  test(`malformed move ${defect} rejected atomically`, () => {
    const room = new Room(tableFixture()),
      p = move(room.record.state),
      i = p.op.intent;
    if (defect === "extra") i.copy = true;
    if (defect === "batch") p.op.intent = { kind: "batch", intents: [i] };
    if (defect === "private") p.op.intent = p.state.effects[p.op.id].inverse;
    if (defect === "axis") i.axis = "table";
    if (defect === "target") i.targets = ["unknown"];
    if (defect === "duplicate") i.targets = [i.targets[0], i.targets[0]];
    if (defect === "noncontiguous")
      i.targets = [i.expected.order[0], i.expected.order[2]];
    if (defect === "destination") i.before = i.targets[0];
    if (defect === "witness") i.expected.owner = "forged";
    const before = room.record.state;
    assert.equal(room.accept(p.op).outcome, "rejected");
    assert.deepEqual(room.record.state, before);
  });

for (const node of ["row", "cell", "table"])
  test(`raw tree placement cannot bypass table move admission for ${node}`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      parent = Object.values(s.nodes).find((n) => n.children?.includes(node));
    const receipt = room.accept(
      op("A", 1, {
        kind: "batch",
        intents: [
          {
            kind: "treePlace",
            node,
            from: parent.id,
            parent: parent.id,
            before: null,
            expected: null,
          },
        ],
      }),
    );
    assert.equal(receipt.outcome, "rejected");
    assert.deepEqual(room.record.state, s);
  });
test("two adjacent rich rows move together past a third row and Undo restores identities", () => {
  const base = tableFixture(),
    r = captureRange(
      base,
      { block: "last", offset: 0 },
      { block: "last", offset: 0 },
    ),
    s = planInsertRow(base, r, op("B", 1)).state,
    p = move(s, "rows", "cell", null, "A", 1, "empty-cell");
  assert.equal(p.preview.targets.length, 2);
  assert.deepEqual(p.state.nodes.table.children, [
    s.nodes.table.children[2],
    "row",
    "row-two",
  ]);
  const back = undo(p.state, p.op.id);
  assert.deepEqual(back.nodes.table.children, s.nodes.table.children);
  assert.deepEqual(contents(back), contents(s));
});
