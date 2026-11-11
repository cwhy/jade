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
  planDelete,
  planListIndent,
} from "@cwhy/jade-core/commands";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const value = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const range = (s, id, offset) =>
  captureRange(s, { block: id, offset }, { block: id, offset });
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
function fixture() {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p"] },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "Sam", marks: [{ type: "em" }] }] },
  );
}
const paste = (s) =>
  op("P", 1, planRichInsert(s, range(s, "p", 1), slice, op("P", 1)).intent);
test("Public rich paste matches Lark prefix/list/suffix shape and exact Undo Redo", () => {
  const s = fixture(),
    anchor = anchorAt(s, "p", 1, 3);
  let n = apply(s, paste(s));
  assert.deepEqual(n.nodes.doc.children, ["p", "P:s:1:rich:0"]);
  assert.equal(value(n, "p"), "S");
  const list = n.nodes["P:s:1:rich:0"];
  assert.equal(list.order, 2);
  assert.deepEqual(
    list.children.map((id) => value(n, n.nodes[id].children[0])),
    ["settings", "copyam"],
  );
  assert.deepEqual(
    text(n, "P:s:1:cut:paragraph").slice(-2),
    text(s, "p").slice(1),
  );
  const pasted = structuredClone(n);
  n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
  assert.deepEqual(text(n, "p"), text(s, "p"));
  assert.deepEqual(resolveAnchor(n, anchor), resolveAnchor(s, anchor));
  n = apply(n, op("P", 3, { kind: "undo", target: "P:s:2" }));
  assert.deepEqual(n.nodes.doc.children, pasted.nodes.doc.children);
  assert.deepEqual(
    text(n, "P:s:1:cut:paragraph"),
    text(pasted, "P:s:1:cut:paragraph"),
  );
  validate(n);
});
for (const offset of [0, 2, 4, 5, 6])
  test(`Ordinary command Enter in copied/original text offset=${offset}`, () => {
    const s = fixture(),
      pasted = apply(s, paste(s)),
      id = "P:s:1:cut:paragraph",
      a = op(
        "A",
        1,
        planEnter(pasted, range(pasted, id, offset), op("A", 1)).intent,
      );
    let n = apply(pasted, a);
    validate(n);
    const list = n.nodes["P:s:1:rich:0"];
    assert.deepEqual(
      list.children.map((i) => value(n, n.nodes[i].children[0])),
      ["settings", "copyam".slice(0, offset), "copyam".slice(offset)],
    );
    n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
    assert.deepEqual(text(n, id), text(pasted, id));
    n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
    assert.deepEqual(text(n, "p"), text(s, "p"));
    n = apply(n, op("P", 3, { kind: "undo", target: "P:s:2" }));
    n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
    validate(n);
  });
for (const order of ["PB", "BP"])
  test(`Offline suffix typing and paste order=${order}`, () => {
    const s = fixture(),
      ops = {
        P: paste(s),
        B: op("B", 1, { kind: "insert", at: gapAt(s, "p", 2), text: "peer" }),
      };
    let n = s;
    for (const a of order) n = apply(n, ops[a]);
    assert.equal(value(n, "P:s:1:cut:paragraph"), "copyapeerm");
    n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
    assert.equal(value(n, "p"), "Sapeerm");
    n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
    assert.deepEqual(text(n, "p"), text(s, "p"));
  });
for (const kind of ["backward", "forward"])
  test(`Delete boundary after a new list Enter kind=${kind}`, () => {
    const s = fixture(),
      pasted = apply(s, paste(s)),
      id = "P:s:1:cut:paragraph";
    let n = apply(
      pasted,
      op("A", 1, planEnter(pasted, range(pasted, id, 5), op("A", 1)).intent),
    );
    const tail = "A:s:1:list-tail",
      target = kind === "backward" ? tail : id,
      offset = kind === "backward" ? 0 : 5;
    n = apply(
      n,
      op(
        "B",
        1,
        planDelete(n, range(n, target, offset), kind, op("B", 1)).intent,
      ),
    );
    if (kind === "forward") assert.equal(value(n, id), "copyam");
    else {
      assert.equal(value(n, tail), "m");
      assert.ok(n.nodes.doc.children.includes(tail));
    }
    n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
    n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
    n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
    assert.deepEqual(text(n, "p"), text(s, "p"));
  });

test("Backspace outdent followed by Enter uses its current prose placement", () => {
  const s = fixture(),
    pasted = apply(s, paste(s)),
    id = "P:s:1:cut:paragraph";
  let n = apply(
    pasted,
    op("A", 1, planEnter(pasted, range(pasted, id, 4), op("A", 1)).intent),
  );
  const tail = "A:s:1:list-tail";
  n = apply(
    n,
    op("B", 1, planDelete(n, range(n, tail, 0), "backward", op("B", 1)).intent),
  );
  n = apply(n, op("C", 1, planEnter(n, range(n, tail, 1), op("C", 1)).intent));
  assert.equal(value(n, tail), "a");
  assert.equal(value(n, "C:s:1:paragraph"), "m");
  n = apply(n, op("C", 2, { kind: "undo", target: "C:s:1" }));
  n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
  assert.deepEqual(text(n, "p"), text(s, "p"));
});
for (const offset of [0, 1, 2, 3])
  for (const order of ["PB", "BP"])
    test(`Offline original paragraph Enter across paste offset=${offset} order=${order}`, () => {
      const s = fixture(),
        ops = {
          P: paste(s),
          B: op("B", 1, planEnter(s, range(s, "p", offset), op("B", 1)).intent),
        };
      let n = s;
      for (const actor of order) n = apply(n, ops[actor]);
      validate(n);
      n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
      n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
      assert.deepEqual(text(n, "p"), text(s, "p"));
      assert.deepEqual(n.nodes.doc.children, ["p"]);
    });
for (const offset of [2, 3])
  test(`Separated prose boundary Undo Redo retains exact visible placement offset=${offset}`, () => {
    const s = fixture(),
      b = op("B", 1, planEnter(s, range(s, "p", offset), op("B", 1)).intent);
    let n = apply(apply(s, b), paste(s));
    const before = structuredClone(n),
      anchor = anchorAt(s, "p", 1, 3);
    n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
    n = JSON.parse(JSON.stringify(n));
    n = apply(n, op("B", 3, { kind: "undo", target: "B:s:2" }));
    assert.deepEqual(n.nodes.doc.children, before.nodes.doc.children);
    assert.deepEqual(
      n.nodes["P:s:1:rich:0"].children,
      before.nodes["P:s:1:rich:0"].children,
    );
    for (const node of Object.values(before.nodes).filter(
      (n) => n.live && n.text,
    ))
      assert.deepEqual(text(n, node.id), text(before, node.id));
    assert.deepEqual(resolveAnchor(n, anchor), resolveAnchor(before, anchor));
    n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
    n = apply(n, op("B", 4, { kind: "undo", target: "B:s:3" }));
    assert.deepEqual(text(n, "p"), text(s, "p"));
  });
test("Nested list tail, blank destination and repeated split/paste Undo Redo preserve structure", () => {
  const s = seed(
      {
        doc: { id: "doc", type: "doc", live: true, children: ["p"] },
        p: { id: "p", type: "paragraph", live: true },
      },
      { p: [] },
    ),
    nested = structuredClone(slice);
  nested.blocks[0].children[1].children.push({
    type: "bullet_list",
    children: [{ type: "list_item", children: [para("deep")] }],
  });
  let n = apply(
    s,
    op("P", 1, planRichInsert(s, range(s, "p", 0), nested, op("P", 1)).intent),
  );
  const id = "P:s:1:cut:paragraph",
    initial = structuredClone(n);
  n = apply(n, op("A", 1, planEnter(n, range(n, id, 2), op("A", 1)).intent));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
  assert.deepEqual(n.nodes.doc.children, ["p"]);
  assert.equal(value(n, "p"), "");
  n = apply(n, op("P", 3, { kind: "undo", target: "P:s:2" }));
  assert.deepEqual(n.nodes.doc.children, initial.nodes.doc.children);
  assert.equal(value(n, id), "deep");
  validate(n);
});

test("Paste then Enter indent and parent Enter all reverse without losing source", () => {
  const s = fixture(),
    id = "P:s:1:cut:paragraph";
  let n = apply(s, paste(s));
  n = apply(n, op("A", 1, planEnter(n, range(n, id, 4), op("A", 1)).intent));
  const tail = "A:s:1:list-tail";
  n = apply(
    n,
    op(
      "B",
      1,
      planListIndent(n, range(n, tail, 0), op("B", 1), { outdent: false })
        .intent,
    ),
  );
  n = apply(n, op("C", 1, planEnter(n, range(n, id, 2), op("C", 1)).intent));
  n = apply(n, op("C", 2, { kind: "undo", target: "C:s:1" }));
  n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
  assert.deepEqual(text(n, "p"), text(s, "p"));
});
test("Repeated Enter in nested adopted region preserves every wrapper", () => {
  const s = fixture(),
    id = "P:s:1:cut:paragraph";
  let n = apply(s, paste(s));
  n = apply(n, op("A", 1, planEnter(n, range(n, id, 4), op("A", 1)).intent));
  const tail = "A:s:1:list-tail";
  n = apply(
    n,
    op(
      "B",
      1,
      planListIndent(n, range(n, tail, 0), op("B", 1), { outdent: false })
        .intent,
    ),
  );
  n = apply(n, op("C", 1, planEnter(n, range(n, id, 2), op("C", 1)).intent));
  n = apply(
    n,
    op("D", 1, planEnter(n, range(n, "C:s:1:list-tail", 1), op("D", 1)).intent),
  );
  n = apply(n, op("D", 2, { kind: "undo", target: "D:s:1" }));
  n = apply(n, op("C", 2, { kind: "undo", target: "C:s:1" }));
  n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
  assert.deepEqual(text(n, "p"), text(s, "p"));
});
test("Nested placement round trip Redo preserves every item identity", () => {
  const s = fixture(),
    id = "P:s:1:cut:paragraph";
  let n = apply(s, paste(s));
  n = apply(n, op("A", 1, planEnter(n, range(n, id, 4), op("A", 1)).intent));
  const tail = "A:s:1:list-tail";
  n = apply(
    n,
    op(
      "B",
      1,
      planListIndent(n, range(n, tail, 0), op("B", 1), { outdent: false })
        .intent,
    ),
  );
  n = apply(n, op("C", 1, planEnter(n, range(n, id, 2), op("C", 1)).intent));
  n = apply(
    n,
    op("D", 1, planEnter(n, range(n, "C:s:1:list-tail", 1), op("D", 1)).intent),
  );
  const full = structuredClone(n);
  n = apply(n, op("D", 2, { kind: "undo", target: "D:s:1" }));
  n = apply(n, op("C", 2, { kind: "undo", target: "C:s:1" }));
  n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
  assert.deepEqual(text(n, "p"), text(s, "p"));
  for (const actor of ["P", "A", "B", "C", "D"])
    n = apply(n, op(actor, 3, { kind: "undo", target: actor + ":s:2" }));
  for (const node of Object.values(full.nodes).filter((n) => n.live)) {
    assert.deepEqual(n.nodes[node.id].children, node.children);
    if (node.text) assert.deepEqual(text(n, node.id), text(full, node.id));
  }
  validate(n);
});
