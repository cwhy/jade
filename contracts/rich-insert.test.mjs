// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { planRichInsert } from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const p = (s) => ({
  type: "paragraph",
  content: [{ text: s, marks: [{ type: "em" }] }],
});
const code = {
  type: "code",
  language: "javascript",
  content: [{ text: "const retry = 2;\nretry();", marks: [] }],
};
const list = {
  type: "ordered_list",
  order: 3,
  children: [
    {
      type: "list_item",
      children: [
        p("Review"),
        {
          type: "bullet_list",
          children: [{ type: "list_item", children: [p("Nested")] }],
        },
      ],
    },
  ],
};
const image = {
  type: "image",
  asset: "mock.png",
  alt: "mock",
  width: 200,
  height: 100,
};
const slice = (blocks) => ({
  version: 1,
  edges: { start: "partial", end: "partial" },
  blocks,
});
function fixture(cell = false) {
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children: cell ? ["table"] : ["p", "source"],
    },
    p: { id: "p", type: "paragraph", live: true },
    source: { id: "source", type: "image", live: true, asset: "mock.png" },
  };
  if (cell)
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["p", "source"] },
    });
  return seed(nodes, { p: [{ text: "ABCD", marks: [{ type: "strong" }] }] });
}
const range = (s, offset = 2) =>
  captureRange(s, { block: "p", offset }, { block: "p", offset });
const val = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const paste = (s, blocks, actor = "A", seq = 1) =>
  op(
    actor,
    seq,
    planRichInsert(s, range(s), slice(blocks), op(actor, seq)).intent,
  );
for (const cell of [false, true])
  for (const blocks of [
    [p("intro"), code],
    [image],
    [code, p("tail")],
    [p("intro"), list, code, p("tail")],
  ])
    test(`Atomic rich insertion exact content/identity Undo Redo cell=${cell} types=${blocks.map((b) => b.type)}`, () => {
      const initial = fixture(cell),
        source = text(initial, "p"),
        anchor = anchorAt(initial, "p", 2, 4),
        command = paste(initial, blocks);
      let s = apply(initial, command);
      validate(s);
      const parent = cell ? "cell" : "doc",
        suffix = "A:s:1:cut:paragraph";
      assert.equal(
        val(s, "p"),
        "AB" + (blocks[0].type === "paragraph" ? "intro" : ""),
      );
      assert.equal(
        val(s, suffix),
        (blocks.at(-1).type === "paragraph" ? "tail" : "") + "CD",
      );
      assert.deepEqual(text(s, "p").slice(0, 2), source.slice(0, 2));
      assert.deepEqual(text(s, suffix).slice(-2), source.slice(2));
      assert.equal(s.nodes[parent].children.at(-1), "source");
      const pasted = structuredClone(s);
      s = JSON.parse(JSON.stringify(s));
      s = apply(s, op("A", 2, { kind: "undo", target: command.id }));
      assert.deepEqual(text(s, "p"), source);
      assert.deepEqual(
        s.nodes[parent].children,
        initial.nodes[parent].children,
      );
      assert.deepEqual(
        resolveAnchor(s, anchor),
        resolveAnchor(initial, anchor),
      );
      validate(s);
      s = apply(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
      assert.deepEqual(s.nodes[parent].children, pasted.nodes[parent].children);
      for (const n of Object.values(pasted.nodes).filter(
        (n) => n.live && n.text,
      ))
        assert.deepEqual(text(s, n.id), text(pasted, n.id));
      validate(s);
    });
for (const early of [false, true])
  for (const offset of [1, 3])
    test(`Offline peer typing around the original caret survives paste and Undo early=${early} offset=${offset}`, () => {
      const initial = fixture(),
        a = paste(initial, [p("intro"), code]),
        b = op("B", 1, {
          kind: "insert",
          at: gapAt(initial, "p", offset),
          text: "peer",
          marks: [{ type: "em" }],
        }),
        expected = apply(initial, b);
      let s = early ? apply(apply(initial, b), a) : apply(apply(initial, a), b);
      s = JSON.parse(JSON.stringify(s));
      s = apply(s, op("A", 2, { kind: "undo", target: a.id }));
      assert.deepEqual(text(s, "p"), text(expected, "p"));
      assert.deepEqual(s.nodes.doc.children, initial.nodes.doc.children);
      validate(s);
    });
test("Peer contributions inside a pasted block make Undo atomic and non-destructive", () => {
  let s = fixture();
  s = apply(s, paste(s, [p("intro"), code]));
  s = apply(
    s,
    op("B", 1, {
      kind: "insert",
      at: gapAt(s, "A:s:1:rich:0", 4),
      text: "peer",
    }),
  );
  const before = structuredClone(s);
  assert.throws(
    () => apply(s, op("A", 2, { kind: "undo", target: "A:s:1" })),
    /other contributions/,
  );
  assert.deepEqual(s, before);
  s = apply(s, op("B", 2, { kind: "undo", target: "B:s:1" }));
  s = apply(s, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.equal(val(s, "p"), "ABCD");
});
test("Enter and own Undo in inserted paragraph preserve later paste Undo", () => {
  let s = fixture();
  s = apply(s, paste(s, [code, p("middle"), image]));
  const middle = "A:s:1:rich:1";
  s = apply(s, op("B", 1, { kind: "proseEnter", at: gapAt(s, middle, 3) }));
  s = apply(s, op("B", 2, { kind: "undo", target: "B:s:1" }));
  s = apply(s, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.equal(val(s, "p"), "ABCD");
  validate(s);
});
test("Fresh paste identities do not alias source, another paste or original characters", () => {
  let s = fixture();
  s = apply(s, paste(s, [code]));
  s = apply(s, paste(s, [code], "B"));
  const a = text(s, "A:s:1:rich:0"),
    b = text(s, "B:s:1:rich:0");
  assert.equal(a.map((x) => x.char).join(""), b.map((x) => x.char).join(""));
  assert.ok(a.every((x) => !b.some((y) => x.id === y.id)));
  validate(s);
});
test("Read-only planner returns caret before original suffix after trailing paragraph", () => {
  const s = fixture(),
    plan = planRichInsert(s, range(s), slice([code, p("tail")]), op("A", 1));
  assert.equal(plan.after.offset, 4);
  assert.equal(val(s, "p"), "ABCD");
});
for (const offset of [0, 4])
  test(`Code-only insertion at paragraph boundary remains reversible offset=${offset}`, () => {
    const s = fixture(),
      a = op(
        "A",
        1,
        planRichInsert(s, range(s, offset), slice([code]), op("A", 1)).intent,
      ),
      n = apply(s, a);
    assert.equal(val(n, "p"), "ABCD".slice(0, offset));
    assert.equal(val(n, "A:s:1:cut:paragraph"), "ABCD".slice(offset));
    assert.deepEqual(
      text(apply(n, op("A", 2, { kind: "undo", target: a.id })), "p"),
      text(s, "p"),
    );
  });
for (const mutation of [
  "list-tail",
  "asset",
  "identity",
  "batch",
  "lifecycle",
  "selection",
])
  test(`Unsupported or forged rich paste rejects unchanged ${mutation}`, () => {
    const s = fixture(),
      before = structuredClone(s);
    assert.throws(() => {
      if (mutation === "selection")
        return planRichInsert(
          s,
          captureRange(s, { block: "p", offset: 1 }, { block: "p", offset: 3 }),
          slice([code]),
          op("A", 1),
        );
      const intent = {
        kind: "richInsert",
        parent: "doc",
        at: gapAt(s, "p", 2),
        slice: slice(
          mutation === "list-tail"
            ? [
                {
                  ...list,
                  children: [
                    { type: "list_item", children: [p("Review"), code] },
                  ],
                },
              ]
            : mutation === "asset"
              ? [{ ...image, asset: "private.png" }]
              : [code],
        ),
      };
      if (mutation === "identity")
        intent.slice.blocks[0] = { ...code, id: "p" };
      return apply(
        s,
        op(
          "A",
          1,
          mutation === "batch"
            ? { kind: "batch", intents: [intent] }
            : mutation === "lifecycle"
              ? { kind: "richForestActive", active: true }
              : intent,
        ),
      );
    });
    assert.deepEqual(s, before);
  });
test("A queued edit targeting a pasted block retired by Undo rejects without resurrection", () => {
  let s = fixture();
  s = apply(s, paste(s, [code]));
  const b = op("B", 1, {
    kind: "insert",
    at: gapAt(s, "A:s:1:rich:0", 3),
    text: "offline",
  });
  s = apply(s, op("A", 2, { kind: "undo", target: "A:s:1" }));
  const before = structuredClone(s);
  assert.throws(() => apply(s, b), /retired|cleared|deleted|no longer live/);
  assert.deepEqual(s, before);
});
for (const order of ["AB", "BA"])
  test(`Independent rich pastes at one original caret settle and Undo in reverse acceptance order ${order}`, () => {
    const initial = fixture(),
      a = paste(initial, [p("alpha"), code]),
      b = paste(initial, [p("beta"), image], "B"),
      ops = { A: a, B: b };
    let s = initial;
    for (const actor of order) s = apply(s, ops[actor]);
    validate(s);
    s = JSON.parse(JSON.stringify(s));
    for (const actor of [...order].reverse())
      s = apply(s, op(actor, 2, { kind: "undo", target: ops[actor].id }));
    assert.deepEqual(text(s, "p"), text(initial, "p"));
    assert.deepEqual(s.nodes.doc.children, initial.nodes.doc.children);
  });
test("Created list can split and undo its own Enter before paste Undo", () => {
  let s = fixture();
  s = apply(s, paste(s, [list, code]));
  const target = "A:s:1:rich:2";
  s = apply(s, op("B", 1, { kind: "listEnter", at: gapAt(s, target, 3) }));
  s = apply(s, op("B", 2, { kind: "undo", target: "B:s:1" }));
  s = apply(s, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.equal(val(s, "p"), "ABCD");
  validate(s);
});
for (const early of [false, true])
  test(`Independent Enter beside caret paste settles early=${early}`, () => {
    const initial = fixture(),
      a = paste(initial, [code]),
      b = op("B", 1, { kind: "proseEnter", at: gapAt(initial, "p", 1) });
    let s = early ? apply(apply(initial, b), a) : apply(apply(initial, a), b);
    s = apply(s, op("B", 2, { kind: "undo", target: b.id }));
    s = apply(s, op("A", 2, { kind: "undo", target: a.id }));
    assert.deepEqual(text(s, "p"), text(initial, "p"));
    assert.deepEqual(s.nodes.doc.children, initial.nodes.doc.children);
  });
