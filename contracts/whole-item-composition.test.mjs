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
import { immutable } from "@cwhy/jade-core/immutability";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planRichInsert,
  planEnter,
  planClearCells,
  previewTableDelete,
  planTableDelete,
  planListIndent,
  planDelete,
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

const run = (s, o) => {
  const before = JSON.stringify(s);
  const next = immutable(apply(s, o));
  validate(next);
  assert.equal(JSON.stringify(s), before, "input remains unchanged");
  return next;
};

for (const type of ["image", "code"])
  for (const offset of [0, 2, 4])
    for (const command of ["indent", "outdent"]) {
      if (command === "indent" && offset === 0) continue;
      test(`Twelve independent birth/move cycles ${type} offset=${offset} ${command}`, () => {
        const initial = immutable(fixture()),
          a = paste(initial, type, offset),
          pasted = run(initial, a),
          b = op("B", 1);
        b.intent = planListIndent(pasted, point(pasted, para, 0), b, {
          outdent: command === "outdent",
        }).intent;
        let s = run(pasted, b),
          at = a.id,
          bt = b.id,
          aseq = 1,
          bseq = 1;
        const placed = visible(s);
        for (let cycle = 0; cycle < 12; cycle++) {
          let o = op("A", ++aseq, { kind: "undo", target: at });
          s = run(s, o);
          at = o.id;
          assert.equal(
            text(s, para)
              .map((x) => x.char)
              .join(""),
            "Copied",
          );
          assert.equal(
            text(s, "p")
              .map((x) => x.char)
              .join(""),
            "ABCD",
          );
          o = op("B", ++bseq, { kind: "undo", target: bt });
          s = run(s, o);
          bt = o.id;
          assert.deepEqual(visible(s), visible(initial));
          o = op("B", ++bseq, { kind: "undo", target: bt });
          s = run(s, o);
          bt = o.id;
          o = op("A", ++aseq, { kind: "undo", target: at });
          s = run(s, o);
          at = o.id;
          assert.deepEqual(visible(s), placed);
        }
      });
    }
for (const first of ["B", "C"])
  test(`Two moves on same birth release first=${first}`, () => {
    const initial = immutable(fixture()),
      a = paste(initial, "image", 4),
      pasted = run(initial, a);
    let s = pasted;
    const b = op("B", 1);
    b.intent = planListIndent(s, point(s, para, 0), b).intent;
    s = run(s, b);
    const c = op("C", 1);
    c.intent = planListIndent(s, point(s, para, 0), c, {
      outdent: true,
    }).intent;
    s = run(s, c);
    s = run(s, op("A", 2, { kind: "undo", target: a.id }));
    s = run(
      s,
      op(first, 2, { kind: "undo", target: first === "B" ? b.id : c.id }),
    );
    assert.equal(
      text(s, para)
        .map((x) => x.char)
        .join(""),
      "Copied",
      "one active move still retains original birth",
    );
    assert.equal(s.nodes[attachment].live, true);
    assert.equal(
      parent(s, s.creations[a.id].root).id,
      first === "B" ? "list" : "B:s:1:list:1",
      "latest remaining accepted placement stays effective",
    );
    const second = first === "B" ? "C" : "B";
    s = run(
      s,
      op(second, 2, { kind: "undo", target: second === "B" ? b.id : c.id }),
    );
    assert.deepEqual(visible(s), visible(initial));
  });
for (const type of ["image", "code"])
  for (const destructive of ["clear", "table"])
    for (const priorUndo of [false, true])
      test(`Explicit ${destructive} overrides hold ${type} priorUndo=${priorUndo}`, () => {
        const initial = immutable(fixture()),
          a = paste(initial, type, 4);
        let s = run(initial, a);
        const b = op("B", 1);
        b.intent = planListIndent(s, point(s, para, 0), b).intent;
        s = run(s, b);
        if (priorUndo) s = run(s, op("A", 2, { kind: "undo", target: a.id }));
        const range = captureCellRange(s, "table", "cell", "cell"),
          c = op("C", 1);
        c.intent =
          destructive === "clear"
            ? planClearCells(s, range, c).intent
            : planTableDelete(s, range, c, {
                preview: previewTableDelete(s, range, "table"),
              }).intent;
        s = run(s, c);
        const before = JSON.stringify(s);
        assert.throws(() => run(s, op("B", 2, { kind: "undo", target: b.id })));
        assert.equal(JSON.stringify(s), before);
        assert.throws(() =>
          run(
            s,
            op("A", priorUndo ? 3 : 2, {
              kind: "undo",
              target: priorUndo ? "A:s:2" : a.id,
            }),
          ),
        );
        assert.equal(JSON.stringify(s), before);
        assert.equal(s.nodes[attachment].live, false);
      });
