// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, gapAt, text } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import {
  planInsertBlock,
  previewTableDelete,
  planTableDelete,
  planClearCells,
  copyCells,
} from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const initial = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p"] },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "Notes" }] },
  );
const op = (actor, seq, intent) => ({
  actor,
  stream: "media",
  seq,
  id: `${actor}:media:${seq}`,
  epoch: 1,
  intent,
});
const insert = (s, block = "p", offset = 5) => {
  const o = op("A", 1),
    range = captureRange(s, { block, offset }, { block, offset });
  return {
    ...o,
    intent: planInsertBlock(s, range, o, {
      type: "image",
      slot: "mock-slot-00000001",
      width: 80,
      height: 40,
    }).intent,
  };
};
const complete = (image = "A:media:1:image", generation = "A:media:1") =>
  op("system", 1, {
    kind: "imageComplete",
    image,
    generation,
    asset: "a".repeat(64),
    mime: "image/png",
    bytes: 100,
    width: 80,
    height: 40,
  });
const undo = (actor, seq, target) => op(actor, seq, { kind: "undo", target });
test("accepted placeholder has stable position and contains no private bytes or URLs", () => {
  const s = initial(),
    n = apply(s, insert(s));
  validate(n);
  assert.deepEqual(n.nodes.doc.children, ["p", "A:media:1:image"]);
  assert.equal(n.pendingMedia["A:media:1:image"].generation, "A:media:1");
  assert.equal(n.nodes["A:media:1:image"].asset, undefined);
  assert.deepEqual(s, initial());
});
test("completion updates the same node; original insertion Undo removes the completed image", () => {
  const s = initial(),
    n = apply(s, insert(s)),
    done = apply(n, complete());
  assert.deepEqual(done.nodes.doc.children, n.nodes.doc.children);
  assert.equal(done.pendingMedia["A:media:1:image"], undefined);
  const removed = apply(done, undo("A", 2, "A:media:1"));
  assert.equal(removed.nodes["A:media:1:image"].live, false);
  const restored = apply(removed, undo("A", 3, "A:media:2"));
  assert.equal(restored.nodes["A:media:1:image"].asset, "a".repeat(64));
  assert.equal(restored.nodes["A:media:1:image"].live, true);
  assert.equal(
    n.nodes["A:media:1:image"].asset,
    undefined,
    "historical placeholder remains unresolved",
  );
});
test("Undo and Redo fence old upload generations", () => {
  const s = initial(),
    n = apply(s, insert(s)),
    removed = apply(n, undo("A", 2, "A:media:1"));
  assert.throws(() => apply(removed, complete()), /no longer current/);
  const restored = apply(removed, undo("A", 3, "A:media:2"));
  assert.equal(
    restored.pendingMedia["A:media:1:image"].generation,
    "A:media:3",
  );
  assert.throws(() => apply(restored, complete()), /no longer current/);
  assert.ok(
    apply(restored, complete(undefined, "A:media:3")).nodes["A:media:1:image"]
      .asset,
  );
});
for (const order of ["complete-delete", "delete-complete"])
  test("completion/deletion race: " + order, () => {
    const room = new Room(initial()),
      creation = insert(room.record.state);
    room.accept(creation);
    const del = op("B", 1, { kind: "imageDelete", image: "A:media:1:image" });
    if (order === "complete-delete") {
      assert.equal(room.accept(complete()).outcome, "accepted");
      assert.equal(room.accept(del).outcome, "accepted");
    } else {
      assert.equal(room.accept(del).outcome, "accepted");
      assert.equal(room.accept(complete()).outcome, "rejected");
    }
    assert.equal(room.record.state.nodes["A:media:1:image"].live, false);
  });
test("duplicate delivery and reload preserve one completed image and exact receipts", () => {
  const room = new Room(initial()),
    o = insert(room.record.state);
  const before = room.snapshot(),
    a = room.accept(o);
  let r = replay(before, { op: o, receipt: a });
  const c = complete(),
    receipt = room.accept(c);
  r = replay(r, { op: c, receipt });
  assert.deepEqual(room.accept(c), receipt);
  const restored = new Room(null, JSON.parse(JSON.stringify(room.record)));
  assert.deepEqual(restored.accept(c), receipt);
  assert.deepEqual(restored.record, r);
});
for (const bad of [
  { width: 0 },
  { height: 10001 },
  { slot: "short" },
  { privateURL: "blob:device" },
])
  test("invalid placeholder rejected " + JSON.stringify(bad), () => {
    const s = initial(),
      o = insert(s);
    o.intent = { ...o.intent, ...bad };
    assert.throws(() => apply(s, o));
    assert.deepEqual(s, initial());
  });
for (const bad of [
  { bytes: 0 },
  { mime: "image/svg+xml" },
  { asset: "https://private.example/secret" },
  { width: 10001 },
  { generation: "old" },
  { epoch: 9 },
])
  test("invalid/stale completion rejected " + JSON.stringify(bad), () => {
    const s = initial(),
      n = apply(s, insert(s)),
      o = complete();
    if (bad.epoch) o.epoch = bad.epoch;
    else Object.assign(o.intent, bad);
    assert.throws(() => apply(n, o));
    assert.equal(n.nodes["A:media:1:image"].asset, undefined);
  });
test("ordinary peer typing survives image insertion Undo", () => {
  const s = initial(),
    n = apply(s, insert(s)),
    typed = apply(
      n,
      op("B", 1, {
        kind: "insert",
        at: gapAt(n, "p", 5),
        text: " peer",
        marks: [],
      }),
    );
  const result = apply(typed, undo("A", 2, "A:media:1"));
  assert.equal(
    text(result, "p")
      .map((a) => a.char)
      .join(""),
    "Notes peer",
  );
});
test("raw restoration intents are rejected", () => {
  const s = initial();
  for (const kind of ["imagePresence", "mediaNoop"])
    assert.throws(() => apply(s, op("A", 1, { kind })));
});

import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
for (const action of ["clear", "rows", "columns", "table"])
  test(
    "structural " + action + " and Undo fence pending media completion",
    () => {
      let s = tableFixture();
      const o = insert(s, "first", text(s, "first").length);
      s = apply(s, o);
      const range = captureCellRange(s, "table", "cell"),
        d = op("B", 1);
      const planned =
        action === "clear"
          ? planClearCells(s, range, d)
          : planTableDelete(s, range, d, {
              preview: previewTableDelete(s, range, action),
            });
      const removed = apply(s, { ...d, intent: planned.intent });
      assert.equal(removed.nodes["A:media:1:image"].live, false);
      assert.throws(() => apply(removed, complete()), /no longer current/);
      const restored = apply(removed, undo("B", 2, d.id));
      assert.equal(
        restored.pendingMedia["A:media:1:image"].generation,
        "B:media:2",
      );
      assert.throws(() => apply(restored, complete()), /no longer current/);
      const removedAgain = apply(restored, undo("B", 3, "B:media:2")),
        restoredAgain = apply(removedAgain, undo("B", 4, "B:media:3"));
      assert.equal(
        restoredAgain.pendingMedia["A:media:1:image"].generation,
        "B:media:4",
      );
      assert.throws(
        () => apply(restoredAgain, complete(undefined, "B:media:2")),
        /no longer current/,
      );
      assert.ok(
        apply(restoredAgain, complete(undefined, "B:media:4")).nodes[
          "A:media:1:image"
        ].asset,
      );
    },
  );

test("unfinished images block normal copy but permit reviewed deletion", () => {
  let s = tableFixture();
  s = apply(s, insert(s, "first", text(s, "first").length));
  const range = captureCellRange(s, "table", "cell");
  assert.throws(() => copyCells(s, range), /upload is incomplete/);
  assert.ok(previewTableDelete(s, range, "rows"));
});
test("upload completion is not an independently undoable user contribution", () => {
  const s = initial(),
    done = apply(apply(s, insert(s)), complete());
  assert.throws(
    () => apply(done, undo("system", 2, "system:media:1")),
    /not a user Undo/,
  );
});
test("decoded malformed lifecycle ledgers fail validation", () => {
  const s = initial(),
    pending = apply(s, insert(s));
  for (const mutate of [
    (s) => delete s.pendingMedia["A:media:1:image"],
    (s) => (s.pendingMedia["A:media:1:image"] = { generation: null }),
    (s) => (s.pendingMedia.unknown = { generation: "x" }),
    (s) => (s.pendingMedia = []),
  ]) {
    const invalid = JSON.parse(JSON.stringify(pending));
    mutate(invalid);
    assert.throws(() => validate(invalid));
  }
});

import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import {
  planListIndent,
  previewCellPaste,
  planPasteCells,
} from "@cwhy/jade-core/commands";
import { immutable } from "@cwhy/jade-core/immutability";
test("moving a containing list item preserves its live upload generation", () => {
  let s = listFixture();
  s = apply(s, insert(s, "bp", 4));
  const point = { block: "bp", offset: 0 },
    range = captureRange(s, point, point),
    o = op("B", 1);
  const moved = apply(s, { ...o, intent: planListIndent(s, range, o).intent });
  assert.equal(moved.pendingMedia["A:media:1:image"].generation, "A:media:1");
  assert.ok(apply(moved, complete()).nodes["A:media:1:image"].asset);
});
test("replacing a cell fences upload; restoring content allocates a new generation", () => {
  let s = tableFixture();
  s = apply(s, insert(s, "first", text(s, "first").length));
  const range = captureCellRange(s, "table", "cell"),
    o = op("B", 1),
    source = {
      version: 1,
      rows: [
        [
          [
            {
              type: "paragraph",
              content: [{ text: "Replacement", marks: [] }],
            },
          ],
        ],
      ],
    };
  const preview = previewCellPaste(s, range, source),
    replaced = apply(s, {
      ...o,
      intent: planPasteCells(s, range, o, { preview }).intent,
    });
  assert.throws(() => apply(replaced, complete()), /no longer current/);
  const restored = apply(replaced, undo("B", 2, o.id));
  assert.equal(
    restored.pendingMedia["A:media:1:image"].generation,
    "B:media:2",
  );
  assert.ok(
    apply(restored, complete(undefined, "B:media:2")).nodes["A:media:1:image"]
      .asset,
  );
});
test("mutable ledgers cannot bypass validation through an immutable node cache", () => {
  const s = initial(),
    pending = immutable(apply(s, insert(s))),
    candidate = {
      ...pending,
      pendingMedia: structuredClone(pending.pendingMedia),
    };
  validate(candidate);
  candidate.pendingMedia["A:media:1:image"].generation = null;
  assert.throws(() => validate(candidate));
});
test("legacy codec43 records without a media ledger accept their first slot", () => {
  const s = initial();
  delete s.pendingMedia;
  validate(s);
  const n = apply(s, insert(s));
  assert.equal(n.pendingMedia["A:media:1:image"].generation, "A:media:1");
});
