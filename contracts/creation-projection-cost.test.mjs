// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { immutable } from "@cwhy/jade-core/immutability";
import { captureRange } from "@cwhy/jade-core/selection";
import { planRichInsert, planEnter } from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
function initial() {
  return immutable(
    seed(
      {
        doc: {
          id: "doc",
          type: "doc",
          live: true,
          children: ["list", "q", "asset"],
        },
        list: {
          id: "list",
          type: "ordered_list",
          live: true,
          children: ["item"],
        },
        item: { id: "item", type: "list_item", live: true, children: ["p"] },
        p: { id: "p", type: "paragraph", live: true },
        q: { id: "q", type: "paragraph", live: true },
        asset: { id: "asset", type: "image", live: true, asset: "mock.png" },
      },
      { p: [{ text: "Target" }], q: [{ text: "Other" }] },
    ),
  );
}
const para = "A:s:1:attached:paragraph";
const range = (s, id, n) =>
  captureRange(s, { block: id, offset: n }, { block: id, offset: n });
function paste(s, type) {
  return op(
    "A",
    1,
    planRichInsert(
      s,
      range(s, "p", 6),
      {
        version: 1,
        edges: { start: "boundary", end: "boundary" },
        blocks: [
          {
            type: "ordered_list",
            children: [
              {
                type: "list_item",
                children: [
                  {
                    type: "paragraph",
                    content: [{ text: "Copied", marks: [] }],
                  },
                  type === "image"
                    ? { type: "image", asset: "mock.png" }
                    : {
                        type: "code",
                        language: "text",
                        content: [{ text: "code", marks: [] }],
                      },
                ],
              },
            ],
          },
        ],
      },
      op("A", 1),
    ).intent,
  );
}
function step(s, o) {
  const before = JSON.stringify(s),
    fast = immutable(apply(s, o)),
    slow = apply(JSON.parse(before), JSON.parse(JSON.stringify(o)));
  validate(fast);
  validate(slow);
  assert.deepEqual(
    fast,
    slow,
    "sealed dependency shortcut must equal full decoded-state projection",
  );
  assert.equal(JSON.stringify(s), before, "predecessor is unchanged");
  return fast;
}
for (const type of ["image", "code"])
  test(`Unrelated typing preserves node and boundary maps across dormant ${type} birth`, () => {
    let s = initial(),
      a = paste(s, type);
    s = step(s, a);
    s = step(s, op("A", 2, { kind: "undo", target: a.id }));
    const nodes = s.nodes,
      boundaries = s.boundaries,
      creations = s.creations;
    for (let i = 0; i < 12; i++) {
      s = step(
        s,
        op("B", i + 1, { kind: "insert", at: gapAt(s, "q", 5 + i), text: "x" }),
      );
      assert.equal(s.nodes, nodes);
      assert.equal(s.boundaries, boundaries);
      assert.equal(s.creations, creations);
    }
  });
for (const type of ["image", "code"])
  for (const enter of [false, true])
    test(`Hidden-origin revival, dependency typing and release use equivalent projections ${type} Enter=${enter}`, () => {
      let s = initial(),
        a = paste(s, type);
      s = step(s, a);
      const pasted = s;
      let authored = s,
        queue = [];
      if (enter) {
        const e = op(
          "B",
          1,
          planEnter(authored, range(authored, para, 3), op("B", 1)).intent,
        );
        authored = immutable(apply(authored, e));
        queue.push(e);
      }
      const target = enter ? "B:s:1:list-tail" : para,
        b = op("B", queue.length + 1, {
          kind: "insert",
          at: gapAt(authored, target, 0),
          text: "peer",
        });
      queue.push(b);
      s = step(s, op("A", 2, { kind: "undo", target: a.id }));
      const hidden = s.nodes;
      for (const e of queue) s = step(s, e);
      assert.notEqual(s.nodes, hidden);
      const visible = s.nodes,
        c = op("C", 1, { kind: "insert", at: gapAt(s, target, 4), text: "!" });
      s = step(s, c);
      assert.equal(
        s.nodes,
        visible,
        "unchanged dependency visibility should not invalidate the tree",
      );
      s = step(s, op("C", 2, { kind: "undo", target: c.id }));
      for (const [i, e] of queue.toReversed().entries())
        s = step(
          s,
          op("B", queue.length + i + 1, { kind: "undo", target: e.id }),
        );
      assert.equal(s.nodes[para].live, false);
      assert.equal(s.nodes["A:s:1:attached:item"].live, false);
      s = step(s, op("A", 3, { kind: "undo", target: "A:s:2" }));
      assert.deepEqual(text(s, para), text(pasted, para));
    });
for (const field of ["creation", "live"])
  test(`Decoded mutation of ${field} cannot reuse a sealed creation certificate`, () => {
    let s = initial(),
      a = paste(s, "image");
    s = step(s, a);
    s = step(s, op("A", 2, { kind: "undo", target: a.id }));
    validate(s);
    const forged = JSON.parse(JSON.stringify(s));
    if (field === "creation") forged.nodes[para].creation = "not-a-birth";
    else forged.nodes[para].live = true;
    assert.throws(() => validate(forged), /creation|Creation|Orphan|replica/);
  });
