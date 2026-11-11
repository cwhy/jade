// SPDX-License-Identifier: MPL-2.0
import { itemMarker, listMarkers } from "@cwhy/jade-core/list-marker";
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
// Native reference: single numbered text copy into a bullet parent with ordered children.
// Only default / explicit-one start is qualified; original non-default source intent is not inferred.
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
        type: "bullet_list",
        live: true,
        children: ["before", "item", "after"],
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
const slice = {
  version: 1,
  edges: { start: "partial", end: "partial" },
  blocks: [
    {
      type: "ordered_list",
      children: [
        {
          type: "list_item",
          children: [
            {
              type: "paragraph",
              content: [{ text: "Copied item", marks: [{ type: "em" }] }],
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
const input = (explicit) => {
  const x = structuredClone(slice);
  if (explicit) x.blocks[0].order = 1;
  return x;
};
for (const offset of [0, 6, 13])
  for (const explicit of [false, true])
    test(`Reverse single numbering and caret offset=${offset} explicit=${explicit}`, () => {
      const initial = original(),
        a = op(1),
        plan = planRichInsert(
          initial,
          at(initial, "p", offset),
          input(explicit),
          a,
        );
      a.intent = plan.intent;
      let s = apply(initial, a);
      validate(s);
      const target = offset === 0 ? "p" : `${a.id}:cut:list-tail`,
        list = offset === 0 ? "list" : "children",
        markers = listMarkers(s, list);
      assert.equal(itemMarker(s, owner(s, target).id), "ordered_list");
      assert.equal(markers.find((m) => m.id === owner(s, target).id).number, 1);
      assert.equal(
        body(s, target),
        "Copied item" + "Parent suffix".slice(offset),
      );
      assert.deepEqual(plan.after, gapAt(s, target, 11));
      assert.deepEqual(text(s, "cp"), text(initial, "cp"));
      assert.equal(
        listMarkers(s, "children").find((m) => m.id === "child").number,
        offset === 0 ? 1 : 2,
      );
      const all = Object.values(s.nodes)
        .filter((n) => n.live && n.text)
        .flatMap((n) => text(s, n.id));
      for (const atom of text(initial, "p"))
        assert.deepEqual(
          all.find((a) => a.id === atom.id),
          atom,
        );
      const after = full(s, s.root);
      s = apply(s, op(2, { kind: "undo", target: a.id }));
      validate(s);
      assert.equal(full(s, s.root), full(initial, initial.root));
      assert.deepEqual(text(s, "p"), text(initial, "p"));
      assert.equal(itemMarker(s, "item"), "bullet_list");
      assert.equal(listMarkers(s, "children")[0].number, 1);
      s = apply(s, op(3, { kind: "undo", target: "A:reference:2" }));
      validate(s);
      assert.equal(full(s, s.root), after);
    });
for (const offset of [0, 6])
  for (const peerOffset of [0, 3, 6, 13])
    for (const first of [false, true])
      for (const undo of ["AB", "BA"])
        for (const explicit of [false, true])
          test(`Reverse independent Enter offset=${offset} peer=${peerOffset} first=${first} undo=${undo} explicit=${explicit}`, () => {
            const initial = original(),
              a = op(1),
              b = peer(1),
              anchor = anchorAt(initial, "p", 0, 13);
            a.intent = planRichInsert(
              initial,
              at(initial, "p", offset),
              input(explicit),
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
            const after = full(s, s.root);
            for (const who of undo)
              s = apply(
                s,
                who === "A"
                  ? op(2, { kind: "undo", target: a.id })
                  : peer(2, { kind: "undo", target: b.id }),
              );
            validate(s);
            for (const id of ["p", "bp", "ap", "cp"])
              assert.deepEqual(text(s, id), text(initial, id));
            assert.deepEqual(
              resolveAnchor(s, anchor),
              resolveAnchor(initial, anchor),
            );
            assert.equal(full(s, s.root), full(initial, initial.root));
            for (const who of [...undo].reverse())
              s = apply(
                s,
                who === "A"
                  ? op(3, { kind: "undo", target: "A:reference:2" })
                  : peer(3, { kind: "undo", target: "B:reference:2" }),
              );
            validate(s);
            assert.equal(full(s, s.root), after);
          });
for (const offset of [0, 6])
  for (const late of [false, true])
    for (const undoOrder of ["AB", "BA"])
      test(`Reverse peer-created item stays numbered offset=${offset} late=${late} undo=${undoOrder}`, () => {
        const initial = original(),
          a = op(1);
        a.intent = planRichInsert(
          initial,
          at(initial, "p", offset),
          slice,
          a,
        ).intent;
        const pasted = apply(initial, a),
          target = offset === 0 ? "p" : `${a.id}:cut:list-tail`,
          b = peer(1);
        b.intent = planEnter(pasted, at(pasted, target, 4), b).intent;
        assert.equal(b.intent.marker, "ordered_list");
        const offline = apply(pasted, b),
          tail = `${b.id}:list-tail`,
          typing = peer(2, {
            kind: "insert",
            at: gapAt(offline, tail, 0),
            text: "Peer keeps this",
          }),
          peerAtoms = text(apply(offline, typing), tail).filter((a) =>
            a.id.startsWith("B:"),
          ),
          undo = op(2, { kind: "undo", target: a.id });
        let s = pasted;
        if (late) s = apply(s, undo);
        s = apply(s, b);
        s = apply(s, typing);
        if (!late && undoOrder === "AB") s = apply(s, undo);
        validate(s);
        assert.equal(itemMarker(s, owner(s, tail).id), "ordered_list");
        const all = Object.values(s.nodes)
          .filter((n) => n.live && n.text)
          .flatMap((n) => text(s, n.id));
        for (const atom of peerAtoms)
          assert.deepEqual(
            all.find((a) => a.id === atom.id),
            atom,
          );
        s = apply(s, peer(3, { kind: "undo", target: typing.id }));
        s = apply(s, peer(4, { kind: "undo", target: b.id }));
        if (!late && undoOrder === "BA") s = apply(s, undo);
        validate(s);
        assert.equal(full(s, s.root), full(initial, initial.root));
        assert.deepEqual(text(s, "p"), text(initial, "p"));
      });
for (const variant of [
  "nondefault",
  "multiple-attached",
  "nested-source",
  "bullet-children",
])
  test(`Unqualified reverse shape rejects unchanged ${variant}`, () => {
    const s = original(),
      before = structuredClone(s),
      x = structuredClone(slice);
    if (variant === "nondefault") x.blocks[0].order = 3;
    if (variant === "multiple-attached") {
      const item = structuredClone(x.blocks[0].children[0]);
      item.children.push({
        type: "code",
        content: [{ text: "not qualified" }],
        language: "text",
      });
      x.blocks[0].children.push(item);
    }
    if (variant === "nested-source")
      x.blocks[0].children[0].children.push(structuredClone(x.blocks[0]));
    if (variant === "bullet-children") {
      s.nodes.children.type = "bullet_list";
      delete s.nodes.children.order;
    }
    const untouched = structuredClone(s);
    assert.throws(() => planRichInsert(s, at(s, "p", 6), x, op(1)));
    assert.deepEqual(s, untouched);
  });

test("Reverse start beside an existing ordered run remains guarded", () => {
  const s = original();
  s.nodes.before.markerBase = "ordered_list";
  const before = structuredClone(s);
  assert.throws(() => planRichInsert(s, at(s, "p", 0), slice, op(1)));
  assert.deepEqual(s, before);
});
