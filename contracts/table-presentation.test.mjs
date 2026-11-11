// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { Room } from "@cwhy/jade-collaboration/room";
import { apply, validate, gapAt, text } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  previewCellStyle,
  planCellStyle,
  planHeaderRow,
  previewDistributeColumns,
  planDistributeColumns,
  previewColumnResize,
  planColumnResize,
  planInsertRow,
  planInsertColumn,
  previewTableMove,
  planTableMove,
  previewTableDelete,
  planTableDelete,
  planClearCells,
} from "@cwhy/jade-core/commands";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s) => captureCellRange(s, "table", "cell", "last-cell"),
  point = (s) =>
    captureRange(
      s,
      { block: "first", offset: 1 },
      { block: "first", offset: 1 },
    );
const style = (s, patch, a = "A", n = 1, selection = range(s)) => {
  const p = planCellStyle(s, selection, op(a, n), {
    preview: previewCellStyle(s, selection),
    patch,
  });
  return { ...p, op: op(a, n, p.intent) };
};
const undo = (s, target, a = "A", n = 2) =>
  apply(s, op(a, n, { kind: "undo", target }));
const widths = (s) =>
  s.nodes.row.children.map((id) => s.nodes[id].colwidth?.[0] ?? 200);
const uneven = () => {
  const s = tableFixture();
  s.nodes.cell.colwidth = s.nodes["empty-cell"].colwidth = [250];
  s.nodes["list-cell"].colwidth = s.nodes["image-cell"].colwidth = [150];
  s.nodes["code-cell"].colwidth = s.nodes["last-cell"].colwidth = [300];
  return s;
};
const distribute = (s, a = "A", n = 1) => {
  const p = planDistributeColumns(s, point(s), op(a, n), {
    preview: previewDistributeColumns(s, "table"),
  });
  return { ...p, op: op(a, n, p.intent) };
};
for (const [key, value] of [
  ["background", "#dbeafe"],
  ["verticalAlign", "top"],
  ["textAlign", "right"],
])
  test(`cell ${key} applies uniformly without touching widths/content; Undo returns original and Redo restores`, () => {
    const s = tableFixture(),
      p = style(s, { [key]: value }),
      n = p.state;
    validate(n);
    assert.deepEqual(n.replicas, s.replicas);
    assert.deepEqual(n.runs, s.runs);
    assert.deepEqual(widths(n), widths(s));
    for (const id of range(s).cells.flat())
      assert.equal(n.nodes[id][key], value);
    const back = undo(n, p.op.id);
    for (const id of range(s).cells.flat())
      assert.equal(back.nodes[id][key], undefined);
    const again = undo(back, "A:s:2", "A", 3);
    for (const id of range(s).cells.flat())
      assert.equal(again.nodes[id][key], value);
  });
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const removal of [
    ["A", "B"],
    ["B", "A"],
  ])
    test(`overlapping cell colors ${arrival}, Undo ${removal} reveals latest remaining then original`, () => {
      const s = tableFixture();
      s.nodes.cell.background = "#ff0000";
      const cell = captureCellRange(s, "table", "cell"),
        ops = {
          A: style(s, { background: "#fff3bf" }, "A", 1, cell).op,
          B: style(s, { background: "#dbeafe" }, "B", 1, cell).op,
        },
        room = new Room(s);
      for (const a of arrival)
        assert.equal(room.accept(ops[a]).outcome, "accepted");
      assert.equal(
        room.record.state.nodes.cell.background,
        arrival[1] === "A" ? "#fff3bf" : "#dbeafe",
      );
      assert.equal(
        room.accept(
          op(removal[0], 2, { kind: "undo", target: ops[removal[0]].id }),
        ).outcome,
        "accepted",
      );
      assert.equal(
        room.record.state.nodes.cell.background,
        removal[1] === "A" ? "#fff3bf" : "#dbeafe",
      );
      assert.equal(
        room.accept(
          op(removal[1], 2, { kind: "undo", target: ops[removal[1]].id }),
        ).outcome,
        "accepted",
      );
      assert.equal(room.record.state.nodes.cell.background, "#ff0000");
    });
test("one patch contributes several properties; its Undo preserves another actor’s independent property", () => {
  const s = tableFixture(),
    a = style(s, { background: "#fff3bf", verticalAlign: "top" }),
    b = style(a.state, { textAlign: "center" }, "B"),
    back = undo(b.state, a.op.id);
  assert.equal(back.nodes.cell.background, undefined);
  assert.equal(back.nodes.cell.verticalAlign, undefined);
  assert.equal(back.nodes.cell.textAlign, "center");
});
test("Redo reactivates original layer order rather than moving it after a newer peer style", () => {
  const s = tableFixture(),
    a = style(s, { background: "#fff3bf" }),
    b = style(a.state, { background: "#dbeafe" }, "B"),
    back = undo(b.state, a.op.id),
    again = undo(back, "A:s:2", "A", 3);
  assert.equal(again.nodes.cell.background, "#dbeafe");
});
test("partial overlap affects only intended cells and restores only that contribution", () => {
  const s = tableFixture(),
    a = style(
      s,
      { background: "#fff3bf" },
      "A",
      1,
      captureCellRange(s, "table", "cell", "list-cell"),
    ),
    b = style(
      a.state,
      { background: "#dbeafe" },
      "B",
      1,
      captureCellRange(a.state, "table", "list-cell", "code-cell"),
    ),
    back = undo(b.state, a.op.id);
  assert.equal(back.nodes.cell.background, undefined);
  assert.equal(back.nodes["list-cell"].background, "#dbeafe");
  assert.equal(back.nodes["code-cell"].background, "#dbeafe");
  assert.equal(back.nodes["empty-cell"].background, undefined);
});
test("style no-op emits no operation and preserves original state", () => {
  const s = style(tableFixture(), { background: "#fff3bf" }).state,
    p = style(s, { background: "#fff3bf" }, "A", 2);
  assert.equal(p.intent, null);
  assert.equal(p.state, s);
});
for (const patch of [
  { background: "url(https://example.com)" },
  { background: "red" },
  { verticalAlign: "stretch" },
  { textAlign: "justify" },
  { headerRow: "true" },
  { colwidth: [300] },
  { __bad: "value" },
  {},
])
  test(`invalid style ${JSON.stringify(patch)} rejects unchanged`, () => {
    const s = tableFixture(),
      before = JSON.stringify(s);
    assert.throws(() => style(s, patch), /Invalid|invalid|changed/);
    assert.equal(JSON.stringify(s), before);
  });
test("header is an explicit table setting; insertion/reorder preserve it and Undo does not alter structure", () => {
  const s = tableFixture(),
    header = planHeaderRow(s, point(s), op("A", 1), {
      table: "table",
      value: true,
    });
  assert.equal(header.state.nodes.table.headerRow, true);
  const ins = planInsertRow(header.state, point(header.state), op("B", 1), {
    side: "above",
  }).state;
  assert.equal(ins.nodes.table.headerRow, true);
  const back = undo(ins, "A:s:1");
  assert.equal(back.nodes.table.headerRow, undefined);
  assert.deepEqual(back.nodes.table.children, ins.nodes.table.children);
});
test("overlapping header toggles preserve the peer setting through owned Undo", () => {
  const s = tableFixture(),
    a = planHeaderRow(s, point(s), op("A", 1), {
      table: "table",
      value: true,
    }).state,
    b = planHeaderRow(a, point(a), op("B", 1), {
      table: "table",
      value: false,
    }).state,
    back = undo(b, "A:s:1");
  assert.equal(back.nodes.table.headerRow, false);
  assert.equal(undo(back, "B:s:1", "B", 2).nodes.table.headerRow, undefined);
});
test("clear retains cell styles; later style survives Clear Undo", () => {
  const s = style(tableFixture(), { background: "#fff3bf" }).state,
    selected = range(s),
    cleared = planClearCells(s, selected, op("A", 2)).state,
    b = style(cleared, { textAlign: "right" }, "B"),
    back = undo(b.state, "A:s:2", "A", 3);
  assert.equal(back.nodes.cell.background, "#fff3bf");
  assert.equal(back.nodes.cell.textAlign, "right");
  for (const [id, replica] of Object.entries(s.replicas))
    assert.deepEqual(back.replicas[id], replica);
  for (const [id, replica] of Object.entries(back.replicas))
    if (!s.replicas[id]) assert.equal(replica.retired, true);
});
test("style inverse waits for a deleted target to be restored, then affects its original identity", () => {
  const s = tableFixture(),
    a = style(s, { background: "#fff3bf" }),
    selected = captureCellRange(a.state, "table", "cell"),
    d = planTableDelete(a.state, selected, op("B", 1), {
      preview: previewTableDelete(a.state, selected, "rows"),
    }).state;
  assert.throws(() => undo(d, a.op.id), /unavailable/);
  const restored = undo(d, "B:s:1", "B", 2);
  assert.equal(undo(restored, a.op.id).nodes.cell.background, undefined);
});
test("a frozen style applies to stable original cells after peer insertion, excluding the new cells", () => {
  const s = tableFixture(),
    a = style(s, { textAlign: "right" }),
    ins = planInsertColumn(s, point(s), op("B", 1), { side: "left" }).state,
    n = apply(ins, a.op);
  for (const id of range(s).cells.flat())
    assert.equal(n.nodes[id].textAlign, "right");
  assert.equal(n.nodes[n.nodes.row.children[0]].textAlign, undefined);
});
for (const corruption of ["projection", "layer", "base", "wrong-node"])
  test(`malformed persisted formatting ${corruption} rejects`, () => {
    const s = structuredClone(
      style(tableFixture(), { background: "#fff3bf" }).state,
    );
    if (corruption === "projection") s.nodes.cell.background = "#dbeafe";
    if (corruption === "layer")
      s.nodes.cell.tableFormats.layers[0].active = "yes";
    if (corruption === "base") s.nodes.cell.tableFormats.base.bad = null;
    if (corruption === "wrong-node")
      s.nodes.first.tableFormats = { base: {}, layers: [] };
    assert.throws(() => validate(s), /format|Style/i);
  });
test("public lifecycle and batch bypasses are refused", () => {
  const s = tableFixture(),
    a = style(s, { textAlign: "right" });
  for (const intent of [
    { kind: "tableFormatActive" },
    { kind: "restoreDistributedWidths" },
    { kind: "batch", intents: [a.intent] },
  ])
    assert.throws(
      () => apply(s, op("A", 1, intent)),
      /internal|invalid|unsupported/,
    );
});
for (const setup of ["uneven", "fractional", "below-minimum", "legacy-unequal"])
  test(`distribution ${setup} is atomic, equal and restores exact old widths/owners`, () => {
    const s = uneven();
    if (setup === "fractional") s.nodes.cell.colwidth = [250.5];
    if (setup === "below-minimum")
      for (const id of range(s).cells.flat()) s.nodes[id].colwidth = [80];
    if (setup === "legacy-unequal") {
      delete s.nodes.cell.colwidth;
      s.nodes["empty-cell"].colwidth = [260];
    }
    const old = widths(s),
      p = distribute(s),
      n = p.state,
      expected = Math.max(120, old.reduce((a, b) => a + b, 0) / 3);
    assert.deepEqual(widths(n), [expected, expected, expected]);
    assert.deepEqual(n.replicas, s.replicas);
    assert.deepEqual(undo(n, p.op.id).nodes, s.nodes);
    assert.deepEqual(undo(undo(n, p.op.id), "A:s:2", "A", 3).nodes, n.nodes);
  });
test("already distributed columns are a no-op", () => {
  const s = tableFixture(),
    p = distribute(s);
  assert.equal(p.intent, null);
  assert.equal(p.state, s);
});
for (const kind of ["width", "row", "column", "move"])
  test(`distribution refuses stale ${kind} witness unchanged`, () => {
    const s = uneven(),
      p = distribute(s),
      o = op("B", 1);
    let n;
    if (kind === "width")
      n = planColumnResize(s, point(s), o, {
        preview: previewColumnResize(s, "cell"),
        width: 400,
      }).state;
    else if (kind === "row") n = planInsertRow(s, point(s), o).state;
    else if (kind === "column")
      n = planInsertColumn(s, point(s), o, { side: "left" }).state;
    else
      n = planTableMove(s, point(s), o, {
        preview: previewTableMove(
          s,
          captureCellRange(s, "table", "cell"),
          "columns",
        ),
        before: null,
      }).state;
    const before = JSON.stringify(n);
    assert.throws(() => apply(n, p.op), /changed/);
    assert.equal(JSON.stringify(n), before);
  });
test("distribution Undo refuses whole inverse after one newer width, then works after its Undo", () => {
  const s = uneven(),
    a = distribute(s),
    b = planColumnResize(a.state, point(a.state), op("B", 1), {
      preview: previewColumnResize(a.state, "cell"),
      width: 400,
    }).state;
  assert.throws(() => undo(b, a.op.id), /cannot overwrite/);
  const restored = undo(b, "B:s:1", "B", 2);
  assert.deepEqual(undo(restored, a.op.id).nodes, s.nodes);
});
test("peer content and cell style survive distribution and Undo", () => {
  const s = uneven(),
    p = distribute(s),
    b = apply(
      s,
      op("B", 1, { kind: "insert", at: gapAt(s, "first", 1), text: "peer" }),
    ),
    styled = style(b, { background: "#dbeafe" }, "B", 2).state,
    back = undo(apply(styled, p.op), p.op.id);
  assert.deepEqual(widths(back), widths(s));
  assert.equal(back.nodes.cell.background, "#dbeafe");
  assert.equal(
    text(back, "first")
      .map((a) => a.char)
      .join(""),
    "Fpeerirst cell text",
  );
});

test("Undo restores explicitly present null defaults separately from missing properties", () => {
  const s = tableFixture();
  s.nodes.cell.background = null;
  s.nodes.cell.verticalAlign = null;
  const p = style(
      s,
      { background: "#dbeafe", verticalAlign: "top", textAlign: "right" },
      "A",
      1,
      captureCellRange(s, "table", "cell"),
    ),
    back = undo(p.state, p.op.id);
  assert.equal(Object.hasOwn(back.nodes.cell, "background"), true);
  assert.equal(back.nodes.cell.background, null);
  assert.equal(Object.hasOwn(back.nodes.cell, "verticalAlign"), true);
  assert.equal(back.nodes.cell.verticalAlign, null);
  assert.equal(Object.hasOwn(back.nodes.cell, "textAlign"), false);
  const { tableFormats, ...restored } = back.nodes.cell;
  assert.deepEqual(restored, s.nodes.cell);
  validate(back);
});
