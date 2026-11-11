// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  apply,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const value = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
function fixture() {
  return seed(
    {
      doc: {
        id: "doc",
        type: "doc",
        children: ["p", "code", "after"],
        live: true,
      },
      p: { id: "p", type: "paragraph", live: true },
      code: { id: "code", type: "code", language: "javascript", live: true },
      after: { id: "after", type: "paragraph", live: true },
    },
    {
      p: [{ text: "ABCD", marks: [{ type: "em" }] }],
      code: [{ text: "const retry = 2;" }],
      after: [{ text: "after" }],
    },
  );
}
const split = (s) =>
  apply(s, op("A", 1, { kind: "proseEnter", at: gapAt(s, "p", 2) }));
// Private model setup only: move an existing fixture code block between the
// two paragraphs. This is NOT a proposed public treePlace/paste operation.
const interleave = (s) =>
  apply(
    s,
    op("M", 1, {
      kind: "treePlace",
      node: "code",
      from: "doc",
      parent: "doc",
      before: "A:s:1:paragraph",
      expected: null,
    }),
  );
for (const side of ["prefix", "suffix"])
  for (const reload of [false, true])
    test(`Typing Enter beside interleaved code remains ordinary editing side=${side} reload=${reload}`, () => {
      const initial = fixture(),
        anchor = anchorAt(initial, "p", 3, 4);
      let s = interleave(split(initial));
      if (reload) s = JSON.parse(JSON.stringify(s));
      const block = side === "prefix" ? "p" : "A:s:1:paragraph",
        before = s,
        b = op("B", 1, { kind: "proseEnter", at: gapAt(s, block, 1) });
      s = apply(s, b);
      assert.equal(value(s, "code"), "const retry = 2;");
      assert.equal(value(s, block), side === "prefix" ? "A" : "C");
      assert.equal(value(s, "B:s:1:paragraph"), side === "prefix" ? "B" : "D");
      assert.deepEqual(
        s.nodes.doc.children,
        side === "prefix"
          ? ["p", "B:s:1:paragraph", "code", "A:s:1:paragraph", "after"]
          : ["p", "code", "A:s:1:paragraph", "B:s:1:paragraph", "after"],
      );
      s = apply(s, op("B", 2, { kind: "undo", target: b.id }));
      assert.equal(value(s, block), side === "prefix" ? "AB" : "CD");
      assert.deepEqual(s.nodes.doc.children, before.nodes.doc.children);
      assert.deepEqual(resolveAnchor(s, anchor), resolveAnchor(before, anchor));
      s = apply(s, op("B", 3, { kind: "undo", target: "B:s:2" }));
      validate(s);
      assert.equal(value(s, "code"), "const retry = 2;");
    });
test("An older split Undo cannot join across an intervening code block", () => {
  const initial = fixture(),
    s = interleave(split(initial));
  assert.throws(
    () => apply(s, op("A", 2, { kind: "undo", target: "A:s:1" })),
    /structural dependency|intervening/,
  );
  const restored = apply(s, op("M", 2, { kind: "undo", target: "M:s:1" }));
  const undone = apply(restored, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.equal(value(undone, "p"), "ABCD");
  assert.deepEqual(undone.nodes.doc.children, initial.nodes.doc.children);
});
for (const early of [false, true])
  test(`Offline earlier Enter retains source anchor around inserted code early=${early}`, () => {
    const initial = fixture(),
      anchor = anchorAt(initial, "p", 3, 4),
      b = op("B", 1, { kind: "proseEnter", at: gapAt(initial, "p", 1) });
    let s;
    if (early) {
      s = apply(initial, b);
      s = apply(
        s,
        op("A", 1, { kind: "proseEnter", at: gapAt(s, "B:s:1:paragraph", 1) }),
      );
      s = interleave(s);
    } else {
      s = apply(interleave(split(initial)), b);
    }
    assert.deepEqual(s.nodes.doc.children, [
      "p",
      "B:s:1:paragraph",
      "code",
      "A:s:1:paragraph",
      "after",
    ]);
    assert.equal(value(s, "p"), "A");
    assert.equal(value(s, "B:s:1:paragraph"), "B");
    assert.equal(value(s, "A:s:1:paragraph"), "CD");
    const before = resolveAnchor(s, anchor);
    s = apply(s, op("B", 2, { kind: "undo", target: b.id }));
    assert.deepEqual(resolveAnchor(s, anchor), before);
    assert.equal(value(s, "p"), "AB");
    assert.equal(value(s, "code"), "const retry = 2;");
    validate(s);
  });
for (const type of ["paragraph", "code", "image", "bullet_list"])
  test(`Enter preserves every foreign sibling kind ${type}`, () => {
    const original = fixture(),
      nodes = structuredClone(original.nodes);
    for (const n of Object.values(nodes)) delete n.text;
    nodes.code = {
      id: "code",
      type,
      live: true,
      ...(type === "image"
        ? { asset: "mock.png" }
        : type === "bullet_list"
          ? { children: ["item"] }
          : {}),
    };
    if (type === "bullet_list") {
      nodes.item = {
        id: "item",
        type: "list_item",
        live: true,
        children: ["ip"],
      };
      nodes.ip = { id: "ip", type: "paragraph", live: true };
    }
    const s = seed(nodes, {
        p: [{ text: "ABCD" }],
        after: [{ text: "after" }],
        ...(["code", "paragraph"].includes(type)
          ? { code: [{ text: "foreign" }] }
          : {}),
        ...(type === "bullet_list" ? { ip: [{ text: "foreign" }] } : {}),
      }),
      before = interleave(split(s));
    let n = apply(
      before,
      op("B", 1, { kind: "proseEnter", at: gapAt(before, "p", 1) }),
    );
    assert.deepEqual(n.nodes.code, before.nodes.code);
    assert.deepEqual(n.nodes.doc.children, [
      "p",
      "B:s:1:paragraph",
      "code",
      "A:s:1:paragraph",
      "after",
    ]);
    n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
    assert.deepEqual(n.nodes.doc.children, before.nodes.doc.children);
    assert.deepEqual(n.nodes.code, before.nodes.code);
    validate(n);
  });
test("Family member reordering is still rejected, not treated as an independent insertion", () => {
  let s = split(fixture());
  s = apply(
    s,
    op("M", 1, {
      kind: "treePlace",
      node: "A:s:1:paragraph",
      from: "doc",
      parent: "doc",
      before: "p",
      expected: null,
    }),
  );
  assert.throws(
    () => apply(s, op("B", 1, { kind: "proseEnter", at: gapAt(s, "p", 1) })),
    /structural dependency/,
  );
});
test("Foreign sibling text and marks survive repeated Enter and Undo/Redo around it", () => {
  let s = interleave(split(fixture()));
  s = apply(
    s,
    op("C", 1, {
      kind: "insert",
      at: gapAt(s, "code", 6),
      text: "peer",
      marks: [{ type: "strong" }],
    }),
  );
  const foreign = text(s, "code");
  for (let seq = 1; seq <= 9; seq += 3) {
    s = apply(s, op("B", seq, { kind: "proseEnter", at: gapAt(s, "p", 1) }));
    s = apply(s, op("B", seq + 1, { kind: "undo", target: `B:s:${seq}` }));
    s = apply(s, op("B", seq + 2, { kind: "undo", target: `B:s:${seq + 1}` }));
    assert.deepEqual(text(s, "code"), foreign);
    s = JSON.parse(JSON.stringify(s));
    validate(s);
  }
});
