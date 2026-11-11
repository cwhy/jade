// SPDX-License-Identifier: MPL-2.0
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

export { fixture, paste, op, point, run, visible, para, attachment, parent };
