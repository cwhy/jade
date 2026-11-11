// SPDX-License-Identifier: MPL-2.0
import { itemMarker } from "@cwhy/jade-core/list-marker";
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { planRichInsert, planEnter, copyRange } from "@cwhy/jade-core/commands";
// Only the two observed single-bullet cases are normative here. The source
// represents the full selected text, including its bullet block type.
const op = (seq, intent) => ({
  id: `A:reference:${seq}`,
  actor: "A",
  stream: "reference",
  seq,
  epoch: 1,
  intent,
});
const original = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["list"] },
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["before", "item", "after"],
        order: 2,
      },
      before: { id: "before", type: "list_item", live: true, children: ["bp"] },
      bp: { id: "bp", type: "paragraph", live: true },
      item: {
        id: "item",
        type: "list_item",
        live: true,
        children: ["p", "children"],
      },
      p: { id: "p", type: "paragraph", live: true },
      children: {
        id: "children",
        type: "ordered_list",
        live: true,
        children: ["child"],
        order: 1,
      },
      child: { id: "child", type: "list_item", live: true, children: ["cp"] },
      cp: { id: "cp", type: "paragraph", live: true },
      after: { id: "after", type: "list_item", live: true, children: ["ap"] },
      ap: { id: "ap", type: "paragraph", live: true },
    },
    {
      bp: [{ text: "Before" }],
      p: [{ text: "Parent suffix", marks: [{ type: "strong" }] }],
      cp: [{ text: "Existing child" }],
      ap: [{ text: "After" }],
    },
  );
const oneSlice = {
  version: 1,
  edges: { start: "partial", end: "partial" },
  blocks: [
    {
      type: "bullet_list",
      children: [
        {
          type: "list_item",
          children: [
            {
              type: "paragraph",
              content: [{ text: "Copied bullet", marks: [{ type: "em" }] }],
            },
          ],
        },
      ],
    },
  ],
};
const owner = (s, id) =>
  Object.values(s.nodes).find((n) => n.live && n.children?.includes(id));
const body = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const full = (s, id) =>
  s.nodes[id].text
    ? body(s, id)
    : (s.nodes[id].children || []).map((x) => full(s, x)).join("|");

const peer = (seq, intent) => ({
  id: `B:reference:${seq}`,
  actor: "B",
  stream: "reference",
  seq,
  epoch: 1,
  intent,
});
const at = (s, block, offset) =>
  captureRange(s, { block, offset }, { block, offset });
const setup = (reverse, count) => {
  const s = original();
  if (reverse) {
    s.nodes.list.type = "bullet_list";
    s.nodes.children.type = "bullet_list";
    delete s.nodes.list.order;
    delete s.nodes.children.order;
  }
  const slice = structuredClone(oneSlice);
  slice.blocks[0].type = reverse ? "ordered_list" : "bullet_list";
  if (reverse) slice.blocks[0].order = 4;
  slice.blocks[0].children = Array.from({ length: count }, (_, i) => ({
    type: "list_item",
    children: [
      {
        type: "paragraph",
        content: [{ text: `Copied ${i}`, marks: [{ type: "em" }] }],
      },
    ],
  }));
  return { s, slice };
};
for (const reverse of [false])
  for (const count of [1, 2, 3])
    for (const offset of [0, 6, 13])
      test(`Expansion plain reverse=${reverse} count=${count} offset=${offset}`, () => {
        const { s: initial, slice } = setup(reverse, count),
          a = op(1);
        a.intent = planRichInsert(
          initial,
          at(initial, "p", offset),
          slice,
          a,
        ).intent;
        let s = apply(initial, a);
        validate(s);
        const after = full(s, s.root);
        for (let i = 0; i < count; i++) {
          const p = Object.values(s.nodes).find(
            (n) => n.live && n.text && body(s, n.id).includes(`Copied ${i}`),
          );
          assert.ok(p);
          assert.equal(itemMarker(s, owner(s, p.id).id), slice.blocks[0].type);
        }
        s = apply(s, op(2, { kind: "undo", target: a.id }));
        validate(s);
        assert.equal(full(s, s.root), full(initial, initial.root));
        assert.deepEqual(text(s, "p"), text(initial, "p"));
        s = apply(s, op(3, { kind: "undo", target: "A:reference:2" }));
        validate(s);
        assert.equal(full(s, s.root), after);
      });
for (const reverse of [false])
  for (const count of [2, 3])
    for (const offset of [0, 6])
      for (const index of Array.from({ length: count }, (_, i) => i))
        for (const late of [false, true])
          test(`Expansion peer inside pasted item reverse=${reverse} count=${count} offset=${offset} index=${index} late=${late}`, () => {
            const { s: initial, slice } = setup(reverse, count),
              a = op(1);
            a.intent = planRichInsert(
              initial,
              at(initial, "p", offset),
              slice,
              a,
            ).intent;
            const pasted = apply(initial, a),
              p = Object.values(pasted.nodes).find(
                (n) =>
                  n.live &&
                  n.text &&
                  body(pasted, n.id).includes(`Copied ${index}`),
              ).id,
              b = peer(1);
            b.intent = planEnter(pasted, at(pasted, p, 3), b).intent;
            let offline = apply(pasted, b),
              tail = `${b.id}:list-tail`;
            const typing = peer(2, {
                kind: "insert",
                at: gapAt(offline, tail, 0),
                text: "Peer",
              }),
              undo = op(2, { kind: "undo", target: a.id });
            let s = pasted;
            if (late) s = apply(s, undo);
            s = apply(s, b);
            s = apply(s, typing);
            if (!late) s = apply(s, undo);
            validate(s);
            assert.equal(
              itemMarker(s, `${b.id}:list-item`),
              slice.blocks[0].type,
            );
            assert.ok(body(s, tail).includes("Peer"));
            assert.equal(
              itemMarker(s, owner(s, tail).id),
              slice.blocks[0].type,
            );
            s = apply(s, peer(3, { kind: "undo", target: typing.id }));
            s = apply(s, peer(4, { kind: "undo", target: b.id }));
            validate(s);
            assert.equal(full(s, s.root), full(initial, initial.root));
            assert.deepEqual(text(s, "p"), text(initial, "p"));
          });

for (const count of [2, 3])
  for (const offset of [0, 6, 13])
    for (const peerOffset of [0, 3, 6, 13])
      for (const first of [false, true])
        for (const undo of ["AB", "BA"])
          test(`Expansion independent Enter count=${count} offset=${offset} peer=${peerOffset} first=${first} undo=${undo}`, () => {
            const { s: initial, slice } = setup(false, count),
              a = op(1),
              b = peer(1),
              anchor = anchorAt(initial, "p", 0, 13);
            a.intent = planRichInsert(
              initial,
              at(initial, "p", offset),
              slice,
              a,
            ).intent;
            b.intent = planEnter(
              initial,
              at(initial, "p", peerOffset),
              b,
            ).intent;
            let s = first
              ? apply(apply(initial, b), a)
              : apply(apply(initial, a), b);
            validate(s);
            const result = full(s, s.root),
              atoms = Object.values(s.nodes)
                .filter((n) => n.live && n.text)
                .flatMap((n) => text(s, n.id));
            for (const id of ["p", "cp", "bp", "ap"])
              for (const atom of text(initial, id))
                assert.deepEqual(
                  atoms.find((x) => x.id === atom.id),
                  atom,
                );
            for (const who of undo)
              s = apply(
                s,
                who === "A"
                  ? op(2, { kind: "undo", target: a.id })
                  : peer(2, { kind: "undo", target: b.id }),
              );
            validate(s);
            assert.equal(full(s, s.root), full(initial, initial.root));
            assert.deepEqual(
              resolveAnchor(s, anchor),
              resolveAnchor(initial, anchor),
            );
            for (const id of ["p", "cp", "bp", "ap"])
              assert.deepEqual(text(s, id), text(initial, id));
            for (const who of [...undo].reverse())
              s = apply(
                s,
                who === "A"
                  ? op(3, { kind: "undo", target: "A:reference:2" })
                  : peer(3, { kind: "undo", target: "B:reference:2" }),
              );
            validate(s);
            assert.equal(full(s, s.root), result);
          });

for (const count of [2, 3])
  for (const offset of [0, 6, 13])
    test(`Flat bullet exact layout and caret count=${count} offset=${offset}`, () => {
      const { s: initial, slice } = setup(false, count),
        a = op(1),
        plan = planRichInsert(initial, at(initial, "p", offset), slice, a),
        s = plan.state;
      const summarize = (id) => {
        const n = s.nodes[id];
        if (n.text) return body(s, id);
        return {
          type: n.type,
          ...(n.type === "list_item" ? { marker: itemMarker(s, id) } : {}),
          children: n.children.map(summarize),
        };
      };
      const p = (t) => t,
        item = (t, marker = "ordered_list", children = []) => ({
          type: "list_item",
          marker,
          children: [t, ...children],
        }),
        existing = { type: "ordered_list", children: [item("Existing child")] };
      const copied = Array.from({ length: count }, (_, i) =>
        item(
          `Copied ${i}` +
            (i === count - 1 ? "Parent suffix".slice(offset) : ""),
          "bullet_list",
          offset === 0 && i === count - 1 ? [existing] : [],
        ),
      );
      const middle =
        offset === 0
          ? copied
          : [
              item("Parent suffix".slice(0, offset), "ordered_list", [
                {
                  type: "ordered_list",
                  children: [...copied, item("Existing child")],
                },
              ]),
            ];
      assert.deepEqual(summarize("list"), {
        type: "ordered_list",
        children: [item("Before"), ...middle, item("After")],
      });
      const end =
        s.listFamilies &&
        Object.values(s.nodes).find(
          (n) =>
            n.live && n.text && body(s, n.id).startsWith(`Copied ${count - 1}`),
        );
      assert.ok(end);
      assert.deepEqual(plan.after, gapAt(s, end.id, 8));
      for (const n of Object.values(s.nodes).filter((n) => n.live && n.text)) {
        for (const atom of text(s, n.id).filter((a) => a.id.startsWith("A:")))
          assert.deepEqual(atom.marks, [{ type: "em" }]);
      }
    });
for (const invalid of ["type", "placement"])
  test(`Inherited paragraph marker validates decoded state ${invalid}`, () => {
    const s = original();
    if (invalid === "type") s.nodes.p.listMarkerBase = "invalid";
    else s.nodes.item.listMarkerBase = "bullet_list";
    assert.throws(() => validate(s));
  });
