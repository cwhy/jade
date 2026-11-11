// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { captureRange } from "@cwhy/jade-core/selection";
import { copyRange } from "@cwhy/jade-core/commands";
import {
  SLICE_MIME,
  validateRichSlice,
  sliceHTML,
  slicePlainText,
} from "@cwhy/jade-core/rich-slice";
import { MIME } from "@cwhy/jade-core/fragment";
import { apply, text, seed } from "@cwhy/jade-core/model";
const range = (s, a, x, b = a, y = x) =>
  captureRange(s, { block: a, offset: x }, { block: b, offset: y });
const words = (b) => b.content?.map((c) => c.text).join("");
for (const cell of [false, true])
  for (const reverse of [false, true])
    test(`Rich copy preserves nested hierarchy and exact selected text cell=${cell} reverse=${reverse}`, () => {
      const s = listFixture({ cell, parent: true }),
        before = JSON.stringify(s),
        r = reverse ? range(s, "bp", 3, "ap", 1) : range(s, "ap", 1, "bp", 3),
        c = copyRange(s, r);
      assert.equal(c.mime, SLICE_MIME);
      assert.deepEqual(c.fragment.edges, { start: "partial", end: "partial" });
      const list = c.fragment.blocks[0];
      assert.equal(list.type, "ordered_list");
      assert.equal(list.order, 1);
      assert.equal(list.children.length, 2);
      assert.equal(words(list.children[0].children[0]), "aaa");
      assert.deepEqual(list.children[0].children[0].content[0].marks, [
        { type: "em" },
      ]);
      assert.equal(list.children[0].children[1].type, "bullet_list");
      assert.equal(
        words(list.children[0].children[1].children[0].children[0]),
        "child",
      );
      assert.equal(words(list.children[1].children[0]), "bbb");
      assert.equal(JSON.stringify(s), before);
      assert.doesNotMatch(
        JSON.stringify(c.fragment),
        /"id"|"replicas"|"actor"/,
      );
      assert.match(c.html, /<ol start="1"><li><p><em>aaa/);
      assert.match(c.html, /<ul><li><p>child/);
      assert.equal(c.plain, "1. aaa\n  • child\n2. bbb");
    });
test("Partial sibling copy starts at source ordinal and excludes text outside the range", () => {
  const s = listFixture(),
    c = copyRange(s, range(s, "bp", 1, "cp", 2)),
    l = c.fragment.blocks[0];
  assert.equal(l.order, 2);
  assert.deepEqual(
    l.children.map((i) => words(i.children[0])),
    ["bbb", "cc"],
  );
  assert.equal(c.plain, "2. bbb\n3. cc");
});
test("Copy ending at next item start excludes that item while preserving the selected list wrapper", () => {
  const s = listFixture(),
    c = copyRange(s, range(s, "bp", 0, "cp", 0));
  assert.equal(c.mime, SLICE_MIME);
  assert.equal(c.fragment.blocks[0].order, 2);
  assert.equal(c.fragment.blocks[0].children.length, 1);
  assert.equal(c.plain, "2. bbbb");
});
test("Blank selected item stays a blank item", () => {
  const s = listFixture({ empty: true }),
    c = copyRange(s, range(s, "ap", 0, "cp", 2));
  assert.equal(c.fragment.blocks[0].children.length, 3);
  assert.deepEqual(c.fragment.blocks[0].children[1].children[0].content, []);
  assert.match(c.html, /<li><p><br><\/p><\/li>/);
});
test("Code language, whitespace and intervening image survive internal copy", () => {
  const s = listFixture({ rich: true }),
    c = copyRange(s, range(s, "bp", 0, "cp", 2)),
    children = c.fragment.blocks[0].children[0].children;
  assert.equal(children[1].type, "code");
  assert.equal(children[1].language, "js");
  assert.equal(words(children[1]), "const a=1;");
  assert.deepEqual(children[2], { type: "image", asset: "mock.png" });
  assert.match(c.html, /<pre>const a=1;<\/pre>/);
  assert.match(c.plain, /\[Image: mock.png\]/);
});
test("Copying only code retains its language without an invented list parent", () => {
  const s = listFixture({ rich: true }),
    c = copyRange(s, range(s, "code", 1, "code", 6));
  assert.equal(c.mime, SLICE_MIME);
  assert.equal(c.fragment.blocks[0].type, "code");
  assert.equal(c.fragment.blocks[0].language, "js");
  assert.equal(words(c.fragment.blocks[0]), "onst ");
});
test("Single paragraph selection inside a list remains inline copy", () => {
  const s = listFixture({ parent: true }),
    c = copyRange(s, range(s, "childp", 1, "childp", 4));
  assert.equal(c.mime, MIME);
  assert.equal(c.plain, "hil");
  assert.equal(c.html, "<p>hil</p>");
});
test("Cross-cell ordinary copy is guarded instead of silently flattening the grid", () => {
  const s = tableFixture();
  assert.throws(
    () => copyRange(s, range(s, "first", 2, "list-text", 3)),
    /whole cells/,
  );
});
test("Orphan nested-parent selection is guarded instead of fabricating ancestor text", () => {
  const s = listFixture({ parent: true });
  assert.throws(
    () => copyRange(s, range(s, "childp", 2, "bp", 3)),
    /partial ancestor/,
  );
});
test("Stale copy range does not silently recapture different content", () => {
  const s = listFixture(),
    r = range(s, "ap", 0, "bp", 3),
    n = apply(s, {
      id: "A:s:1",
      actor: "A",
      stream: "s",
      seq: 1,
      epoch: 1,
      intent: { kind: "delete", ids: [text(s, "ap")[0].id] },
    });
  assert.throws(() => copyRange(n, r), /Destination changed/);
});
test("Read-only copy normalizes legacy local highlight into transferable marks", () => {
  const s = listFixture(),
    a = text(s, "ap")[0];
  const n = apply(s, {
    id: "A:s:1",
    actor: "A",
    stream: "s",
    seq: 1,
    epoch: 1,
    intent: {
      kind: "format",
      ids: [a.id],
      property: "highlight",
      value: { type: "highlight", color: "#fff0a8" },
    },
  });
  assert.deepEqual(
    copyRange(n, range(n, "ap", 0, "ap", 1)).fragment.blocks[0].content[0]
      .marks,
    [{ type: "em" }, { type: "highlight", attrs: { color: "#fff0a8" } }],
  );
});
test("A table between prose endpoints cannot disappear during ordinary copy", () => {
  const s = tableFixture();
  const n = seed(
    {
      ...Object.fromEntries(
        Object.entries(s.nodes).map(([k, v]) => [k, { ...v, text: undefined }]),
      ),
      doc: {
        id: "doc",
        type: "doc",
        live: true,
        children: ["before", "table", "after"],
      },
      before: { id: "before", type: "paragraph", live: true },
      after: { id: "after", type: "paragraph", live: true },
    },
    {
      before: [{ text: "before" }],
      after: [{ text: "after" }],
      first: [{ text: "x" }],
      "list-text": [{ text: "x" }],
      code: [{ text: "x" }],
      empty: [],
      "image-text": [{ text: "x" }],
      last: [{ text: "x" }],
    },
  );
  assert.throws(
    () => copyRange(n, range(n, "before", 1, "after", 2)),
    /whole-cell/,
  );
});
const sample = {
  version: 1,
  edges: { start: "boundary", end: "partial" },
  blocks: [
    {
      type: "ordered_list",
      order: 2,
      children: [
        {
          type: "list_item",
          children: [
            { type: "paragraph", content: [{ text: "<&", marks: [] }] },
          ],
        },
      ],
    },
  ],
};
for (const change of [
  (s) => (s.id = "foreign"),
  (s) => (s.blocks[0].id = "foreign"),
  (s) => (s.edges.start = "unknown"),
  (s) => (s.blocks[0].order = 0),
  (s) =>
    (s.blocks[0].children[0].children[0].content[0].marks = [
      { type: "link", attrs: { href: "javascript:alert(1)" } },
    ]),
])
  test(`Rich clipboard rejects untrusted fields/values ${change}`, () => {
    const s = structuredClone(sample);
    change(s);
    assert.throws(() => validateRichSlice(s));
  });
test("Rich slice serializers escape text, preserve numbering, and round trip the validated payload", () => {
  assert.equal(
    sliceHTML(sample),
    '<ol start="2"><li><p>&lt;&amp;</p></li></ol>',
  );
  assert.equal(slicePlainText(sample), "2. <&");
  assert.deepEqual(
    validateRichSlice(JSON.parse(JSON.stringify(sample))),
    sample,
  );
});

test("A zero-offset terminal caret still includes intervening code and images", () => {
  const s = listFixture({ rich: true }),
    c = copyRange(s, range(s, "bp", 0, "cp", 0)),
    items = c.fragment.blocks[0].children;
  assert.equal(items.length, 1);
  assert.deepEqual(
    items[0].children.map((b) => b.type),
    ["paragraph", "code", "image"],
  );
  assert.equal(items[0].children[2].asset, "mock.png");
});
