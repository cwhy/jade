// SPDX-License-Identifier: MPL-2.0
import { planRichInsert } from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import test from "node:test";
import assert from "node:assert/strict";
import { seed, gapAt, text } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { previewImageSize as imageSizeWitness } from "@cwhy/jade-core/commands";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import { upgradeStorage } from "@cwhy/jade-core/storage";
const op = (actor, seq, intent) => ({
  actor,
  stream: "images",
  seq,
  id: `${actor}:images:${seq}`,
  epoch: 1,
  modelVersion: 2,
  intent,
});
const undo = (s, actor, seq, target) =>
  apply(s, op(actor, seq, { kind: "undo", target }));
function fixture() {
  let s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p"] },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "Notes" }] },
  );
  s = apply(
    s,
    op("a", 1, {
      kind: "imageInsert",
      at: gapAt(s, "p", 5),
      slot: "mock-image-slot-0001",
      width: 320,
      height: 180,
    }),
  );
  return apply(
    s,
    op("system", 1, {
      kind: "imageComplete",
      image: "a:images:1:image",
      generation: "a:images:1",
      asset: "a".repeat(64),
      mime: "image/png",
      bytes: 100,
      width: 320,
      height: 180,
    }),
  );
}
const image = "a:images:1:image";
const del = (s, actor, seq) =>
  apply(s, op(actor, seq, { kind: "imageDelete", image }));
test("Undo deletion restores contribution ownership so earlier insertion Undo and both Redos work", () => {
  const initial = fixture(),
    stale = imageSizeWitness(initial, image);
  let s = del(initial, "a", 2);
  s = undo(s, "a", 3, "a:images:2");
  assert.equal(s.nodes[image].live, true);
  assert.throws(
    () =>
      apply(
        s,
        op("b", 1, { kind: "imageResize", image, width: 160, expected: stale }),
      ),
    /changed/i,
    "restoration must not revive an old drag witness",
  );
  s = undo(s, "a", 4, "a:images:1");
  assert.equal(s.nodes[image].live, false);
  s = undo(s, "a", 5, "a:images:4");
  assert.equal(s.nodes[image].live, true);
  s = undo(s, "a", 6, "a:images:3");
  assert.equal(s.nodes[image].live, false);
  s = undo(s, "a", 7, "a:images:6");
  assert.equal(s.nodes[image].live, true);
  validate(s);
  assert.equal(
    text(s, "p")
      .map((x) => x.char)
      .join(""),
    "Notes",
  );
  assert.equal(s.nodes[image].asset, initial.nodes[image].asset);
});
test("peer presence contribution remains protected; Undo of that peer contribution reveals the earlier owner", () => {
  let s = del(fixture(), "a", 2);
  s = undo(s, "a", 3, "a:images:2");
  s = del(s, "b", 1);
  assert.throws(() => undo(s, "a", 4, "a:images:1"), /changed/i);
  s = undo(s, "b", 2, "b:images:1");
  s = undo(s, "a", 4, "a:images:1");
  assert.equal(s.nodes[image].live, false);
  validate(s);
});
test("repeated own delete/restore survives serialized reload and leaves peer resize protected", () => {
  let s = fixture();
  for (let seq = 2; seq < 10; seq += 2) {
    s = del(s, "a", seq);
    s = undo(s, "a", seq + 1, `a:images:${seq}`);
    s = JSON.parse(JSON.stringify(s));
    validate(s);
  }
  const resized = apply(
    s,
    op("b", 1, {
      kind: "imageResize",
      image,
      width: 180,
      expected: imageSizeWitness(s, image),
    }),
  );
  assert.throws(() => undo(resized, "a", 10, "a:images:1"), /changed/i);
  s = undo(resized, "b", 2, "b:images:1");
  s = undo(s, "a", 10, "a:images:1");
  assert.equal(s.nodes[image].live, false);
});

test("uncertain delivery and server reload preserve presence ownership and exact receipts", () => {
  let room = new Room(fixture()),
    record = room.snapshot();
  const commands = [
    op("a", 2, { kind: "imageDelete", image }),
    op("a", 3, { kind: "undo", target: "a:images:2" }),
    op("a", 4, { kind: "undo", target: "a:images:1" }),
    op("a", 5, { kind: "undo", target: "a:images:4" }),
  ];
  // The fixture has committed source effects but no stream receipts. Start this
  // independent test stream at its first sequence while retaining source targets.
  commands.forEach((o, i) => {
    o.stream = "retry";
    o.seq = i + 1;
    o.id = `a:retry:${i + 1}`;
  });
  commands[1].intent.target = "a:retry:1";
  commands[3].intent.target = "a:retry:3";
  for (const command of commands) {
    const receipt = room.accept(command);
    assert.equal(receipt.outcome, "accepted");
    record = replay(record, { op: command, receipt });
    room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
    assert.deepEqual(room.accept(command), receipt);
    assert.deepEqual(room.snapshot(), record);
  }
  assert.equal(room.record.state.nodes[image].live, true);
});
test("codec47 source stays intact; fresh actions record ownership without inventing legacy inverse fields", () => {
  const source = fixture();
  source.storageCodec = 47;
  const bytes = JSON.stringify(source),
    s = upgradeStorage(source);
  assert.equal(JSON.stringify(source), bytes);
  assert.deepEqual({ ...s, storageCodec: 47 }, source);
  let n = del(s, "a", 2);
  n = undo(n, "a", 3, "a:images:2");
  n = undo(n, "a", 4, "a:images:1");
  assert.equal(n.nodes[image].live, false);
  const malformed = structuredClone(n);
  malformed.nodes[image].imageGeneration = 3;
  assert.throws(() => validate(malformed), /presence generation/);
});

test("completed copied images have no upload slot but still delete and restore with fresh presence", () => {
  const s = seed(
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
    { p: [{ text: "Copy notes" }] },
  );
  const before = imageSizeWitness(s, "i");
  let n = apply(s, op("a", 1, { kind: "imageDelete", image: "i" }));
  assert.equal(n.nodes.i.live, false);
  n = undo(n, "a", 2, "a:images:1");
  assert.equal(n.nodes.i.live, true);
  assert.equal(n.nodes.i.imageOwner, undefined);
  assert.equal(n.nodes.i.asset, s.nodes.i.asset);
  assert.throws(
    () =>
      apply(
        n,
        op("b", 1, {
          kind: "imageResize",
          image: "i",
          width: 160,
          expected: before,
        }),
      ),
    /changed/i,
  );
  n = undo(n, "a", 3, "a:images:2");
  assert.equal(n.nodes.i.live, false);
  validate(n);
});

test("owned rich-paste removal ignores freshness alone after image delete and Undo", () => {
  let s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p", "existing"] },
      existing: {
        id: "existing",
        type: "image",
        live: true,
        asset: "a".repeat(64),
        width: 320,
        height: 180,
      },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "Notes" }] },
  );
  s = planRichInsert(
    s,
    captureRange(s, { block: "p", offset: 5 }, { block: "p", offset: 5 }),
    {
      version: 1,
      edges: { start: "partial", end: "partial" },
      blocks: [
        { type: "image", asset: "a".repeat(64), width: 320, height: 180 },
      ],
    },
    op("a", 1),
  ).state;
  const copied = Object.values(s.nodes).find(
    (n) => n.type === "image" && n.id !== "existing",
  ).id;
  s = apply(s, op("a", 2, { kind: "imageDelete", image: copied }));
  s = undo(s, "a", 3, "a:images:2");
  s = undo(s, "a", 4, "a:images:1");
  assert.equal(s.nodes[copied].live, false);
  assert.equal(s.nodes.existing.live, true);
  validate(s);
});
