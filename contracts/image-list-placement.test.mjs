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
  resolveGap,
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
import { planDelete } from "@cwhy/jade-core/commands";
for (const where of ["target", "A:s:1:cut:list-tail", "after"])
  test(`typing inside flow retains topology ${where}`, () => {
    const s = fixture(),
      room = new Room(s);
    room.accept(insertion(s, 10));
    const before = room.record.state;
    const peer = op("B", 1, {
      kind: "insert",
      at: gapAt(before, where, 1),
      text: "友",
      marks: ["strong"],
    });
    assert.equal(room.accept(peer).outcome, "accepted");
    const next = room.record.state;
    assert.equal(next.nodes, before.nodes);
    assert.equal(next.imageFlowProjection, before.imageFlowProjection);
    validate(next);
    const fresh = new Room(null, JSON.parse(JSON.stringify(room.record)));
    assert.deepEqual(fresh.record, room.record);
    assert.equal(
      fresh.accept(op("B", 2, { kind: "undo", target: peer.id })).outcome,
      "accepted",
    );
    assert.deepEqual(projection(fresh.record.state), projection(before));
  });

for (const direction of ["backward", "forward"])
  test(`plain suffix Enter and ${direction} join preserve image flow`, () => {
    const s = fixture();
    let n = apply(s, insertion(s, 10));
    const suffix = "A:s:1:cut:list-tail";
    n = apply(
      n,
      op(
        "B",
        1,
        planEnter(
          n,
          captureRange(
            n,
            { block: suffix, offset: 3 },
            { block: suffix, offset: 3 },
          ),
          op("B", 1),
        ).intent,
      ),
    );
    const before = n,
      tail = "B:s:1:list-tail",
      block = direction === "backward" ? tail : suffix,
      offset = direction === "backward" ? 0 : 3;
    const p = planDelete(
      n,
      captureRange(n, { block, offset }, { block, offset }),
      direction,
      op("B", 2),
    );
    assert.ok(p.intent);
    n = apply(n, op("B", 2, p.intent));
    validate(n);
    assert.equal(words(n, suffix), "settings");
    assert.equal(n.nodes["A:s:1:image"].live, true);
    n = undo(n, "B", 3, "B:s:2");
    assert.deepEqual(projection(n), projection(before));
    validate(n);
  });
for (const direction of ["backward", "forward"])
  for (const imageFirst of [false, true])
    for (const typingFirst of [false, true])
      test(`join/image independent restoration ${direction} imageFirst=${imageFirst} typingFirst=${typingFirst}`, () => {
        const s = fixture(),
          anchor = anchorAt(s, "target", 0, 18);
        let room = new Room(s),
          record = room.snapshot();
        const accept = (operation) => {
          const receipt = room.accept(operation);
          assert.equal(receipt.outcome, "accepted", JSON.stringify(receipt));
          record = replay(record, { op: operation, receipt });
          room = new Room(null, JSON.parse(JSON.stringify(room.record)));
          assert.deepEqual(room.accept(operation), receipt);
          assert.deepEqual(room.record, record);
          validate(record.state);
        };
        accept(insertion(s, 10));
        const suffix = "A:s:1:cut:list-tail";
        let n = room.record.state;
        accept(
          op(
            "B",
            1,
            planEnter(
              n,
              captureRange(
                n,
                { block: suffix, offset: 3 },
                { block: suffix, offset: 3 },
              ),
              op("B", 1),
            ).intent,
          ),
        );
        n = room.record.state;
        const peer = op("C", 1, {
            kind: "insert",
            at: gapAt(n, suffix, 2),
            text: "友",
            marks: ["strong"],
          }),
          block = direction === "backward" ? "B:s:1:list-tail" : suffix,
          offset = direction === "backward" ? 0 : 3,
          join = op(
            "B",
            2,
            planDelete(
              n,
              captureRange(n, { block, offset }, { block, offset }),
              direction,
              op("B", 2),
            ).intent,
          );
        for (const action of typingFirst ? [peer, join] : [join, peer])
          accept(action);
        const uImage = op("A", 2, { kind: "undo", target: "A:s:1" }),
          uJoin = op("B", 3, { kind: "undo", target: "B:s:2" });
        for (const action of imageFirst ? [uImage, uJoin] : [uJoin, uImage])
          accept(action);
        assert.deepEqual(projection(room.record.state), [
          first,
          { kind: "ordered", number: 2, text: "Workspace se友t" },
          { kind: "paragraph", text: "tings" },
          last,
        ]);
        accept(op("A", 3, { kind: "undo", target: "A:s:2" }));
        accept(op("B", 4, { kind: "undo", target: "B:s:3" }));
        accept(op("B", 5, { kind: "undo", target: "B:s:4" }));
        accept(op("A", 4, { kind: "undo", target: "A:s:3" }));
        accept(op("B", 6, { kind: "undo", target: "B:s:1" }));
        assert.equal(
          words(room.record.state, "target"),
          "Workspace se友ttings",
        );
        assert.deepEqual(
          resolveAnchor(room.record.state, anchor)
            .segments.filter((x) => anchor.atoms.includes(x.id))
            .map((x) => x.id),
          anchor.atoms,
        );
        accept(op("C", 2, { kind: "undo", target: "C:s:1" }));
        assert.deepEqual(text(room.record.state, "target"), text(s, "target"));
      });

import { planReplace } from "@cwhy/jade-core/commands";
import { plainFragment } from "@cwhy/jade-core/fragment";
for (const replacement of ["", "X", "X\nY", "\n"])
  test(`replace across plain image suffix ${JSON.stringify(replacement)}`, () => {
    let s = apply(fixture(), insertion(fixture(), 10));
    const suffix = "A:s:1:cut:list-tail";
    s = apply(
      s,
      op(
        "B",
        1,
        planEnter(
          s,
          captureRange(
            s,
            { block: suffix, offset: 3 },
            { block: suffix, offset: 3 },
          ),
          op("B", 1),
        ).intent,
      ),
    );
    const initial = s,
      tail = "B:s:1:list-tail";
    const plan = planReplace(
      s,
      captureRange(s, { block: suffix, offset: 1 }, { block: tail, offset: 2 }),
      plainFragment(replacement),
      op("C", 1),
      { strict: true },
    );
    s = apply(s, op("C", 1, plan.intent));
    const caret = resolveGap(s, plan.after),
      lines = replacement.split("\n");
    assert.equal(
      caret.offset,
      lines.at(-1).length + (lines.length === 1 ? 1 : 0),
    );
    assert.equal(
      words(s, caret.block),
      (lines.length === 1 ? "s" : "") + lines.at(-1) + "ngs",
    );
    assert.deepEqual(projection(s), [
      first,
      { kind: "ordered", number: 2, text: "Workspace " },
      image,
      ...("s" + replacement + "ngs")
        .split("\n")
        .map((text) => ({ kind: "paragraph", text })),
      last,
    ]);
    s = undo(s, "C", 2, "C:s:1");
    assert.deepEqual(projection(s), projection(initial));
    assert.deepEqual(text(s, suffix), text(initial, suffix));
    assert.deepEqual(text(s, tail), text(initial, tail));
    validate(s);
  });

for (const replacement of ["X", "X\nY", "\n"])
  for (const peerRight of [false, true])
    for (const peerFirst of [false, true])
      for (const imageFirst of [false, true])
        test(`suffix replacement preserves offline text replacement=${JSON.stringify(replacement)} right=${peerRight} peerFirst=${peerFirst} imageFirst=${imageFirst}`, () => {
          const initial = fixture(),
            original = text(initial, "target");
          let room = new Room(initial),
            record = room.snapshot();
          const accept = (operation) => {
            const receipt = room.accept(operation);
            assert.equal(receipt.outcome, "accepted", JSON.stringify(receipt));
            record = replay(record, { op: operation, receipt });
            room = new Room(null, JSON.parse(JSON.stringify(room.record)));
            assert.deepEqual(room.accept(operation), receipt);
            assert.deepEqual(room.record, record);
            validate(record.state);
          };
          accept(insertion(initial, 10));
          const left = "A:s:1:cut:list-tail",
            right = "B:s:1:list-tail";
          let s = room.record.state;
          accept(
            op(
              "B",
              1,
              planEnter(
                s,
                captureRange(
                  s,
                  { block: left, offset: 3 },
                  { block: left, offset: 3 },
                ),
                op("B", 1),
              ).intent,
            ),
          );
          s = room.record.state;
          const replace = op(
              "C",
              1,
              planReplace(
                s,
                captureRange(
                  s,
                  { block: left, offset: 1 },
                  { block: right, offset: 2 },
                ),
                plainFragment(replacement),
                op("C", 1),
                { strict: true },
              ).intent,
            ),
            peer = op("D", 1, {
              kind: "insert",
              at: gapAt(s, peerRight ? right : left, peerRight ? 1 : 2),
              text: "友",
              marks: ["strong"],
            });
          for (const operation of peerFirst ? [peer, replace] : [replace, peer])
            accept(operation);
          const uImage = op("A", 2, { kind: "undo", target: "A:s:1" }),
            uReplace = op("C", 2, { kind: "undo", target: "C:s:1" });
          for (const operation of imageFirst
            ? [uImage, uReplace]
            : [uReplace, uImage])
            accept(operation);
          const expected = [
            first,
            {
              kind: "ordered",
              number: 2,
              text: peerRight ? "Workspace set" : "Workspace se友t",
            },
            { kind: "paragraph", text: peerRight ? "t友ings" : "tings" },
            last,
          ];
          assert.deepEqual(projection(room.record.state), expected);
          accept(op("A", 3, { kind: "undo", target: "A:s:2" }));
          accept(op("C", 3, { kind: "undo", target: "C:s:2" }));
          accept(op("C", 4, { kind: "undo", target: "C:s:3" }));
          accept(op("A", 4, { kind: "undo", target: "A:s:3" }));
          assert.deepEqual(projection(room.record.state), expected);
          accept(op("B", 2, { kind: "undo", target: "B:s:1" }));
          const pos = peerRight ? 14 : 12;
          assert.deepEqual(text(room.record.state, "target"), [
            ...original.slice(0, pos),
            { id: "D:s:1:char:0", char: "友", marks: ["strong"] },
            ...original.slice(pos),
          ]);
          accept(op("D", 2, { kind: "undo", target: "D:s:1" }));
          assert.deepEqual(text(room.record.state, "target"), original);
        });

import { copyRange, copyCells, planTextFormat } from "@cwhy/jade-core/commands";
for (const property of [
  "strong",
  "em",
  "underline",
  "strike",
  "color",
  "highlight",
])
  for (const imageFirst of [false, true])
    test(`format image prefix/suffix retains peer contribution ${property} imageFirst=${imageFirst}`, () => {
      const initial = fixture(),
        value = ["color", "highlight"].includes(property)
          ? { type: property, attrs: { color: "red" } }
          : undefined;
      let s = apply(initial, insertion(initial, 10));
      const suffix = "A:s:1:cut:list-tail",
        range = captureRange(
          s,
          { block: "target", offset: 5 },
          { block: suffix, offset: 5 },
        );
      const author = op(
        "B",
        1,
        planTextFormat(s, range, op("B", 1), { property, value }).intent,
      );
      const peerRange = captureRange(
          s,
          { block: suffix, offset: 1 },
          { block: suffix, offset: 3 },
        ),
        peerIds = peerRange.slices[0].atoms.map((a) => a.id);
      const peerValue = ["color", "highlight"].includes(property)
        ? { type: property, attrs: { color: "blue" } }
        : { type: property };
      const peer = op(
        "C",
        1,
        planTextFormat(s, peerRange, op("C", 1), {
          property,
          value: ["color", "highlight"].includes(property)
            ? peerValue
            : undefined,
        }).intent,
      );
      s = apply(apply(s, author), peer);
      for (const actor of imageFirst ? ["A", "B"] : ["B", "A"])
        s = undo(s, actor, 2, `${actor}:s:1`);
      assert.deepEqual(projection(s), projection(initial));
      for (const atom of text(s, "target"))
        assert.deepEqual(
          atom.marks,
          peerIds.includes(atom.id) ? [peerValue] : [],
        );
      s = undo(s, "C", 2, "C:s:1");
      assert.deepEqual(text(s, "target"), text(initial, "target"));
      validate(s);
    });

test("copy pending image flow blocks image transfer but permits plain suffix copy", () => {
  const initial = fixture(),
    s = apply(initial, insertion(initial, 10)),
    before = JSON.stringify(s);
  assert.throws(
    () => copyCells(s, captureCellRange(s, "table", "cell")),
    /upload is incomplete/,
  );
  assert.throws(
    () =>
      copyRange(
        s,
        captureRange(
          s,
          { block: "target", offset: 1 },
          { block: "A:s:1:cut:list-tail", offset: 2 },
        ),
      ),
    /image|asset/i,
  );
  const copied = copyRange(
    s,
    captureRange(
      s,
      { block: "A:s:1:cut:list-tail", offset: 1 },
      { block: "A:s:1:cut:list-tail", offset: 4 },
    ),
  );
  assert.equal(copied.plain, "ett");
  assert.equal(copied.html, "<p>ett</p>");
  assert.equal(JSON.stringify(s), before);
});
for (const wholeCell of [false, true])
  test(`completed flow copy carries visible wrappers without ownership wholeCell=${wholeCell}`, () => {
    const initial = fixture();
    let s = apply(initial, insertion(initial, 10));
    s = apply(
      s,
      op("host", 1, {
        kind: "imageComplete",
        image: "A:s:1:image",
        generation: "A:s:1",
        asset: "a".repeat(64),
        mime: "image/png",
        bytes: 160,
        width: 160,
        height: 64,
      }),
    );
    const before = JSON.stringify(s),
      copied = wholeCell
        ? copyCells(s, captureCellRange(s, "table", "cell"))
        : copyRange(
            s,
            captureRange(
              s,
              { block: "target", offset: 0 },
              { block: "after", offset: 5 },
            ),
          ).fragment,
      blocks = wholeCell ? copied.rows[0][0] : copied.blocks;
    assert.deepEqual(
      blocks.map((b) => b.type),
      ["ordered_list", "image", "paragraph", "ordered_list"],
    );
    assert.equal(blocks[0].order ?? 1, wholeCell ? 1 : 2);
    assert.equal(blocks[3].order, 3);
    assert.equal(blocks[2].content.map((r) => r.text).join(""), "settings");
    assert.deepEqual(blocks[1], {
      type: "image",
      asset: "a".repeat(64),
      alt: "",
      width: 160,
      height: 64,
    });
    assert.doesNotMatch(
      JSON.stringify(copied),
      /"id"|"replicas"|"imageFlows"|"imageFlowKind"|"imageFlowProjection"|"generation"|"mediaSlot"/,
    );
    assert.equal(JSON.stringify(s), before);
  });

test("plain image suffix paragraphs copy as prose after Enter and join Undo", () => {
  const initial = fixture();
  let s = apply(initial, insertion(initial, 10));
  const left = "A:s:1:cut:list-tail",
    right = "B:s:1:list-tail";
  s = apply(
    s,
    op(
      "B",
      1,
      planEnter(
        s,
        captureRange(s, { block: left, offset: 3 }, { block: left, offset: 3 }),
        op("B", 1),
      ).intent,
    ),
  );
  s = apply(
    s,
    op(
      "B",
      2,
      planDelete(
        s,
        captureRange(
          s,
          { block: right, offset: 0 },
          { block: right, offset: 0 },
        ),
        "backward",
        op("B", 2),
      ).intent,
    ),
  );
  s = undo(s, "B", 3, "B:s:2");
  const before = JSON.stringify(s),
    copied = copyRange(
      s,
      captureRange(s, { block: left, offset: 0 }, { block: right, offset: 5 }),
    );
  assert.deepEqual(
    copied.fragment.blocks.map((b) => b.type),
    ["paragraph", "paragraph"],
  );
  assert.equal(copied.plain, "set\ntings");
  assert.equal(copied.html, "<p>set</p><p>tings</p>");
  assert.equal(JSON.stringify(s), before);
});
