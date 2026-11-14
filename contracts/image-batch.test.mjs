// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { planInsertBlock } from "@cwhy/jade-core/commands";
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
const images = Array.from({ length: 3 }, (_, i) => ({
  slot: `mock-batch-slot-${i.toString().padStart(4, "0")}`,
  width: 100 + i,
  height: 50,
}));
function fixture(cell, list) {
  const scope = cell ? "cell" : "doc",
    nodes = {
      doc: {
        id: "doc",
        type: "doc",
        live: true,
        children: cell ? ["table"] : [list ? "list" : "p"],
      },
      p: { id: "p", type: "paragraph", live: true },
    };
  if (cell)
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: [list ? "list" : "p"],
      },
    });
  if (list)
    Object.assign(nodes, {
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item"],
      },
      item: { id: "item", type: "list_item", live: true, children: ["p"] },
    });
  return seed(nodes, { p: [{ text: "abcdef", marks: ["strong"] }] });
}
const chars = (s) =>
  Object.values(s.nodes)
    .filter((n) => n.live && n.text)
    .flatMap((n) => text(s, n.id));
for (const peerFirst of [false, true])
  for (const peerAt of [3, 5])
    for (const cell of [false, true])
      for (const list of [false, true])
        for (const [start, end] of [
          [0, 0],
          [3, 3],
          [6, 6],
          ...(!list
            ? [
                [2, 4],
                [4, 2],
              ]
            : []),
        ])
          test(`atomic image batch cell=${cell} list=${list} range=${start}:${end} peerFirst=${peerFirst} peerAt=${peerAt}`, () => {
            const initial = fixture(cell, list);
            let room = new Room(initial),
              record = room.snapshot();
            const accept = (o, expected = "accepted") => {
              const receipt = room.accept(o);
              assert.equal(receipt.outcome, expected, receipt.reason);
              record = replay(record, { op: o, receipt });
              room = new Room(null, JSON.parse(JSON.stringify(room.record)));
              assert.deepEqual(room.accept(o), receipt);
              assert.deepEqual(room.record, record);
              validate(record.state);
              return record.state;
            };
            const range = captureRange(
                initial,
                { block: "p", offset: start },
                { block: "p", offset: end },
              ),
              planned = planInsertBlock(initial, range, op("A", 1), {
                type: "image",
                images,
              }),
              peer = op("B", 1, {
                kind: "insert",
                at: gapAt(initial, "p", peerAt),
                text: "友",
                marks: ["em"],
              });
            if (peerFirst) accept(peer);
            const pasted = accept(op("A", 1, planned.intent)),
              scope = cell ? "cell" : "doc",
              ids = pasted.nodes[scope].children.filter(
                (id) => pasted.nodes[id].type === "image",
              );
            assert.deepEqual(
              ids.map((id) => pasted.nodes[id].mediaSlot),
              images.map((i) => i.slot),
            );
            assert.equal(ids.length, 3);
            let state = peerFirst ? pasted : accept(peer);
            // Complete out of order; slots retain their original order.
            for (const i of [2, 0])
              state = accept(
                op("host" + i, 1, {
                  kind: "imageComplete",
                  image: ids[i],
                  generation: state.pendingMedia[ids[i]].generation,
                  asset: String(i + 1).repeat(64),
                  mime: "image/png",
                  bytes: 10,
                  width: 100 + i,
                  height: 50,
                }),
              );
            for (let i = 0; i < 3; i++) {
              state = accept(
                op("A", 2 + i * 2, {
                  kind: "undo",
                  target: i ? "A:s:" + String(1 + i * 2) : "A:s:1",
                }),
              );
              assert.equal(
                Object.values(state.nodes).filter(
                  (n) => n.live && n.type === "image",
                ).length,
                0,
              );
              assert.deepEqual(
                chars(state).filter((a) => !a.id.startsWith("B:")),
                chars(initial),
              );
              assert.equal(
                chars(state).find((a) => a.id === "B:s:1:char:0").char,
                "友",
              );
              state = accept(
                op("A", 3 + i * 2, {
                  kind: "undo",
                  target: "A:s:" + String(2 + i * 2),
                }),
              );
              assert.deepEqual(
                state.nodes[scope].children.filter(
                  (id) => state.nodes[id].type === "image",
                ),
                ids,
              );
            }
            const pending = ids[1];
            state = accept(
              op("late", 1, {
                kind: "imageComplete",
                image: pending,
                generation: pasted.pendingMedia[pending].generation,
                asset: "a".repeat(64),
                mime: "image/png",
                bytes: 10,
                width: 101,
                height: 50,
              }),
              "rejected",
            );
            accept(
              op("late", 2, {
                kind: "imageComplete",
                image: pending,
                generation: state.pendingMedia[pending].generation,
                asset: "a".repeat(64),
                mime: "image/png",
                bytes: 10,
                width: 101,
                height: 50,
              }),
            );
          });
test("invalid descriptor or duplicate slot leaves original document untouched", () => {
  const s = fixture(false, false),
    before = JSON.stringify(s),
    range = captureRange(
      s,
      { block: "p", offset: 2 },
      { block: "p", offset: 4 },
    );
  for (const input of [
    [images[0], { ...images[1], width: 0 }],
    [images[0], images[0]],
    [],
    Array(17).fill(images[0]),
  ]) {
    assert.throws(() =>
      planInsertBlock(s, range, op("A", 1), { type: "image", images: input }),
    );
    assert.equal(JSON.stringify(s), before);
  }
});
for (const cell of [false, true])
  test(`peer resize blocks whole-group Undo without partial removal cell=${cell}`, async () => {
    const { previewImageSize, planImageSize } = await import(
      "@cwhy/jade-core/commands"
    );
    const initial = fixture(cell, false),
      r = new Room(initial),
      range = captureRange(
        initial,
        { block: "p", offset: 3 },
        { block: "p", offset: 3 },
      );
    assert.equal(
      r.accept(
        op(
          "A",
          1,
          planInsertBlock(initial, range, op("A", 1), { type: "image", images })
            .intent,
        ),
      ).outcome,
      "accepted",
    );
    const id = Object.values(r.record.state.nodes).find(
      (n) => n.mediaSlot === images[1].slot,
    ).id;
    assert.equal(
      r.accept(
        op("host", 1, {
          kind: "imageComplete",
          image: id,
          generation: r.record.state.pendingMedia[id].generation,
          asset: "f".repeat(64),
          mime: "image/png",
          bytes: 10,
          width: 101,
          height: 50,
        }),
      ).outcome,
      "accepted",
    );
    const resize = planImageSize(r.record.state, null, op("B", 1), {
      preview: previewImageSize(r.record.state, id),
      width: 80,
    });
    assert.equal(r.accept(op("B", 1, resize.intent)).outcome, "accepted");
    const before = JSON.stringify(r.record.state);
    assert.equal(
      r.accept(op("A", 2, { kind: "undo", target: "A:s:1" })).outcome,
      "rejected",
    );
    assert.equal(JSON.stringify(r.record.state), before);
    assert.equal(
      r.accept(op("B", 2, { kind: "undo", target: "B:s:1" })).outcome,
      "accepted",
    );
    assert.equal(
      r.accept(op("A", 3, { kind: "undo", target: "A:s:1" })).outcome,
      "accepted",
    );
    assert.equal(
      Object.values(r.record.state.nodes).filter(
        (n) => n.live && n.type === "image",
      ).length,
      0,
    );
  });
