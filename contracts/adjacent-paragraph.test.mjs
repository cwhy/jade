// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { planAdjacentParagraph, planEnter } from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
const op = (actor, seq, intent) => ({
  actor,
  stream: "boundary",
  seq,
  id: `${actor}:boundary:${seq}`,
  epoch: 1,
  modelVersion: 2,
  intent,
});
function fixture(
  container = "doc",
  { nested = false, following = false } = {},
) {
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children:
        container === "doc"
          ? ["code"]
          : ["cell", "item-cell"].includes(container)
            ? ["table"]
            : ["list"],
    },
    code: { id: "code", type: "code", live: true, language: "javascript" },
  };
  if (["cell", "item-cell"].includes(container))
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: container === "item-cell" ? ["list"] : ["code"],
      },
    });
  if (["item", "item-cell"].includes(container))
    Object.assign(nodes, {
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item"],
      },
      item: {
        id: "item",
        type: "list_item",
        live: true,
        children: ["head", "code"],
      },
      head: { id: "head", type: "paragraph", live: true },
    });
  if (following) {
    nodes.list.children.push("nextItem");
    nodes.nextItem = {
      id: "nextItem",
      type: "list_item",
      live: true,
      children: ["nextText"],
    };
    nodes.nextText = { id: "nextText", type: "paragraph", live: true };
  }
  if (nested) {
    nodes.doc.children = ["outerList"];
    Object.assign(nodes, {
      outerList: {
        id: "outerList",
        type: "bullet_list",
        live: true,
        children: ["outerItem"],
      },
      outerItem: {
        id: "outerItem",
        type: "list_item",
        live: true,
        children: ["outerText", "list"],
      },
      outerText: { id: "outerText", type: "paragraph", live: true },
    });
  }
  return seed(nodes, {
    ...(nested ? { outerText: [{ text: "Outer" }] } : {}),
    ...(following ? { nextText: [{ text: "Following" }] } : {}),
    code: [{ text: "const keep = 1;" }],
    ...(["item", "item-cell"].includes(container)
      ? { head: [{ text: "Task" }] }
      : {}),
  });
}
const add = (s, actor = "a", seq = 1, side = "after") =>
  planAdjacentParagraph(s, "code", op(actor, seq), { side });
const undo = (s, actor, seq, target) =>
  apply(s, op(actor, seq, { kind: "undo", target }));
const id = "a:boundary:1:paragraph";
for (const container of ["doc", "cell", "item"])
  for (const side of ["before", "after"])
    test(`adjacent paragraph preserves code and same ${container} container (${side})`, () => {
      const s = fixture(container),
        p = add(s, "a", 1, side),
        n = p.state,
        children = n.nodes[container].children;
      assert.equal(
        children.indexOf(id),
        children.indexOf("code") + (side === "after" ? 1 : -1),
      );
      assert.deepEqual(text(n, "code"), text(s, "code"));
      assert.equal(n.nodes.code.language, "javascript");
      assert.equal(n.nodes[id].type, "paragraph");
      validate(n);
      const back = undo(n, "a", 2, "a:boundary:1");
      assert.deepEqual(
        back.nodes[container].children,
        s.nodes[container].children,
      );
      assert.equal(back.nodes[id].live, false);
      const redo = undo(back, "a", 3, "a:boundary:2");
      assert.deepEqual(redo.nodes[container].children, children);
      validate(redo);
    });
test("reuse focuses an existing following paragraph without adding an Undo entry", () => {
  const s = add(fixture()).state,
    n = planAdjacentParagraph(s, "code", op("a", 2), { reuse: true });
  assert.equal(n.intent, undefined);
  assert.equal(n.state, s);
  assert.ok(n.selection.anchor);
  assert.equal(Object.keys(n.state.effects).length, 1);
});
for (const container of ["doc", "cell", "item"])
  test(`creation Undo retains peer text; removing that contribution hides the inactive birth (${container})`, () => {
    let n = add(fixture(container)).state;
    n = apply(
      n,
      op("b", 1, { kind: "insert", at: gapAt(n, id, 0), text: "PEER" }),
    );
    n = undo(n, "a", 2, "a:boundary:1");
    assert.equal(n.nodes[id].live, true);
    assert.equal(
      text(n, id)
        .map((x) => x.char)
        .join(""),
      "PEER",
    );
    n = undo(n, "b", 2, "b:boundary:1");
    assert.equal(n.nodes[id].live, false);
    assert.ok(!n.nodes[container].children.includes(id));
    validate(n);
  });
for (const side of ["before", "after"])
  for (const order of ["ab", "ba"])
    test(`concurrent boundary births retain order through independent Undo/Redo (${side}/${order})`, () => {
      const s = fixture(),
        plans = { a: add(s, "a", 1, side), b: add(s, "b", 1, side) };
      let n = s;
      for (const actor of order)
        n = apply(n, op(actor, 1, plans[actor].intent));
      const expected = [...n.nodes.doc.children];
      n = undo(n, "a", 2, "a:boundary:1");
      n = undo(n, "a", 3, "a:boundary:2");
      assert.deepEqual(n.nodes.doc.children, expected);
      n = undo(n, "b", 2, "b:boundary:1");
      n = undo(n, "a", 4, "a:boundary:3");
      n = undo(n, "b", 3, "b:boundary:2");
      n = undo(n, "a", 5, "a:boundary:4");
      assert.deepEqual(n.nodes.doc.children, expected);
      validate(n);
    });
test("offline typing into a hidden creation revives the same paragraph identity", () => {
  let n = add(fixture()).state;
  const edit = op("b", 1, {
    kind: "insert",
    at: gapAt(n, id, 0),
    text: "late",
  });
  n = undo(n, "a", 2, "a:boundary:1");
  n = apply(n, edit);
  assert.equal(n.nodes[id].live, true);
  assert.equal(
    text(n, id)
      .map((x) => x.char)
      .join(""),
    "late",
  );
  validate(n);
});
for (const container of ["doc", "cell", "item"])
  test(`peer Enter and typing preserve their paragraph lineage during creation Undo (${container})`, () => {
    let n = add(fixture(container)).state;
    n = apply(
      n,
      op("b", 1, { kind: "insert", at: gapAt(n, id, 0), text: "leftRIGHT" }),
    );
    const range = captureRange(
      n,
      { block: id, offset: 4 },
      { block: id, offset: 4 },
    );
    n = planEnter(n, range, op("b", 2)).state;
    n = undo(n, "a", 2, "a:boundary:1");
    assert.ok(n.nodes[id].live);
    assert.ok(n.nodes[container].children.length >= 3);
    validate(n);
    n = undo(n, "b", 3, "b:boundary:2");
    n = undo(n, "b", 4, "b:boundary:1");
    assert.equal(n.nodes[id].live, false);
    validate(n);
  });

import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import { resolveGap } from "@cwhy/jade-core/model";
for (const container of ["doc", "cell", "item"])
  for (const order of ["ab", "ba"])
    test(`durable boundary receipts, replay and exact independent restoration (${container}/${order})`, () => {
      const s = fixture(container),
        plans = { a: add(s, "a", 1), b: add(s, "b", 1) };
      let room = new Room(s),
        record = room.snapshot();
      const accept = (command) => {
        const receipt = room.accept(command);
        assert.equal(receipt.outcome, "accepted", receipt.reason);
        record = replay(record, { op: command, receipt });
        room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
        assert.deepEqual(room.accept(command), receipt);
        assert.deepEqual(room.snapshot(), record);
      };
      for (const actor of order) accept(op(actor, 1, plans[actor].intent));
      const expected = room.record.state.nodes[container].children.slice(),
        anchor = gapAt(room.record.state, id, 0),
        code = text(room.record.state, "code");
      accept(
        op("b", 2, {
          kind: "insert",
          at: anchor,
          text: "你好",
          marks: ["strong"],
        }),
      );
      const contribution = text(room.record.state, id);
      accept(op("a", 2, { kind: "undo", target: "a:boundary:1" }));
      assert.deepEqual(text(room.record.state, id), contribution);
      assert.equal(resolveGap(room.record.state, anchor).block, id);
      accept(op("b", 3, { kind: "undo", target: "b:boundary:2" }));
      assert.equal(room.record.state.nodes[id].live, false);
      accept(op("a", 3, { kind: "undo", target: "a:boundary:2" }));
      assert.deepEqual(room.record.state.nodes[container].children, expected);
      assert.equal(resolveGap(room.record.state, anchor).block, id);
      assert.deepEqual(text(room.record.state, "code"), code);
    });
test("admission rejects forged and unavailable boundaries without partial nodes or receipts", () => {
  const s = fixture(),
    before = JSON.stringify(s);
  for (const intent of [
    { kind: "insertAdjacentParagraph", block: "code", side: "inside" },
    { kind: "insertAdjacentParagraph", block: "missing", side: "after" },
    {
      kind: "insertAdjacentParagraph",
      block: "code",
      side: "after",
      id: "forged",
    },
    {
      kind: "batch",
      intents: [
        { kind: "insertAdjacentParagraph", block: "code", side: "after" },
      ],
    },
  ])
    assert.throws(() => apply(s, op("a", 1, intent)));
  assert.equal(JSON.stringify(s), before);
});

import {
  planClearCells,
  previewTableDelete,
  planTableDelete,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
for (const removal of ["clear", "table-delete"])
  for (const inactive of [false, true])
    test(`explicit ${removal} fences late paragraph edits and birth Undo (inactive=${inactive})`, () => {
      let n = add(fixture("cell")).state;
      const late = op("b", 1, {
        kind: "insert",
        at: gapAt(n, id, 0),
        text: "OFFLINE",
        marks: ["em"],
      });
      if (inactive) n = undo(n, "a", 2, "a:boundary:1");
      const selection = captureCellRange(n, "table", "cell"),
        header = op("c", 1);
      const plan =
        removal === "clear"
          ? planClearCells(n, selection, header)
          : planTableDelete(n, selection, header, {
              preview: previewTableDelete(n, selection, "rows"),
            });
      n = plan.state;
      const bytes = JSON.stringify(n);
      assert.throws(() => apply(n, late));
      assert.equal(JSON.stringify(n), bytes);
      if (!inactive) {
        assert.throws(() => undo(n, "a", 2, "a:boundary:1"));
        assert.equal(JSON.stringify(n), bytes);
      }
      n = undo(n, "c", 2, "c:boundary:1");
      n = apply(n, late);
      assert.equal(
        text(n, id)
          .map((a) => a.char)
          .join(""),
        "OFFLINE",
      );
      assert.equal(n.nodes[id].live, true);
      validate(n);
    });

// Lark reference 2026-11-19: nonempty continuations remain unnumbered;
// an empty continuation leaves its item with the same paragraph identity.
for (const position of [0, 6, 9])
  test(`Lark continuation Enter splits nonempty text at ${position} without a list marker`, () => {
    let n = add(fixture("item")).state;
    n = apply(
      n,
      op("a", 2, { kind: "insert", at: gapAt(n, id, 0), text: "Follow up" }),
    );
    const range = captureRange(
      n,
      { block: id, offset: position },
      { block: id, offset: position },
    );
    const plan = planEnter(n, range, op("a", 3));
    const tail = resolveGap(plan.state, plan.after).block;
    assert.deepEqual(plan.state.nodes.item.children, [
      "head",
      "code",
      id,
      tail,
    ]);
    assert.equal(
      text(plan.state, id)
        .map((a) => a.char)
        .join(""),
      "Follow up".slice(0, position),
    );
    assert.equal(
      text(plan.state, tail)
        .map((a) => a.char)
        .join(""),
      "Follow up".slice(position),
    );
    assert.equal(plan.state.nodes[tail].type, "paragraph");
    validate(plan.state);
  });
for (const afterText of [false, true])
  test(`Lark empty continuation exits item with retained identity (after text=${afterText})`, () => {
    let n = add(fixture("item")).state,
      target = id;
    if (afterText) {
      n = apply(
        n,
        op("a", 2, { kind: "insert", at: gapAt(n, id, 0), text: "Follow up" }),
      );
      const range = captureRange(
        n,
        { block: id, offset: 9 },
        { block: id, offset: 9 },
      );
      const plan = planEnter(n, range, op("a", 3));
      n = plan.state;
      target = resolveGap(n, plan.after).block;
    }
    const range = captureRange(
      n,
      { block: target, offset: 0 },
      { block: target, offset: 0 },
    );
    const next = planEnter(n, range, op("a", 4)).state;
    assert.deepEqual(next.nodes.doc.children, ["list", target]);
    assert.deepEqual(
      next.nodes.item.children,
      afterText ? ["head", "code", id] : ["head", "code"],
    );
    assert.equal(next.nodes[target].type, "paragraph");
    assert.equal(text(next, target).length, 0);
    assert.deepEqual(text(next, "code"), text(n, "code"));
    validate(next);
  });

for (const container of ["item", "item-cell"])
  for (const derived of [false, true])
    for (const order of ["move-type", "type-move"])
      test(`continuation exit preserves peer text, anchors and independent Undo (${container}/${derived}/${order})`, () => {
        let n = add(fixture(container)).state,
          target = id;
        if (derived) {
          n = apply(
            n,
            op("a", 2, {
              kind: "insert",
              at: gapAt(n, id, 0),
              text: "Follow up",
            }),
          );
          const range = captureRange(
            n,
            { block: id, offset: 9 },
            { block: id, offset: 9 },
          );
          const p = planEnter(n, range, op("a", 3));
          n = p.state;
          target = resolveGap(n, p.after).block;
        }
        const anchor = gapAt(n, target, 0),
          range = captureRange(
            n,
            { block: target, offset: 0 },
            { block: target, offset: 0 },
          );
        const move = op("b", 1, planEnter(n, range, op("b", 1)).intent);
        const type = op("c", 1, {
          kind: "insert",
          at: anchor,
          text: "你好",
          marks: ["strong"],
        });
        for (const name of order.split("-"))
          n = apply(n, name === "move" ? move : type);
        const owner = container === "item" ? "doc" : "cell";
        assert.ok(n.nodes[owner].children.includes(target));
        const chars = text(n, target);
        assert.equal(chars.map((a) => a.char).join(""), "你好");
        n = undo(n, "a", 4, "a:boundary:1");
        assert.deepEqual(text(n, target), chars);
        assert.ok(n.nodes[owner].children.includes(target));
        assert.equal(resolveGap(n, anchor).block, target);
        n = undo(n, "b", 2, "b:boundary:1");
        assert.ok(n.nodes.item.children.includes(target));
        assert.deepEqual(text(n, target), chars);
        n = undo(n, "b", 3, "b:boundary:2");
        assert.ok(n.nodes[owner].children.includes(target));
        validate(n);
      });
for (const order of ["ab", "ba"])
  test(`concurrent empty exits retain independent placement ownership (${order})`, () => {
    let n = add(fixture("item")).state;
    const range = captureRange(
      n,
      { block: id, offset: 0 },
      { block: id, offset: 0 },
    );
    const moves = Object.fromEntries(
      [...order].map((actor) => [
        actor,
        op(actor, 10, planEnter(n, range, op(actor, 10)).intent),
      ]),
    );
    for (const actor of order) n = apply(n, moves[actor]);
    n = undo(n, order[0], 11, moves[order[0]].id);
    assert.ok(n.nodes.doc.children.includes(id));
    n = undo(n, order[1], 11, moves[order[1]].id);
    assert.ok(n.nodes.item.children.includes(id));
    n = undo(n, order[0], 12, `${order[0]}:boundary:11`);
    assert.ok(n.nodes.doc.children.includes(id));
    validate(n);
  });
test("continuation descendant can split again without being mistaken for a numbered item", () => {
  let n = add(fixture("item")).state;
  n = apply(
    n,
    op("a", 2, { kind: "insert", at: gapAt(n, id, 0), text: "one two three" }),
  );
  const first = planEnter(
    n,
    captureRange(n, { block: id, offset: 4 }, { block: id, offset: 4 }),
    op("a", 3),
  );
  n = first.state;
  const tail = resolveGap(n, first.after).block;
  const second = planEnter(
    n,
    captureRange(n, { block: tail, offset: 4 }, { block: tail, offset: 4 }),
    op("a", 4),
  );
  assert.deepEqual(
    second.state.nodes.item.children.slice(2).map((k) =>
      text(second.state, k)
        .map((a) => a.char)
        .join(""),
    ),
    ["one ", "two ", "three"],
  );
  validate(second.state);
});
for (const derived of [false, true])
  test(`paragraph exit durable receipts and cut ownership (derived=${derived})`, () => {
    let n = add(fixture("item-cell")).state,
      target = id;
    if (derived) {
      n = apply(
        n,
        op("a", 2, { kind: "insert", at: gapAt(n, id, 0), text: "Follow up" }),
      );
      const p = planEnter(
        n,
        captureRange(n, { block: id, offset: 9 }, { block: id, offset: 9 }),
        op("a", 3),
      );
      n = p.state;
      target = resolveGap(n, p.after).block;
    }
    let room = new Room(n),
      record = room.snapshot();
    function accept(command) {
      const receipt = room.accept(command);
      assert.equal(receipt.outcome, "accepted", receipt.reason);
      record = replay(record, { op: command, receipt });
      room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(command), receipt);
      assert.deepEqual(room.snapshot(), record);
    }
    const plan = planEnter(
      n,
      captureRange(
        n,
        { block: target, offset: 0 },
        { block: target, offset: 0 },
      ),
      op("b", 1),
    );
    accept(op("b", 1, plan.intent));
    if (derived)
      accept({
        ...op("a", 1, { kind: "undo", target: "a:boundary:3" }),
        stream: "reloaded",
        id: "a:reloaded:1",
      });
    accept({
      ...op("a", derived ? 2 : 1, { kind: "undo", target: "a:boundary:1" }),
      stream: "reloaded",
      id: `a:reloaded:${derived ? 2 : 1}`,
    });
    assert.ok(room.record.state.nodes.cell.children.includes(target));
    accept(op("b", 2, { kind: "undo", target: "b:boundary:1" }));
    accept(op("b", 3, { kind: "undo", target: "b:boundary:2" }));
    assert.ok(room.record.state.nodes.cell.children.includes(target));
    validate(room.record.state);
  });
for (const derived of [false, true])
  test(`peer split after exit survives exit Undo and birth Undo (derived=${derived})`, () => {
    let n = add(fixture("item")).state,
      target = id;
    if (derived) {
      n = apply(
        n,
        op("a", 2, { kind: "insert", at: gapAt(n, id, 0), text: "before" }),
      );
      const p = planEnter(
        n,
        captureRange(n, { block: id, offset: 6 }, { block: id, offset: 6 }),
        op("a", 3),
      );
      n = p.state;
      target = resolveGap(n, p.after).block;
    }
    n = planEnter(
      n,
      captureRange(
        n,
        { block: target, offset: 0 },
        { block: target, offset: 0 },
      ),
      op("b", 1),
    ).state;
    n = apply(
      n,
      op("c", 1, {
        kind: "insert",
        at: gapAt(n, target, 0),
        text: "leftRIGHT",
      }),
    );
    const p = planEnter(
      n,
      captureRange(
        n,
        { block: target, offset: 4 },
        { block: target, offset: 4 },
      ),
      op("c", 2),
    );
    n = p.state;
    const tail = resolveGap(n, p.after).block;
    n = undo(n, "b", 2, "b:boundary:1");
    assert.equal(
      text(n, target)
        .map((a) => a.char)
        .join(""),
      "left",
    );
    assert.equal(
      text(n, tail)
        .map((a) => a.char)
        .join(""),
      "RIGHT",
    );
    n = undo(n, "a", 4, "a:boundary:1");
    assert.equal(
      text(n, target)
        .map((a) => a.char)
        .join(""),
      "left",
    );
    assert.equal(
      text(n, tail)
        .map((a) => a.char)
        .join(""),
      "RIGHT",
    );
    n = undo(n, "c", 3, "c:boundary:2");
    assert.equal(
      text(n, target)
        .map((a) => a.char)
        .join(""),
      "leftRIGHT",
    );
    validate(n);
  });
test("successive exits retain one paragraph and an independently owned placement path", () => {
  let n = add(fixture("item", { nested: true })).state;
  const exit = (state, actor, seq) =>
    planEnter(
      state,
      captureRange(state, { block: id, offset: 0 }, { block: id, offset: 0 }),
      op(actor, seq),
    ).state;
  n = exit(n, "b", 1);
  assert.deepEqual(n.nodes.outerItem.children, ["outerText", "list", id]);
  n = exit(n, "c", 1);
  assert.deepEqual(n.nodes.doc.children, ["outerList", id]);
  n = undo(n, "b", 2, "b:boundary:1");
  assert.deepEqual(n.nodes.doc.children, ["outerList", id]);
  n = undo(n, "c", 2, "c:boundary:1");
  assert.deepEqual(n.nodes.item.children, ["head", "code", id]);
  n = undo(n, "b", 3, "b:boundary:2");
  assert.deepEqual(n.nodes.outerItem.children, ["outerText", "list", id]);
  n = undo(n, "c", 3, "c:boundary:2");
  assert.deepEqual(n.nodes.doc.children, ["outerList", id]);
  validate(n);
});
test("exit before following items preserves their order, text and independent edit through Undo", () => {
  let n = add(fixture("item", { following: true })).state;
  const before = text(n, "nextText");
  n = planEnter(
    n,
    captureRange(n, { block: id, offset: 0 }, { block: id, offset: 0 }),
    op("b", 1),
  ).state;
  assert.deepEqual(n.nodes.doc.children, [
    "list",
    id,
    "b:boundary:1:following-list",
  ]);
  assert.deepEqual(n.nodes["b:boundary:1:following-list"].children, [
    "nextItem",
  ]);
  assert.deepEqual(text(n, "nextText"), before);
  n = apply(
    n,
    op("c", 1, { kind: "insert", at: gapAt(n, "nextText", 0), text: "Peer " }),
  );
  n = undo(n, "b", 2, "b:boundary:1");
  assert.deepEqual(n.nodes.list.children, ["item", "nextItem"]);
  assert.equal(
    text(n, "nextText")
      .map((a) => a.char)
      .join(""),
    "Peer Following",
  );
  n = undo(n, "b", 3, "b:boundary:2");
  assert.deepEqual(n.nodes.doc.children, [
    "list",
    id,
    "b:boundary:1:following-list",
  ]);
  validate(n);
});
test("nonempty continuation after one nested exit remains prose in its new item", () => {
  let n = add(fixture("item", { nested: true })).state;
  n = planEnter(
    n,
    captureRange(n, { block: id, offset: 0 }, { block: id, offset: 0 }),
    op("b", 1),
  ).state;
  n = apply(
    n,
    op("c", 1, { kind: "insert", at: gapAt(n, id, 0), text: "leftRIGHT" }),
  );
  const p = planEnter(
    n,
    captureRange(n, { block: id, offset: 4 }, { block: id, offset: 4 }),
    op("c", 2),
  );
  n = p.state;
  assert.equal(
    text(n, id)
      .map((a) => a.char)
      .join(""),
    "left",
  );
  assert.equal(
    text(n, resolveGap(n, p.after).block)
      .map((a) => a.char)
      .join(""),
    "RIGHT",
  );
  validate(n);
});
test("Lark empty continuation before code creates another unnumbered paragraph inside the item", () => {
  let n = add(fixture("item"), "a", 1, "before").state;
  const p = planEnter(
    n,
    captureRange(n, { block: id, offset: 0 }, { block: id, offset: 0 }),
    op("a", 2),
  );
  const tail = resolveGap(p.state, p.after).block;
  assert.deepEqual(p.state.nodes.item.children, ["head", id, tail, "code"]);
  assert.equal(text(p.state, id).length, 0);
  assert.equal(text(p.state, tail).length, 0);
  assert.deepEqual(p.state.nodes.doc.children, ["list"]);
  validate(p.state);
});
