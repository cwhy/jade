// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planRichInsert,
  planEnter,
  planListIndent,
} from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const para = (t) => ({
  type: "paragraph",
  content: [{ text: t, marks: [{ type: "strong" }] }],
});
const slice = {
  version: 1,
  edges: { start: "partial", end: "partial" },
  blocks: [
    {
      type: "ordered_list",
      order: 2,
      children: [
        { type: "list_item", children: [para("settings")] },
        { type: "list_item", children: [para("copy")] },
      ],
    },
  ],
};
function fixture(nested = false) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["list"] },
    list: {
      id: "list",
      type: "ordered_list",
      live: true,
      order: 1,
      children: ["i0", "i1", "i2"],
    },
  };
  for (let i = 0; i < 3; i++) {
    nodes["i" + i] = {
      id: "i" + i,
      type: "list_item",
      live: true,
      children: ["p" + i],
    };
    nodes["p" + i] = { id: "p" + i, type: "paragraph", live: true };
  }
  if (nested) {
    nodes.doc.children = ["outer"];
    nodes.outer = {
      id: "outer",
      type: "bullet_list",
      live: true,
      children: ["oi"],
    };
    nodes.oi = {
      id: "oi",
      type: "list_item",
      live: true,
      children: ["op", "list"],
    };
    nodes.op = { id: "op", type: "paragraph", live: true };
  }
  return seed(nodes, {
    p0: [{ text: "Sam" }],
    p1: [{ text: "Sam" }],
    p2: [{ text: "Sam" }],
    ...(nested ? { op: [{ text: "parent" }] } : {}),
  });
}
const range = (s, id, offset) =>
  captureRange(s, { block: id, offset }, { block: id, offset });
const value = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const paste = (s, id, offset = 1) =>
  op("A", 1, planRichInsert(s, range(s, id, offset), slice, op("A", 1)).intent);
for (const nested of [false, true])
  for (const index of [0, 1, 2])
    for (const offset of [0, 1, 3])
      test(`List item paste exact shape and Undo Redo nested=${nested} item=${index} offset=${offset}`, () => {
        const s = fixture(nested),
          id = "p" + index,
          anchor = anchorAt(s, id, 0, 3),
          a = paste(s, id, offset);
        let n = apply(s, a);
        validate(n);
        assert.deepEqual(
          n.nodes.list.children.map((i) => value(n, n.nodes[i].children[0])),
          [
            ...Array(index).fill("Sam"),
            "Sam".slice(0, offset),
            "settings",
            "copy" + "Sam".slice(offset),
            ...Array(2 - index).fill("Sam"),
          ],
        );
        const pasted = structuredClone(n);
        n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
        assert.deepEqual(text(n, id), text(s, id));
        assert.deepEqual(n.nodes.list.children, s.nodes.list.children);
        assert.deepEqual(resolveAnchor(n, anchor), resolveAnchor(s, anchor));
        n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
        assert.deepEqual(n.nodes.list.children, pasted.nodes.list.children);
        for (const node of Object.values(pasted.nodes).filter(
          (n) => n.live && n.text,
        ))
          assert.deepEqual(text(n, node.id), text(pasted, node.id));
        validate(n);
      });
for (const offset of [0, 1, 2, 3])
  for (const early of [false, true])
    test(`Original peer typing offset=${offset} early=${early}`, () => {
      const s = fixture(),
        a = paste(s, "p1"),
        b = op("B", 1, {
          kind: "insert",
          at: gapAt(s, "p1", offset),
          text: "peer",
        }),
        expected = apply(s, b);
      let n = early ? apply(apply(s, b), a) : apply(apply(s, a), b);
      n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
      assert.deepEqual(text(n, "p1"), text(expected, "p1"));
      assert.deepEqual(n.nodes.list.children, s.nodes.list.children);
      validate(n);
    });
for (const offset of [0, 1, 2, 3])
  for (const early of [false, true])
    test(`Offline original Enter offset=${offset} early=${early}`, () => {
      const s = fixture(),
        a = paste(s, "p1"),
        b = op("B", 1, planEnter(s, range(s, "p1", offset), op("B", 1)).intent);
      let n = early ? apply(apply(s, b), a) : apply(apply(s, a), b);
      n = JSON.parse(JSON.stringify(n));
      n = apply(n, op("B", 2, { kind: "undo", target: b.id }));
      n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
      assert.deepEqual(text(n, "p1"), text(s, "p1"));
      assert.deepEqual(n.nodes.list.children, s.nodes.list.children);
      validate(n);
    });
for (const offset of [0, 2, 4, 6])
  test(`Enter adopted list suffix offset=${offset} Undo and all Redos`, () => {
    const s = fixture(),
      a = paste(s, "p1");
    let n = apply(s, a);
    const id = "A:s:1:cut:list-tail",
      b = op("B", 1, planEnter(n, range(n, id, offset), op("B", 1)).intent);
    n = apply(n, b);
    const before = structuredClone(n);
    n = apply(n, op("B", 2, { kind: "undo", target: b.id }));
    n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
    assert.deepEqual(text(n, "p1"), text(s, "p1"));
    n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
    n = apply(n, op("B", 3, { kind: "undo", target: "B:s:2" }));
    assert.deepEqual(n.nodes.list.children, before.nodes.list.children);
    for (const node of Object.values(before.nodes).filter(
      (n) => n.live && n.text,
    ))
      assert.deepEqual(text(n, node.id), text(before, node.id));
    validate(n);
  });
for (const variant of [
  "type",
  "attachment",
  "nested-tail",
  "parent",
  "selected",
])
  test(`Unsupported list destination rejects unchanged ${variant}`, () => {
    const s = fixture(),
      before = structuredClone(s),
      input = structuredClone(slice);
    if (variant === "type") input.blocks[0].type = "bullet_list";
    if (variant === "attachment")
      input.blocks[0].children
        .at(-1)
        .children.push({ type: "code", language: "text", content: [] });
    if (variant === "nested-tail")
      input.blocks[0].children
        .at(-1)
        .children.push({
          type: "bullet_list",
          children: [{ type: "list_item", children: [para("child")] }],
        });
    assert.throws(() => {
      if (variant === "parent")
        return apply(
          s,
          op("A", 1, {
            kind: "richInsert",
            parent: "i0",
            at: gapAt(s, "p1", 1),
            slice: input,
          }),
        );
      return planRichInsert(
        s,
        variant === "selected"
          ? captureRange(
              s,
              { block: "p1", offset: 0 },
              { block: "p1", offset: 2 },
            )
          : range(s, "p1", 1),
        input,
        op("A", 1),
      );
    });
    assert.deepEqual(s, before);
  });
test("Copied earlier subtree retains nested list, marks and code through Undo Redo", () => {
  const s = fixture(true),
    input = structuredClone(slice);
  input.blocks[0].children[0].children.push({
    type: "bullet_list",
    children: [
      {
        type: "list_item",
        children: [
          para("Nested"),
          {
            type: "code",
            language: "javascript",
            content: [{ text: "let n = 2;", marks: [] }],
          },
        ],
      },
    ],
  });
  const a = op(
    "A",
    1,
    planRichInsert(s, range(s, "p1", 1), input, op("A", 1)).intent,
  );
  let n = apply(s, a);
  const original = structuredClone(n);
  n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
  assert.deepEqual(n.nodes.list.children, s.nodes.list.children);
  n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
  for (const node of Object.values(original.nodes).filter((n) => n.live)) {
    assert.deepEqual(n.nodes[node.id].children, node.children);
    if (node.text) assert.deepEqual(text(n, node.id), text(original, node.id));
  }
  validate(n);
});
test("Peer contribution to new copied item guards whole paste Undo atomically", () => {
  const s = fixture();
  let n = apply(s, paste(s, "p1"));
  const item = n.nodes.list.children[2],
    id = n.nodes[item].children[0];
  n = apply(
    n,
    op("B", 1, { kind: "insert", at: gapAt(n, id, 1), text: "peer" }),
  );
  const before = structuredClone(n);
  assert.throws(
    () => apply(n, op("A", 2, { kind: "undo", target: "A:s:1" })),
    /contributions/,
  );
  assert.deepEqual(n, before);
  n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.deepEqual(text(n, "p1"), text(s, "p1"));
});
test("Nested split indent and repeated Enter survive full Undo Redo", () => {
  const s = fixture();
  let n = apply(s, paste(s, "p1"));
  const suffix = "A:s:1:cut:list-tail";
  const run = (seq, plan) => {
    n = apply(n, op("A", seq, plan.intent));
  };
  run(2, planEnter(n, range(n, suffix, 2), op("A", 2)));
  const tail = "A:s:2:list-tail";
  run(3, planListIndent(n, range(n, tail, 1), op("A", 3)));
  run(4, planEnter(n, range(n, suffix, 1), op("A", 4)));
  const before = structuredClone(n);
  for (let seq = 5; seq <= 8; seq++)
    n = apply(n, op("A", seq, { kind: "undo", target: `A:s:${9 - seq}` }));
  assert.deepEqual(text(n, "p1"), text(s, "p1"));
  for (let seq = 9; seq <= 12; seq++)
    n = apply(n, op("A", seq, { kind: "undo", target: `A:s:${17 - seq}` }));
  for (const node of Object.values(before.nodes).filter((n) => n.live)) {
    assert.deepEqual(n.nodes[node.id].children, node.children);
    if (node.text) assert.deepEqual(text(n, node.id), text(before, node.id));
  }
  validate(n);
});
