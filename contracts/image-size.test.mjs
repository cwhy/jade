// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import {
  previewImageSize,
  planImageSize,
  planInsertBlock,
  copyCells,
  previewCellPaste,
  planPasteCells,
} from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (a, n, intent) => ({
  actor: a,
  seq: n,
  stream: "s",
  id: `${a}:s:${n}`,
  epoch: 1,
  intent,
});
const fixture = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p", "i"] },
      p: { id: "p", type: "paragraph", live: true },
      i: {
        id: "i",
        type: "image",
        live: true,
        asset: "a".repeat(64),
        width: 320,
        height: 180,
      },
    },
    { p: [{ text: "Notes" }] },
  );
const size = (s, width = 160, a = "A", n = 1, image = "i") =>
  op(a, n, {
    kind: "imageResize",
    image,
    width,
    expected: previewImageSize(s, image),
  });
const undo = (s, a, n, target) => apply(s, op(a, n, { kind: "undo", target }));
for (const width of [48, 160, 640, 10000])
  test(`resize ${width} preserves original asset and dimensions through Undo/Redo`, () => {
    const s = fixture(),
      o = size(s, width),
      n = apply(s, o);
    validate(n);
    assert.equal(n.nodes.i.displayWidth, width);
    assert.equal(n.nodes.i.width, 320);
    assert.equal(n.nodes.i.height, 180);
    assert.equal(n.nodes.i.asset, s.nodes.i.asset);
    const u = undo(n, "A", 2, o.id);
    assert.deepEqual(u.nodes.i, s.nodes.i);
    const r = undo(u, "A", 3, "A:s:2");
    assert.equal(r.nodes.i.displayWidth, width);
    assert.deepEqual(s, fixture());
  });
for (const width of [0, 47, 10001, NaN, 1.5, "160"])
  test("invalid width rejects " + width, () => {
    const s = fixture();
    assert.throws(() => apply(s, size(s, width)));
    assert.equal(s.nodes.i.displayWidth, undefined);
  });
for (const first of ["A", "B"])
  test("concurrent resize has a stale-review loser " + first, () => {
    const s = fixture(),
      a = size(s, 160),
      b = size(s, 240, "B");
    const winner = first === "A" ? a : b,
      loser = first === "A" ? b : a,
      n = apply(s, winner);
    assert.throws(() => apply(n, loser), /changed/);
    assert.equal(n.nodes.i.displayWidth, winner.intent.width);
  });
test("Undo cannot overwrite later peer size; after peer Undo the prior owner can Undo", () => {
  const s = fixture(),
    a = size(s),
    n = apply(s, a),
    b = size(n, 240, "B"),
    m = apply(n, b);
  assert.throws(() => undo(m, "A", 2, a.id), /cannot overwrite/);
  const p = undo(m, "B", 2, b.id);
  assert.equal(p.nodes.i.displayWidth, 160);
  assert.deepEqual(undo(p, "A", 3, a.id).nodes.i, s.nodes.i);
});
test("ordinary peer typing does not invalidate captured sizing or erase peer text", () => {
  const s = fixture(),
    o = size(s),
    peer = op("B", 1, {
      kind: "insert",
      at: gapAt(s, "p", 5),
      text: " peer",
      marks: [],
    });
  for (const order of [
    [o, peer],
    [peer, o],
  ]) {
    let n = s;
    for (const x of order) n = apply(n, x);
    n = undo(n, "A", 2, o.id);
    assert.equal(
      text(n, "p")
        .map((a) => a.char)
        .join(""),
      "Notes peer",
    );
  }
});
test("original insertion Undo protects later resize; explicit delete and its Undo preserve size", () => {
  const base = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p"] },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "Notes" }] },
  );
  const range = captureRange(
      base,
      { block: "p", offset: 5 },
      { block: "p", offset: 5 },
    ),
    a = op(
      "A",
      1,
      planInsertBlock(base, range, op("A", 1), {
        type: "image",
        slot: "mock-size-slot-000001",
        width: 320,
        height: 180,
      }).intent,
    );
  let n = apply(base, a);
  assert.throws(() => size(n, 160, "B", 1, "A:s:1:image"), /completed/);
  n = apply(
    n,
    op("host", 1, {
      kind: "imageComplete",
      image: "A:s:1:image",
      generation: a.id,
      asset: "a".repeat(64),
      mime: "image/png",
      bytes: 100,
      width: 320,
      height: 180,
    }),
  );
  const resized = apply(n, size(n, 160, "B", 1, "A:s:1:image"));
  assert.throws(() => undo(resized, "A", 2, a.id), /changed/);
  const deleted = apply(
    resized,
    op("C", 1, { kind: "imageDelete", image: "A:s:1:image" }),
  );
  const restored = undo(deleted, "C", 2, "C:s:1");
  assert.equal(restored.nodes["A:s:1:image"].displayWidth, 160);
  const reverted = undo(resized, "B", 2, "B:s:1");
  assert.equal(undo(reverted, "A", 3, a.id).nodes["A:s:1:image"].live, false);
});
test("reload, duplicate delivery and replay keep exact size ownership", () => {
  const room = new Room(fixture());
  let record = room.snapshot();
  for (const o of [
    size(room.record.state),
    op("A", 2, { kind: "undo", target: "A:s:1" }),
    op("A", 3, { kind: "undo", target: "A:s:2" }),
  ]) {
    const receipt = room.accept(o);
    assert.equal(receipt.outcome, "accepted");
    record = replay(record, { op: o, receipt });
    assert.deepEqual(room.accept(o), receipt);
    assert.deepEqual(
      new Room(null, JSON.parse(JSON.stringify(room.record))).record,
      record,
    );
  }
});
test("malformed saved size metadata rejected", () => {
  for (const patch of [
    { displayWidth: 47 },
    { displayWidth: Infinity },
    { imageSizeOwner: "bad" },
    { displayWidth: 100, imageSizeOwner: 12 },
  ]) {
    const s = fixture();
    Object.assign(s.nodes.i, patch);
    assert.throws(() => validate(s));
  }
});
test("image cell copy keeps displayed size without copying ownership", () => {
  const s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["t"] },
      t: { id: "t", type: "table", live: true, children: ["r"] },
      r: { id: "r", type: "row", live: true, children: ["c"] },
      c: { id: "c", type: "cell", live: true, children: ["p", "i"] },
      p: { id: "p", type: "paragraph", live: true },
      i: {
        id: "i",
        type: "image",
        live: true,
        asset: "a".repeat(64),
        width: 320,
        height: 180,
      },
    },
    { p: [] },
  );
  const n = apply(s, size(s)),
    fragment = copyCells(n, captureCellRange(n, "t", "c"));
  const image = fragment.rows[0][0].find((b) => b.type === "image");
  assert.equal(image.width, 320);
  assert.equal(image.displayWidth, 160);
  assert.equal(image.height, 180);
  assert.equal(image.imageSizeOwner, undefined);
  const selection = captureCellRange(n, "t", "c"),
    preview = previewCellPaste(n, selection, fragment),
    o = op("B", 1);
  const pasted = apply(n, {
    ...o,
    intent: planPasteCells(n, selection, o, { preview }).intent,
  });
  const copied = Object.values(pasted.nodes).find(
    (x) => x.live && x.type === "image",
  );
  assert.equal(copied.width, 320);
  assert.equal(copied.height, 180);
  assert.equal(copied.displayWidth, 160);
  assert.equal(copied.imageSizeOwner, undefined);
});
