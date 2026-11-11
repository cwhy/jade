// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { plainFragment } from "@cwhy/jade-core/fragment";
import {
  planReplace,
  planEnter,
  planDelete,
  previewCut,
  planCut,
} from "@cwhy/jade-core/commands";
import { Room } from "@cwhy/jade-testkit/peers";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
function fixture() {
  return seed(
    {
      doc: { id: "doc", type: "doc", children: ["p", "q", "r"], live: true },
      p: { id: "p", type: "paragraph", live: true },
      q: { id: "q", type: "paragraph", live: true },
      r: { id: "r", type: "paragraph", live: true },
    },
    {
      p: [{ text: "aaaa", marks: [] }],
      q: [{ text: "bbbb", marks: ["strong"] }],
      r: [{ text: "cccc", marks: [] }],
    },
  );
}
const range = (s, a = "p", start = 2, b = "q", end = 2) =>
  captureRange(s, { block: a, offset: start }, { block: b, offset: end });
const logical = (s) =>
  s.nodes.doc.children.map((id) => ({ id, atoms: text(s, id) }));
const undo = (s, a, target, n = 2) =>
  apply(s, op(a, n, { kind: "undo", target }));
const fragment = {
  version: 1,
  blocks: [
    { type: "paragraph", content: [{ text: "X", marks: [{ type: "em" }] }] },
    {
      type: "paragraph",
      content: [
        { text: "蓝", marks: [{ type: "color", attrs: { color: "blue" } }] },
      ],
    },
  ],
};
const replacement = (s) => {
  const p = planReplace(s, range(s), fragment, op("A", 1), { strict: true });
  return { ...p, op: op("A", 1, p.intent) };
};
for (const before of [false, true])
  for (const block of ["p", "q"])
    for (const offset of [0, 1, 2, 3, 4])
      test(`Cross-paragraph replacement retains offline source affiliation peerFirst=${before} ${block}:${offset}`, () => {
        const s = fixture(),
          p = replacement(s),
          peer = op("B", 1, {
            kind: "insert",
            at: gapAt(s, block, offset),
            text: "中",
            marks: ["underline"],
          }),
          anchor = anchorAt(s, "q", 0, 4);
        let n = s;
        for (const o of before ? [peer, p.op] : [p.op, peer]) n = apply(n, o);
        assert.equal(
          logical(n)
            .flatMap((x) => x.atoms)
            .filter((a) => a.id.startsWith("B:")).length,
          1,
        );
        n = undo(n, "A", p.op.id);
        assert.deepEqual(logical(n), logical(apply(s, peer)));
        assert.deepEqual(
          resolveAnchor(n, anchor).segments.map((x) => x.id),
          anchor.atoms,
        );
        n = undo(n, "B", peer.id);
        assert.deepEqual(logical(n), logical(s));
        validate(n);
      });
for (const before of [false, true])
  for (const block of ["p", "q"])
    for (const offset of [0, 1, 2, 3, 4])
      test(`Replacement retains peer-created boundary peerFirst=${before} ${block}:${offset}`, () => {
        const s = fixture(),
          p = replacement(s),
          peer = op(
            "B",
            1,
            planEnter(s, range(s, block, offset, block, offset), op("B", 1))
              .intent,
          );
        let n = s;
        for (const o of before ? [peer, p.op] : [p.op, peer]) n = apply(n, o);
        const joined = logical(n);
        n = undo(n, "A", p.op.id);
        assert.deepEqual(logical(n), logical(apply(s, peer)));
        n = undo(n, "B", peer.id);
        assert.deepEqual(logical(n), logical(s));
        n = undo(n, "B", "B:s:2", 3);
        n = undo(n, "A", "A:s:2", 3);
        assert.deepEqual(logical(n), joined);
        validate(n);
      });
for (const from of [0, 1, 4])
  for (const to of [0, 2, 4])
    test(`Selected prose Enter preserves exact original identities ${from}:${to}`, () => {
      if (from > to) return;
      const s = fixture(),
        p = planEnter(s, range(s, "p", from, "p", to), op("A", 1));
      let n = apply(s, op("A", 1, p.intent));
      assert.deepEqual(n.nodes.doc.children.slice(-2), ["q", "r"]);
      n = undo(n, "A", "A:s:1");
      assert.deepEqual(logical(n), logical(s));
    });
test("Multi-paragraph replacement is one durable decision across restart and duplicate retry", () => {
  const s = fixture(),
    p = replacement(s);
  let room = new Room(s);
  const receipt = room.accept(p.op);
  assert.equal(receipt.outcome, "accepted");
  room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
  assert.deepEqual(room.accept(p.op), receipt);
  assert.equal(room.record.state.revision, 1);
  const copied = logical(room.record.state);
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: p.op.id })).outcome,
    "accepted",
  );
  room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
  assert.deepEqual(logical(room.record.state), logical(s));
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: "A:s:2" })).outcome,
    "accepted",
  );
  assert.deepEqual(logical(room.record.state), copied);
});
for (const mutate of [
  (i) => (i.parent = "p"),
  (i) => i.ids.push(i.ids[0]),
  (i) => (i.joins[0].id = "forged"),
  (i) => i.joins.push(i.joins[0]),
  (i) => (i.fragment.blocks[0].type = "code"),
  (i) => (i.at.text = "missing"),
  (i) => (i.atoms = []),
  (i) =>
    (i.fragment.blocks[0].content[0].marks = [
      { type: "link", attrs: { href: "javascript:bad" } },
    ]),
])
  test(`Semantic prose admission rejects malformed payload: ${mutate}`, () => {
    const s = fixture(),
      p = replacement(s),
      i = structuredClone(p.intent),
      before = structuredClone(s);
    mutate(i);
    assert.throws(() => apply(s, op("A", 1, i)));
    assert.deepEqual(s, before);
  });
for (const order of [
  ["A", "B", "C"],
  ["A", "C", "B"],
  ["B", "A", "C"],
  ["C", "A", "B"],
])
  test(`Collapsed offline boundaries retain erased source ordering ${order}`, () => {
    const s = fixture(),
      p = replacement(s),
      b = op("B", 1, planEnter(s, range(s, "q", 1, "q", 1), op("B", 1)).intent),
      c = op("C", 1, planEnter(s, range(s, "q", 2, "q", 2), op("C", 1)).intent),
      operations = { A: p.op, B: b, C: c };
    let n = s;
    for (const a of order) n = apply(n, operations[a]);
    n = undo(n, "A", p.op.id);
    assert.deepEqual(logical(n), logical(apply(apply(s, b), c)));
    n = undo(n, "B", b.id);
    n = undo(n, "C", c.id);
    assert.deepEqual(logical(n), logical(s));
    validate(n);
  });
