// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { listMarkers } from "@cwhy/jade-core/list-marker";
import {
  planInsertBlock,
  planRichInsert,
  planEnter,
  previewCellPaste,
  planPasteCells,
} from "@cwhy/jade-core/commands";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  stream: "s",
  id: `${actor}:s:${seq}`,
  epoch: 1,
  intent,
});
function fixture() {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["table"] },
    table: { id: "table", type: "table", live: true, children: ["row"] },
    row: { id: "row", type: "row", live: true, children: ["cell", "other"] },
    cell: { id: "cell", type: "cell", live: true, children: ["list"] },
    other: { id: "other", type: "cell", live: true, children: ["other-text"] },
    "other-text": { id: "other-text", type: "paragraph", live: true },
    list: {
      id: "list",
      type: "ordered_list",
      live: true,
      children: ["before-item", "target-item", "after-item"],
    },
  };
  for (const id of ["before", "target", "after"]) {
    nodes[id + "-item"] = {
      id: id + "-item",
      type: "list_item",
      live: true,
      children: [id],
    };
    nodes[id] = { id, type: "paragraph", live: true };
  }
  return seed(nodes, {
    before: [{ text: "Before" }],
    target: [{ text: "Workspace settings" }],
    after: [{ text: "After" }],
    "other-text": [{ text: "Destination" }],
  });
}
const chars = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
function view(s, cell = "cell") {
  return s.nodes[cell].children.flatMap((id) => {
    const n = s.nodes[id];
    if (n.type === "ordered_list")
      return listMarkers(s, id).map((m) => ({
        type: m.type,
        number: m.number,
        text: chars(s, s.nodes[m.id].children[0]),
      }));
    return n.type === "paragraph"
      ? [{ type: n.type, text: chars(s, id) }]
      : [{ type: n.type }];
  });
}
function durable(initial = fixture()) {
  let room = new Room(initial),
    record = room.snapshot();
  return {
    get state() {
      return room.record.state;
    },
    accept(operation, outcome = "accepted") {
      const receipt = room.accept(operation);
      assert.equal(receipt.outcome, outcome, JSON.stringify(receipt));
      record = replay(record, { op: operation, receipt });
      room = new Room(null, JSON.parse(JSON.stringify(room.record)));
      assert.deepEqual(room.accept(operation), receipt);
      assert.deepEqual(room.record, record);
      validate(record.state);
      return receipt;
    },
  };
}
const image = "A:s:1:image";
function insert(r, offset) {
  const s = r.state,
    range = captureRange(
      s,
      { block: "target", offset },
      { block: "target", offset },
    );
  r.accept(
    op(
      "A",
      1,
      planInsertBlock(s, range, op("A", 1), {
        type: "image",
        slot: "media-paste-slot-0001",
        width: 320,
        height: 180,
      }).intent,
    ),
  );
}
const undo = (actor, seq, target) => op(actor, seq, { kind: "undo", target });
const plainFixture = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p"] },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "settings" }] },
  );
const slice = (type) => ({
  version: 1,
  edges: { start: "boundary", end: "boundary" },
  blocks: [
    type === "code"
      ? { type, language: "javascript", content: [{ text: "Mock", marks: [] }] }
      : {
          type,
          children: [
            {
              type: "list_item",
              children: [
                { type: "paragraph", content: [{ text: "Mock", marks: [] }] },
              ],
            },
          ],
        },
  ],
});
const point = (s, block, offset) =>
  captureRange(s, { block, offset }, { block, offset });
const paste = (s, block, offset, type, actor = "B", seq = 1) =>
  op(
    actor,
    seq,
    planRichInsert(s, point(s, block, offset), slice(type), op(actor, seq))
      .intent,
  );
function visibleTree(s, ids) {
  return ids.map((id) => {
    const n = s.nodes[id];
    return {
      type: n.type,
      ...(n.type === "ordered_list" ? { order: n.order ?? 1 } : {}),
      ...(n.text ? { text: chars(s, id) } : {}),
      ...(n.children ? { children: visibleTree(s, n.children) } : {}),
    };
  });
}
const suffix = "A:s:1:cut:list-tail";
for (const type of ["code", "bullet_list"])
  for (const offset of [0, 3, 8])
    test(`rich suffix paste matches ordinary prose ${type} offset=${offset}`, () => {
      const r = durable();
      insert(r, 10);
      const before = view(r.state),
        original = text(r.state, suffix);
      const control = durable(plainFixture());
      control.accept(paste(control.state, "p", offset, type));
      r.accept(paste(r.state, suffix, offset, type));
      const children = r.state.nodes.cell.children,
        start = children.indexOf(image) + 1,
        end = children.indexOf("list:image-run:after-item");
      assert.deepEqual(
        visibleTree(r.state, children.slice(start, end)),
        visibleTree(control.state, control.state.nodes.doc.children),
      );
      const pasted = visibleTree(r.state, children);
      r.accept(undo("B", 2, "B:s:1"));
      assert.deepEqual(view(r.state), before);
      assert.deepEqual(text(r.state, suffix), original);
      r.accept(undo("B", 3, "B:s:2"));
      assert.deepEqual(
        visibleTree(r.state, r.state.nodes.cell.children),
        pasted,
      );
    });
for (const type of ["code", "bullet_list"])
  for (const imageFirst of [false, true])
    for (const peerFirst of [false, true])
      for (const peerOffset of [1, 5])
        test(`rich suffix ownership ${type} imageFirst=${imageFirst} peerFirst=${peerFirst} peerOffset=${peerOffset}`, () => {
          const r = durable(),
            initial = r.state,
            original = text(initial, "target");
          insert(r, 10);
          const p = paste(r.state, suffix, 3, type),
            peer = op("C", 1, {
              kind: "insert",
              at: gapAt(r.state, suffix, peerOffset),
              text: "友",
              marks: ["strong"],
            });
          for (const o of peerFirst ? [peer, p] : [p, peer]) r.accept(o);
          for (const actor of imageFirst ? ["A", "B"] : ["B", "A"])
            r.accept(undo(actor, 2, `${actor}:s:1`));
          assert.deepEqual(view(r.state), [
            { type: "ordered_list", number: 1, text: "Before" },
            {
              type: "ordered_list",
              number: 2,
              text:
                "Workspace " +
                "settings".slice(0, peerOffset) +
                "友" +
                "settings".slice(peerOffset),
            },
            { type: "ordered_list", number: 3, text: "After" },
          ]);
          const expected = [
            ...original.slice(0, 10 + peerOffset),
            { id: "C:s:1:char:0", char: "友", marks: ["strong"] },
            ...original.slice(10 + peerOffset),
          ];
          assert.deepEqual(text(r.state, "target"), expected);
          r.accept(undo("A", 3, "A:s:2"));
          r.accept(undo("B", 3, "B:s:2"));
          r.accept(undo("B", 4, "B:s:3"));
          r.accept(undo("A", 4, "A:s:3"));
          assert.deepEqual(text(r.state, "target"), expected);
          r.accept(undo("C", 2, "C:s:1"));
          assert.deepEqual(text(r.state, "target"), original);
        });
for (const type of ["code", "bullet_list"])
  for (const secondOffset of [0, 6])
    test(`rich suffix materialization preserves another image at before-item offset=${secondOffset} type=${type}`, () => {
      const r = durable();
      insert(r, 10);
      const c = op("C", 1),
        range = point(r.state, "before", secondOffset);
      r.accept(
        op(
          "C",
          1,
          planInsertBlock(r.state, range, c, {
            type: "image",
            slot: "rich-other-image-slot",
            width: 160,
            height: 80,
          }).intent,
        ),
      );
      const before = view(r.state);
      r.accept(paste(r.state, suffix, 3, type));
      r.accept(undo("B", 2, "B:s:1"));
      assert.deepEqual(view(r.state), before);
      r.accept(undo("C", 2, "C:s:1"));
      r.accept(undo("A", 2, "A:s:1"));
      assert.deepEqual(view(r.state), view(fixture()));
    });
for (const type of ["code", "bullet_list"])
  for (const order of ["enter-first", "paste-first"])
    test(`peer Enter after materialization ${type} ${order}`, () => {
      const r = durable();
      insert(r, 10);
      r.accept(paste(r.state, suffix, 3, type));
      // Enter in the surviving plain prefix is a normal prose command.
      const e = op(
        "C",
        1,
        planEnter(r.state, point(r.state, suffix, 1), op("C", 1)).intent,
      );
      r.accept(e);
      for (const actor of order === "enter-first" ? ["C", "B"] : ["B", "C"])
        r.accept(undo(actor, 2, `${actor}:s:1`));
      r.accept(undo("A", 2, "A:s:1"));
      assert.deepEqual(view(r.state), view(fixture()));
      assert.deepEqual(text(r.state, "target"), text(fixture(), "target"));
    });
for (const type of ["code", "bullet_list"])
  test(`materialized cell clear restores independent content ${type}`, () => {
    const r = durable();
    insert(r, 10);
    r.accept(paste(r.state, suffix, 3, type));
    const before = visibleTree(r.state, r.state.nodes.cell.children),
      range = captureCellRange(r.state, "table", "cell"),
      fragment = {
        version: 1,
        rows: [
          [[{ type: "paragraph", content: [{ text: "Reviewed", marks: [] }] }]],
        ],
      },
      preview = previewCellPaste(r.state, range, fragment);
    r.accept(
      op(
        "C",
        1,
        planPasteCells(r.state, range, op("C", 1), { preview }).intent,
      ),
    );
    r.accept(undo("C", 2, "C:s:1"));
    assert.deepEqual(visibleTree(r.state, r.state.nodes.cell.children), before);
    r.accept(undo("B", 2, "B:s:1"));
    r.accept(undo("A", 2, "A:s:1"));
    assert.deepEqual(view(r.state), view(fixture()));
  });
test("materialized flag and placement state remain validated", () => {
  const r = durable();
  insert(r, 10);
  r.accept(paste(r.state, suffix, 3, "code"));
  for (const flag of [false, "yes", 1]) {
    const forged = JSON.parse(JSON.stringify(r.state));
    forged.imageFlows["A:s:1"].materialized = flag;
    assert.throws(() => validate(forged), /image flow/i);
  }
  const forged = JSON.parse(JSON.stringify(r.state));
  forged.listFamilies[forged.imageFlows["A:s:1"].family].kind = "list";
  assert.throws(() => validate(forged));
});
for (const type of ["code", "bullet_list"])
  test(`restoration does not cross a new foreign block ${type}`, () => {
    const r = durable();
    insert(r, 10);
    r.accept(paste(r.state, suffix, 3, type));
    r.accept(undo("A", 2, "A:s:1"));
    r.accept(undo("B", 2, "B:s:1"));
    r.accept(undo("A", 3, "A:s:2"));
    r.accept(paste(r.state, suffix, 8, "code", "D", 1));
    const before = JSON.stringify(r.state);
    r.accept(undo("B", 3, "B:s:2"), "rejected");
    assert.equal(JSON.stringify(r.state), before);
    r.accept(undo("D", 2, "D:s:1"));
    r.accept(undo("B", 4, "B:s:2"));
  });
test("saved separated-cut neighbours are validated", () => {
  const r = durable();
  insert(r, 10);
  r.accept(paste(r.state, suffix, 3, "code"));
  r.accept(undo("A", 2, "A:s:1"));
  const f = r.state.imageFlows["A:s:1"].family,
    c = r.state.imageFlows["A:s:1"].cut;
  for (const neighbours of [
    null,
    false,
    { preceding: ["missing"], following: [] },
    { preceding: ["list"], following: ["list"] },
    { preceding: "list", following: [] },
  ]) {
    const forged = JSON.parse(JSON.stringify(r.state));
    forged.listFamilies[f].cuts[c].separatedPlacement.neighbours = neighbours;
    assert.throws(() => validate(forged), /neighbours/);
  }
});
for (const offset of [0, 6])
  test(`materialization preserves accepted image order at endpoint ${offset}`, () => {
    const r = durable();
    insert(r, 10);
    for (const actor of ["C", "D"]) {
      r.accept(
        op(
          actor,
          1,
          planInsertBlock(
            r.state,
            point(r.state, "before", offset),
            op(actor, 1),
            {
              type: "image",
              slot: `endpoint-${actor}-slot-0001`,
              width: 320,
              height: 180,
            },
          ).intent,
        ),
      );
    }
    const images = (s) =>
      s.nodes.cell.children.filter((id) => s.nodes[id].type === "image");
    const before = images(r.state);
    r.accept(paste(r.state, suffix, 3, "code"));
    assert.deepEqual(images(r.state), before);
    r.accept(undo("B", 2, "B:s:1"));
    assert.deepEqual(images(r.state), before);
    r.accept(undo("C", 2, "C:s:1"));
    r.accept(undo("C", 3, "C:s:2"));
    assert.deepEqual(images(r.state), before);
  });

for (const type of ["code", "bullet_list"])
  for (const block of ["before", "target", "after", suffix])
    for (const offset of [0, 1])
      test(`subsequent image after rich paste ${type} ${block} offset=${offset}`, () => {
        const r = durable();
        insert(r, 10);
        r.accept(paste(r.state, suffix, 3, type));
        const before = visibleTree(r.state, r.state.nodes.cell.children);
        const atoms = text(r.state, block);
        const planned = planInsertBlock(
          r.state,
          point(r.state, block, offset),
          op("C", 1),
          {
            type: "image",
            slot: "subsequent-image-slot-0001",
            width: 320,
            height: 180,
          },
        );
        r.accept(op("C", 1, planned.intent));
        assert.equal(r.state.nodes["C:s:1:image"].live, true);
        assert.ok(r.state.nodes.cell.children.includes("C:s:1:image"));
        const prose = (nodes) =>
          nodes.map((n) => n.text ?? prose(n.children || [])).join("");
        assert.equal(
          prose(visibleTree(r.state, r.state.nodes.cell.children)),
          prose(before),
        );
        const inserted = visibleTree(r.state, r.state.nodes.cell.children);
        r.accept(undo("C", 2, "C:s:1"));
        assert.deepEqual(
          visibleTree(r.state, r.state.nodes.cell.children),
          before,
        );
        assert.deepEqual(text(r.state, block), atoms);
        r.accept(undo("C", 3, "C:s:2"));
        assert.deepEqual(
          visibleTree(r.state, r.state.nodes.cell.children),
          inserted,
        );
        r.accept(undo("C", 4, "C:s:3"));
        r.accept(undo("B", 2, "B:s:1"));
        r.accept(undo("A", 2, "A:s:1"));
        assert.deepEqual(view(r.state), view(fixture()));
      });

for (const type of ["code", "bullet_list"])
  for (const imageFirst of [false, true])
    test(`repeated independent image/paste ownership ${type} imageFirst=${imageFirst}`, () => {
      const r = durable(),
        initial = view(r.state),
        atoms = text(r.state, "target");
      for (let cycle = 1; cycle <= 5; cycle++) {
        const a = `image${cycle}`,
          b = `paste${cycle}`;
        const plan = planInsertBlock(
          r.state,
          point(r.state, "target", 10),
          op(a, 1),
          {
            type: "image",
            slot: `repeated-slot-${cycle}-0001`,
            width: 320,
            height: 180,
          },
        );
        r.accept(op(a, 1, plan.intent));
        r.accept(paste(r.state, `${a}:s:1:cut:list-tail`, 3, type, b, 1));
        for (const actor of imageFirst ? [a, b] : [b, a])
          r.accept(undo(actor, 2, `${actor}:s:1`));
        assert.deepEqual(view(r.state), initial);
        assert.deepEqual(text(r.state, "target"), atoms);
      }
    });
