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
    for (const command of ["indent", "outdent"])
      for (const late of [false, true])
        for (const withText of [false, true]) {
          if (command === "indent" && offset === 0) continue;
          test(`Dependency release ${type} offset=${offset} ${command} late=${late} text=${withText}`, () => {
            const initial = immutable(fixture()),
              a = paste(initial, type, offset),
              pasted = run(initial, a),
              b = op("B", 1);
            b.intent = planListIndent(pasted, point(pasted, para, 0), b, {
              outdent: command === "outdent",
            }).intent;
            const c = op("C", 1, {
              kind: "insert",
              at: gapAt(pasted, para, 2),
              text: "peer",
              marks: ["strong"],
            });
            let s = pasted;
            if (withText) s = run(s, c);
            if (!late) s = run(s, b);
            s = run(s, op("A", 2, { kind: "undo", target: a.id }));
            if (late) s = run(s, b);
            assert.equal(
              text(s, para)
                .map((x) => x.char)
                .join(""),
              withText ? "Copeerpied" : "Copied",
            );
            assert.equal(s.creations[a.id].active, false);
            assert.equal(
              s.creations[a.id].sourceApplied,
              false,
              "placement retains node identity, not the original paragraph split",
            );
            assert.equal(s.creationPlacements[b.id].active, true);
            // Retained topology is not a claim that the paste's text remains authored.
            assert.equal(
              all(s).some((x) => x.id.startsWith(a.id + ":")),
              true,
              "CO-11 retains original birth characters while placement holds it",
            );
            const placed = visible(s);
            s = run(s, op("B", 2, { kind: "undo", target: b.id }));
            assert.equal(s.creations[a.id].sourceApplied, false);
            assert.equal(
              text(s, "p")
                .map((x) => x.char)
                .join(""),
              "ABCD",
            );
            if (withText) {
              assert.equal(
                text(s, para)
                  .map((x) => x.char)
                  .join(""),
                "peer",
              );
              assert.equal(parent(s, para).type, "list_item");
            } else assert.deepEqual(visible(s), visible(initial));
            s = run(s, op("B", 3, { kind: "undo", target: "B:s:2" }));
            assert.deepEqual(
              visible(s),
              placed,
              "Redo reuses stable placements and identities",
            );
            s = run(s, op("B", 4, { kind: "undo", target: "B:s:3" }));
            if (withText)
              s = run(s, op("C", 2, { kind: "undo", target: c.id }));
            assert.deepEqual(visible(s), visible(initial));
            s = run(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
            assert.deepEqual(visible(s), visible(pasted));
          });
        }
for (const order of [
  [0, 1],
  [1, 0],
])
  test(`Separate creation placements release independently order=${order}`, () => {
    let s = immutable(fixture());
    const births = [];
    for (const [actor, target] of [
      ["A", "p"],
      ["D", "q"],
    ]) {
      const template = paste(fixture(), "image", 4),
        o = op(
          actor,
          1,
          planRichInsert(
            s,
            point(s, target, text(s, target).length),
            template.intent.slice,
            op(actor, 1),
          ).intent,
        );
      s = run(s, o);
      births.push(o);
    }
    const before = s,
      placements = [];
    for (const [i, a] of births.entries()) {
      const b = op("B", i + 1);
      b.intent = planListIndent(
        s,
        point(s, a.id + ":attached:paragraph", 0),
        b,
      ).intent;
      s = run(s, b);
      placements.push(b);
    }
    for (const a of births)
      s = run(s, op(a.actor, 2, { kind: "undo", target: a.id }));
    for (const i of order)
      s = run(
        s,
        op("B", 3 + order.indexOf(i), {
          kind: "undo",
          target: placements[i].id,
        }),
      );
    assert.equal(
      Object.values(s.creations).some((r) => r.active || r.sourceApplied),
      false,
    );
    validate(s);
  });
