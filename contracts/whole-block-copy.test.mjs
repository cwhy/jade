// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import {
  captureBlockRange,
  resolveBlockRange,
} from "@cwhy/jade-core/block-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  copyBlocks,
  copyRange,
  copyCells,
  previewCellPaste,
  planPasteCells,
} from "@cwhy/jade-core/commands";
import { SLICE_MIME, validateRichSlice } from "@cwhy/jade-core/rich-slice";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
function fixture(cell = false, type = "ordered_list", last = "image") {
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children: cell ? ["table"] : ["list"],
    },
    list: {
      id: "list",
      type,
      live: true,
      children: ["item"],
      ...(type === "ordered_list" ? { order: 3 } : {}),
    },
    item: {
      id: "item",
      type: "list_item",
      live: true,
      children: [
        "p",
        "nested",
        ...(last === "image" ? ["code", "image"] : ["image", "code"]),
      ],
    },
    p: { id: "p", type: "paragraph", live: true },
    nested: {
      id: "nested",
      type: "bullet_list",
      live: true,
      children: ["child"],
    },
    child: { id: "child", type: "list_item", live: true, children: ["cp"] },
    cp: { id: "cp", type: "paragraph", live: true },
    code: { id: "code", type: "code", live: true, language: "javascript" },
    image: {
      id: "image",
      type: "image",
      live: true,
      asset: "mock.png",
      alt: "Mock diagram",
      width: 320,
      height: 180,
    },
  };
  if (cell)
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: {
        id: "row",
        type: "row",
        live: true,
        children: ["source", "target"],
      },
      source: { id: "source", type: "cell", live: true, children: ["list"] },
      target: { id: "target", type: "cell", live: true, children: ["dest"] },
      dest: { id: "dest", type: "paragraph", live: true },
    });
  return seed(nodes, {
    p: [
      {
        text: "任务🙂",
        marks: ["strong", { type: "highlight", color: "#fff0a8" }],
      },
    ],
    cp: [{ text: "子项", marks: ["em"] }],
    code: [{ text: "const n = 1;\n\t// 保留空格\n" }],
    ...(cell ? { dest: [{ text: "Destination" }] } : {}),
  });
}
const words = (b) => b.content?.map((r) => r.text).join("");
for (const cell of [false, true])
  for (const type of ["ordered_list", "bullet_list"])
    for (const last of ["image", "code"])
      test(`Whole final item copy cell=${cell} ${type} ending=${last}`, () => {
        const s = fixture(cell, type, last),
          before = structuredClone(s),
          r = captureBlockRange(s, "item"),
          c = copyBlocks(s, r),
          list = c.fragment.blocks[0],
          item = list.children[0];
        assert.equal(c.mime, SLICE_MIME);
        assert.deepEqual(c.fragment.edges, {
          start: "boundary",
          end: "boundary",
        });
        assert.equal(list.type, type);
        if (type === "ordered_list") assert.equal(list.order, 3);
        assert.equal(words(item.children[0]), "任务🙂");
        assert.deepEqual(
          item.children.map((b) => b.type),
          last === "image"
            ? ["paragraph", "bullet_list", "code", "image"]
            : ["paragraph", "bullet_list", "image", "code"],
        );
        assert.equal(words(item.children[1].children[0].children[0]), "子项");
        assert.deepEqual(item.children[0].content[0].marks, [
          { type: "strong" },
          { type: "highlight", attrs: { color: "#fff0a8" } },
        ]);
        const code = item.children.find((b) => b.type === "code"),
          image = item.children.find((b) => b.type === "image");
        assert.equal(code.language, "javascript");
        assert.equal(words(code), "const n = 1;\n\t// 保留空格\n");
        assert.deepEqual(image, {
          type: "image",
          asset: "mock.png",
          alt: "Mock diagram",
          width: 320,
          height: 180,
        });
        assert.deepEqual(
          validateRichSlice(JSON.parse(JSON.stringify(c.fragment))),
          c.fragment,
        );
        assert.doesNotMatch(
          JSON.stringify(c.fragment),
          /"id"|"replicas"|"epoch"|"actor"|"placement"/,
        );
        assert.match(c.html, /<pre>/);
        assert.match(c.plain, /\[Image: Mock diagram\]/);
        assert.deepEqual(s, before);
      });
for (const reversed of [false, true])
  test(`Whole adjacent child blocks preserve exact order reversed=${reversed}`, () => {
    const s = fixture(),
      r = captureBlockRange(
        s,
        reversed ? "image" : "code",
        reversed ? "code" : "image",
      ),
      c = copyBlocks(s, r);
    assert.equal(r.backwards, reversed);
    assert.deepEqual(r.blocks, ["code", "image"]);
    assert.deepEqual(
      c.fragment.blocks.map((b) => b.type),
      ["code", "image"],
    );
  });
for (const id of ["image", "code", "p", "nested", "list"])
  test(`Explicit whole block ${id} does not invent ancestors`, () => {
    const s = fixture(),
      c = copyBlocks(s, captureBlockRange(s, id));
    assert.equal(c.fragment.blocks[0].type, s.nodes[id].type);
    assert.equal(c.fragment.blocks.length, 1);
  });
test("Ordinary paragraph text selection stays inline and excludes attachments", () => {
  const s = fixture(),
    c = copyRange(
      s,
      captureRange(s, { block: "p", offset: 0 }, { block: "p", offset: 3 }),
    );
  assert.notEqual(c.mime, SLICE_MIME);
  assert.deepEqual(
    c.fragment.blocks.map((b) => b.type),
    ["paragraph"],
  );
  assert.equal(c.plain, "任务🙂");
});
test("Whole-block copy reads current peer text without invalidating an intact structural selection", () => {
  const s = fixture(),
    r = captureBlockRange(s, "item"),
    next = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "code", 0),
        text: "// peer\n",
      }),
    ),
    before = structuredClone(next);
  assert.ok(
    words(
      copyBlocks(next, r).fragment.blocks[0].children[0].children.find(
        (b) => b.type === "code",
      ),
    ).startsWith("// peer\n"),
  );
  assert.deepEqual(next, before);
});
for (const kind of [
  "epoch",
  "parent",
  "range-members",
  "missing",
  "cross-parent",
  "table",
  "root",
])
  test(`Whole-block selection rejects ${kind} without mutation`, () => {
    const s = fixture(true),
      before = structuredClone(s),
      r = captureBlockRange(s, "item");
    if (kind === "epoch") r.epoch++;
    if (kind === "parent") r.parent = "source";
    if (kind === "range-members") r.blocks.push("dest");
    assert.throws(() =>
      kind === "missing"
        ? captureBlockRange(s, "missing")
        : kind === "cross-parent"
          ? captureBlockRange(s, "p", "dest")
          : kind === "table"
            ? captureBlockRange(s, "table")
            : kind === "root"
              ? captureBlockRange(s, "doc")
              : copyBlocks(s, r),
    );
    assert.deepEqual(s, before);
  });
test("Whole-block selection survives unrelated sibling insertion but rejects inserted selected-range content", () => {
  const s = fixture(),
    r = captureBlockRange(s, "code", "image");
  const extend = (inside) => {
    const nodes = structuredClone(s.nodes),
      texts = {};
    for (const n of Object.values(nodes))
      if (n.text) {
        texts[n.id] = text(s, n.id).map((a) => ({
          text: a.char,
          marks: a.marks,
        }));
        delete n.text;
      }
    nodes.extra = { id: "extra", type: "paragraph", live: true };
    nodes.item.children.splice(
      inside ? nodes.item.children.indexOf("image") : 1,
      0,
      "extra",
    );
    texts.extra = [{ text: "new peer block" }];
    return seed(nodes, texts);
  };
  assert.deepEqual(resolveBlockRange(extend(false), r).blocks, [
    "code",
    "image",
  ]);
  assert.throws(() => resolveBlockRange(extend(true), r), /structure changed/);
  assert.deepEqual(s.nodes.item.children, ["p", "nested", "code", "image"]);
});
for (const last of ["image", "code"])
  test(`Whole item copy into selected cell preserves source edits and owned Undo ending=${last}`, () => {
    const initial = fixture(true, "ordered_list", last),
      copy = copyBlocks(initial, captureBlockRange(initial, "item")),
      cells = captureCellRange(initial, "table", "target"),
      grid = { version: 1, rows: [[copy.fragment.blocks]] },
      a = op("A", 1),
      plan = planPasteCells(initial, cells, a, {
        preview: previewCellPaste(initial, cells, grid),
      });
    a.intent = plan.intent;
    let s = apply(initial, a);
    assert.deepEqual(
      copyCells(s, captureCellRange(s, "table", "target")).rows,
      grid.rows,
    );
    assert.deepEqual(s.nodes.item, initial.nodes.item);
    const b = op("B", 1, {
      kind: "insert",
      at: gapAt(s, "code", 0),
      text: "peer",
    });
    s = apply(s, b);
    s = apply(s, op("A", 2, { kind: "undo", target: a.id }));
    assert.equal(
      text(s, "dest")
        .map((a) => a.char)
        .join(""),
      "Destination",
    );
    assert.ok(
      text(s, "code")
        .map((a) => a.char)
        .join("")
        .startsWith("peer"),
    );
    s = apply(s, op("B", 2, { kind: "undo", target: b.id }));
    assert.deepEqual(text(s, "code"), text(initial, "code"));
    assert.deepEqual(s.nodes.target.children, ["dest"]);
    assert.deepEqual(copyBlocks(s, captureBlockRange(s, "item")), copy);
  });
