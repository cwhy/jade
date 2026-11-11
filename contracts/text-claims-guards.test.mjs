// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const fixture = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p"] },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "abc", marks: [] }] },
  );
const removed = () => {
  const s = fixture();
  return apply(
    s,
    op("A", 1, {
      kind: "delete",
      ids: text(s, "p")
        .slice(0, 2)
        .map((a) => a.id),
    }),
  );
};
for (const change of [
  (s) => delete s.textClaims,
  (s) => (s.textClaims["A:s:1"].active = false),
  (s) => s.textClaims["A:s:1"].ids.push(s.textClaims["A:s:1"].ids[0]),
  (s) => Object.values(s.textMasks)[0].ids.reverse(),
  (s) => (Object.values(s.textMasks)[0].inverse.intents[0].restore = "forged"),
])
  test(`Reject invalid deletion ledger: ${change}`, () => {
    const s = removed();
    change(s);
    assert.throws(() => validate(s));
  });
test("Public activation cannot impersonate owned Undo", () => {
  const s = removed(),
    before = structuredClone(s);
  assert.throws(() =>
    apply(
      s,
      op("B", 1, { kind: "textClaimActive", claim: "A:s:1", active: false }),
    ),
  );
  assert.deepEqual(s, before);
  assert.throws(() => apply(s, op("B", 1, { kind: "undo", target: "A:s:1" })));
});
test("Codec 42 is rejected and cannot be silently retagged without visibility metadata", () => {
  const s = fixture();
  s.storageCodec = 42;
  assert.throws(() => validate(s));
  s.storageCodec = 43;
  delete s.textClaims;
  delete s.textMasks;
  assert.throws(() => validate(s));
});

test("Deleting unknown identities cannot reserve future inserted characters", () => {
  let s = fixture();
  s = apply(s, op("A", 1, { kind: "delete", ids: ["B:s:1:char:0"] }));
  s = apply(s, op("B", 1, { kind: "insert", at: gapAt(s, "p", 1), text: "X" }));
  assert.equal(
    text(s, "p")
      .map((a) => a.char)
      .join(""),
    "aXbc",
  );
  validate(s);
  s = apply(s, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.equal(
    text(s, "p")
      .map((a) => a.char)
      .join(""),
    "aXbc",
  );
});
