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
import { planRichInsert, planEnter } from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
    id: `${actor}:s:${seq}`,
    actor,
    stream: "s",
    seq,
    epoch: 1,
    intent,
  }),
  p = (t) => ({
    type: "paragraph",
    content: [{ text: t, marks: [{ type: "em" }] }],
  }),
  range = (s, id, offset) =>
    captureRange(s, { block: id, offset }, { block: id, offset }),
  val = (s, id) =>
    text(s, id)
      .map((a) => a.char)
      .join("");
function fixture(type = "ordered_list") {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["list"] },
      list: { id: "list", type, live: true, children: ["item", "next"] },
      item: {
        id: "item",
        type: "list_item",
        live: true,
        children: ["p", "children"],
      },
      p: { id: "p", type: "paragraph", live: true },
      children: {
        id: "children",
        type,
        live: true,
        children: ["ci", "ci2"],
        ...(type === "ordered_list" ? { order: 1 } : {}),
      },
      ci: { id: "ci", type: "list_item", live: true, children: ["cp", "code"] },
      cp: { id: "cp", type: "paragraph", live: true },
      code: { id: "code", type: "code", live: true, language: "javascript" },
      ci2: { id: "ci2", type: "list_item", live: true, children: ["cp2"] },
      cp2: { id: "cp2", type: "paragraph", live: true },
      next: { id: "next", type: "list_item", live: true, children: ["np"] },
      np: { id: "np", type: "paragraph", live: true },
    },
    {
      p: [{ text: "Sam", marks: ["strong"] }],
      cp: [{ text: "existing" }],
      cp2: [{ text: "second" }],
      code: [{ text: "let a = 1;" }],
      np: [{ text: "next" }],
    },
  );
}
const slice = (start = 2, type = "ordered_list") => ({
  version: 1,
  edges: { start: "partial", end: "partial" },
  blocks: [
    {
      type,
      ...(type === "ordered_list" ? { order: start } : {}),
      children: [
        { type: "list_item", children: [p("one")] },
        { type: "list_item", children: [p("two")] },
      ],
    },
  ],
});
const paste = (s, start = 2, offset = 1, type = "ordered_list") =>
  op(
    "A",
    1,
    planRichInsert(s, range(s, "p", offset), slice(start, type), op("A", 1))
      .intent,
  );
for (const type of ["ordered_list", "bullet_list"])
  for (const start of [1, 2, 9])
    for (const offset of [1, 3])
      test(`Existing children survive paste Undo Redo ${type} start=${start} offset=${offset}`, () => {
        const s = fixture(type),
          anchor = anchorAt(s, "p", 1, 3);
        let n = apply(s, paste(s, start, offset, type));
        assert.equal(val(n, "p"), "Sam".slice(0, offset));
        assert.deepEqual(n.nodes.list.children, ["item", "next"]);
        assert.deepEqual(n.nodes.children.children.slice(-2), ["ci", "ci2"]);
        assert.deepEqual(
          n.nodes.children.children
            .slice(0, 2)
            .map((i) => val(n, n.nodes[i].children[0])),
          ["one", "two" + "Sam".slice(offset)],
        );
        if (type === "ordered_list")
          assert.equal(n.nodes.children.order, start);
        for (const id of ["cp", "cp2", "code"])
          assert.deepEqual(text(n, id), text(s, id));
        const full = structuredClone(n);
        n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
        assert.deepEqual(text(n, "p"), text(s, "p"));
        assert.deepEqual(n.nodes.children.children, s.nodes.children.children);
        assert.equal(n.nodes.children.order, s.nodes.children.order);
        assert.deepEqual(resolveAnchor(n, anchor), resolveAnchor(s, anchor));
        n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
        assert.deepEqual(
          n.nodes.children.children,
          full.nodes.children.children,
        );
        assert.equal(n.nodes.children.order, full.nodes.children.order);
        validate(n);
      });
for (const early of [false, true])
  for (const target of ["p", "cp", "code"])
    test(`Offline text target=${target} early=${early}`, () => {
      const s = fixture(),
        a = paste(s),
        b = op("B", 1, {
          kind: "insert",
          at: gapAt(s, target, 1),
          text: "peer",
        }),
        expected = apply(s, b);
      let n = early ? apply(apply(s, b), a) : apply(apply(s, a), b);
      n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
      assert.deepEqual(text(n, target), text(expected, target));
      assert.deepEqual(n.nodes.children.children, s.nodes.children.children);
      assert.equal(n.nodes.children.order, 1);
      validate(n);
    });
for (const early of [false, true])
  for (const offset of [0, 1, 2, 3])
    test(`Offline parent Enter offset=${offset} early=${early}`, () => {
      const s = fixture(),
        a = paste(s),
        b = op("B", 1, planEnter(s, range(s, "p", offset), op("B", 1)).intent);
      let n = early ? apply(apply(s, b), a) : apply(apply(s, a), b);
      validate(n);
      const full = structuredClone(n);
      n = apply(n, op("B", 2, { kind: "undo", target: b.id }));
      n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
      for (const id of ["p", "cp", "cp2", "code"])
        assert.deepEqual(text(n, id), text(s, id));
      assert.deepEqual(n.nodes.list.children, s.nodes.list.children);
      assert.deepEqual(n.nodes.children.children, s.nodes.children.children);
      assert.equal(n.nodes.children.order, 1);
      n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
      n = apply(n, op("B", 3, { kind: "undo", target: "B:s:2" }));
      for (const node of Object.values(full.nodes).filter((n) => n.live)) {
        assert.deepEqual(n.nodes[node.id].children, node.children);
        if (node.text) assert.deepEqual(text(n, node.id), text(full, node.id));
      }
      validate(n);
    });
for (const arrival of ["AB", "BA"])
  for (const undo of ["AB", "BA"])
    test(`Owned numbering arrival=${arrival} undo=${undo}`, () => {
      const s = fixture(),
        ops = {
          A: paste(s),
          B: op("B", 1, { kind: "listNumbering", list: "children", start: 7 }),
        };
      let n = s;
      for (const actor of arrival) n = apply(n, ops[actor]);
      assert.equal(n.nodes.children.order, arrival === "AB" ? 7 : 2);
      for (const actor of undo) {
        n = apply(n, op(actor, 2, { kind: "undo", target: ops[actor].id }));
        assert.equal(
          n.nodes.children.order,
          actor === undo[1] ? 1 : actor === "A" ? 7 : 2,
        );
      }
      assert.deepEqual(text(n, "p"), text(s, "p"));
      for (const actor of [...undo].reverse())
        n = apply(n, op(actor, 3, { kind: "undo", target: `${actor}:s:2` }));
      assert.equal(n.nodes.children.order, arrival === "AB" ? 7 : 2);
      validate(n);
    });
for (const offset of [0, 1, 3, 5])
  test(`Enter after nested paste offset=${offset} complete Undo Redo`, () => {
    const s = fixture();
    let n = apply(s, paste(s)),
      suffix = "A:s:1:cut:list-tail";
    const b = op(
      "B",
      1,
      planEnter(n, range(n, suffix, offset), op("B", 1)).intent,
    );
    n = apply(n, b);
    const full = structuredClone(n);
    n = apply(n, op("B", 2, { kind: "undo", target: b.id }));
    n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
    assert.deepEqual(text(n, "p"), text(s, "p"));
    n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
    n = apply(n, op("B", 3, { kind: "undo", target: "B:s:2" }));
    for (const node of Object.values(full.nodes).filter((n) => n.live)) {
      assert.deepEqual(n.nodes[node.id].children, node.children);
      if (node.text) assert.deepEqual(text(n, node.id), text(full, node.id));
    }
    validate(n);
  });

for (const count of [1, 2])
  test(`Start paste merges first item without empty prefix count=${count}`, () => {
    const s = fixture(),
      input = slice();
    input.blocks[0].children = input.blocks[0].children.slice(0, count);
    const plan = planRichInsert(s, range(s, "p", 0), input, op("A", 1));
    let n = apply(s, op("A", 1, plan.intent));
    assert.deepEqual(
      n.nodes.list.children.map((i) => val(n, n.nodes[i].children[0])),
      count === 1 ? ["oneSam", "next"] : ["one", "twoSam", "next"],
    );
    assert.deepEqual(n.nodes.item.children.slice(1), ["children"]);
    assert.deepEqual(n.nodes.children.children, ["ci", "ci2"]);
    assert.equal(n.nodes.children.order, 1);
    assert.equal(plan.after.offset, 3);
    n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
    assert.deepEqual(text(n, "p"), text(s, "p"));
    assert.deepEqual(n.nodes.list.children, s.nodes.list.children);
    n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
    validate(n);
  });
for (const present of [false, true])
  test(`Numbering restores original attribute presence present=${present}`, () => {
    let s = fixture();
    if (!present) delete s.nodes.children.order;
    const original = structuredClone(s);
    s = apply(
      s,
      op("B", 1, { kind: "listNumbering", list: "children", start: 8 }),
    );
    s = apply(s, op("B", 2, { kind: "undo", target: "B:s:1" }));
    assert.equal(Object.hasOwn(s.nodes.children, "order"), present);
    assert.equal(s.nodes.children.order, original.nodes.children.order);
    validate(s);
  });
for (const bad of [0, -1, 1.5, "2", null])
  test(`Invalid numbering rejects unchanged ${bad}`, () => {
    const s = fixture(),
      before = structuredClone(s);
    assert.throws(() =>
      apply(
        s,
        op("B", 1, { kind: "listNumbering", list: "children", start: bad }),
      ),
    );
    assert.deepEqual(s, before);
  });
for (const mutation of ["duplicate", "projection", "node", "active", "base"])
  test(`Decoded numbering ledger rejects ${mutation}`, () => {
    const s = structuredClone(
      apply(
        fixture(),
        op("B", 1, { kind: "listNumbering", list: "children", start: 3 }),
      ),
    );
    const l = s.nodes.children.numbering;
    if (mutation === "duplicate") l.layers.push({ ...l.layers[0] });
    if (mutation === "projection") s.nodes.children.order = 4;
    if (mutation === "node") {
      s.nodes.p.numbering = l;
      delete s.nodes.children.numbering;
    }
    if (mutation === "active") l.layers[0].active = 1;
    if (mutation === "base") l.base = 0;
    assert.throws(() => validate(s), /numbering|Numbering/);
  });
for (const mutation of [
  "activation",
  "batch",
  "unrelated-parent",
  "mixed-child",
  "source-attached-start",
])
  test(`Numbering and child-paste admission guards ${mutation}`, () => {
    const s = fixture(),
      before = structuredClone(s);
    assert.throws(() => {
      if (mutation === "activation")
        return apply(
          s,
          op("B", 1, {
            kind: "listNumberingActive",
            list: "children",
            target: "fake",
            active: true,
          }),
        );
      if (mutation === "batch")
        return apply(
          s,
          op("B", 1, {
            kind: "batch",
            intents: [{ kind: "listNumbering", list: "children", start: 3 }],
          }),
        );
      if (mutation === "unrelated-parent")
        return apply(
          s,
          op("B", 1, {
            kind: "richInsert",
            parent: "next",
            at: gapAt(s, "p", 1),
            slice: slice(),
          }),
        );
      if (mutation === "mixed-child") {
        const input = structuredClone(s);
        input.nodes.children.type = "bullet_list";
        return paste(input);
      }
      const v = slice();
      v.blocks[0].children[0].children.push({
        type: "bullet_list",
        children: [{ type: "list_item", children: [p("child")] }],
      });
      return planRichInsert(s, range(s, "p", 0), v, op("A", 1));
    });
    assert.deepEqual(s, before);
  });
test("Copied nested source and old descendant code both survive parent paste", () => {
  const s = fixture(),
    v = slice();
  v.blocks[0].children[0].children.push({
    type: "bullet_list",
    children: [{ type: "list_item", children: [p("new child")] }],
  });
  let n = apply(
    s,
    op("A", 1, planRichInsert(s, range(s, "p", 1), v, op("A", 1)).intent),
  );
  assert.deepEqual(text(n, "code"), text(s, "code"));
  const first = n.nodes[n.nodes.children.children[0]];
  assert.equal(n.nodes[first.children[1]].type, "bullet_list");
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.deepEqual(n.nodes.children.children, ["ci", "ci2"]);
  assert.deepEqual(text(n, "p"), text(s, "p"));
});
