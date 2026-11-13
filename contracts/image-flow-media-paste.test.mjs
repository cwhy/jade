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
  previewImageSize,
  planImageSize,
  copyCells,
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
const completion = (seq, generation = "A:s:1") =>
  op("host", seq, {
    kind: "imageComplete",
    image,
    generation,
    asset: "a".repeat(64),
    mime: "image/png",
    bytes: 160,
    width: 320,
    height: 180,
  });
const undo = (actor, seq, target) => op(actor, seq, { kind: "undo", target });
const resize = (s, actor, seq, width) =>
  op(
    actor,
    seq,
    planImageSize(s, null, op(actor, seq), {
      preview: previewImageSize(s, image),
      width,
    }).intent,
  );
for (const offset of [0, 10, 18])
  for (const completed of [false, true])
    test(`selected image deletion preserves surrounding layout offset=${offset} completed=${completed}`, () => {
      const r = durable();
      insert(r, offset);
      if (completed) r.accept(completion(1));
      const before = view(r.state),
        atoms = Object.values(r.state.nodes)
          .filter((n) => n.live && n.text)
          .flatMap((n) => text(r.state, n.id));
      r.accept(op("B", 1, { kind: "imageDelete", image }));
      assert.deepEqual(
        view(r.state),
        before.filter((b) => b.type !== "image"),
      );
      assert.deepEqual(
        Object.values(r.state.nodes)
          .filter((n) => n.live && n.text)
          .flatMap((n) => text(r.state, n.id)),
        atoms,
      );
      if (!completed) {
        assert.equal(r.state.pendingMedia[image].generation, null);
        r.accept(completion(1), "rejected");
      }
      r.accept(undo("B", 2, "B:s:1"));
      assert.deepEqual(view(r.state), before);
      if (!completed) {
        assert.equal(r.state.pendingMedia[image].generation, "B:s:2");
        r.accept(completion(2), "rejected");
      }
      r.accept(undo("B", 3, "B:s:2"));
      r.accept(undo("B", 4, "B:s:3"));
      assert.deepEqual(view(r.state), before);
      if (!completed) r.accept(completion(3, "B:s:4"));
      assert.equal(r.state.nodes[image].asset, "a".repeat(64));
    });
for (const offset of [0, 10, 18])
  test(`flow resize protects peer size and survives explicit deletion offset=${offset}`, () => {
    const r = durable();
    insert(r, offset);
    assert.throws(() => resize(r.state, "B", 1, 160), /completed/);
    r.accept(completion(1));
    const before = view(r.state),
      a = resize(r.state, "B", 1, 160),
      b = resize(r.state, "C", 1, 240);
    r.accept(a);
    r.accept(b, "rejected");
    r.accept(undo("A", 2, "A:s:1"), "rejected");
    r.accept(resize(r.state, "C", 2, 240));
    r.accept(undo("B", 2, "B:s:1"), "rejected");
    r.accept(undo("C", 3, "C:s:2"));
    assert.equal(r.state.nodes[image].displayWidth, 160);
    r.accept(op("D", 1, { kind: "imageDelete", image }));
    assert.deepEqual(
      view(r.state),
      before.filter((b) => b.type !== "image"),
    );
    r.accept(undo("D", 2, "D:s:1"));
    assert.equal(r.state.nodes[image].displayWidth, 160);
    r.accept(undo("B", 3, "B:s:1"));
    assert.equal(r.state.nodes[image].displayWidth, undefined);
    assert.deepEqual(view(r.state), before);
    assert.equal(r.state.nodes[image].width, 320);
    assert.equal(r.state.nodes[image].height, 180);
  });
for (const offset of [0, 10, 18])
  for (const completed of [false, true])
    test(`paste replaces an active flow cell and restores original content offset=${offset} completed=${completed}`, () => {
      const r = durable();
      insert(r, offset);
      if (completed) r.accept(completion(1));
      const before = view(r.state);
      const range = captureCellRange(r.state, "table", "cell"),
        fragment = {
          version: 1,
          rows: [
            [[{ type: "paragraph", content: [{ text: "Pasted", marks: [] }] }]],
          ],
        },
        preview = previewCellPaste(r.state, range, fragment);
      r.accept(
        op(
          "B",
          1,
          planPasteCells(r.state, range, op("B", 1), { preview }).intent,
        ),
      );
      assert.deepEqual(view(r.state), [{ type: "paragraph", text: "Pasted" }]);
      assert.equal(r.state.nodes[image].live, false);
      r.accept(undo("B", 2, "B:s:1"));
      assert.deepEqual(view(r.state), before);
      r.accept(undo("B", 3, "B:s:2"));
      r.accept(undo("B", 4, "B:s:3"));
      assert.deepEqual(view(r.state), before);
      if (!completed)
        assert.equal(r.state.pendingMedia[image].generation, "B:s:4");
      r.accept(undo("A", 2, "A:s:1"));
      assert.deepEqual(view(r.state), view(fixture()));
    });
for (const offset of [0, 10, 18])
  test(`completed flow cell copies independently into another cell offset=${offset}`, () => {
    const r = durable();
    insert(r, offset);
    r.accept(completion(1));
    r.accept(resize(r.state, "B", 1, 160));
    const fragment = copyCells(
        r.state,
        captureCellRange(r.state, "table", "cell"),
      ),
      destination = captureCellRange(r.state, "table", "other"),
      preview = previewCellPaste(r.state, destination, fragment),
      before = view(r.state, "other");
    r.accept(
      op(
        "C",
        1,
        planPasteCells(r.state, destination, op("C", 1), { preview }).intent,
      ),
    );
    assert.deepEqual(
      copyCells(r.state, captureCellRange(r.state, "table", "other")),
      fragment,
    );
    const copies = Object.values(r.state.nodes).filter(
      (n) => n.live && n.type === "image" && n.id !== image,
    );
    assert.equal(copies.length, 1);
    const copied = copies[0];
    assert.equal(copied.displayWidth, 160);
    assert.equal(copied.mediaSlot, undefined);
    assert.equal(copied.imageSizeOwner, undefined);
    r.accept(op("D", 1, { kind: "imageDelete", image }));
    assert.deepEqual(
      copyCells(r.state, captureCellRange(r.state, "table", "other")),
      fragment,
    );
    r.accept(undo("C", 2, "C:s:1"));
    assert.deepEqual(view(r.state, "other"), before);
    r.accept(undo("C", 3, "C:s:2"));
    assert.deepEqual(
      copyCells(r.state, captureCellRange(r.state, "table", "other")),
      fragment,
    );
  });

for (const flow of [false, true])
  test(`size Undo follows its own contribution after restore, stale previews do not flow=${flow}`, () => {
    const initial = flow
        ? fixture()
        : seed(
            {
              doc: { id: "doc", type: "doc", live: true, children: ["target"] },
              target: { id: "target", type: "paragraph", live: true },
            },
            { target: [{ text: "Notes" }] },
          ),
      r = durable(initial);
    insert(r, flow ? 10 : 5);
    r.accept(completion(1));
    r.accept(resize(r.state, "B", 1, 160));
    const stale = resize(r.state, "C", 1, 240);
    r.accept(op("D", 1, { kind: "imageDelete", image }));
    r.accept(undo("B", 2, "B:s:1"), "rejected");
    r.accept(undo("D", 2, "D:s:1"));
    r.accept(stale, "rejected");
    r.accept(resize(r.state, "C", 2, 240));
    r.accept(undo("B", 3, "B:s:1"), "rejected");
    r.accept(undo("C", 3, "C:s:2"));
    r.accept(undo("B", 4, "B:s:1"));
    assert.equal(r.state.nodes[image].displayWidth, undefined);
    r.accept(undo("B", 5, "B:s:4"));
    assert.equal(r.state.nodes[image].displayWidth, 160);
  });
for (const peerFirst of [false, true])
  for (const right of [false, true])
    test(`image delete retains offline source text peerFirst=${peerFirst} suffix=${right}`, () => {
      const r = durable();
      insert(r, 10);
      const block = right ? "A:s:1:cut:list-tail" : "target",
        peer = op("B", 1, {
          kind: "insert",
          at: gapAt(r.state, block, 2),
          text: "友",
          marks: ["strong"],
        }),
        del = op("C", 1, { kind: "imageDelete", image });
      for (const o of peerFirst ? [peer, del] : [del, peer]) r.accept(o);
      const peerAtom = { id: "B:s:1:char:0", char: "友", marks: ["strong"] };
      assert.deepEqual(
        text(r.state, block).find((a) => a.id === peerAtom.id),
        peerAtom,
      );
      assert.equal(
        chars(r.state, block),
        right ? "se友ttings" : "Wo友rkspace ",
      );
      assert.equal(view(r.state).find((b) => b.text === "After").number, 3);
      assert.ok(
        view(r.state).some(
          (b) =>
            b.type === "paragraph" &&
            b.text === (right ? "se友ttings" : "settings"),
        ),
      );
      r.accept(undo("C", 2, "C:s:1"));
      assert.deepEqual(
        text(r.state, block).find((a) => a.id === peerAtom.id),
        peerAtom,
      );
      assert.equal(
        chars(r.state, block),
        right ? "se友ttings" : "Wo友rkspace ",
      );
      r.accept(undo("B", 2, "B:s:1"));
      assert.deepEqual(
        text(r.state, block)
          .map((a) => a.char)
          .join(""),
        right ? "settings" : "Workspace ",
      );
    });
for (const reverse of [false, true])
  test(`deleting both images retains shared suffix kind reverse=${reverse}`, () => {
    const r = durable();
    insert(r, 10);
    const block = "A:s:1:cut:list-tail",
      range = captureRange(r.state, { block, offset: 0 }, { block, offset: 0 });
    r.accept(
      op(
        "B",
        1,
        planInsertBlock(r.state, range, op("B", 1), {
          type: "image",
          slot: "second-media-slot-001",
          width: 320,
          height: 180,
        }).intent,
      ),
    );
    const before = view(r.state),
      actions = [
        op("C", 1, { kind: "imageDelete", image }),
        op("D", 1, { kind: "imageDelete", image: "B:s:1:image" }),
      ];
    for (const o of reverse ? [...actions].reverse() : actions) r.accept(o);
    assert.deepEqual(
      view(r.state),
      before.filter((b) => b.type !== "image"),
    );
    r.accept(undo("D", 2, "D:s:1"));
    assert.equal(view(r.state).filter((b) => b.type === "image").length, 1);
    r.accept(undo("C", 2, "C:s:1"));
    assert.deepEqual(view(r.state), before);
  });
for (const change of ["typing", "completion", "resize"])
  test(`stale cell-paste preview protects changed flow ${change}`, () => {
    const r = durable();
    insert(r, 10);
    if (change === "resize") r.accept(completion(1));
    const range = captureCellRange(r.state, "table", "cell"),
      fragment = {
        version: 1,
        rows: [
          [[{ type: "paragraph", content: [{ text: "Reviewed", marks: [] }] }]],
        ],
      },
      preview = previewCellPaste(r.state, range, fragment),
      paste = op(
        "B",
        1,
        planPasteCells(r.state, range, op("B", 1), { preview }).intent,
      );
    if (change === "typing")
      r.accept(
        op("C", 1, {
          kind: "insert",
          at: gapAt(r.state, "A:s:1:cut:list-tail", 2),
          text: "友",
          marks: ["strong"],
        }),
      );
    if (change === "completion") r.accept(completion(1));
    if (change === "resize") r.accept(resize(r.state, "C", 1, 160));
    const before = JSON.stringify(r.state);
    r.accept(paste, "rejected");
    assert.equal(JSON.stringify(r.state), before);
    const fresh = previewCellPaste(r.state, range, fragment);
    r.accept(
      op(
        "B",
        2,
        planPasteCells(r.state, range, op("B", 2), { preview: fresh }).intent,
      ),
    );
    r.accept(undo("B", 3, "B:s:2"));
    assert.deepEqual(view(r.state), view(JSON.parse(before)));
    for (const n of Object.values(r.state.nodes).filter(
      (n) => n.live && n.text,
    ))
      assert.deepEqual(text(r.state, n.id), text(JSON.parse(before), n.id));
    if (change !== "typing")
      assert.equal(r.state.nodes[image].asset, "a".repeat(64));
  });
