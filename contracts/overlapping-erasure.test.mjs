// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { immutable } from "@cwhy/jade-core/immutability";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const fixture = () =>
  immutable(
    seed(
      {
        doc: { id: "doc", type: "doc", children: ["p"], live: true },
        p: { id: "p", type: "paragraph", live: true },
      },
      { p: [{ text: "abcdef", marks: ["strong"] }] },
    ),
  );
const run = (s, o) => {
  const before = JSON.stringify(s);
  try {
    const n = immutable(apply(s, o));
    validate(n);
    return n;
  } finally {
    assert.equal(JSON.stringify(s), before);
  }
};
const chars = (s) =>
  text(s, "p")
    .map((a) => a.char)
    .join("");
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const undoFirst of ["A", "B"])
    test(`Overlapping deletes retain independent claims: arrival=${arrival} undoFirst=${undoFirst}`, () => {
      const initial = fixture(),
        atoms = text(initial, "p"),
        ops = {
          A: op("A", 1, {
            kind: "delete",
            ids: atoms.slice(1, 4).map((a) => a.id),
          }),
          B: op("B", 1, {
            kind: "delete",
            ids: atoms.slice(2, 5).map((a) => a.id),
          }),
        };
      let s = initial;
      for (const a of arrival) s = run(s, ops[a]);
      assert.equal(chars(s), "af");
      s = run(s, op(undoFirst, 2, { kind: "undo", target: ops[undoFirst].id }));
      const other = undoFirst === "A" ? "B" : "A";
      assert.deepEqual(
        text(s, "p"),
        text(run(initial, ops[other]), "p"),
        "only the other deletion remains effective",
      );
      s = run(s, op(other, 2, { kind: "undo", target: ops[other].id }));
      assert.deepEqual(text(s, "p"), atoms);
      s = run(
        s,
        op(undoFirst, 3, { kind: "undo", target: `${undoFirst}:s:2` }),
      );
      assert.deepEqual(
        text(s, "p"),
        text(run(initial, ops[undoFirst]), "p"),
        "Redo reactivates the same original selected identities",
      );
    });
for (const undoFirst of ["author", "deleter"])
  test(`Insertion Undo versus later deletion: undoFirst=${undoFirst}`, () => {
    const initial = fixture(),
      a = op("A", 1, {
        kind: "insert",
        at: gapAt(initial, "p", 3),
        text: "XYZ",
        marks: ["em"],
      });
    let s = run(initial, a);
    const c = op("C", 1, {
      kind: "delete",
      ids: text(s, "p")
        .filter((a) => a.id.startsWith("A:"))
        .map((a) => a.id),
    });
    s = run(s, c);
    if (undoFirst === "author") {
      s = run(s, op("A", 2, { kind: "undo", target: a.id }));
      s = run(s, op("C", 2, { kind: "undo", target: c.id }));
      assert.deepEqual(
        text(s, "p"),
        text(initial, "p"),
        "inactive insertion cannot be revived by Undoing another deletion",
      );
    } else {
      s = run(s, op("C", 2, { kind: "undo", target: c.id }));
      s = run(s, op("A", 2, { kind: "undo", target: a.id }));
      assert.deepEqual(text(s, "p"), text(initial, "p"));
    }
    s = run(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
    assert.deepEqual(
      text(s, "p"),
      text(run(initial, a), "p"),
      "Redo restores exact original insertion identities",
    );
  });
