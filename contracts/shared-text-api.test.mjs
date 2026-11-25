// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { captureRange, resolveRange } from "@cwhy/jade-core/selection";
import {
  planReplace,
  planEnter,
  planDelete,
  copyRange,
  planCodeIndent,
} from "@cwhy/jade-core/commands";
import { documentView } from "@cwhy/jade-core/document-read";
import { plainFragment } from "@cwhy/jade-core/fragment";
import { captureConversion } from "@cwhy/jade-core/conversion";
const op = (actor, seq) => ({
  actor,
  seq,
  id: `${actor}:shared:${seq}`,
  stream: "shared",
  epoch: 1,
  modelVersion: 2,
});
const fixture = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["a", "b", "c"] },
      ...Object.fromEntries(
        ["a", "b", "c"].map((id) => [
          id,
          { id, type: "paragraph", live: true },
        ]),
      ),
    },
    { a: [{ text: "Alpha" }], b: [{ text: "Beta" }], c: [{ text: "Later" }] },
  );
const convert = (s) =>
  apply(s, {
    ...op("a", 1),
    intent: captureConversion(s, "doc", ["a", "b"], "code"),
  });
const range = (s, a, b = a) =>
  captureRange(s, { block: "a", offset: a }, { block: "a", offset: b });
const content = (s) =>
  documentView(s).order.map((id) => [
    documentView(s).node(id).type,
    documentView(s)
      .text(id)
      .map((a) => a.char)
      .join(""),
  ]);
test("shared range spans converted sources and copies exactly rendered code", () => {
  const s = convert(fixture()),
    r = range(s, 0, 10);
  assert.equal(r.logical, true);
  assert.equal(r.slices.length, 1);
  assert.equal(r.slices[0].type, "code");
  assert.equal(r.slices[0].atoms.map((a) => a.char).join(""), "Alpha\nBeta");
  assert.equal(copyRange(s, r).plain, "Alpha\nBeta");
  assert.equal(copyRange(s, r).fragment.blocks[0].type, "code");
});
for (const [from, to] of [
  [1, 1],
  [5, 6],
  [3, 8],
  [0, 10],
])
  test(`public replacement ${from}..${to} preserves original identities on Undo`, () => {
    const initial = fixture();
    let s = convert(initial);
    const r = range(s, from, to),
      plan = planReplace(s, r, plainFragment("X"), op("b", 1));
    s = apply(s, { ...op("b", 1), intent: plan.intent });
    assert.equal(
      content(s)[0][1],
      "Alpha\nBeta".slice(0, from) + "X" + "Alpha\nBeta".slice(to),
    );
    assert.deepEqual(
      resolveRange(s, { epoch: s.epoch, anchor: plan.after, focus: plan.after })
        .anchor,
      { block: "a", offset: from + 1 },
    );
    s = apply(s, {
      ...op("b", 2),
      intent: { kind: "undo", target: "b:shared:1" },
    });
    assert.deepEqual(content(s), [
      ["code", "Alpha\nBeta"],
      ["paragraph", "Later"],
    ]);
    for (const id of ["a", "b", "c"])
      assert.deepEqual(text(s, id), text(initial, id));
  });
test("public code Enter, Backspace, indent and reverse Body Enter share logical points", () => {
  let s = convert(fixture()),
    p = planEnter(s, range(s, 7), op("b", 1));
  s = apply(s, { ...op("b", 1), intent: p.intent });
  assert.equal(content(s)[0][1], "Alpha\nB\neta");
  p = planDelete(s, range(s, 8), "backward", op("b", 2));
  s = apply(s, { ...op("b", 2), intent: p.intent });
  assert.equal(content(s)[0][1], "Alpha\nBeta");
  p = planCodeIndent(s, range(s, 0, 10), op("b", 3));
  s = apply(s, { ...op("b", 3), intent: p.intent });
  assert.equal(content(s)[0][1], "  Alpha\n  Beta");
  s = apply(s, {
    ...op("a", 2),
    intent: captureConversion(s, "doc", ["a", "b"], "paragraph"),
  });
  p = planEnter(s, range(s, 2), op("b", 4));
  s = apply(s, { ...op("b", 4), intent: p.intent });
  assert.deepEqual(
    content(s).map((x) => x[1]),
    ["  ", "Alpha\n  Beta", "Later"],
  );
});
test("reading one caret does not materialize unrelated long leaves", () => {
  const n = 2000,
    nodes = { doc: { id: "doc", type: "doc", live: true, children: [] } },
    contents = {};
  for (let i = 0; i < n; i++) {
    const id = "p" + i;
    nodes.doc.children.push(id);
    nodes[id] = { id, type: "paragraph", live: true };
    contents[id] = [{ text: "word ".repeat(50) }];
  }
  const s = seed(nodes, contents),
    view = documentView(s);
  view.gapAt("p1999", 17);
  assert.equal(view.stats().materializedLeaves, 0);
  view.text("p1999");
  assert.equal(view.stats().materializedLeaves, 1);
});

import { immutable } from "@cwhy/jade-core/immutability";
test("topology cache reuses only sealed structure; text remains snapshot-specific", () => {
  const s = immutable(convert(fixture())),
    before = documentView(s);
  assert.equal(
    before
      .text("a")
      .map((a) => a.char)
      .join(""),
    "Alpha\nBeta",
  );
  const next = immutable(
      apply(s, {
        ...op("b", 1),
        intent: { kind: "insert", at: gapAt(s, "b", 0), text: "X" },
      }),
    ),
    after = documentView(next);
  assert.equal(next.nodes, s.nodes);
  assert.equal(after.stats().reusedTopology, true);
  assert.equal(after.stats().materializedLeaves, 0);
  assert.equal(
    after
      .text("a")
      .map((a) => a.char)
      .join(""),
    "Alpha\nXBeta",
  );
  assert.equal(
    before
      .text("a")
      .map((a) => a.char)
      .join(""),
    "Alpha\nBeta",
  );
  const changed = immutable(
    apply(next, {
      ...op("a", 2),
      intent: { kind: "undo", target: "a:shared:1" },
    }),
  );
  assert.equal(documentView(changed).stats().reusedTopology, false);
  assert.deepEqual(documentView(changed).order, ["a", "b", "c"]);
});
