// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  apply as rawApply,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
const apply = (s, o) => {
  try {
    return rawApply(s, o);
  } catch (e) {
    e.message = o.id + " " + JSON.stringify(o.intent) + " :: " + e.message;
    throw e;
  }
};
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const str = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
function fixture() {
  const original = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p", "list"] },
      p: { id: "p", type: "paragraph", live: true },
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item"],
      },
      item: { id: "item", type: "list_item", live: true, children: ["ip"] },
      ip: { id: "ip", type: "paragraph", live: true },
    },
    { p: [{ text: "Sam", marks: [{ type: "em" }] }], ip: [{ text: "copied" }] },
  );
  let s = apply(
    original,
    op("P", 1, { kind: "proseEnter", at: gapAt(original, "p", 1) }),
  );
  const suffix = "P:s:1:paragraph";
  s = apply(
    s,
    op("M", 1, {
      kind: "treePlace",
      node: "list",
      from: "doc",
      parent: "doc",
      before: suffix,
      expected: null,
    }),
  );
  s = apply(
    s,
    op("M", 2, {
      kind: "treePlace",
      node: suffix,
      from: "doc",
      parent: "item",
      before: null,
      expected: null,
    }),
  );
  s = apply(
    s,
    op("M", 3, {
      kind: "treePlace",
      node: "ip",
      from: "item",
      parent: "doc",
      before: "list",
      expected: null,
    }),
  );
  return { s, original, suffix };
}
for (const offset of [0, 1, 2])
  test(`Adopted list Enter keeps visible grammar and home wrapper offset=${offset}`, () => {
    const { s, suffix } = fixture(),
      n = apply(
        s,
        op("A", 1, { kind: "listEnter", at: gapAt(s, suffix, offset) }),
      ),
      items = n.nodes.list.children;
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((id) => str(n, n.nodes[id].children[0])),
      ["am".slice(0, offset), "am".slice(offset)],
    );
    assert.equal(items[offset === 0 ? 1 : 0], "item");
    const restored = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
    assert.deepEqual(restored.nodes.list.children, ["item"]);
    assert.deepEqual(text(restored, suffix), text(s, suffix));
    validate(restored);
  });
for (const a of [0, 1, 2])
  for (const b of [0, 1, 2])
    for (const order of ["AB", "BA"])
      for (const undo of ["AB", "BA"])
        test(`Two adopted list cuts offsets=${a},${b} arrival=${order} Undo=${undo}`, () => {
          const { s, suffix } = fixture(),
            ops = {
              A: op("A", 1, { kind: "listEnter", at: gapAt(s, suffix, a) }),
              B: op("B", 1, { kind: "listEnter", at: gapAt(s, suffix, b) }),
            };
          let n = s;
          for (const actor of order) n = apply(n, ops[actor]);
          const lengths = [a, b].sort((a, b) => a - b);
          assert.deepEqual(
            n.nodes.list.children.map((id) => str(n, n.nodes[id].children[0])),
            [
              "am".slice(0, lengths[0]),
              "am".slice(lengths[0], lengths[1]),
              "am".slice(lengths[1]),
            ],
          );
          n = JSON.parse(JSON.stringify(n));
          for (const actor of undo)
            n = apply(n, op(actor, 2, { kind: "undo", target: ops[actor].id }));
          assert.deepEqual(text(n, suffix), text(s, suffix));
          assert.deepEqual(n.nodes.list.children, ["item"]);
          validate(n);
        });
for (const offset of [0, 1, 2])
  for (const early of [true, false])
    test(`Offline original suffix typing at ${offset} early=${early}`, () => {
      const { s, original, suffix } = fixture(),
        peer = op("B", 1, {
          kind: "insert",
          at: gapAt(original, "p", 1 + offset),
          text: "peer",
          marks: [{ type: "strong" }],
        }),
        enter = op("A", 1, { kind: "listEnter", at: gapAt(s, suffix, 1) });
      let n = early
        ? apply(apply(s, peer), enter)
        : apply(apply(s, enter), peer);
      n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
      assert.equal(
        str(n, suffix),
        "am".slice(0, offset) + "peer" + "am".slice(offset),
      );
      n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
      assert.deepEqual(text(n, suffix), text(s, suffix));
    });
test("Independent prefix Enter does not disturb adopted suffix region", () => {
  const { s, suffix } = fixture();
  let n = apply(s, op("A", 1, { kind: "listEnter", at: gapAt(s, suffix, 1) }));
  const list = structuredClone(n.nodes.list);
  n = apply(n, op("B", 1, { kind: "proseEnter", at: gapAt(n, "p", 0) }));
  assert.deepEqual(n.nodes.list.children, list.children);
  n = apply(n, op("B", 2, { kind: "undo", target: "B:s:1" }));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  assert.deepEqual(n.nodes.doc.children, s.nodes.doc.children);
});
test("List Enter Undo, restore placement, original split Undo and all Redos preserve exact source", () => {
  const { s, original, suffix } = fixture(),
    anchor = anchorAt(original, "p", 1, 3);
  let n = apply(s, op("A", 1, { kind: "listEnter", at: gapAt(s, suffix, 1) }));
  n = apply(n, op("A", 2, { kind: "undo", target: "A:s:1" }));
  n = apply(n, op("M", 4, { kind: "undo", target: "M:s:3" }));
  n = apply(n, op("M", 5, { kind: "undo", target: "M:s:2" }));
  n = apply(n, op("M", 6, { kind: "undo", target: "M:s:1" }));
  n = apply(n, op("P", 2, { kind: "undo", target: "P:s:1" }));
  assert.deepEqual(text(n, "p"), text(original, "p"));
  assert.deepEqual(resolveAnchor(n, anchor), resolveAnchor(original, anchor));
  n = apply(n, op("P", 3, { kind: "undo", target: "P:s:2" }));
  n = apply(n, op("M", 7, { kind: "undo", target: "M:s:6" }));
  n = apply(n, op("M", 8, { kind: "undo", target: "M:s:5" }));
  n = apply(n, op("M", 9, { kind: "undo", target: "M:s:4" }));
  n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
  assert.deepEqual(
    n.nodes.list.children.map((id) => str(n, n.nodes[id].children[0])),
    ["a", "m"],
  );
  validate(n);
});
for (const mutation of [
  "missing-region",
  "overlap",
  "home-pin",
  "region-order",
  "separated-placement",
])
  test(`Decoded flow validation rejects malformed ${mutation}`, () => {
    const { s, suffix } = fixture();
    let n = apply(
      s,
      op("A", 1, { kind: "listEnter", at: gapAt(s, suffix, 1) }),
    );
    n = JSON.parse(JSON.stringify(n));
    const f = Object.values(n.listFamilies).find((f) => f.kind === "flow");
    if (mutation === "missing-region") f.regions = [];
    if (mutation === "overlap")
      f.regions[1].layout.blocks = f.regions[0].layout.blocks;
    if (mutation === "home-pin") f.homePins[0].before.push("unknown-cut");
    if (mutation === "region-order") f.regions[0].order.push("unknown-cut");
    if (mutation === "separated-placement")
      Object.values(f.cuts)[0].separatedPlacement = {
        parent: "unknown-parent",
        after: null,
        before: null,
      };
    assert.throws(() => validate(n), /flow|Flow|separated/);
  });

for (const replacement of ["p", "missing"])
  test(`Decoded active wrapper assignment rejects ${replacement}`, () => {
    const { s, suffix } = fixture();
    let n = apply(
      s,
      op("A", 1, { kind: "listEnter", at: gapAt(s, suffix, 1) }),
    );
    n = JSON.parse(JSON.stringify(n));
    const f = Object.values(n.listFamilies).find((f) => f.kind === "flow"),
      r = f.regions.find((r) => r.kind === "list");
    r.wrappers["A:s:1:cut"] = replacement;
    assert.throws(() => validate(n), /wrapper assignment/);
  });
