// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planListIndent,
  planReplace,
  previewCut,
  planCut,
  planInsertRow,
  planInsertColumn,
  previewTableMove,
  planTableMove,
} from "@cwhy/jade-core/commands";
import { fixture as oldFixture, run } from "./clipboard-cell-fixture.mjs";
import { paste, op, point, para } from "./placement-chain-fixture.mjs";
export { run, op, para };
export function fixture() {
  const old = oldFixture(),
    nodes = structuredClone(old.nodes),
    contents = {};
  for (const n of Object.values(nodes))
    if (n.text) {
      contents[n.id] = text(old, n.id).map((a) => ({
        text: a.char,
        marks: a.marks,
      }));
      delete n.text;
    }
  nodes.table.children.push("row-two");
  nodes["row-two"] = {
    id: "row-two",
    type: "row",
    live: true,
    children: ["lower-left", "lower-right"],
  };
  for (const [id, value] of [
    ["lower-left", "Lower left"],
    ["lower-right", "Lower right"],
  ]) {
    nodes[id] = { id, type: "cell", live: true, children: [id + "-p"] };
    nodes[id + "-p"] = { id: id + "-p", type: "paragraph", live: true };
    contents[id + "-p"] = [{ text: value, marks: ["em"] }];
  }
  return seed(nodes, contents);
}
export const range = (s, a = "cell", b = "lower-right") =>
  captureCellRange(s, "table", a, b);
export function setup(type, kind, peerFirst) {
  const initial = fixture(),
    a = paste(initial, type, 4),
    ops = [a];
  let s = run(initial, a);
  const b = op("B", 1);
  b.intent = planListIndent(s, point(s, para, 0), b).intent;
  s = run(s, b);
  ops.push(b);
  const r = captureRange(
      s,
      { block: para, offset: 1 },
      { block: para, offset: 5 },
    ),
    c = op("C", 1);
  c.intent = (
    kind === "cut"
      ? planCut(s, previewCut(s, r), c)
      : planReplace(
          s,
          r,
          {
            version: 1,
            blocks: [
              {
                type: "paragraph",
                content: [{ text: "新🙂", marks: [{ type: "underline" }] }],
              },
            ],
          },
          c,
          { strict: true },
        )
  ).intent;
  const d = op("D", 1, {
    kind: "insert",
    at: gapAt(s, para, 3),
    text: "中",
    marks: ["strong"],
  });
  for (const o of peerFirst ? [d, c] : [c, d]) {
    s = run(s, o);
    ops.push(o);
  }
  return { initial, s, ops, a, b, c, d };
}
export const changes = [
  "row-between",
  "column-between",
  "row-reorder",
  "column-reorder",
  "row-before",
  "row-after",
  "column-before",
  "column-after",
];
export const invalidates = (change) =>
  change.endsWith("between") || change.endsWith("reorder");
export function structure(s, change) {
  const o = op("B", 2),
    row = change.startsWith("row-"),
    where = change.split("-")[1];
  if (where === "reorder") {
    const r = range(
        s,
        row ? "lower-left" : "other-cell",
        row ? "lower-left" : "other-cell",
      ),
      preview = previewTableMove(s, r, row ? "rows" : "columns");
    o.intent = planTableMove(s, r, o, {
      preview,
      before: preview.expected.order[0],
    }).intent;
  } else {
    const target = where === "after" ? "lower-right" : "cell",
      r = range(s, target, target);
    o.intent = (
      row
        ? planInsertRow(s, r, o, {
            side: where === "before" ? "above" : "below",
          })
        : planInsertColumn(s, r, o, {
            side: where === "before" ? "left" : "right",
          })
    ).intent;
  }
  assert.ok(o.intent);
  return o;
}
export const first = (s) => s.nodes[s.nodes.table.children[0]].children[0];
