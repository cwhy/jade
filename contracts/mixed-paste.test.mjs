// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  apply,
  text,
  gapAt,
  validate,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/admission";
import { planReplace } from "@cwhy/jade-core/commands";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s, id = "first", from = 2, to = 7) =>
  captureRange(s, { block: id, offset: from }, { block: id, offset: to });
const runs = [
  { text: "你", marks: [{ type: "strong" }] },
  {
    text: "好🌱",
    marks: [{ type: "em" }, { type: "color", attrs: { color: "#0066cc" } }],
  },
  {
    text: "link",
    marks: [{ type: "link", attrs: { href: "https://example.com" } }],
  },
  { text: "!", marks: [] },
];
const fragment = (content) => ({
  version: 1,
  blocks: [{ type: "paragraph", content }],
});
const visible = (a) => a.map(({ id, ...atom }) => atom);
const expected = runs.flatMap((run) =>
  [...run.text].map((char) => ({ char, marks: run.marks })),
);
const plan = (s, r = range(s), content = runs) => {
  const p = planReplace(s, r, fragment(content), op("A", 1), { strict: true });
  return { ...p, op: op("A", 1, p.intent) };
};
for (const id of ["first", "list-text"])
  test(`Mixed-style ${id} paste is one public insertion, exact identities, anchors and owned Undo/Redo`, () => {
    const s = tableFixture(),
      r = range(s, id),
      p = plan(s, r),
      n = apply(s, p.op),
      bookmark = anchorAt(s, id, 2, 5),
      insert = p.intent.intents.filter((i) => i.kind === "insert");
    assert.equal(insert.length, 1);
    assert.deepEqual(insert[0].runs, runs);
    assert.equal(Object.hasOwn(insert[0], "atoms"), false);
    assert.deepEqual(n, p.state);
    assert.equal(resolveAnchor(n, bookmark).status, "removed");
    assert.deepEqual(
      visible(text(n, id).slice(2, 2 + expected.length)),
      expected,
    );
    assert.equal(
      new Set(text(n, id).map((a) => a.id)).size,
      text(n, id).length,
    );
    const back = apply(n, op("A", 2, { kind: "undo", target: p.op.id }));
    assert.deepEqual(text(back, id), text(s, id));
    assert.deepEqual(resolveAnchor(back, bookmark), resolveAnchor(s, bookmark));
    const redo = apply(back, op("A", 3, { kind: "undo", target: "A:s:2" }));
    assert.deepEqual(text(redo, id), text(n, id));
    validate(redo);
  });
for (const peerFirst of [false, true])
  test(`Mixed-style paste and independent peer insertion, peer first=${peerFirst}`, () => {
    const s = tableFixture(),
      p = plan(s),
      peer = op("B", 1, {
        kind: "insert",
        at: gapAt(s, "first", 4),
        text: "peer",
        marks: [{ type: "underline" }],
      });
    let n = s;
    for (const o of peerFirst ? [peer, p.op] : [p.op, peer]) n = apply(n, o);
    assert.equal(
      text(n, "first")
        .filter((a) => a.id.startsWith("B:"))
        .map((a) => a.char)
        .join(""),
      "peer",
    );
    assert.deepEqual(
      visible(text(n, "first").filter((a) => a.id.startsWith("A:"))),
      expected,
    );
    n = apply(n, op("A", 2, { kind: "undo", target: p.op.id }));
    assert.deepEqual(text(n, "first"), text(apply(s, peer), "first"));
    n = apply(n, op("B", 2, { kind: "undo", target: peer.id }));
    assert.deepEqual(text(n, "first"), text(s, "first"));
    validate(n);
  });
test("Mixed-style replacement rechecks the selected destination before planning", () => {
  const s = tableFixture(),
    r = range(s),
    n = apply(
      s,
      op("B", 1, { kind: "insert", at: gapAt(s, "first", 4), text: "peer" }),
    );
  assert.throws(() => plan(n, r), /Destination changed/);
});
test("Alternating styles produce one insertion, with no per-style operation batches", () => {
  const s = tableFixture(),
    content = Array.from({ length: 2000 }, (_, i) => ({
      text: "界",
      marks: i % 2 ? [{ type: "em" }] : [{ type: "strong" }],
    })),
    p = plan(s, range(s, "empty", 0, 0), content);
  assert.equal(p.intent.intents.length, 1);
  assert.equal(p.intent.intents[0].runs.length, 2000);
  assert.ok(JSON.stringify(p.intent).length < 120000);
  const n = apply(s, p.op);
  assert.deepEqual(
    visible(text(n, "empty")),
    content.map((r) => ({ char: r.text, marks: r.marks })),
  );
  assert.equal(
    text(apply(n, op("A", 2, { kind: "undo", target: p.op.id })), "empty")
      .length,
    0,
  );
});
test("Plain-style override replaces every imported style in one insertion", () => {
  const s = tableFixture(),
    style = [{ type: "underline" }],
    p = planReplace(s, range(s), fragment(runs), op("A", 1), {
      strict: true,
      inheritedMarks: style,
    }),
    n = apply(s, op("A", 1, p.intent));
  assert.ok(
    text(n, "first")
      .slice(2, 2 + expected.length)
      .every((a) => JSON.stringify(a.marks) === JSON.stringify(style)),
  );
});
test("Code destination receives literal whitespace without imported links or colors", () => {
  const s = tableFixture(),
    content = [
      {
        text: "  x\n\ty",
        marks: [
          { type: "strong" },
          { type: "link", attrs: { href: "https://example.com" } },
        ],
      },
    ],
    p = plan(s, range(s, "code", 0, 0), content),
    n = apply(s, p.op);
  assert.equal(
    text(n, "code")
      .slice(0, 6)
      .map((a) => a.char)
      .join(""),
    "  x\n\ty",
  );
  assert.ok(
    text(n, "code")
      .slice(0, 6)
      .every((a) => !a.marks.length),
  );
});
for (const [name, patch] of [
  ["ambiguous text", { text: "extra" }],
  ["top-level marks", { marks: [] }],
  ["forged raw atoms", { atoms: [] }],
  ["empty list", { runs: [] }],
  ["empty text", { runs: [{ text: "", marks: [] }] }],
  [
    "unsafe link",
    {
      runs: [
        {
          text: "x",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    },
  ],
  ["unknown mark", { runs: [{ text: "x", marks: [{ type: "custom" }] }] }],
  [
    "invalid highlight",
    {
      runs: [
        {
          text: "x",
          marks: [{ type: "highlight", attrs: { color: "url(secret)" } }],
        },
      ],
    },
  ],
  [
    "forged character id",
    { runs: [{ text: "x", marks: [], id: "seed:first:0" }] },
  ],
  ["oversized content", { runs: [{ text: "x".repeat(100001), marks: [] }] }],
])
  test(`Public styled insertion rejects ${name} without modifying state`, () => {
    const s = tableFixture(),
      before = structuredClone(s);
    assert.throws(
      () =>
        apply(
          s,
          op("A", 1, {
            kind: "insert",
            at: gapAt(s, "first", 0),
            runs,
            ...patch,
          }),
        ),
      /Admission/,
    );
    assert.deepEqual(s, before);
  });
