// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { captureRange } from "@cwhy/jade-core/selection";
import { apply, text, gapAt, validate } from "@cwhy/jade-core/admission";
import { planTextFormat, textFormatState } from "@cwhy/jade-core/commands";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s) =>
  captureRange(s, { block: "code", offset: 5 }, { block: "first", offset: 3 });
const plan = (s, r, p = "strong", v = undefined, a = "A", n = 1) => {
  const x = planTextFormat(s, r, op(a, n), { property: p, value: v });
  return { ...x, op: op(a, n, x.intent) };
};
const undo = (s, target, a = "A", n = 2) =>
  apply(s, op(a, n, { kind: "undo", target }));
for (const property of [
  "strong",
  "em",
  "underline",
  "strike",
  "color",
  "highlight",
])
  test(`reverse partial cross-cell ${property} preserves exact structure and marks outside range`, () => {
    const s = tableFixture(),
      r = range(s),
      p = plan(
        s,
        r,
        property,
        ["color", "highlight"].includes(property)
          ? { type: property, attrs: { color: "red" } }
          : undefined,
      );
    validate(p.state);
    assert.deepEqual(p.selection, r);
    assert.deepEqual(p.state.nodes, s.nodes);
    assert.deepEqual(p.state.replicas, s.replicas);
    assert.deepEqual(p.state.runs, s.runs);
    const ids = new Set(r.slices.flatMap((s) => s.atoms.map((a) => a.id)));
    for (const b of ["first", "list-text", "code", "last"])
      for (const a of text(p.state, b)) {
        if (ids.has(a.id) && b !== "code")
          assert.ok(a.marks.some((m) => m.type === property));
        else
          assert.deepEqual(
            a,
            text(s, b).find((x) => x.id === a.id),
          );
      }
    const back = undo(p.state, p.op.id);
    for (const b of ["first", "list-text", "code", "last"])
      assert.deepEqual(text(back, b), text(s, b));
  });
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  test(`frozen text range excludes peer typing, Undo ${order}`, () => {
    const s = tableFixture(),
      r = range(s),
      f = plan(s, r),
      insert = op("B", 1, {
        kind: "insert",
        at: gapAt(s, "list-text", 3),
        text: "peer",
      });
    let n = apply(apply(s, insert), f.op);
    assert.ok(
      text(n, "list-text")
        .filter((a) => a.id.startsWith("B:"))
        .every((a) => !a.marks.length),
    );
    for (const a of order) n = undo(n, a === "A" ? f.op.id : insert.id, a);
    for (const b of ["first", "list-text", "code"])
      assert.deepEqual(text(n, b), text(s, b));
  });
test("bookmark uses current marks for toggles but never widens target to later peer text", () => {
  const s = tableFixture(),
    r = range(s),
    peer = plan(s, r, "strong", undefined, "B").state;
  assert.equal(textFormatState(peer, r, "strong").enabled, true);
  const p = plan(peer, r);
  assert.ok(
    text(p.state, "code")
      .slice(0, 5)
      .every((a) => !a.marks.length),
  );
  const back = undo(p.state, p.op.id);
  assert.deepEqual(text(back, "code"), text(peer, "code"));
});
test("Clear text formatting is one owned batch, removes links/colors, preserves structure and peer contribution", () => {
  const s = tableFixture(),
    r = range(s);
  let seed = plan(
    s,
    r,
    "link",
    { type: "link", attrs: { href: "https://example.com" } },
    "seed",
    1,
  ).state;
  seed = plan(
    seed,
    r,
    "color",
    { type: "color", attrs: { color: "red" } },
    "seed",
    2,
  ).state;
  seed = plan(seed, r, "strong", undefined, "seed", 3).state;
  const clear = plan(seed, r, "clearFormat"),
    peer = plan(clear.state, r, "underline", undefined, "B").state;
  assert.deepEqual(peer.nodes, s.nodes);
  assert.ok(
    text(peer, "first")
      .slice(3)
      .every((a) => a.marks.length === 1 && a.marks[0].type === "underline"),
  );
  const back = undo(peer, clear.op.id);
  assert.ok(
    text(back, "first")
      .slice(3)
      .every((a) =>
        ["link", "color", "strong", "underline"].every((t) =>
          a.marks.some((m) => m.type === t),
        ),
      ),
  );
  const final = undo(back, "B:s:1", "B", 2);
  for (const b of ["first", "list-text", "code"])
    assert.deepEqual(text(final, b), text(seed, b));
});
test("collapsed range is no-op and prior epoch or structural range is rejected", () => {
  const s = tableFixture(),
    r = captureRange(
      s,
      { block: "first", offset: 2 },
      { block: "first", offset: 2 },
    );
  assert.equal(plan(s, r).intent, null);
  assert.throws(() => plan(s, { ...r, epoch: 0 }), /current document/);
  assert.throws(() => plan(s, { kind: "cells" }), /current document/);
});

test("code-only text formatting is an explicit no-op, retaining state and selection", () => {
  const s = tableFixture(),
    r = captureRange(
      s,
      { block: "code", offset: 1 },
      { block: "code", offset: 5 },
    ),
    p = plan(s, r);
  assert.equal(p.intent, null);
  assert.equal(p.state, s);
  assert.equal(p.selection, r);
  assert.match(p.notice, /Code text skipped/);
  assert.equal(textFormatState(s, r, "strong").empty, true);
});
