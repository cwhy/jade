// SPDX-License-Identifier: MPL-2.0
// Image-only clipboard placement observed in a leaf numbered item.
import test from "node:test";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { planInsertBlock, planEnter } from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { listMarkers } from "@cwhy/jade-core/list-marker";

function fixture() {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["table"] },
    table: { id: "table", type: "table", live: true, children: ["row"] },
    row: { id: "row", type: "row", live: true, children: ["cell"] },
    cell: { id: "cell", type: "cell", live: true, children: ["list"] },
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
  });
}
const words = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
function projection(s) {
  const out = [];
  for (const id of s.nodes.cell.children) {
    const n = s.nodes[id];
    if (n.type === "ordered_list") {
      for (const marker of listMarkers(s, id)) {
        const item = s.nodes[marker.id];
        out.push({
          kind: "ordered",
          number: marker.number,
          text: words(s, item.children[0]),
        });
        for (const child of item.children.slice(1))
          out.push({ kind: s.nodes[child].type, parent: "item" });
      }
    } else
      out.push(
        n.type === "paragraph"
          ? { kind: "paragraph", text: words(s, id) }
          : { kind: n.type, parent: "cell" },
      );
  }
  return out;
}
const first = { kind: "ordered", number: 1, text: "Before" };
const whole = { kind: "ordered", number: 2, text: "Workspace settings" };
const last = { kind: "ordered", number: 3, text: "After" };
const image = { kind: "image", parent: "cell" };
for (const [name, offset, expected] of [
  ["start", 0, [first, image, whole, last]],
  [
    "middle",
    10,
    [
      first,
      { kind: "ordered", number: 2, text: "Workspace " },
      image,
      { kind: "paragraph", text: "settings" },
      last,
    ],
  ],
  ["end", 18, [first, whole, image, last]],
])
  test(`Lark image-only paste: ${name} of leaf numbered item`, () => {
    const s = fixture();
    const range = captureRange(
      s,
      { block: "target", offset },
      { block: "target", offset },
    );
    const op = {
      actor: "A",
      stream: "reference",
      seq: 1,
      id: "A:reference:1",
      epoch: 1,
    };
    const plan = planInsertBlock(s, range, op, {
      type: "image",
      slot: "reference-image-slot-0001",
      width: 160,
      height: 64,
    });
    const next = apply(s, { ...op, intent: plan.intent });
    validate(next);
    assert.deepEqual(projection(next), expected);
    // Product requirement beyond the observed visible restoration: exact owned
    // Undo must preserve the original character identities, not rebuild text.
    const back = apply(next, {
      ...op,
      seq: 2,
      id: "A:reference:2",
      intent: { kind: "undo", target: op.id },
    });
    assert.deepEqual(projection(back), projection(s));
    assert.deepEqual(text(back, "target"), text(s, "target"));
  });

const op = (actor, seq, intent) => ({
  actor,
  stream: "s",
  seq,
  id: `${actor}:s:${seq}`,
  epoch: 1,
  intent,
});
const at = (s, offset) =>
  captureRange(s, { block: "target", offset }, { block: "target", offset });
const insertion = (s, offset) =>
  op(
    "A",
    1,
    planInsertBlock(s, at(s, offset), op("A", 1), {
      type: "image",
      slot: "list-image-slot-00001",
      width: 160,
      height: 64,
    }).intent,
  );
const undo = (s, actor = "A", seq = 2, target = "A:s:1") =>
  apply(s, op(actor, seq, { kind: "undo", target }));
for (const offset of [0, 10, 18])
  test(`list image repeated Undo/Redo offset=${offset}`, () => {
    const s = fixture(),
      ins = insertion(s, offset),
      n = apply(s, ins);
    let current = n;
    for (let i = 0; i < 3; i++) {
      current = undo(current, "A", 2 + i * 2, i ? `A:s:${1 + i * 2}` : ins.id);
      assert.deepEqual(projection(current), projection(s));
      assert.deepEqual(text(current, "target"), text(s, "target"));
      current = undo(current, "A", 3 + i * 2, `A:s:${2 + i * 2}`);
      assert.deepEqual(projection(current), projection(n));
      validate(current);
    }
  });
for (const offset of [0, 10, 18])
  for (const peerOffset of [0, 5, 10, 14, 18])
    for (const first of [false, true])
      test(`peer typing insertion=${offset} peer=${peerOffset} first=${first}`, () => {
        const s = fixture(),
          ins = insertion(s, offset),
          peer = op("B", 1, {
            kind: "insert",
            at: gapAt(s, "target", peerOffset),
            text: "友",
            marks: ["strong"],
          }),
          expected = apply(s, peer),
          anchor = anchorAt(s, "target", 0, 18);
        let n = s;
        for (const action of first ? [peer, ins] : [ins, peer])
          n = apply(n, action);
        n = undo(n);
        validate(n);
        assert.deepEqual(projection(n), projection(expected));
        assert.deepEqual(text(n, "target"), text(expected, "target"));
        assert.deepEqual(
          resolveAnchor(n, anchor).segments.map((a) => a.id),
          resolveAnchor(expected, anchor).segments.map((a) => a.id),
        );
        n = undo(n, "B", 2, "B:s:1");
        assert.deepEqual(text(n, "target"), text(s, "target"));
      });
for (const offset of [0, 10, 18])
  for (const peerOffset of [0, 5, 10, 14, 18])
    for (const first of [false, true])
      test(`peer Enter insertion=${offset} peer=${peerOffset} first=${first}`, () => {
        const s = fixture(),
          ins = insertion(s, offset),
          peer = op("B", 1, planEnter(s, at(s, peerOffset), op("B", 1)).intent),
          expected = apply(s, peer);
        let n = s;
        for (const action of first ? [peer, ins] : [ins, peer])
          n = apply(n, action);
        n = undo(n);
        validate(n);
        assert.deepEqual(projection(n), projection(expected));
        for (const id of Object.keys(expected.nodes))
          if (expected.nodes[id].live && expected.nodes[id].text)
            assert.deepEqual(text(n, id), text(expected, id));
        n = undo(n, "A", 3, "A:s:2");
        validate(n);
        n = undo(n, "A", 4, "A:s:3");
        validate(n);
        assert.deepEqual(projection(n), projection(expected));
        n = undo(n, "B", 2, "B:s:1");
        validate(n);
        assert.deepEqual(projection(n), projection(s));
      });
for (const offset of [0, 10, 18])
  for (const first of [false, true])
    test(`two images independent Undo offset=${offset} first=${first}`, () => {
      const s = fixture(),
        a = insertion(s, offset),
        base = op("B", 1),
        b = {
          ...base,
          intent: planInsertBlock(s, at(s, offset), base, {
            type: "image",
            slot: "list-image-slot-00002",
            width: 80,
            height: 40,
          }).intent,
        };
      let n = s;
      for (const action of first ? [b, a] : [a, b]) n = apply(n, action);
      n = undo(n);
      assert.equal(n.nodes["B:s:1:image"].live, true);
      validate(n);
      n = undo(n, "B", 2, "B:s:1");
      assert.deepEqual(projection(n), projection(s));
      assert.deepEqual(text(n, "target"), text(s, "target"));
    });
test("Enter authored in the plain suffix retains paragraph grammar after image Undo", () => {
  const s = fixture(),
    a = insertion(s, 10);
  let n = apply(s, a);
  const tail = "A:s:1:cut:list-tail",
    r = captureRange(n, { block: tail, offset: 3 }, { block: tail, offset: 3 }),
    b = op("B", 1, planEnter(n, r, op("B", 1)).intent);
  n = apply(n, b);
  n = undo(n);
  validate(n);
  assert.deepEqual(projection(n), [
    first,
    { kind: "ordered", number: 2, text: "Workspace set" },
    { kind: "paragraph", text: "tings" },
    last,
  ]);
});

for (const aOffset of [0, 5, 10, 18])
  for (const bOffset of [0, 5, 10, 18])
    for (const first of [false, true])
      for (const undoB of [false, true])
        test(`independent image lifecycles ${aOffset}/${bOffset} first=${first} undoB=${undoB}`, () => {
          const s = fixture(),
            a = insertion(s, aOffset),
            base = op("B", 1),
            b = {
              ...base,
              intent: planInsertBlock(s, at(s, bOffset), base, {
                type: "image",
                slot: "list-image-slot-00002",
                width: 80,
                height: 40,
              }).intent,
            };
          let room = new Room(s),
            record = room.snapshot();
          const actions = [
            ...(first ? [b, a] : [a, b]),
            op(undoB ? "B" : "A", 2, {
              kind: "undo",
              target: undoB ? b.id : a.id,
            }),
            op(undoB ? "A" : "B", 2, {
              kind: "undo",
              target: undoB ? a.id : b.id,
            }),
          ];
          for (const action of actions) {
            const receipt = room.accept(action);
            assert.equal(receipt.outcome, "accepted", JSON.stringify(receipt));
            record = replay(record, { op: action, receipt });
            assert.deepEqual(room.accept(action), receipt);
            room = new Room(null, JSON.parse(JSON.stringify(room.record)));
            assert.deepEqual(room.accept(action), receipt);
            assert.deepEqual(room.record, record);
            validate(record.state);
          }
          assert.deepEqual(projection(room.record.state), projection(s));
          assert.deepEqual(
            text(room.record.state, "target"),
            text(s, "target"),
          );
          for (const actor of ["A", "B"]) {
            const receipt = room.accept(
              op(actor, 3, { kind: "undo", target: actor + ":s:2" }),
            );
            assert.equal(receipt.outcome, "accepted", JSON.stringify(receipt));
          }
          assert.equal(room.record.state.nodes[a.id + ":image"].live, true);
          assert.equal(room.record.state.nodes[b.id + ":image"].live, true);
          for (const actor of ["B", "A"])
            assert.equal(
              room.accept(
                op(actor, 4, { kind: "undo", target: actor + ":s:3" }),
              ).outcome,
              "accepted",
            );
          assert.deepEqual(projection(room.record.state), projection(s));
        });
for (const reverse of [false, true])
  test(`online plain Enter retains authored kind through both Undo orders ${reverse}`, () => {
    const s = fixture();
    let n = apply(s, insertion(s, 10));
    const r = captureRange(
      n,
      { block: "A:s:1:cut:list-tail", offset: 3 },
      { block: "A:s:1:cut:list-tail", offset: 3 },
    );
    n = apply(n, op("B", 1, planEnter(n, r, op("B", 1)).intent));
    for (const actor of reverse ? ["B", "A"] : ["A", "B"])
      n = undo(n, actor, 2, actor + ":s:1");
    assert.deepEqual(projection(n), projection(s));
    for (const actor of ["A", "B"]) n = undo(n, actor, 3, actor + ":s:2");
    n = undo(n, "A", 4, "A:s:3");
    assert.deepEqual(projection(n), [
      first,
      { kind: "ordered", number: 2, text: "Workspace set" },
      { kind: "paragraph", text: "tings" },
      last,
    ]);
  });
for (const offset of [0, 10, 18])
  test(`upload generations and exact completed restoration ${offset}`, () => {
    const s = fixture(),
      room = new Room(s),
      a = insertion(s, offset);
    assert.equal(room.accept(a).outcome, "accepted");
    const complete = (seq, generation) =>
      op("host", seq, {
        kind: "imageComplete",
        image: a.id + ":image",
        generation,
        asset: "a".repeat(64),
        mime: "image/png",
        bytes: 160,
        width: 160,
        height: 64,
      });
    assert.equal(
      room.accept(op("A", 2, { kind: "undo", target: a.id })).outcome,
      "accepted",
    );
    assert.equal(room.accept(complete(1, a.id)).outcome, "rejected");
    assert.equal(
      room.accept(op("A", 3, { kind: "undo", target: "A:s:2" })).outcome,
      "accepted",
    );
    assert.equal(room.accept(complete(2, "A:s:3")).outcome, "accepted");
    assert.equal(
      room.accept(op("A", 4, { kind: "undo", target: "A:s:3" })).outcome,
      "accepted",
    );
    assert.equal(
      room.accept(op("A", 5, { kind: "undo", target: "A:s:4" })).outcome,
      "accepted",
    );
    assert.equal(
      room.record.state.nodes[a.id + ":image"].asset,
      "a".repeat(64),
    );
    validate(room.record.state);
  });
for (const tamper of ["active", "kind", "view", "cache", "missing", "cut"])
  test(`malformed persisted image flow rejects ${tamper}`, () => {
    const n = JSON.parse(
      JSON.stringify(apply(fixture(), insertion(fixture(), 10))),
    );
    if (tamper === "active") n.imageFlows["A:s:1"].active = "yes";
    if (tamper === "kind") n.nodes.target.imageFlowKind = "html";
    if (tamper === "view") n.nodes.cell.children.reverse();
    if (tamper === "cache") n.imageFlowProjection.nodes.list.children.reverse();
    if (tamper === "missing") delete n.imageFlowProjection;
    if (tamper === "cut") n.imageFlows["A:s:1"].cut = "unknown";
    assert.throws(() => validate(n), /image|Image|paragraph/);
  });
test("private image activity cannot be forged as a public operation", () => {
  const n = apply(fixture(), insertion(fixture(), 10));
  assert.throws(
    () =>
      apply(
        n,
        op("B", 1, { kind: "imageFlowActive", flow: "A:s:1", active: false }),
      ),
    /unsupported/,
  );
});
test("unrelated typing retains image projection and node-map identity", () => {
  const base = fixture(),
    nodes = structuredClone(base.nodes),
    content = {};
  for (const n of Object.values(base.nodes))
    if (n.type === "paragraph") content[n.id] = [{ text: words(base, n.id) }];
  nodes.doc.children.push("outside");
  nodes.outside = { id: "outside", type: "paragraph", live: true };
  content.outside = [{ text: "Outside" }];
  const s = seed(nodes, content),
    room = new Room(s);
  assert.equal(room.accept(insertion(s, 10)).outcome, "accepted");
  const before = room.record.state;
  assert.equal(
    room.accept(
      op("B", 1, {
        kind: "insert",
        at: gapAt(before, "outside", 0),
        text: "x",
        marks: [],
      }),
    ).outcome,
    "accepted",
  );
  assert.equal(room.record.state.nodes, before.nodes);
  assert.equal(
    room.record.state.imageFlowProjection,
    before.imageFlowProjection,
  );
  validate(room.record.state);
});

import {
  planClearCells,
  planTableDelete,
  previewTableDelete,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
for (const action of ["clear", "rows", "columns", "table"])
  for (const offset of [0, 10, 18])
    test(`active image flow ${action} restore offset=${offset}`, () => {
      const s = fixture(),
        a = insertion(s, offset);
      let n = apply(s, a);
      const range = captureCellRange(n, "table", "cell"),
        d = op("B", 1);
      const planned =
        action === "clear"
          ? planClearCells(n, range, d)
          : planTableDelete(n, range, d, {
              preview: previewTableDelete(n, range, action),
            });
      n = apply(n, { ...d, intent: planned.intent });
      assert.equal(n.nodes[a.id + ":image"].live, false);
      validate(n);
      n = undo(n, "B", 2, d.id);
      validate(n);
      assert.deepEqual(projection(n), projection(apply(s, a)));
      assert.equal(n.pendingMedia[a.id + ":image"].generation, "B:s:2");
      n = undo(n, "B", 3, "B:s:2");
      n = undo(n, "B", 4, "B:s:3");
      validate(n);
      assert.equal(n.pendingMedia[a.id + ":image"].generation, "B:s:4");
      n = undo(n);
      assert.deepEqual(projection(n), projection(s));
    });
for (const action of ["clear", "rows", "columns", "table"])
  for (const offset of [0, 10, 18])
    for (const completed of [false, true])
      test(`persisted flow deletion ${action} offset=${offset} completed=${completed}`, () => {
        const s = fixture(),
          a = insertion(s, offset);
        let room = new Room(s),
          record = room.snapshot();
        const accept = (operation, expected = "accepted") => {
          const receipt = room.accept(operation);
          assert.equal(receipt.outcome, expected, JSON.stringify(receipt));
          record = replay(record, { op: operation, receipt });
          room = new Room(null, JSON.parse(JSON.stringify(room.record)));
          assert.deepEqual(room.accept(operation), receipt);
          assert.deepEqual(room.record, record);
          validate(room.record.state);
        };
        accept(a);
        const complete = (seq, generation) =>
          op("host", seq, {
            kind: "imageComplete",
            image: a.id + ":image",
            generation,
            asset: "a".repeat(64),
            mime: "image/png",
            bytes: 160,
            width: 160,
            height: 64,
          });
        if (completed) accept(complete(1, a.id));
        const n = room.record.state,
          range = captureCellRange(n, "table", "cell"),
          d = op("B", 1),
          planned =
            action === "clear"
              ? planClearCells(n, range, d)
              : planTableDelete(n, range, d, {
                  preview: previewTableDelete(n, range, action),
                });
        accept({ ...d, intent: planned.intent });
        assert.equal(room.record.state.nodes[a.id + ":image"].live, false);
        if (!completed) accept(complete(1, a.id), "rejected");
        accept(op("B", 2, { kind: "undo", target: d.id }));
        assert.deepEqual(projection(room.record.state), projection(n));
        if (!completed) {
          accept(complete(2, a.id), "rejected");
          accept(complete(3, "B:s:2"));
        }
        assert.equal(
          room.record.state.nodes[a.id + ":image"].asset,
          "a".repeat(64),
        );
        if (completed) {
          accept(op("B", 3, { kind: "undo", target: "B:s:2" }));
          accept(op("B", 4, { kind: "undo", target: "B:s:3" }));
        } else {
          // Existing destructive-Undo policy protects content that completed
          // after the saved witness. A fresh reviewed deletion may remove it.
          accept(op("B", 3, { kind: "undo", target: "B:s:2" }), "rejected");
          const current = room.record.state,
            freshRange = captureCellRange(current, "table", "cell"),
            fresh = op("B", 4);
          const reviewed =
            action === "clear"
              ? planClearCells(current, freshRange, fresh)
              : planTableDelete(current, freshRange, fresh, {
                  preview: previewTableDelete(current, freshRange, action),
                });
          accept({ ...fresh, intent: reviewed.intent });
          accept(op("B", 5, { kind: "undo", target: fresh.id }));
          assert.equal(
            room.record.state.nodes[a.id + ":image"].asset,
            "a".repeat(64),
          );
        }
        accept(op("A", 2, { kind: "undo", target: a.id }));
        assert.deepEqual(projection(room.record.state), projection(s));
      });
test("clearing one cell keeps another cell image flow live and unchanged", () => {
  const base = fixture(),
    nodes = structuredClone(base.nodes),
    content = {};
  for (const n of Object.values(base.nodes))
    if (n.type === "paragraph") content[n.id] = [{ text: words(base, n.id) }];
  nodes.row.children.push("other-cell");
  nodes["other-cell"] = {
    id: "other-cell",
    type: "cell",
    live: true,
    children: ["other-list"],
  };
  nodes["other-list"] = {
    id: "other-list",
    type: "ordered_list",
    live: true,
    children: ["other-item"],
  };
  nodes["other-item"] = {
    id: "other-item",
    type: "list_item",
    live: true,
    children: ["other-text"],
  };
  nodes["other-text"] = { id: "other-text", type: "paragraph", live: true };
  content["other-text"] = [{ text: "Other sample" }];
  const s = seed(nodes, content);
  let n = apply(s, insertion(s, 10));
  const c = op("C", 1),
    range = captureRange(
      n,
      { block: "other-text", offset: 5 },
      { block: "other-text", offset: 5 },
    );
  n = apply(n, {
    ...c,
    intent: planInsertBlock(n, range, c, {
      type: "image",
      slot: "second-cell-image-0001",
      width: 80,
      height: 40,
    }).intent,
  });
  const other = n.nodes["other-cell"].children.slice(),
    d = op("B", 1),
    cells = captureCellRange(n, "table", "cell");
  n = apply(n, { ...d, intent: planClearCells(n, cells, d).intent });
  validate(n);
  assert.equal(n.nodes["A:s:1:image"].live, false);
  assert.equal(n.nodes["C:s:1:image"].live, true);
  assert.deepEqual(n.nodes["other-cell"].children, other);
  assert.equal(n.pendingMedia["C:s:1:image"].generation, c.id);
  n = undo(n, "B", 2, d.id);
  validate(n);
  assert.deepEqual(n.nodes["other-cell"].children, other);
});
