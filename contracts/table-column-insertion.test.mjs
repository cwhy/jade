// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  planInsertColumn,
  planInsertRow,
  planEnter,
  planPasteCells,
  previewCellPaste,
  copyCells,
} from "@cwhy/jade-core/commands";
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
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { immutable } from "@cwhy/jade-core/immutability";
import { Room } from "@cwhy/jade-collaboration/room";
import { Client } from "@cwhy/jade-collaboration/client";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  stream: "cols",
  seq,
  id: `${actor}:cols:${seq}`,
  epoch: 1,
  intent,
});
const range = (s, block = "first", offset = 0) =>
  captureRange(s, { block, offset }, { block, offset });
const insertion = (
  s,
  actor = "A",
  block = "first",
  side = "right",
  seq = 1,
) => {
  const o = op(actor, seq);
  return {
    ...o,
    intent: planInsertColumn(s, range(s, block), o, { side }).intent,
  };
};
const undo = (s, target, seq = 2, actor = "A") =>
  immutable(apply(s, op(actor, seq, { kind: "undo", target })));
const values = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const column = (s, owner = "A:cols:1") =>
  Object.values(s.nodes.table.columns).find((c) => c.owner === owner);
const birthBlocks = (s, owner) =>
  Object.values(column(s, owner).cells).map((id) => s.nodes[id].children[0]);
for (const side of ["left", "right"])
  for (const block of ["first", "code", "last"])
    test(`column ${side} of ${block} preserves rich neighbors, widths and active-row focus`, () => {
      const s = immutable(tableFixture()),
        o = op("A", 1),
        p = planInsertColumn(s, range(s, block), o, { side }),
        n = immutable(apply(s, { ...o, intent: p.intent }));
      validate(n);
      const focus = resolveGap(n, p.after),
        row = block === "last" ? "row-two" : "row";
      assert.equal(n.nodes[column(n).cells[row]].children[0], focus.block);
      assert.equal(focus.offset, 0);
      for (const [id, node] of Object.entries(s.nodes))
        if (!["table", "row", "row-two"].includes(id))
          assert.equal(n.nodes[id], node);
      for (const r of s.nodes.table.children) {
        assert.equal(n.nodes[r].children.length, 4);
        const added = column(n).cells[r];
        assert.deepEqual(n.nodes[added].colwidth, [200]);
        assert.equal(values(n, n.nodes[added].children[0]), "");
        assert.deepEqual(
          n.nodes[r].children.filter((id) => id !== added),
          s.nodes[r].children,
        );
      }
    });
test("rectangle insertion uses focus cell and retains old content", () => {
  const s = tableFixture(),
    r = captureCellRange(s, "table", "cell", "last-cell"),
    o = op("A", 1),
    p = planInsertColumn(s, r, o);
  assert.equal(p.intent.before, null);
  assert.equal(
    resolveGap(p.state, p.after).block,
    p.state.nodes[column(p.state).cells["row-two"]].children[0],
  );
});
test("column Undo/Redo restores the same cells, replica and empty-boundary identities", () => {
  const s = tableFixture(),
    o = insertion(s),
    n = apply(s, o),
    blocks = birthBlocks(n),
    g = gapAt(n, blocks[0], 0),
    gone = undo(n, o.id);
  validate(gone);
  assert.deepEqual(gone.nodes.row.children, s.nodes.row.children);
  assert.throws(() => resolveGap(gone, g), /no longer live/);
  const back = undo(gone, "A:cols:2", 3);
  validate(back);
  assert.deepEqual(back.nodes.row.children, n.nodes.row.children);
  assert.deepEqual(resolveGap(back, g), { block: blocks[0], offset: 0 });
});
test("own typing, Undo typing, column Undo/Redo, text Redo preserve original character identity", () => {
  let s = apply(tableFixture(), insertion(tableFixture()));
  const block = birthBlocks(s)[0];
  s = apply(
    s,
    op("A", 2, {
      kind: "insert",
      at: gapAt(s, block, 0),
      text: "note",
      marks: ["em"],
    }),
  );
  const a = anchorAt(s, block, 0, 4);
  s = undo(s, "A:cols:2", 3);
  s = undo(s, "A:cols:1", 4);
  s = undo(s, "A:cols:4", 5);
  s = undo(s, "A:cols:3", 6);
  assert.equal(values(s, block), "note");
  assert.equal(resolveAnchor(s, a).status, "exact");
});
test("column birth Undo follows logical paragraphs across own Enter/Undo replica generations", () => {
  let s = tableFixture();
  s = apply(s, insertion(s));
  const block = birthBlocks(s)[0],
    original = s.nodes[block].text;
  s = apply(s, op("A", 2, planEnter(s, range(s, block), op("A", 2)).intent));
  s = undo(s, "A:cols:2", 3);
  assert.notEqual(s.nodes[block].text, original);
  s = undo(s, "A:cols:1", 4);
  validate(s);
  assert.equal(s.nodes[block].live, false);
  s = undo(s, "A:cols:4", 5);
  assert.equal(values(s, block), "");
  validate(s);
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
      test(`concurrent columns ${arrivals}, Undo ${undos}, Redo ${redos}`, () => {
        const initial = tableFixture(),
          ops = { A: insertion(initial, "A"), B: insertion(initial, "B") };
        let s = initial;
        for (const a of arrivals) s = immutable(apply(s, ops[a]));
        const saved = [...s.nodes.row.children];
        for (const a of undos) s = undo(s, ops[a].id, 2, a);
        assert.deepEqual(s.nodes.row.children, initial.nodes.row.children);
        s = JSON.parse(JSON.stringify(s));
        for (const a of redos) s = undo(s, `${a}:cols:2`, 3, a);
        assert.deepEqual(s.nodes.row.children, saved);
        validate(s);
      });
for (const arrival of ["peer-first", "undo-first"])
  test(`column Undo and peer input race ${arrival} preserves contribution or rejects late payload`, () => {
    const room = new Room(tableFixture());
    room.accept(insertion(room.record.state));
    const s = room.record.state,
      block = birthBlocks(s)[0],
      typing = op("B", 1, {
        kind: "insert",
        at: gapAt(s, block, 0),
        text: "peer",
        marks: [],
      }),
      remove = op("A", 2, { kind: "undo", target: "A:cols:1" });
    for (const o of arrival === "peer-first"
      ? [typing, remove]
      : [remove, typing])
      room.accept(o);
    validate(room.record.state);
    if (arrival === "peer-first") {
      assert.equal(room.record.receipts[remove.id].outcome, "rejected");
      assert.equal(values(room.record.state, block), "peer");
    } else {
      assert.equal(room.record.receipts[typing.id].outcome, "rejected");
      assert.equal(
        room.record.receipts[typing.id].bytes,
        JSON.stringify(typing),
      );
      assert.equal(room.record.state.nodes[block].live, false);
    }
  });
test("blocked optimistic Undo restores history after peer acknowledgement", () => {
  const room = new Room(tableFixture()),
    c = new Client("A", "cols", room.snapshot());
  c.prepare(planInsertColumn(c.state, range(c.state), op("A", 1)).intent);
  room.accept(c.pending[0]);
  c.receive(room.snapshot());
  const block = birthBlocks(c.state)[0];
  c.undo();
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, block, 0),
      text: "peer",
      marks: [],
    }),
  );
  room.accept(c.pending[0]);
  c.receive(room.snapshot());
  assert.deepEqual(
    c.undoStack.map((x) => x.ids),
    [["A:cols:1"]],
  );
  assert.equal(c.recovery.length, 1);
  assert.equal(values(c.state, block), "peer");
});
for (const first of ["row", "column"])
  for (const side of ["left", "right"])
    test(`independent row/column insert ${first}-first, column ${side}, preserves planned row caret`, () => {
      const s = tableFixture(),
        r = op("B", 1),
        rp = planInsertRow(s, range(s, "code"), r, { side: "below" }),
        c = insertion(s, "A", "first", side),
        rowOp = { ...r, intent: rp.intent },
        room = new Room(s);
      for (const o of first === "row" ? [rowOp, c] : [c, rowOp])
        assert.equal(room.accept(o).outcome, "accepted");
      const n = room.record.state;
      validate(n);
      assert.equal(n.nodes.table.children.length, 3);
      assert.ok(
        n.nodes.table.children.every((id) => n.nodes[id].children.length === 4),
      );
      const row = n.nodes["B:cols:1:row"];
      assert.equal(
        n.nodes[row.children.at(-1)].children[0],
        "B:cols:1:paragraph:2",
      );
      assert.equal(resolveGap(n, rp.after).block, "B:cols:1:paragraph:2");
    });
test("row inserted after column blocks column removal until the row is undone; redo dependencies remain explicit", () => {
  const room = new Room(tableFixture());
  room.accept(insertion(room.record.state));
  const s = room.record.state,
    r = op("B", 1);
  room.accept({ ...r, intent: planInsertRow(s, range(s, "first"), r).intent });
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: "A:cols:1" })).outcome,
    "rejected",
  );
  assert.equal(
    room.accept(op("B", 2, { kind: "undo", target: "B:cols:1" })).outcome,
    "accepted",
  );
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: "A:cols:1" })).outcome,
    "accepted",
  );
  assert.equal(
    room.accept(op("B", 3, { kind: "undo", target: "B:cols:2" })).outcome,
    "rejected",
  );
  assert.equal(
    room.accept(op("A", 4, { kind: "undo", target: "A:cols:3" })).outcome,
    "accepted",
  );
  assert.equal(
    room.accept(op("B", 4, { kind: "undo", target: "B:cols:2" })).outcome,
    "accepted",
  );
  validate(room.record.state);
});
test("retired row at first column insertion can be restored after column Undo", () => {
  const room = new Room(tableFixture()),
    r = op("B", 1);
  room.accept({
    ...r,
    intent: planInsertRow(room.record.state, range(room.record.state), r)
      .intent,
  });
  room.accept(op("B", 2, { kind: "undo", target: r.id }));
  room.accept(insertion(room.record.state));
  assert.equal(
    room.accept(op("B", 3, { kind: "undo", target: "B:cols:2" })).outcome,
    "rejected",
  );
  room.accept(op("A", 2, { kind: "undo", target: "A:cols:1" }));
  assert.equal(
    room.accept(op("B", 4, { kind: "undo", target: "B:cols:2" })).outcome,
    "accepted",
  );
  validate(room.record.state);
});
test("rich paste in a born column prevents removal until that paste is undone", () => {
  let s = tableFixture();
  const f = copyCells(s, captureCellRange(s, "table", "image-cell"));
  s = apply(s, insertion(s));
  const target = column(s).cells.row,
    r = captureCellRange(s, "table", target),
    o = op("A", 2),
    p = planPasteCells(s, r, o, { preview: previewCellPaste(s, r, f) });
  s = apply(s, { ...o, intent: p.intent });
  assert.throws(() => undo(s, "A:cols:1", 3), /structural/);
  s = undo(s, "A:cols:2", 3);
  s = undo(s, "A:cols:1", 4);
  validate(s);
  assert.equal(s.nodes.image.live, true);
});
test("duplicate receipt, decode and replay retain column lifecycle", () => {
  const room = new Room(tableFixture()),
    start = room.record,
    o = insertion(start.state),
    receipt = room.accept(o);
  assert.deepEqual(replay(start, { op: o, receipt }), room.record);
  const next = new Room(null, JSON.parse(JSON.stringify(room.record)));
  assert.deepEqual(next.accept(o), receipt);
  assert.equal(
    next.accept(op("A", 2, { kind: "undo", target: o.id })).outcome,
    "accepted",
  );
  validate(next.record.state);
});
for (const kind of [
  "missing-template",
  "retired-boundary",
  "unknown-field",
  "batch",
  "private-lifecycle",
])
  test(`column admission rejects ${kind}`, () => {
    const s = tableFixture(),
      o = insertion(s);
    if (kind === "missing-template") o.intent.template = "missing";
    if (kind === "retired-boundary") o.intent.before = "missing";
    if (kind === "unknown-field") o.intent.width = 999;
    if (kind === "batch") o.intent = { kind: "batch", intents: [o.intent] };
    if (kind === "private-lifecycle")
      o.intent = { kind: "tableColumnActive", table: "table" };
    const before = JSON.stringify(s);
    assert.throws(() => apply(s, o));
    assert.equal(JSON.stringify(s), before);
  });
for (const mutation of [
  "duplicate-order",
  "missing-cell",
  "foreign-row",
  "missing-column",
  "retired-live-cell",
])
  test(`decoded column metadata rejects ${mutation}`, () => {
    const base = tableFixture(),
      s = structuredClone(apply(base, insertion(base))),
      t = s.nodes.table,
      id = t.columnOrder[1];
    if (mutation === "duplicate-order") t.columnOrder.push(id);
    if (mutation === "missing-cell") delete t.columns[id].cells.row;
    if (mutation === "foreign-row") t.columns[id].cells.unknown = "cell";
    if (mutation === "missing-column") delete t.columns[id];
    if (mutation === "retired-live-cell") {
      t.columns[id].active = false;
      t.columns[id].retiredBy = "bad";
    }
    assert.throws(() => validate(s));
  });

test("column width copies the chosen neighbor while all existing dimensions stay unchanged", () => {
  const s = tableFixture();
  s.nodes.cell.colwidth = [170];
  s.nodes["empty-cell"].colwidth = [170];
  s.nodes["list-cell"].colwidth = [310];
  s.nodes["image-cell"].colwidth = [310];
  const n = apply(s, insertion(s, "A", "list-text", "left"));
  for (const row of ["row", "row-two"])
    assert.deepEqual(n.nodes[column(n).cells[row]].colwidth, [310]);
  for (const id of [
    "cell",
    "empty-cell",
    "list-cell",
    "image-cell",
    "code-cell",
    "last-cell",
  ])
    assert.deepEqual(n.nodes[id].colwidth, s.nodes[id].colwidth);
});
test("invalid width and merged-grid template reject atomically", () => {
  for (const kind of ["width", "span"]) {
    const s = tableFixture();
    if (kind === "width") s.nodes.cell.colwidth = [-1];
    else s.nodes.cell.colspan = 2;
    const before = JSON.stringify(s);
    assert.throws(() => insertion(s));
    assert.equal(JSON.stringify(s), before);
  }
});

import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { planDelete } from "@cwhy/jade-core/commands";
test("column insertion preserves supported projected list joins and anchors; mixed-attachment join stays guarded", () => {
  const blocked = listFixture({ cell: true, rich: true });
  assert.throws(
    () => planDelete(blocked, range(blocked, "ap", 4), "forward", op("B", 1)),
    /not qualified/,
  );
  let s = listFixture({ cell: true });
  const join = op(
    "B",
    1,
    planDelete(s, range(s, "ap", 4), "forward", op("B", 1)).intent,
  );
  s = apply(s, join);
  assert.equal(Object.keys(s.listJoins).length, 1);
  const r = captureCellRange(s, "table", "cell", "other-cell"),
    before = copyCells(s, r),
    anchor = anchorAt(s, "ap", 1, 2),
    o = insertion(s, "A", "ap"),
    n = apply(s, o);
  assert.equal(resolveAnchor(n, anchor).status, "exact");
  const back = undo(n, o.id);
  assert.deepEqual(copyCells(back, r), before);
  assert.equal(resolveAnchor(back, anchor).status, "exact");
  assert.equal(Object.keys(back.listJoins).length, 1);
  validate(back);
});
