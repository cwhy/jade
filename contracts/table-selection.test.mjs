// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  captureCellRange,
  resolveCellRange,
  captureTableBoundary,
  resolveTableBoundary,
  leaveTableSelection,
} from "@cwhy/jade-core/table-selection";
import { captureRange, resolveRange } from "@cwhy/jade-core/selection";
import { planNavigateCell, planInsertRow } from "@cwhy/jade-core/commands";
import { apply, gapAt } from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
import { Client } from "@cwhy/jade-collaboration/client";
const point = (s, id) =>
  captureRange(s, { block: id, offset: 0 }, { block: id, offset: 0 });
for (const [a, f] of [
  ["cell", "last-cell"],
  ["last-cell", "cell"],
  ["code-cell", "empty-cell"],
  ["empty-cell", "code-cell"],
])
  test(`rectangle direction ${a} -> ${f} retains identities without mutation`, () => {
    const s = tableFixture(),
      before = JSON.stringify(s),
      r = captureCellRange(s, "table", a, f);
    assert.deepEqual(r.cells, [
      ["cell", "list-cell", "code-cell"],
      ["empty-cell", "image-cell", "last-cell"],
    ]);
    assert.equal(r.anchor, a);
    assert.equal(r.focus, f);
    assert.deepEqual(resolveCellRange(s, r), r);
    assert.equal(JSON.stringify(s), before);
  });
test("single cell, column and subrectangle are distinct from a text range", () => {
  const s = tableFixture();
  assert.deepEqual(captureCellRange(s, "table", "list-cell").cells, [
    ["list-cell"],
  ]);
  assert.deepEqual(
    captureCellRange(s, "table", "list-cell", "image-cell").cells,
    [["list-cell"], ["image-cell"]],
  );
  assert.deepEqual(
    captureCellRange(s, "table", "list-cell", "last-cell").cells,
    [
      ["list-cell", "code-cell"],
      ["image-cell", "last-cell"],
    ],
  );
  assert.equal(captureCellRange(s, "table", "cell").kind, "cells");
  assert.equal(point(s, "first").kind, undefined);
});
test("peer text preserves rectangle and table boundary", () => {
  const s = tableFixture(),
    r = captureCellRange(s, "table", "cell", "last-cell"),
    b = captureTableBoundary(s, "table"),
    op = {
      id: "B:s:1",
      actor: "B",
      epoch: s.epoch,
      intent: {
        kind: "insert",
        at: gapAt(s, "first", 0),
        text: "Peer ",
        marks: [],
      },
    },
    next = apply(s, op);
  assert.deepEqual(resolveCellRange(next, r), r);
  assert.deepEqual(resolveTableBoundary(next, b), b);
});
for (const side of ["above", "below"])
  test(`insertion ${side} outside selected row preserves rectangle`, () => {
    const s = tableFixture(),
      r = captureCellRange(s, "table", "cell", "code-cell"),
      op = { id: "A:s:1", actor: "A", epoch: s.epoch };
    const next = apply(s, {
      ...op,
      intent: planInsertRow(s, point(s, "first"), op, { side }).intent,
    });
    assert.deepEqual(resolveCellRange(next, r), r);
  });
test("insertion inside a rectangle invalidates it instead of silently adding targets", () => {
  const s = tableFixture(),
    r = captureCellRange(s, "table", "cell", "last-cell"),
    op = { id: "A:s:1", actor: "A", epoch: s.epoch },
    next = apply(s, {
      ...op,
      intent: planInsertRow(s, point(s, "first"), op).intent,
    });
  assert.throws(() => resolveCellRange(next, r), /structure changed/);
  assert.equal(r.cells.flat().length, 6);
});
test("column identity replacement and row reorder invalidate frozen target membership", () => {
  const s = tableFixture(),
    r = captureCellRange(s, "table", "cell", "last-cell");
  for (const mutate of [
    (x) => x.nodes.row.children.reverse(),
    (x) => x.nodes.table.children.reverse(),
  ]) {
    const next = structuredClone(s);
    mutate(next);
    assert.throws(() => resolveCellRange(next, r), /structure changed/);
  }
});
test("retiring a selected inserted row invalidates selection, Redo restores the same range identity", () => {
  const room = new Room(tableFixture()),
    c = new Client("A", "s", room.record);
  const op = { id: "A:s:1", actor: "A", epoch: c.state.epoch };
  c.prepare(planInsertRow(c.state, point(c.state, "first"), op).intent);
  room.accept(c.pending[0]);
  c.receive(room.record);
  const r = captureCellRange(c.state, "table", "A:s:1:cell:0", "A:s:1:cell:2");
  c.undo();
  room.accept(c.pending[0]);
  c.receive(room.record);
  assert.throws(() => resolveCellRange(c.state, r), /no longer/);
  c.redo();
  room.accept(c.pending[0]);
  c.receive(room.record);
  assert.deepEqual(resolveCellRange(c.state, r), r);
});
test("first-cell exit is a stable before-table view selection, including a table at document start", () => {
  const s = tableFixture(),
    p = planNavigateCell(s, point(s, "first"), null, { direction: -1 });
  assert.equal(p.state, s);
  assert.equal(p.intent, null);
  assert.deepEqual(p.selection, {
    kind: "boundary",
    version: 1,
    epoch: s.epoch,
    parent: "doc",
    before: "table",
  });
  assert.equal(s.nodes.doc.children.length, 1);
  assert.deepEqual(resolveRange(s, leaveTableSelection(s, p.selection)), {
    anchor: { block: "first", offset: 0 },
    focus: { block: "first", offset: 0 },
  });
});
test("boundary is tied to the table identity, not its numeric document offset", () => {
  const s = tableFixture(),
    b = captureTableBoundary(s, "table"),
    next = structuredClone(s);
  next.nodes.doc.children.unshift("before-image");
  next.nodes["before-image"] = {
    id: "before-image",
    type: "image",
    live: true,
  };
  assert.deepEqual(resolveTableBoundary(next, b), b);
});
test("epoch changes, moved table and malformed grids reject structural selections", () => {
  const s = tableFixture(),
    r = captureCellRange(s, "table", "cell"),
    b = captureTableBoundary(s, "table");
  assert.throws(
    () => resolveCellRange({ ...s, epoch: s.epoch + 1 }, r),
    /Document changed/,
  );
  assert.throws(
    () => resolveTableBoundary({ ...s, epoch: s.epoch + 1 }, b),
    /Document changed/,
  );
  const moved = structuredClone(s);
  moved.nodes.doc.children = ["wrap"];
  moved.nodes.wrap = {
    id: "wrap",
    type: "list_item",
    live: true,
    children: ["table"],
  };
  assert.throws(() => resolveTableBoundary(moved, b), /moved/);
  s.nodes.row.children.pop();
  assert.throws(() => captureCellRange(s, "table", "cell"), /regular grid/);
});
test("media-only cell can be selected without inventing text, but exit-to-text refuses", () => {
  const s = tableFixture();
  s.nodes["image-text"].live = false;
  s.nodes["image-cell"].children = ["image"];
  const r = captureCellRange(s, "table", "image-cell");
  assert.equal(r.cells[0][0], "image-cell");
  assert.throws(() => leaveTableSelection(s, r), /no editable text/);
});
