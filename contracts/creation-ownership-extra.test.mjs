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
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planRichInsert,
  planEnter,
  planClearCells,
  previewTableDelete,
  planTableDelete,
} from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const point = (s, id, offset) =>
  captureRange(s, { block: id, offset }, { block: id, offset });
function fixture() {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["table"] },
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: ["list", "asset"],
      },
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item", "next"],
      },
      item: { id: "item", type: "list_item", live: true, children: ["p"] },
      next: { id: "next", type: "list_item", live: true, children: ["q"] },
      p: { id: "p", type: "paragraph", live: true },
      q: { id: "q", type: "paragraph", live: true },
      asset: { id: "asset", type: "image", live: true, asset: "mock.png" },
    },
    { p: [{ text: "ABCD", marks: ["strong"] }], q: [{ text: "Next" }] },
  );
}
function paste(s, type, offset) {
  const slice = {
    version: 1,
    edges: { start: "boundary", end: "boundary" },
    blocks: [
      {
        type: "ordered_list",
        order: 2,
        children: [
          {
            type: "list_item",
            children: [
              {
                type: "paragraph",
                content: [{ text: "Copied", marks: ["em"] }],
              },
              type === "image"
                ? { type: "image", asset: "mock.png" }
                : {
                    type: "code",
                    language: "text",
                    content: [{ text: "const ready = true;", marks: [] }],
                  },
            ],
          },
        ],
      },
    ],
  };
  return op(
    "A",
    1,
    planRichInsert(s, point(s, "p", offset), slice, op("A", 1)).intent,
  );
}
const para = "A:s:1:attached:paragraph",
  attachment = "A:s:1:attached:attachment";
const undo = (s, actor, seq, target) =>
  apply(s, op(actor, seq, { kind: "undo", target }));
const parent = (s, id) =>
  Object.values(s.nodes).find((n) => n.live && n.children?.includes(id));
function visible(s, id = s.root) {
  const n = s.nodes[id];
  return {
    id: n.id,
    type: n.type,
    ...(n.text ? { atoms: text(s, id) } : {}),
    ...(n.type === "code" ? { language: n.language } : {}),
    ...(n.type === "image" ? { asset: n.asset } : {}),
    ...(n.children ? { children: n.children.map((x) => visible(s, x)) } : {}),
  };
}
const all = (s) =>
  Object.values(s.nodes)
    .filter((n) => n.live && n.text)
    .flatMap((n) => text(s, n.id));
for (const type of ["image", "code"])
  for (const offset of [0, 2, 4])
    for (const late of [false, true])
      test(`Enter, paste Undo and Redo with active peer ${type} offset=${offset} late=${late}`, () => {
        const initial = fixture(),
          a = paste(initial, type, offset),
          pasted = apply(initial, a);
        const enter = op(
            "B",
            1,
            planEnter(pasted, point(pasted, para, 3), op("B", 1)).intent,
          ),
          split = apply(pasted, enter),
          tail = "B:s:1:list-tail";
        const typing = op("B", 2, {
          kind: "insert",
          at: gapAt(split, tail, 0),
          text: "peer",
          marks: ["strong"],
        });
        const expected = apply(split, typing),
          anchor = anchorAt(expected, tail, 0, 4),
          ancestry = [
            parent(expected, tail).type,
            parent(expected, parent(expected, tail).id).type,
          ];
        let s = pasted;
        if (!late) s = apply(apply(s, enter), typing);
        s = undo(s, "A", 2, a.id);
        if (late) s = apply(apply(s, enter), typing);
        validate(s);
        assert.equal(s.nodes[attachment].live, false);
        assert.equal(
          all(s).filter((x) => x.id.startsWith(a.id + ":")).length,
          0,
        );
        assert.equal(resolveAnchor(s, anchor).status, "exact");
        assert.deepEqual(
          [parent(s, tail).type, parent(s, parent(s, tail).id).type],
          ancestry,
        );
        s = undo(s, "A", 3, "A:s:2");
        validate(s);
        assert.deepEqual(
          visible(s),
          visible(expected),
          "Redo restores exact content, marks and placement while peer stays active",
        );
        s = undo(s, "B", 3, typing.id);
        s = undo(s, "B", 4, enter.id);
        assert.deepEqual(visible(s), visible(pasted));
        s = undo(s, "A", 4, "A:s:3");
        validate(s);
        assert.deepEqual(visible(s), visible(initial));
      });
for (const offset of [0, 2, 4])
  for (const late of [false, true])
    test(`Copied code late typing and active-peer Redo offset=${offset} late=${late}`, () => {
      const initial = fixture(),
        a = paste(initial, "code", offset),
        pasted = apply(initial, a),
        b = op("B", 1, {
          kind: "insert",
          at: gapAt(pasted, attachment, 6),
          text: "peer",
        }),
        expected = apply(pasted, b);
      let s = late ? pasted : expected;
      s = undo(s, "A", 2, a.id);
      if (late) s = apply(s, b);
      assert.equal(
        text(s, attachment)
          .map((a) => a.char)
          .join(""),
        "peer",
      );
      assert.equal(s.nodes[attachment].language, "text");
      s = undo(s, "A", 3, "A:s:2");
      assert.deepEqual(visible(s), visible(expected));
    });
for (const offset of [0, 2, 4])
  test(`Later same-actor insertion is independent of birth offset=${offset}`, () => {
    const initial = fixture(),
      a = paste(initial, "image", offset),
      pasted = apply(initial, a),
      b = op("A", 2, {
        kind: "insert",
        at: gapAt(pasted, para, 2),
        text: "later",
      });
    let s = apply(pasted, b);
    s = undo(s, "A", 3, a.id);
    assert.equal(
      text(s, para)
        .map((a) => a.char)
        .join(""),
      "later",
    );
    s = undo(s, "A", 4, b.id);
    assert.deepEqual(visible(s), visible(initial));
    s = undo(s, "A", 5, "A:s:3");
    assert.deepEqual(visible(s), visible(pasted));
  });
for (const offset of [0, 2, 4])
  for (const first of ["B", "C"])
    test(`Two offline peers release independent dependencies offset=${offset} first=${first}`, () => {
      const initial = fixture(),
        a = paste(initial, "image", offset),
        pasted = apply(initial, a),
        ops = {
          B: op("B", 1, {
            kind: "insert",
            at: gapAt(pasted, para, 1),
            text: "B",
          }),
          C: op("C", 1, {
            kind: "insert",
            at: gapAt(pasted, para, 5),
            text: "C",
          }),
        },
        second = first === "B" ? "C" : "B";
      let s = undo(pasted, "A", 2, a.id);
      s = apply(apply(s, ops[first]), ops[second]);
      assert.equal(
        text(s, para)
          .map((a) => a.char)
          .join(""),
        "BC",
      );
      s = undo(s, first, 2, ops[first].id);
      assert.equal(
        text(s, para)
          .map((a) => a.char)
          .join(""),
        second,
      );
      s = undo(s, second, 2, ops[second].id);
      validate(s);
      assert.deepEqual(visible(s), visible(initial));
    });
for (const type of ["image", "code"])
  for (const priorUndo of [false, true])
    for (const destructive of ["clear", "table"])
      test(`Explicit ${destructive} fences retained birth ${type} priorUndo=${priorUndo}`, () => {
        const initial = fixture(),
          a = paste(initial, type, 2),
          pasted = apply(initial, a),
          b = op("B", 1, {
            kind: "insert",
            at: gapAt(pasted, para, 2),
            text: "late",
          });
        let s = priorUndo ? undo(pasted, "A", 2, a.id) : pasted;
        const range = captureCellRange(s, "table", "cell", "cell"),
          c = op("C", 1);
        const intent =
          destructive === "clear"
            ? planClearCells(s, range, c).intent
            : planTableDelete(s, range, c, {
                preview: previewTableDelete(s, range, "table"),
              }).intent;
        s = apply(s, { ...c, intent });
        const before = structuredClone(s);
        assert.throws(() => apply(s, b), /cleared|deleted/);
        assert.deepEqual(s, before);
        validate(s);
      });
for (const type of ["image", "code"])
  test(`Internal creation activity cannot be supplied by a client ${type}`, () => {
    let s = fixture();
    s = apply(s, paste(s, type, 0));
    const before = structuredClone(s);
    assert.throws(
      () =>
        apply(
          s,
          op("B", 1, {
            kind: "creationActive",
            creation: "A:s:1",
            active: false,
          }),
        ),
      /unsupported|internal/,
    );
    assert.deepEqual(s, before);
    const old = op("B", 1, {
      kind: "insert",
      at: gapAt(s, para, 1),
      text: "stale",
    });
    s = { ...s, epoch: 2 };
    assert.throws(() => apply(s, old), /epoch/);
  });
