// SPDX-License-Identifier: MPL-2.0
// CO-11: user-confirmed whole-item adoption policy, November 10.
// Derived from the preserved source-restoration gate; Backspace conversion is
// excluded, not reclassified as an explicit whole-item move.
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
      for (const peerFirst of [false, true])
        test(`Whole-item retention and source restoration ${type} offset=${offset} ${command} peerFirst=${peerFirst}`, () => {
          const initial = immutable(fixture()),
            a = paste(initial, type, offset),
            pasted = run(initial, a);
          const b = op("B", 1),
            range = point(pasted, para, 0);
          const plan =
            command === "backspace"
              ? planDelete(pasted, range, "backward", b)
              : planListIndent(pasted, range, b, {
                  outdent: command === "outdent",
                });
          if (command === "indent" && offset === 0) {
            assert.equal(plan.intent, null, "first item indent is a no-op");
            return;
          }
          assert.ok(plan.intent, "structural operation must be available");
          b.intent = plan.intent;
          const c = op("C", 1, {
            kind: "insert",
            at: gapAt(pasted, para, 2),
            text: "peer",
            marks: ["strong"],
          });
          let s = pasted;
          for (const e of peerFirst ? [c, b] : [b, c]) s = run(s, e);
          const expected = s,
            anchor = anchorAt(s, para, 2, 4),
            owner = parent(s, para).id;
          // A owns the paste; B owns placement; C owns only the newly typed characters.
          s = run(s, op("A", 2, { kind: "undo", target: a.id }));
          assert.deepEqual(
            text(s, para),
            text(expected, para),
            "whole-item move preserves original copied text and independent peer characters",
          );
          assert.equal(
            s.nodes[attachment].live,
            true,
            "whole moved attachment remains",
          );
          if (type === "image")
            assert.equal(
              s.nodes[attachment].asset,
              pasted.nodes[attachment].asset,
            );
          else
            assert.deepEqual(
              text(s, attachment),
              text(pasted, attachment),
              "code identities and marks survive",
            );
          assert.equal(
            resolveAnchor(s, anchorAt(pasted, para, 0, 6)).status,
            "exact",
            "copied text anchors remain exact",
          );
          assert.deepEqual(
            text(s, "p"),
            text(initial, "p"),
            "Undo must reunite the original source paragraph while preserving peer placement",
          );
          assert.equal(
            parent(s, para).id,
            owner,
            "peer placement survives paste Undo",
          );
          assert.equal(
            resolveAnchor(s, anchor).status,
            "exact",
            "peer anchor survives",
          );
          assert.deepEqual(
            text(s, para).map((x) => x.marks),
            text(expected, para).map((x) => x.marks),
            "move does not reset marks",
          );
          s = run(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
          assert.deepEqual(
            visible(s),
            visible(expected),
            "Redo preserves peer placement",
          );
          s = run(s, op("C", 2, { kind: "undo", target: c.id }));
          s = run(s, op("B", 2, { kind: "undo", target: b.id }));
          assert.deepEqual(visible(s), visible(pasted));
          s = run(s, op("A", 4, { kind: "undo", target: "A:s:3" }));
          assert.deepEqual(visible(s), visible(initial));
        });
