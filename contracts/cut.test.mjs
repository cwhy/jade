// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  captureRange,
  planReplace as internalReplace,
} from "@cwhy/jade-core/selection";
import { plainFragment } from "@cwhy/jade-core/fragment";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { apply, text, gapAt } from "@cwhy/jade-core/admission";
import {
  previewCut,
  planCut,
  copyCells,
  planTextFormat,
  planInsertColumn,
  planEnter,
} from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const range = (s, id, from, to) =>
  captureRange(s, { block: id, offset: from }, { block: id, offset: to });
const cut = (s, preview) => planCut(s, preview, op("A", 1));
for (const id of ["first", "list-text", "code"])
  test(`Cut ${id} captures exact text and preserves type, mark identities and owned Undo`, () => {
    const s = tableFixture(),
      r = range(s, id, 2, 7),
      preview = previewCut(s, r),
      before = text(s, id),
      p = cut(s, preview);
    assert.equal(
      preview.fragment.blocks[0].content.map((x) => x.text).join(""),
      before
        .slice(2, 7)
        .map((a) => a.char)
        .join(""),
    );
    assert.deepEqual(text(p.state, id), [
      ...before.slice(0, 2),
      ...before.slice(7),
    ]);
    assert.deepEqual(p.state.nodes, s.nodes);
    assert.deepEqual(apply(s, op("A", 1, p.intent)), p.state);
    const restored = apply(
      p.state,
      op("A", 2, { kind: "undo", target: "A:s:1" }),
    );
    assert.deepEqual(text(restored, id), before);
  });
test("Rich cell Cut preserves clipboard subtree, grid, styles and assets with one restoring Undo", () => {
  const s = tableFixture(),
    r = captureCellRange(s, "table", "cell", "last-cell"),
    preview = previewCut(s, r),
    p = cut(s, preview);
  assert.deepEqual(preview.fragment, copyCells(s, r));
  assert.deepEqual(p.state.nodes.table, s.nodes.table);
  for (const id of r.cells.flat()) {
    assert.equal(p.state.nodes[id].colwidth[0], 200);
    assert.equal(p.state.nodes[id].children.length, 1);
    assert.equal(text(p.state, p.state.nodes[id].children[0]).length, 0);
  }
  assert.ok(p.state.nodes.image.asset);
  const restored = apply(
    p.state,
    op("A", 2, { kind: "undo", target: "A:s:1" }),
  );
  assert.deepEqual(copyCells(restored, r), preview.fragment);
  for (const id of r.cells.flat())
    assert.deepEqual(restored.nodes[id].children, s.nodes[id].children);
  assert.equal(restored.nodes.image.id, "image");
});
for (const change of ["typing", "formatting"])
  test(`Text Cut refuses ${change} inside source while clipboard is pending`, () => {
    const s = tableFixture(),
      r = range(s, "first", 2, 7),
      preview = previewCut(s, r),
      n =
        change === "typing"
          ? apply(
              s,
              op("B", 1, {
                kind: "insert",
                at: gapAt(s, "first", 4),
                text: "peer",
              }),
            )
          : planTextFormat(s, r, op("B", 1), { property: "strong" }).state;
    assert.throws(() => cut(n, preview), /Destination changed/);
  });
for (const change of ["typing", "column"])
  test(`Cell Cut refuses ${change} during clipboard writing`, () => {
    const s = tableFixture(),
      r = captureCellRange(s, "table", "code-cell", "cell"),
      preview = previewCut(s, r),
      n =
        change === "typing"
          ? apply(
              s,
              op("B", 1, {
                kind: "insert",
                at: gapAt(s, "first", 4),
                text: "peer",
              }),
            )
          : planInsertColumn(s, r, op("B", 1), { side: "right" }).state;
    assert.throws(() => cut(n, preview), /changed/);
  });
test("Unrelated peer typing remains after Cut and owned Undo", () => {
  const s = tableFixture(),
    r = range(s, "first", 2, 7),
    preview = previewCut(s, r),
    n = apply(
      s,
      op("B", 1, { kind: "insert", at: gapAt(s, "last", 3), text: "peer" }),
    ),
    p = cut(n, preview),
    restored = apply(p.state, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.deepEqual(text(restored, "first"), text(s, "first"));
  assert.deepEqual(text(restored, "last"), text(n, "last"));
});
test("Adjacent-paragraph Cut uses admitted semantic replacement; raw joins remain private", () => {
  const s = tableFixture(),
    split = planEnter(s, range(s, "first", 5, 5), op("seed", 1)),
    n = split.state,
    tail = n.nodes.cell.children[1],
    r = captureRange(
      n,
      { block: "first", offset: 2 },
      { block: tail, offset: 4 },
    ),
    p = internalReplace(n, r, plainFragment(""), op("A", 1));
  assert.throws(
    () => apply(n, op("A", 1, p.intent)),
    /unsupported public operation/,
  );
  const preview = previewCut(n, r),
    semantic = planCut(n, preview, op("A", 1));
  assert.equal(semantic.intent.kind, "proseReplace");
  assert.deepEqual(apply(n, op("A", 1, semantic.intent)), semantic.state);
  const restored = apply(
    semantic.state,
    op("A", 2, { kind: "undo", target: "A:s:1" }),
  );
  assert.deepEqual(restored.nodes.cell.children, n.nodes.cell.children);
  for (const id of n.nodes.cell.children)
    assert.deepEqual(text(restored, id), text(n, id));
});
test("Unsupported cross-cell text cut is refused before a clipboard write can begin", () => {
  const s = tableFixture(),
    r = captureRange(
      s,
      { block: "first", offset: 2 },
      { block: "code", offset: 4 },
    );
  assert.throws(() => previewCut(s, r), /structural clipboard/);
});
test("Collapsed text Cut has no preview or document mutation", () => {
  const s = tableFixture();
  assert.equal(previewCut(s, range(s, "first", 2, 2)), null);
});

test("Column insertion outside the captured rectangle remains compatible with Cut", () => {
  const s = tableFixture(),
    r = captureCellRange(s, "table", "cell", "code-cell"),
    preview = previewCut(s, r),
    n = planInsertColumn(s, r, op("B", 1), { side: "right" }).state,
    p = cut(n, preview);
  assert.equal(p.state.nodes.row.children.length, 4);
  assert.equal(text(p.state, p.state.nodes.cell.children[0]).length, 0);
  assert.equal(p.state.nodes.row.children[3], n.nodes.row.children[3]);
});

import { encodeClipboardHTML } from "@cwhy/jade-browser/clipboard";
test("Clipboard envelope round-trips Unicode and attribute punctuation without changing readable HTML", () => {
  const type = "application/x-internal-doc-fragment+json",
    payload = JSON.stringify({ text: '你好 👩🏽‍💻 <tag> \" &' }),
    html = "<p>readable</p>",
    wrapped = encodeClipboardHTML(type, payload, html),
    encoded = wrapped.match(/data-internal-doc-clipboard="([^"]+)"/)[1];
  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), {
    version: 1,
    type,
    payload,
  });
  assert.ok(wrapped.endsWith(html + "</div>"));
});
test("Clipboard writer rejects an envelope exceeding the reader limit before an OS write", () => {
  assert.throws(
    () =>
      encodeClipboardHTML(
        "application/x-internal-doc-fragment+json",
        "界".repeat(1000000),
        "<p>text</p>",
      ),
    /HTML is too large/,
  );
});
