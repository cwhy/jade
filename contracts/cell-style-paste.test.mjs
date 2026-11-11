// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  copyCells,
  previewCellPaste,
  planPasteCells,
  previewCellStyle,
  planCellStyle,
  planInsertRow,
  planInsertColumn,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { apply, validate, text } from "@cwhy/jade-core/admission";
import {
  gridFromText,
  gridHTML,
  validateGridFragment,
} from "@cwhy/jade-core/grid-fragment";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s, a = "cell", b = a) => captureCellRange(s, "table", a, b);
const style = (s, patch, a = "B", n = 1, cell = "cell") =>
  planCellStyle(s, range(s, cell), op(a, n), {
    preview: previewCellStyle(s, range(s, cell)),
    patch,
  }).state;
const paste = (s, f, r = range(s), mode = "match", a = "A", n = 1) => {
  const p = previewCellPaste(s, r, f, mode);
  return planPasteCells(s, r, op(a, n), { preview: p }).state;
};
const undo = (s, a = "A", target = 1, n = 2) =>
  apply(s, op(a, n, { kind: "undo", target: `${a}:s:${target}` }));
const copy = (s, c = "cell", end = c) => copyCells(s, range(s, c, end));
const visible = (n) => {
  const { tableFormats, ...rest } = n;
  return rest;
};
const rich = (s) => copy(s, "cell", "last-cell");
test("uncolored source clears destination fill/alignment and Undo restores exact original presence", () => {
  const s = tableFixture();
  s.nodes.cell.background = "#dbeafe";
  s.nodes.cell.textAlign = "right";
  s.nodes.cell.verticalAlign = null;
  const f = copy(s, "last-cell"),
    n = paste(s, f);
  assert.deepEqual(f.styles, [
    [{ background: null, verticalAlign: null, textAlign: null }],
  ]);
  assert.equal(n.nodes.cell.background, undefined);
  assert.equal(n.nodes.cell.textAlign, undefined);
  assert.equal(n.nodes.cell.verticalAlign, undefined);
  const back = undo(n);
  assert.deepEqual(visible(back.nodes.cell), s.nodes.cell);
  validate(back);
  const redo = undo(back, "A", 2, 3);
  assert.deepEqual(copy(redo), f);
  assert.deepEqual(redo.nodes.cell.children, n.nodes.cell.children);
});
test("copy carries visible values only, never source identities, history, header or dimensions", () => {
  let s = style(tableFixture(), {
    background: "#dbeafe",
    verticalAlign: "middle",
    textAlign: "center",
  });
  s.nodes.table.headerRow = true;
  s.nodes.row.minHeight = 200;
  const f = copy(s);
  assert.equal(f.version, 2);
  assert.deepEqual(f.styles[0][0], {
    background: "#dbeafe",
    verticalAlign: "middle",
    textAlign: "center",
  });
  assert.doesNotMatch(
    JSON.stringify(f),
    /tableFormats|headerRow|minHeight|colwidth|B:s:1/,
  );
  const target = paste(s, f, range(s, "last-cell"));
  assert.deepEqual(copy(target, "last-cell"), f);
  assert.equal(target.nodes["last-cell"].tableFormats.layers.length, 3);
  assert.ok(
    target.nodes["last-cell"].tableFormats.layers.every(
      (l) => l.id === "A:s:1",
    ),
  );
});
for (const arrival of ["paste-first", "peer-first"])
  for (const order of [
    ["A", "B"],
    ["B", "A"],
  ])
    test(`paste style and peer style ${arrival}, Undo ${order}`, () => {
      const s = tableFixture();
      s.nodes.cell.background = "#ff0000";
      const f = copy(s, "last-cell"),
        intent = planPasteCells(s, range(s), op("A", 1), {
          preview: previewCellPaste(s, range(s), f),
        }).intent;
      let n =
        arrival === "paste-first"
          ? style(apply(s, op("A", 1, intent)), { background: "#dbeafe" })
          : apply(style(s, { background: "#dbeafe" }), op("A", 1, intent));
      assert.equal(
        n.nodes.cell.background,
        arrival === "paste-first" ? "#dbeafe" : undefined,
      );
      n = undo(n, order[0]);
      assert.equal(
        n.nodes.cell.background,
        order[0] === "A" ? "#dbeafe" : undefined,
      );
      n = undo(n, order[1]);
      assert.equal(n.nodes.cell.background, "#ff0000");
      assert.deepEqual(n.nodes.cell.children, s.nodes.cell.children);
      validate(n);
    });
test("paste Redo retains original style order below a later peer contribution", () => {
  const s = tableFixture(),
    n = paste(s, copy(s, "last-cell")),
    peer = style(n, { background: "#dbeafe" }),
    back = undo(peer),
    again = undo(back, "A", 2, 3);
  assert.equal(again.nodes.cell.background, "#dbeafe");
  assert.deepEqual(again.nodes.cell.children, n.nodes.cell.children);
});
for (const mode of ["match", "fill", "start", "expand"])
  test(`style matrix mapping ${mode} and exact rich-content Undo/Redo`, () => {
    let s = tableFixture();
    s.nodes.cell.background = "#fff3bf";
    s.nodes["list-cell"].textAlign = "right";
    const f = copy(s, "cell", mode === "fill" ? "cell" : "list-cell"),
      r = range(
        s,
        mode === "expand" ? "last-cell" : "cell",
        mode === "fill"
          ? "last-cell"
          : mode === "match"
            ? "list-cell"
            : mode === "expand"
              ? "last-cell"
              : "cell",
      ),
      before = rich(s),
      n = paste(s, f, r, mode);
    validate(n);
    const back = undo(n);
    assert.deepEqual(rich(back), before);
    assert.deepEqual(back.nodes.table.children, s.nodes.table.children);
    const redo = undo(back, "A", 2, 3);
    validate(redo);
    assert.deepEqual(redo.nodes.table.children, n.nodes.table.children);
    for (const node of Object.values(n.nodes).filter(
      (x) => x.live && x.type === "cell",
    ))
      assert.deepEqual(copy(redo, node.id), copy(n, node.id));
  });
for (const axis of ["row", "column"])
  test(`own style Undo is not a live dependency of inserted ${axis}; Redo retains history`, () => {
    const s = tableFixture(),
      r = range(s),
      insert =
        axis === "row"
          ? planInsertRow(s, r, op("A", 1), { side: "below" })
          : planInsertColumn(s, r, op("A", 1), { side: "right" });
    const n = insert.state,
      id =
        axis === "row"
          ? n.nodes[n.nodes.table.children[1]].children[0]
          : n.nodes.row.children[1],
      p = paste(n, copy(s), range(n, id), "match", "A", 2),
      back = undo(p, "A", 2, 3),
      gone = undo(back, "A", 1, 4);
    validate(gone);
    assert.deepEqual(gone.nodes.table.children, s.nodes.table.children);
    const rowBack = undo(gone, "A", 4, 5),
      pasteBack = undo(rowBack, "A", 3, 6);
    assert.deepEqual(copy(pasteBack, id), copy(s));
  });
test("expansion Undo refuses atomically when peer styles a new cell, works after peer Undo", () => {
  const s = tableFixture(),
    n = paste(s, copy(s, "cell", "last-cell"), range(s, "last-cell"), "expand"),
    id = n.nodes.row.children[3],
    peer = style(n, { background: "#dbeafe" }, "B", 1, id),
    before = JSON.stringify(peer);
  assert.throws(() => undo(peer), /dependencies/);
  assert.equal(JSON.stringify(peer), before);
  const back = undo(undo(peer, "B"));
  assert.deepEqual(rich(back), rich(s));
  validate(back);
});
test("plain text and legacy v1 fragments preserve destination styles", () => {
  const s = tableFixture();
  s.nodes.cell.background = "#dbeafe";
  s.nodes.cell.textAlign = "right";
  for (const f of [
    gridFromText("plain"),
    { version: 1, rows: copy(s, "last-cell").rows },
  ]) {
    const n = paste(s, f);
    assert.equal(n.nodes.cell.background, "#dbeafe");
    assert.equal(n.nodes.cell.textAlign, "right");
    assert.equal(n.nodes.cell.tableFormats, undefined);
  }
});
for (const malformed of [
  "missing",
  "dimensions",
  "extra",
  "css",
  "bad-version",
])
  test(`invalid style clipboard ${malformed} rejects unchanged`, () => {
    const s = tableFixture(),
      f = copy(s);
    if (malformed === "missing") delete f.styles[0][0].background;
    if (malformed === "dimensions") f.styles = [];
    if (malformed === "extra") f.styles[0][0].tableFormats = {};
    if (malformed === "css")
      f.styles[0][0].background = "url(https://example.com)";
    if (malformed === "bad-version") f.version = 3;
    const before = JSON.stringify(s);
    assert.throws(() => paste(s, f), /clipboard|Clipboard|style/);
    assert.equal(JSON.stringify(s), before);
  });
test("HTML fallback emits only validated visible cell CSS, including transparent default", () => {
  const s = tableFixture();
  s.nodes.cell.background = "#dbeafe";
  s.nodes.cell.textAlign = "right";
  const html = gridHTML(copy(s, "cell", "list-cell"));
  assert.match(html, /background-color:#dbeafe/);
  assert.match(html, /text-align:right/);
  assert.match(html, /background-color:transparent/);
  const f = copy(s);
  f.styles[0][0].background = '" onmouseover="bad';
  assert.throws(() => gridHTML(f), /style/);
});
