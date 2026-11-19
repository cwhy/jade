// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt, resolveGap } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import {
  planInsertBlock,
  planAdjacentParagraph,
  planClearCells,
} from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { Room } from "@cwhy/jade-collaboration/room";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:code:${seq}`,
  stream: "code",
  epoch: 1,
  modelVersion: 2,
});
const undo = (s, a, q, target) => apply(s, op(a, q, { kind: "undo", target }));
const value = (s, id) =>
  text(s, id)
    .map((x) => x.char)
    .join("");
function fixture(kind = "doc", empty = false) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["p", "after"] },
    p: { id: "p", type: "paragraph", live: true },
    after: { id: "after", type: "paragraph", live: true },
  };
  if (kind !== "doc") {
    nodes.doc.children = ["table"];
    nodes.table = { id: "table", type: "table", live: true, children: ["row"] };
    nodes.row = { id: "row", type: "row", live: true, children: ["cell"] };
    nodes.cell = {
      id: "cell",
      type: "cell",
      live: true,
      children: ["p", "after"],
    };
  }
  if (["ordered", "bullet", "nested"].includes(kind)) {
    nodes.cell.children = ["list"];
    nodes.list = {
      id: "list",
      type: kind === "bullet" ? "bullet_list" : "ordered_list",
      live: true,
      children: ["item", "next"],
    };
    nodes.item = { id: "item", type: "list_item", live: true, children: ["p"] };
    nodes.next = {
      id: "next",
      type: "list_item",
      live: true,
      children: ["after"],
    };
    if (kind === "nested") {
      nodes.cell.children = ["outer"];
      nodes.outer = {
        id: "outer",
        type: "bullet_list",
        live: true,
        children: ["outer-item"],
      };
      nodes["outer-item"] = {
        id: "outer-item",
        type: "list_item",
        live: true,
        children: ["outer-p", "list"],
      };
      nodes["outer-p"] = { id: "outer-p", type: "paragraph", live: true };
    }
  }
  return seed(nodes, {
    p: empty
      ? []
      : [{ text: "Check the ", marks: ["strong"] }, { text: "upload result" }],
    after: [{ text: "Following" }],
    ...(kind === "nested" ? { "outer-p": [{ text: "Parent" }] } : {}),
  });
}
const range = (s, offset = 0, block = "p") =>
  captureRange(s, { block, offset }, { block, offset });
const add = (s, actor = "a", seq = 1, offset = 0) =>
  planInsertBlock(s, range(s, offset), op(actor, seq), { type: "code" });
const code = "a:code:1:code";
for (const kind of ["doc", "cell", "ordered", "bullet", "nested"])
  for (const offset of [0, 10, 23])
    test(`code below intact ${kind} paragraph at ${offset}`, () => {
      const s = fixture(kind),
        original = text(s, "p"),
        replica = s.nodes.p.text,
        n = add(s, "a", 1, offset).state;
      const parent = ["ordered", "bullet", "nested"].includes(kind)
        ? "item"
        : kind;
      assert.deepEqual(
        n.nodes[parent].children,
        kind === "doc" || kind === "cell" ? ["p", code, "after"] : ["p", code],
      );
      assert.deepEqual(text(n, "p"), original);
      assert.equal(n.nodes.p.text, replica);
      assert.equal(n.nodes[code].type, "code");
      assert.equal(value(n, code), "");
      assert.deepEqual(n.listFamilies, s.listFamilies);
      assert.equal(
        Object.keys(n.replicas).length,
        Object.keys(s.replicas).length + 1,
      );
      const back = undo(n, "a", 2, "a:code:1");
      assert.deepEqual(back.nodes[parent].children, s.nodes[parent].children);
      assert.equal(back.nodes[code].live, false);
      const redo = undo(back, "a", 3, "a:code:2");
      assert.deepEqual(redo.nodes[parent].children, n.nodes[parent].children);
      validate(redo);
    });
for (const kind of ["doc", "ordered", "nested"])
  test(`empty ${kind} preserves valid source paragraph and focuses code`, () => {
    const s = fixture(kind, true),
      p = add(s);
    assert.equal(resolveGap(p.state, p.after).block, code);
    assert.equal(value(p.state, "p"), "");
    validate(p.state);
  });
for (const late of [false, true])
  test(`peer code text survives creator Undo (late=${late})`, () => {
    let n = add(fixture("ordered")).state;
    const edit = op("b", 1, {
      kind: "insert",
      at: gapAt(n, code, 0),
      text: "peer();",
    });
    if (!late) n = apply(n, edit);
    n = undo(n, "a", 2, "a:code:1");
    if (late) n = apply(n, edit);
    assert.equal(value(n, code), "peer();");
    assert.equal(n.nodes[code].live, true);
    n = undo(n, "b", 2, "b:code:1");
    assert.equal(n.nodes[code].live, false);
    validate(n);
  });
for (const order of [
  ["a", "b"],
  ["b", "a"],
])
  test(`concurrent block insertion order ${order}`, () => {
    let n = fixture();
    for (const a of order) n = add(n, a).state;
    const expected = [...n.nodes.doc.children];
    n = undo(n, "a", 2, "a:code:1");
    n = undo(n, "b", 2, "b:code:1");
    n = undo(n, "a", 3, "a:code:2");
    n = undo(n, "b", 3, "b:code:2");
    assert.deepEqual(n.nodes.doc.children, expected);
    validate(n);
  });
test("peer manual language choice retains empty code through creator Undo", () => {
  let n = add(fixture()).state;
  n = apply(
    n,
    op("b", 1, { kind: "codeLanguage", block: code, language: "python" }),
  );
  n = undo(n, "a", 2, "a:code:1");
  assert.equal(n.nodes[code].live, true);
  assert.equal(n.nodes[code].language, "python");
  n = undo(n, "b", 2, "b:code:1");
  assert.equal(n.nodes[code].live, false);
  validate(n);
});
for (const content of [false, true])
  test(`dependent continuation retains boundary through independent Undo (text=${content})`, () => {
    let n = add(fixture("ordered")).state;
    n = planAdjacentParagraph(n, code, op("b", 1)).state;
    const p = "b:code:1:paragraph";
    if (content)
      n = apply(
        n,
        op("c", 1, { kind: "insert", at: gapAt(n, p, 0), text: "Follow" }),
      );
    n = undo(n, "a", 2, "a:code:1");
    assert.equal(n.nodes[code].live, true);
    n = undo(n, "b", 2, "b:code:1");
    assert.equal(n.nodes[code].live, content);
    if (content) {
      n = undo(n, "c", 2, "c:code:1");
      assert.equal(n.nodes[code].live, false);
    }
    n = undo(n, "b", 3, "b:code:2");
    assert.equal(n.nodes[p].live, true);
    validate(n);
  });
test("explicit cell clear fences late typing and creation Undo", () => {
  let n = add(fixture("cell")).state;
  const late = op("b", 1, {
    kind: "insert",
    at: gapAt(n, code, 0),
    text: "late",
  });
  n = planClearCells(n, captureCellRange(n, "table", "cell"), op("c", 1)).state;
  const bytes = JSON.stringify(n);
  assert.throws(() => apply(n, late));
  assert.throws(() => undo(n, "a", 2, "a:code:1"));
  assert.equal(JSON.stringify(n), bytes);
});
test("invalid code insertion is rejected without mutation", () => {
  const s = fixture(),
    bytes = JSON.stringify(s);
  for (const intent of [
    { kind: "insertCodeBlock", block: "missing" },
    { kind: "insertCodeBlock", block: "p", type: "image" },
    { kind: "insertCodeBlock", block: "doc" },
    { kind: "batch", intents: [{ kind: "insertCodeBlock", block: "p" }] },
  ])
    assert.throws(() => apply(s, op("a", 1, intent)));
  assert.equal(JSON.stringify(s), bytes);
});
test("selection is not implicitly converted or discarded", () => {
  const s = fixture(),
    r = captureRange(s, { block: "p", offset: 1 }, { block: "p", offset: 5 });
  assert.throws(() => planInsertBlock(s, r, op("a", 1), { type: "code" }));
});

import { replay } from "@cwhy/jade-collaboration/replay";
for (const order of ["ab", "ba"])
  test(`uncertain delivery reload and independent contributions (${order})`, () => {
    const initial = fixture("nested"),
      plans = { a: add(initial, "a"), b: add(initial, "b") };
    let room = new Room(initial),
      record = room.snapshot();
    const accept = (command) => {
      const receipt = room.accept(command);
      assert.equal(receipt.outcome, "accepted", receipt.reason);
      record = replay(record, { op: command, receipt });
      room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(command), receipt);
      assert.deepEqual(room.snapshot(), record);
    };
    for (const a of order) accept(op(a, 1, plans[a].intent));
    const before = text(room.record.state, "p"),
      anchor = gapAt(room.record.state, code, 0);
    accept(op("c", 1, { kind: "insert", at: anchor, text: "你好();" }));
    const peer = text(room.record.state, code);
    accept(op("a", 2, { kind: "undo", target: "a:code:1" }));
    assert.deepEqual(text(room.record.state, code), peer);
    assert.equal(resolveGap(room.record.state, anchor).block, code);
    assert.deepEqual(text(room.record.state, "p"), before);
    accept(op("c", 2, { kind: "undo", target: "c:code:1" }));
    assert.equal(room.record.state.nodes[code].live, false);
    accept(op("a", 3, { kind: "undo", target: "a:code:2" }));
    assert.equal(room.record.state.nodes[code].live, true);
  });
test("code below a created paragraph retains its required boundary through Undo/Redo", () => {
  let n = fixture();
  n = planAdjacentParagraph(n, "p", op("a", 1)).state;
  const anchor = "a:code:1:paragraph";
  n = planInsertBlock(n, range(n, 0, anchor), op("b", 1), {
    type: "code",
  }).state;
  n = undo(n, "a", 2, "a:code:1");
  assert.equal(n.nodes[anchor].live, true);
  n = undo(n, "b", 2, "b:code:1");
  assert.equal(n.nodes[anchor].live, false);
  n = undo(n, "b", 3, "b:code:2");
  assert.equal(n.nodes[anchor].live, true);
  validate(n);
});
test("offline code insertion can retain an undone created paragraph boundary", () => {
  let n = fixture();
  n = planAdjacentParagraph(n, "p", op("a", 1)).state;
  const anchor = "a:code:1:paragraph",
    planned = planInsertBlock(n, range(n, 0, anchor), op("b", 1), {
      type: "code",
    });
  n = undo(n, "a", 2, "a:code:1");
  n = apply(n, op("b", 1, planned.intent));
  assert.equal(n.nodes[anchor].live, true);
  assert.equal(n.nodes["b:code:1:code"].live, true);
  n = undo(n, "b", 2, "b:code:1");
  assert.equal(n.nodes[anchor].live, false);
  validate(n);
});
