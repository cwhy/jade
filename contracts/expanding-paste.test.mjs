// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  copyCells,
  previewCellPaste,
  planPasteCells,
  planInsertRow,
  planInsertColumn,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import { apply, validate, gapAt, text } from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
// Retained inactive contributions support Redo; assert they are all inactive
// before comparing the exact original node identity, properties and children.
const restoredNode = (n) => {
  const { tableFormats, ...node } = n;
  if (tableFormats) assert.ok(tableFormats.layers.every((l) => !l.active));
  return node;
};

const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s, a = "last-cell", b = a) => captureCellRange(s, "table", a, b);
const rich = (s, a = "cell", b = "last-cell") => copyCells(s, range(s, a, b));
function plan(s, f = rich(s), target = "last-cell", a = "A", n = 1) {
  const r = range(s, target),
    preview = previewCellPaste(s, r, f, "expand"),
    p = planPasteCells(s, r, op(a, n), { preview });
  return { ...p, preview, op: op(a, n, p.intent) };
}
const undo = (s, target, n = 2, a = "A") =>
  apply(s, op(a, n, { kind: "undo", target }));
const shape = (s) => s.nodes.table.children.map((id) => s.nodes[id].children);
for (const [name, source, target, rows, cols] of [
  ["columns", ["cell", "code-cell"], "last-cell", 2, 5],
  ["rows", ["cell", "empty-cell"], "empty-cell", 3, 3],
  ["both", ["cell", "last-cell"], "last-cell", 3, 5],
  ["many rows", [null, null], "last-cell", 5, 6],
])
  test(`atomic ${name} expansion, rich content, widths, identities and one Undo/Redo`, () => {
    const s = tableFixture();
    const f = source[0]
      ? rich(s, ...source)
      : {
          version: 1,
          rows: Array.from({ length: 4 }, () =>
            Array.from(
              { length: 4 },
              () => rich(s, "list-cell", "list-cell").rows[0][0],
            ),
          ),
        };
    const before = JSON.stringify(s),
      p = plan(s, f, target);
    assert.equal(JSON.stringify(s), before);
    assert.equal(p.preview.expansion.rows, rows - 2);
    assert.equal(p.preview.expansion.columns, cols - 3);
    const n = apply(s, p.op);
    validate(n);
    assert.equal(n.revision, s.revision + 1);
    assert.equal(Object.keys(n.effects).length, 1);
    assert.equal(shape(n).length, rows);
    assert.ok(shape(n).every((r) => r.length === cols));
    assert.deepEqual(
      f.version === 1
        ? { version: 1, rows: copyCells(n, p.selection).rows }
        : copyCells(n, p.selection),
      f,
    );
    for (const id of shape(s).flat())
      assert.deepEqual(n.nodes[id].colwidth, s.nodes[id].colwidth);
    const back = undo(n, p.op.id);
    validate(back);
    assert.deepEqual(shape(back), shape(s));
    assert.deepEqual(rich(back), rich(s));
    for (const id of shape(s).flat())
      assert.deepEqual(restoredNode(back.nodes[id]), s.nodes[id]);
    const again = undo(back, "A:s:2", 3);
    validate(again);
    assert.deepEqual(shape(again), shape(n));
    assert.deepEqual(
      f.version === 1
        ? { version: 1, rows: copyCells(again, p.selection).rows }
        : copyCells(again, p.selection),
      f,
    );
  });
test("review includes old targets, new cells and exact coordinates without mutation", () => {
  const s = tableFixture(),
    f = rich(s),
    p = plan(s, f, "image-cell");
  assert.equal(p.preview.expansion.top, 1);
  assert.equal(p.preview.expansion.left, 1);
  assert.deepEqual(p.preview.outside, ["last-cell"]);
  assert.deepEqual(p.preview.range.cells[0], ["image-cell", "last-cell", null]);
  assert.equal(p.preview.range.cells[1].filter((x) => x === null).length, 3);
  assert.deepEqual(
    p.preview.before.rows[0][1],
    rich(s, "last-cell", "last-cell").rows[0][0],
  );
});
for (const what of ["text", "format", "row", "column", "width"])
  test(`stale ${what} rejects without partial expansion`, () => {
    const s = tableFixture(),
      p = plan(s);
    let n;
    if (what === "text")
      n = apply(
        s,
        op("B", 1, {
          kind: "insert",
          at: gapAt(s, "last", 0),
          text: "peer ",
          marks: [],
        }),
      );
    if (what === "format")
      n = apply(
        s,
        op("B", 1, {
          kind: "format",
          ids: [text(s, "last")[0].id],
          property: "strong",
          value: "strong",
        }),
      );
    if (what === "width") {
      n = structuredClone(s);
      n.nodes.cell.colwidth = [333];
    }
    if (what === "row" || what === "column") {
      const r = captureRange(
        s,
        { block: "first", offset: 0 },
        { block: "first", offset: 0 },
      );
      n = apply(
        s,
        op(
          "B",
          1,
          (what === "row"
            ? planInsertRow(s, r, op("B", 1), { side: "below" })
            : planInsertColumn(s, r, op("B", 1), { side: "right" })
          ).intent,
        ),
      );
    }
    const before = JSON.stringify(n);
    assert.throws(() => apply(n, p.op), /changed/);
    assert.equal(JSON.stringify(n), before);
  });
test("unrelated peer edits survive atomic expansion and Undo", () => {
  const s = tableFixture(),
    p = plan(s),
    n = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "first", 0),
        text: "peer ",
        marks: [],
      }),
    ),
    back = undo(apply(n, p.op), p.op.id);
  assert.equal(
    text(back, "first")
      .map((a) => a.char)
      .join(""),
    "peer First cell text",
  );
  assert.deepEqual(shape(back), shape(s));
});
for (const where of ["pasted", "new outside rectangle"])
  test(`peer edit in ${where} blocks whole Undo until its own Undo`, () => {
    const room = new Room(tableFixture()),
      p = plan(room.record.state);
    assert.equal(room.accept(p.op).outcome, "accepted");
    let s = room.record.state;
    const id =
      where === "pasted"
        ? s.nodes[p.selection.cells[1][2]].children[0]
        : s.nodes[s.nodes.row.children[3]].children[0];
    const block = s.nodes[id].text
      ? id
      : s.nodes[s.nodes[id].children[0]].children[0];
    assert.equal(
      room.accept(
        op("B", 1, {
          kind: "insert",
          at: gapAt(s, block, 0),
          text: "peer",
          marks: [],
        }),
      ).outcome,
      "accepted",
    );
    s = room.record.state;
    assert.equal(
      room.accept(op("A", 2, { kind: "undo", target: p.op.id })).outcome,
      "rejected",
    );
    assert.deepEqual(room.record.state, s);
    assert.equal(
      room.accept(op("B", 2, { kind: "undo", target: "B:s:1" })).outcome,
      "accepted",
    );
    assert.equal(
      room.accept(op("A", 3, { kind: "undo", target: p.op.id })).outcome,
      "accepted",
    );
    assert.deepEqual(shape(room.record.state), shape(tableFixture()));
  });
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  test(`overlapping offline expansion ${order} admits one, keeps loser immutable`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      ops = Object.fromEntries(
        ["A", "B"].map((a) => [a, plan(s, rich(s), "last-cell", a).op]),
      );
    assert.equal(room.accept(ops[order[0]]).outcome, "accepted");
    const before = room.record.state,
      r = room.accept(ops[order[1]]);
    assert.equal(r.outcome, "rejected");
    assert.equal(r.bytes, JSON.stringify(ops[order[1]]));
    assert.deepEqual(room.record.state, before);
  });
test("duplicate delivery, decode, replay, Undo and Redo use retained exact identities", () => {
  const room = new Room(tableFixture()),
    record = room.record,
    p = plan(record.state),
    receipt = room.accept(p.op);
  assert.equal(receipt.outcome, "accepted");
  assert.deepEqual(room.accept(p.op), receipt);
  assert.deepEqual(
    replay(record, { op: p.op, receipt }).state,
    room.record.state,
  );
  const restored = JSON.parse(JSON.stringify(room.record.state));
  validate(restored);
  const back = undo(restored, p.op.id),
    again = undo(back, "A:s:2", 3);
  assert.deepEqual(shape(again), shape(restored));
  assert.deepEqual(copyCells(again, p.selection), p.preview.fragment);
});
for (const defect of [
  "unknown asset",
  "forged geometry",
  "public batch",
  "extra fields",
  "no expansion",
])
  test(`reject ${defect} with unchanged authority`, () => {
    const s = tableFixture(),
      p = plan(s),
      room = new Room(s);
    if (defect === "unknown asset")
      p.op.intent.fragment.rows[1][1][0].asset = "foreign";
    if (defect === "forged geometry")
      p.op.intent.geometry.cells[0][0] = "last-cell";
    if (defect === "public batch")
      p.op.intent = { kind: "batch", intents: [p.op.intent] };
    if (defect === "extra fields") p.op.intent.operations = [];
    if (defect === "no expansion")
      p.op.intent.fragment = rich(s, "cell", "cell");
    const before = room.record.state;
    assert.equal(room.accept(p.op).outcome, "rejected");
    assert.deepEqual(room.record.state, before);
  });

test("later expansion substep failure leaves no first column behind", () => {
  const s = tableFixture(),
    p = plan(s),
    id = "A:s:1:expand-column:1:column-row:3:row:cell";
  const corrupt = structuredClone(s);
  corrupt.nodes[id] = { id, type: "paragraph", live: false };
  const before = JSON.stringify(corrupt);
  assert.throws(() => apply(corrupt, p.op), /identity reused/);
  assert.equal(JSON.stringify(corrupt), before);
});
test("expansion guard counts empty new cells outside the pasted rectangle", () => {
  let s = tableFixture(); // A 100-row by 20-column clipboard at the bottom-right creates >2000 cells.
  const cell = rich(s, "cell", "cell").rows[0][0],
    f = {
      version: 1,
      rows: Array.from({ length: 100 }, () =>
        Array.from({ length: 20 }, () => cell),
      ),
    };
  assert.throws(() => plan(s, f), /2000 new-cell/);
});
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { planDelete } from "@cwhy/jade-core/commands";
test("expansion preserves projected rich list source and restores exact destination", () => {
  let s = listFixture({ cell: true, parent: true, rich: true });
  const r = captureRange(
    s,
    { block: "ap", offset: 4 },
    { block: "ap", offset: 4 },
  );
  s = apply(s, op("B", 1, planDelete(s, r, "forward", op("B", 1)).intent));
  const f = copyCells(s, captureCellRange(s, "table", "cell", "other-cell")),
    p = plan(s, f, "other-cell"),
    n = apply(s, p.op);
  assert.deepEqual(
    f.version === 1
      ? { version: 1, rows: copyCells(n, p.selection).rows }
      : copyCells(n, p.selection),
    f,
  );
  assert.deepEqual(
    copyCells(n, range(n, "cell")),
    copyCells(s, range(s, "cell")),
  );
  const back = undo(n, p.op.id);
  assert.deepEqual(shape(back), shape(s));
  assert.deepEqual(
    copyCells(back, range(back, "other-cell")),
    copyCells(s, range(s, "other-cell")),
  );
  validate(back);
});
