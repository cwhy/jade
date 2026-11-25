// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { previewConversion, planConversion } from "@cwhy/jade-core/conversion";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  id: `${actor}:format-store:${seq}`,
  actor,
  seq,
  intent,
  stream: "format-store",
  epoch: 1,
  modelVersion: 2,
});
const fixture = (size = 25) =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["a"] },
      a: { id: "a", type: "paragraph", live: true },
    },
    {
      a: [
        {
          text: "x".repeat(size),
          marks: ["strong", { type: "highlight", attrs: { color: "yellow" } }],
        },
      ],
    },
  );
for (const size of [1000, 40000, 100000])
  test(`${size} uniformly styled characters retain O(segments) format and Undo storage`, () => {
    const initial = fixture(size),
      preview = previewConversion(initial, "doc", ["a"], "code");
    let s = planConversion(initial, preview, op("a", 1), {
      confirmLoss: true,
    }).state;
    assert.equal(preview.loss.formattedCharacters, size);
    assert.ok(Buffer.byteLength(JSON.stringify(preview.intent)) < 1000);
    assert.equal(s.formats.values.length, 1);
    assert.equal(s.formats.spans.length, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(s.formats)) < 1000);
    assert.ok(
      Buffer.byteLength(JSON.stringify(s)) -
        Buffer.byteLength(JSON.stringify(initial)) <
        4000,
    );
    const initialIds = text(initial, "a").map((a) => a.id);
    assert.deepEqual(
      text(s, "a").map((a) => a.id),
      initialIds,
    );
    assert.ok(text(s, "a").every((a) => a.marks.length === 0));
    s = apply(
      JSON.parse(JSON.stringify(s)),
      op("a", 2, { kind: "undo", target: "a:format-store:1" }),
    );
    assert.deepEqual(text(s, "a"), text(initial, "a"));
    s = apply(s, op("a", 3, { kind: "undo", target: "a:format-store:2" }));
    assert.ok(text(s, "a").every((a) => a.marks.length === 0));
    assert.equal(s.formats.spans.length, 1);
  });
test("overlapping actor formats match semantic oracle through Undo, Redo, replay and retry", () => {
  const initial = fixture(),
    atoms = text(initial, "a"),
    layers = [],
    sequences = { a: 0, b: 0, c: 0 };
  let room = new Room(initial),
    journal = room.snapshot(),
    random = 2718;
  const next = () =>
    (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) / 4294967296;
  const check = () => {
    for (const atom of text(room.record.state, "a")) {
      const marks = new Map(
        atom.id
          ? atoms
              .find((a) => a.id === atom.id)
              .marks.map((m) => [typeof m === "string" ? m : m.type, m])
          : [],
      );
      for (const l of layers)
        if (l.active && l.ids.includes(atom.id)) {
          marks.delete(l.property);
          if (l.value !== null) marks.set(l.property, l.value);
        }
      const canonical = (xs) => xs.map((x) => JSON.stringify(x)).sort();
      assert.deepEqual(canonical(atom.marks), canonical([...marks.values()]));
    }
  };
  const accept = (command) => {
    const receipt = room.accept(command);
    assert.equal(receipt.outcome, "accepted", receipt.reason);
    journal = replay(journal, { op: command, receipt });
    room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
    assert.deepEqual(room.accept(command), receipt);
    assert.deepEqual(room.snapshot(), journal);
    check();
  };
  for (let i = 0; i < 60; i++) {
    const actor = ["a", "b", "c"][i % 3],
      from = Math.floor(next() * 25),
      to = from + 1 + Math.floor(next() * (25 - from)),
      property = i % 2 ? "strong" : "highlight",
      value =
        next() < 0.3
          ? null
          : property === "strong"
            ? "strong"
            : {
                type: "highlight",
                attrs: { color: i % 3 ? "blue" : "yellow" },
              },
      ids = atoms.slice(from, to).map((a) => a.id),
      command = op(actor, ++sequences[actor], {
        kind: "format",
        ids,
        property,
        value,
      });
    layers.push({ ...command.intent, actor, id: command.id, active: true });
    accept(command);
  }
  for (const layer of layers.filter((_, i) => i % 3 !== 1).reverse()) {
    layer.active = false;
    const command = op(layer.actor, ++sequences[layer.actor], {
      kind: "undo",
      target: layer.id,
    });
    accept(command);
    if (next() < 0.5) {
      layer.active = true;
      accept(
        op(layer.actor, ++sequences[layer.actor], {
          kind: "undo",
          target: command.id,
        }),
      );
    }
  }
});
test("legacy point-ledger checkpoints compact on mutation without losing prior ownership", () => {
  let s = fixture(3);
  s.formats = {
    "seed:a:1": {
      base: ["strong", { type: "highlight", attrs: { color: "yellow" } }],
      layers: [{ id: "old", property: "strong", value: null, active: true }],
    },
  };
  const before = text(s, "a");
  s = apply(
    s,
    op("a", 1, {
      kind: "format",
      ids: [before[0].id],
      property: "underline",
      value: "underline",
    }),
  );
  assert.equal(s.formats.version, 1);
  s = apply(s, op("a", 2, { kind: "undo", target: "a:format-store:1" }));
  assert.deepEqual(text(s, "a"), before);
});
test("malformed compact references and overlapping spans are rejected", () => {
  let s = fixture(40);
  s = apply(
    s,
    op("a", 1, {
      kind: "format",
      ids: text(s, "a").map((a) => a.id),
      property: "strong",
      value: null,
    }),
  );
  for (const mutate of [
    (n) => (n.formats.spans[0].value = 99),
    (n) => (n.formats.spans[0].length = 41),
    (n) => n.formats.spans.push({ ...n.formats.spans[0], from: 2 }),
    (n) =>
      n.formats.values[0].layers.push({ ...n.formats.values[0].layers[0] }),
  ]) {
    const bad = JSON.parse(JSON.stringify(s));
    mutate(bad);
    assert.throws(() => validate(bad), /formatting/);
  }
});

import { planTextFormat } from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
test("toolbar formatting sends compact targets and excludes later peer text", () => {
  const initial = fixture(40000),
    range = captureRange(
      initial,
      { block: "a", offset: 0 },
      { block: "a", offset: 40000 },
    );
  const plan = planTextFormat(initial, range, op("a", 1), {
    property: "clearFormat",
  });
  assert.ok(Buffer.byteLength(JSON.stringify(plan.intent)) < 2000);
  const room = new Room(initial);
  assert.equal(room.accept(op("a", 1, plan.intent)).outcome, "accepted");
  assert.ok(
    Buffer.byteLength(JSON.stringify(room.snapshot())) <
      Buffer.byteLength(JSON.stringify(initial)) + 10000,
  );
  // The compact range names backing characters, not a live positional interval.
  const beforeInsert = text(initial, "a");
  const s = apply(
    initial,
    op("b", 1, {
      kind: "insert",
      at: {
        ...range.start,
        left: beforeInsert[2].id,
        right: beforeInsert[3].id,
      },
      text: "P",
      marks: ["em"],
    }),
  );
  const next = apply(s, op("a", 1, plan.intent));
  assert.deepEqual(text(next, "a").find((a) => a.char === "P").marks, ["em"]);
});
test("public formatting rejects overlapping or ambiguous compressed target references", () => {
  const s = fixture(40),
    before = JSON.stringify(s),
    span = { run: "seed:a", from: 0, length: 20 };
  for (const refs of [
    { ids: ["seed:a:0"], idSpans: [span] },
    { idSpans: [span, { ...span, from: 10 }] },
    { idSpans: [{ ...span, length: 41 }] },
  ])
    assert.throws(() =>
      apply(
        s,
        op("a", 1, {
          kind: "format",
          ...refs,
          property: "strong",
          value: null,
        }),
      ),
    );
  assert.equal(JSON.stringify(s), before);
});

import { immutable } from "@cwhy/jade-core/immutability";
test("format validation cache never trusts mutable or replaced backing runs", () => {
  const make = () => {
    const initial = fixture(40);
    return apply(
      initial,
      op("a", 1, {
        kind: "format",
        ids: text(initial, "a").map((a) => a.id),
        property: "strong",
        value: null,
      }),
    );
  };
  const s = make();
  immutable(s.formats);
  validate(s);
  s.runs["seed:a"].chars.pop();
  assert.throws(() => validate(s), /formatting span/);
  const sealed = immutable(make());
  validate(sealed);
  const changed = {
    ...sealed,
    runs: {
      ...sealed.runs,
      "seed:a": {
        ...sealed.runs["seed:a"],
        chars: sealed.runs["seed:a"].chars.slice(0, 20),
      },
    },
  };
  assert.throws(() => validate(changed), /formatting span/);
});
