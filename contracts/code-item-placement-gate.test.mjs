// SPDX-License-Identifier: MPL-2.0
// Regression for rich-item placement observed during editor interaction research.
// Run in the packed consumer; do not weaken assertions to accommodate its guard.
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
import { captureBlockRange } from "@cwhy/jade-core/block-selection";
import { copyBlocks, planRichInsert } from "@cwhy/jade-core/commands";
import { listMarkers } from "@cwhy/jade-core/list-marker";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
function fixture() {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["table"] },
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["list"] },
      list: {
        id: "list",
        type: "ordered_list",
        order: 1,
        live: true,
        children: ["dest", "source"],
      },
      dest: { id: "dest", type: "list_item", live: true, children: ["p"] },
      source: {
        id: "source",
        type: "list_item",
        live: true,
        children: ["sp", "code"],
      },
      p: { id: "p", type: "paragraph", live: true },
      sp: { id: "sp", type: "paragraph", live: true },
      code: { id: "code", type: "code", live: true, language: "text" },
    },
    {
      p: [{ text: "ABCD", marks: ["strong"] }],
      sp: [{ text: "Copied", marks: ["em"] }],
      code: [{ text: "const ready = true;" }],
    },
  );
}
const value = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const range = (s, offset) =>
  captureRange(s, { block: "p", offset }, { block: "p", offset });
const paste = (s, offset) =>
  op(
    "A",
    1,
    planRichInsert(
      s,
      range(s, offset),
      copyBlocks(s, captureBlockRange(s, "source")).fragment,
      op("A", 1),
    ).intent,
  );
function semantic(s, id = "cell") {
  const n = s.nodes[id];
  if (n.type === "paragraph") return { type: "paragraph", text: value(s, id) };
  if (n.type === "code")
    return { type: "code", text: value(s, id), language: n.language };
  return { type: n.type, children: n.children.map((id) => semantic(s, id)) };
}
const paragraph = (t) => ({ type: "paragraph", text: t }),
  code = { type: "code", text: "const ready = true;", language: "text" },
  item = (t) => ({ type: "list_item", children: [paragraph(t)] }),
  copied = { type: "list_item", children: [paragraph("Copied"), code] },
  list = (children) => ({ type: "ordered_list", children });
for (const offset of [0, 2, 4])
  test(`Native code-ending item placement, owned Undo/Redo offset=${offset}`, () => {
    const s = fixture(),
      anchor = anchorAt(s, "p", 0, 4),
      a = paste(s, offset);
    let n = apply(s, a);
    validate(n);
    const expected =
      offset === 0
        ? [list([copied, item("ABCD"), copied])]
        : offset === 4
          ? [list([item("ABCD"), copied, copied])]
          : [list([item("AB"), copied]), paragraph("CD"), list([copied])];
    assert.deepEqual(semantic(n).children, expected);
    const numbers = n.nodes.cell.children.flatMap((id) =>
      n.nodes[id].type === "ordered_list"
        ? listMarkers(n, id).map((m) => m.number)
        : [],
    );
    assert.deepEqual(numbers, offset === 0 ? [2, 3, 4] : [1, 2, 3]);
    const originalAtoms = new Map(text(s, "p").map((a) => [a.id, a]));
    const visibleAtoms = Object.values(n.nodes)
      .filter((x) => x.live && x.text)
      .flatMap((x) => text(n, x.id));
    for (const [id, atom] of originalAtoms)
      assert.deepEqual(
        visibleAtoms.find((x) => x.id === id),
        atom,
      );
    const before = semantic(n);
    n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
    validate(n);
    assert.deepEqual(semantic(n), semantic(s));
    assert.deepEqual(text(n, "p"), text(s, "p"));
    assert.deepEqual(resolveAnchor(n, anchor), resolveAnchor(s, anchor));
    n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
    validate(n);
    assert.deepEqual(semantic(n), before);
  });
for (const peerFirst of [false, true])
  test(`Code-ending paste restores offline suffix contribution peerFirst=${peerFirst}`, () => {
    const s = fixture(),
      a = paste(s, 2),
      b = op("B", 1, { kind: "insert", at: gapAt(s, "p", 3), text: "peer" }),
      expected = apply(s, b);
    let n = peerFirst ? apply(apply(s, b), a) : apply(apply(s, a), b);
    n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
    validate(n);
    assert.deepEqual(text(n, "p"), text(expected, "p"));
    assert.deepEqual(semantic(n), semantic(expected));
    n = apply(n, op("B", 2, { kind: "undo", target: b.id }));
    assert.deepEqual(text(n, "p"), text(s, "p"));
    assert.deepEqual(semantic(n), semantic(s));
  });
