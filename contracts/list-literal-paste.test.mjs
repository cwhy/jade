// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  apply,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/admission";
import { planReplace } from "@cwhy/jade-core/commands";
import { plainFragment } from "@cwhy/jade-core/fragment";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
for (const selected of [false, true])
  for (const value of ["one\ntwo", "\n\n", "  x\n\ty\n", "你好🌱\r\nnext"])
    test(`List plain paste preserves literal lines selected=${selected} value=${JSON.stringify(value)}`, () => {
      const s = tableFixture(),
        id = "list-text",
        range = captureRange(
          s,
          { block: id, offset: 2 },
          { block: id, offset: selected ? 5 : 2 },
        ),
        original = text(s, id),
        style = [{ type: "underline" }],
        normalized = value.replace(/\r\n?/g, "\n"),
        anchor = anchorAt(s, id, 2, 3);
      const p = planReplace(s, range, plainFragment(value), op("A", 1), {
          strict: true,
          inheritedMarks: style,
          plainText: true,
        }),
        n = apply(s, op("A", 1, p.intent));
      assert.deepEqual(n.nodes, s.nodes);
      assert.equal(
        text(n, id)
          .map((a) => a.char)
          .join(""),
        original
          .slice(0, 2)
          .map((a) => a.char)
          .join("") +
          normalized +
          original
            .slice(selected ? 5 : 2)
            .map((a) => a.char)
            .join(""),
      );
      assert.deepEqual(
        text(n, id)
          .slice(2, 2 + [...normalized].length)
          .map((a) => a.marks),
        [...normalized].map(() => style),
      );
      const undone = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
      assert.deepEqual(text(undone, id), original);
      assert.deepEqual(resolveAnchor(undone, anchor), resolveAnchor(s, anchor));
      const redo = apply(undone, op("A", 3, { kind: "undo", target: "A:s:2" }));
      assert.deepEqual(text(redo, id), text(n, id));
      validate(redo);
    });
for (const peerFirst of [false, true])
  test(`List multiline plain replacement preserves offline peer insertion peerFirst=${peerFirst}`, () => {
    const s = tableFixture(),
      id = "list-text",
      range = captureRange(
        s,
        { block: id, offset: 2 },
        { block: id, offset: 5 },
      ),
      p = op(
        "A",
        1,
        planReplace(s, range, plainFragment("a\nb"), op("A", 1), {
          strict: true,
          plainText: true,
        }).intent,
      ),
      peer = op("B", 1, {
        kind: "insert",
        at: gapAt(s, id, 3),
        text: "中",
        marks: [{ type: "strong" }],
      });
    let n = s;
    for (const mutation of peerFirst ? [peer, p] : [p, peer])
      n = apply(n, mutation);
    assert.deepEqual(n.nodes, s.nodes);
    n = JSON.parse(JSON.stringify(n));
    n = apply(n, op("A", 2, { kind: "undo", target: p.id }));
    assert.deepEqual(text(n, id), text(apply(s, peer), id));
    n = apply(n, op("B", 2, { kind: "undo", target: peer.id }));
    assert.deepEqual(text(n, id), text(s, id));
    validate(n);
  });
test("Rich multiline list paste stays guarded until hierarchy-aware conversion is available", () => {
  const s = tableFixture(),
    range = captureRange(
      s,
      { block: "list-text", offset: 2 },
      { block: "list-text", offset: 2 },
    ),
    before = structuredClone(s);
  assert.throws(
    () =>
      planReplace(s, range, plainFragment("one\ntwo"), op("A", 1), {
        strict: true,
      }),
    /structural clipboard/,
  );
  assert.deepEqual(s, before);
});
test("Plain multiline paste into prose still creates ordinary paragraph boundaries", () => {
  const s = tableFixture(),
    range = captureRange(
      s,
      { block: "first", offset: 2 },
      { block: "first", offset: 2 },
    ),
    p = planReplace(s, range, plainFragment("one\ntwo"), op("A", 1), {
      strict: true,
      plainText: true,
    }),
    n = apply(s, op("A", 1, p.intent));
  assert.equal(n.nodes.cell.children.length, s.nodes.cell.children.length + 1);
  assert.equal(
    text(n, "first")
      .map((a) => a.char)
      .join(""),
    "Fione",
  );
  const undone = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.deepEqual(text(undone, "first"), text(s, "first"));
});
for (const style of [
  { type: "highlight", color: "#fff0a8" },
  { type: "highlight", attrs: { color: "yellow" } },
])
  for (const explicit of [false, true])
    test(`Plain list paste preserves valid local highlight representation ${JSON.stringify(style)} explicit=${explicit}`, () => {
      let s = tableFixture();
      const id = "list-text";
      s = apply(
        s,
        op("H", 1, {
          kind: "format",
          ids: text(s, id).map((a) => a.id),
          property: "highlight",
          value: style,
        }),
      );
      const range = captureRange(
          s,
          { block: id, offset: 2 },
          { block: id, offset: 5 },
        ),
        p = planReplace(s, range, plainFragment("a\nb"), op("A", 1), {
          plainText: true,
          ...(explicit ? { inheritedMarks: [style] } : {}),
        }),
        n = apply(s, op("A", 1, p.intent));
      assert.deepEqual(
        text(n, id)
          .slice(2, 5)
          .map((a) => a.marks),
        [[style], [style], [style]],
      );
      assert.deepEqual(
        text(apply(n, op("A", 2, { kind: "undo", target: "A:s:1" })), id),
        text(s, id),
      );
    });
