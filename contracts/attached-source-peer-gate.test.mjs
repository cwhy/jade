// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
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
});
const r = (s, id, offset) =>
  captureRange(s, { block: id, offset }, { block: id, offset });
function fixture() {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["list", "asset"] },
      list: {
        id: "list",
        type: "ordered_list",
        order: 1,
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
const slice = (type) => ({
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
            { type: "paragraph", content: [{ text: "Copied", marks: ["em"] }] },
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
});
const visible = (s) =>
  Object.values(s.nodes)
    .filter((n) => n.live && n.text)
    .flatMap((n) => text(s, n.id));
for (const type of ["image", "code"])
  for (const offset of [0, 2, 4])
    for (const late of [false, true])
      for (const enter of [false, true])
        test(`Peer contribution in pasted ${type} at=${offset} late=${late} Enter=${enter}`, () => {
          const initial = fixture(),
            a = op(
              "A",
              1,
              planRichInsert(
                initial,
                r(initial, "p", offset),
                slice(type),
                op("A", 1),
              ).intent,
            ),
            pasted = apply(initial, a),
            block = "A:s:1:attached:paragraph";
          let authored = pasted;
          const queue = [];
          if (enter) {
            const e = op(
              "B",
              1,
              planEnter(authored, r(authored, block, 3), op("B", 1)).intent,
            );
            authored = apply(authored, e);
            queue.push(e);
          }
          const target = enter ? "B:s:1:list-tail" : block,
            b = op("B", enter ? 2 : 1, {
              kind: "insert",
              at: gapAt(authored, target, 0),
              text: "peer",
            });
          authored = apply(authored, b);
          queue.push(b);
          let s = pasted;
          if (!late) for (const x of queue) s = apply(s, x);
          s = apply(s, op("A", 2, { kind: "undo", target: a.id }));
          if (late) for (const x of queue) s = apply(s, x);
          validate(s);
          assert.equal(
            visible(s)
              .filter((a) => a.id.startsWith(b.id))
              .map((a) => a.char)
              .join(""),
            "peer",
          );
          assert.deepEqual(
            visible(s).filter((a) =>
              text(initial, "p").some((x) => x.id === a.id),
            ),
            text(initial, "p"),
          );
          for (const [i, x] of [...queue].reverse().entries())
            s = apply(
              s,
              op("B", queue.length + i + 1, { kind: "undo", target: x.id }),
            );
          validate(s);
          assert.deepEqual(text(s, "p"), text(initial, "p"));
          assert.deepEqual(s.nodes.doc.children, initial.nodes.doc.children);
          assert.deepEqual(s.nodes.list.children, initial.nodes.list.children);
        });
for (const offset of [0, 2, 4])
  test(`Peer edits copied code text before paste Undo at=${offset}`, () => {
    const s = fixture(),
      a = op(
        "A",
        1,
        planRichInsert(s, r(s, "p", offset), slice("code"), op("A", 1)).intent,
      );
    let n = apply(s, a);
    const b = op("B", 1, {
      kind: "insert",
      at: gapAt(n, "A:s:1:attached:attachment", 0),
      text: "peer",
    });
    n = apply(n, b);
    n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
    assert.equal(
      visible(n)
        .filter((x) => x.id.startsWith(b.id))
        .map((x) => x.char)
        .join(""),
      "peer",
    );
  });
