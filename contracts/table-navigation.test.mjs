// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { planNavigateCell } from "@cwhy/jade-core/commands";
import { captureRange, resolveRange } from "@cwhy/jade-core/selection";
import { immutable } from "@cwhy/jade-core/immutability";
import { apply, gapAt } from "@cwhy/jade-core/model";
const cells = ["first", "list-text", "code", "empty", "image-text", "last"];
const range = (s, block, offset = 0, tail = block, end = offset) =>
  captureRange(s, { block, offset }, { block: tail, offset: end });
for (const direction of [-1, 1])
  for (let i = 0; i < cells.length; i++) {
    const next = i + direction;
    if (next < 0 || next >= cells.length) continue;
    test(`cell navigation ${cells[i]} -> ${cells[next]} preserves model`, () => {
      const state = immutable(tableFixture()),
        before = JSON.stringify(state),
        p = planNavigateCell(state, range(state, cells[i]), null, {
          direction,
        });
      assert.equal(p.intent, null);
      assert.equal(p.state, state);
      assert.deepEqual(resolveRange(state, p.selection), {
        anchor: { block: cells[next], offset: 0 },
        focus: { block: cells[next], offset: 0 },
      });
      assert.equal(JSON.stringify(state), before);
    });
  }
test("navigation collapses a backwards text selection without deleting it", () => {
  const s = immutable(tableFixture()),
    r = range(s, "first", 8, "first", 2),
    p = planNavigateCell(s, r);
  assert.equal(r.backwards, true);
  assert.equal(p.selection.collapsed, true);
  assert.equal(resolveRange(s, p.selection).focus.block, "list-text");
  assert.equal(p.state, s);
});
test("first boundary is selection-only; cross-cell text navigation remains gated", () => {
  const s = immutable(tableFixture()),
    before = JSON.stringify(s);
  assert.equal(
    planNavigateCell(s, range(s, "first"), null, { direction: -1 }).selection
      .kind,
    "boundary",
  );
  assert.throws(
    () => planNavigateCell(s, range(s, "first", 0, "last", 2)),
    /one cell/,
  );
  assert.equal(JSON.stringify(s), before);
});
test("unsupported grids, media-only target and invalid direction do not silently skip cells", () => {
  for (const mutate of [
    (s) => (s.nodes["list-cell"].colspan = 2),
    (s) => s.nodes["row-two"].children.pop(),
    (s) => (s.nodes["list-cell"].children = ["image"]),
  ]) {
    const s = tableFixture();
    mutate(s);
    const before = JSON.stringify(s);
    assert.throws(
      () => planNavigateCell(s, range(s, "first")),
      /regular grid|no editable text|structure/,
    );
    assert.equal(JSON.stringify(s), before);
  }
  assert.throws(
    () =>
      planNavigateCell(tableFixture(), range(tableFixture(), "first"), null, {
        direction: 0,
      }),
    /direction/,
  );
});
test("resolves the source against current peer text and rejects an old document epoch", () => {
  const s = tableFixture(),
    r = range(s, "first", 4),
    peer = {
      id: "B:s:1",
      actor: "B",
      epoch: s.epoch,
      intent: {
        kind: "insert",
        at: gapAt(s, "first", 0),
        text: "Q",
        marks: [],
      },
    },
    next = immutable(apply(s, peer));
  assert.equal(
    resolveRange(next, planNavigateCell(next, r).selection).focus.block,
    "list-text",
  );
  assert.throws(
    () => planNavigateCell({ ...s, epoch: s.epoch + 1 }, r),
    /Document changed/,
  );
});
