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
const slice = {
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
for (const offset of [0, 6])
  test(`Observed mixed bullet into numbered parent offset=${offset}`, () => {
    const before = original(),
      a = op(1),
      range = captureRange(
        before,
        { block: "p", offset },
        { block: "p", offset },
      );
    const plan = planRichInsert(before, range, slice, a);
    let s = apply(before, { ...a, intent: plan.intent });
    validate(s);
    assert.deepEqual(text(s, "cp"), text(before, "cp"));
    assert.equal(s.nodes.children.type, "ordered_list");
    assert.equal(s.nodes.children.order, 1);
    assert.ok(s.nodes.children.children.includes("child"));
    assert.equal(s.nodes.item.live, true);
    assert.deepEqual(text(s, "bp"), text(before, "bp"));
    assert.deepEqual(text(s, "ap"), text(before, "ap"));
    assert.equal(owner(s, "before").type, "ordered_list");
    assert.equal(owner(s, "after").type, "ordered_list");
    if (offset === 0) {
      assert.equal(body(s, "p"), "Copied bulletParent suffix");
      assert.equal(itemMarker(s, "item"), "bullet_list");
      assert.deepEqual(s.nodes.item.children, ["p", "children"]);
    } else {
      assert.equal(body(s, "p"), "Parent");
      assert.equal(itemMarker(s, "item"), "ordered_list");
      const children = s.nodes.children.children;
      assert.equal(children.length, 2);
      assert.equal(itemMarker(s, children[0]), "bullet_list");
      assert.equal(itemMarker(s, children[1]), "ordered_list");
      assert.equal(
        body(s, s.nodes[children[0]].children[0]),
        "Copied bullet suffix",
      );
      assert.equal(children[1], "child");
    }
    // Existing suffix characters and marks remain their original contributions.
    const sourceAtoms = text(before, "p");
    const survivors = Object.values(s.nodes)
      .filter((n) => n.live && n.text)
      .flatMap((n) => text(s, n.id));
    for (const atom of sourceAtoms)
      assert.deepEqual(
        survivors.find((a) => a.id === atom.id),
        atom,
      );
    const result = full(s, s.root);
    s = apply(s, op(2, { kind: "undo", target: a.id }));
    validate(s);
    assert.deepEqual(text(s, "p"), text(before, "p"));
    assert.deepEqual(s.nodes.doc.children, ["list"]);
    assert.deepEqual(s.nodes.list.children, ["before", "item", "after"]);
    assert.deepEqual(s.nodes.item.children, ["p", "children"]);
    s = apply(s, op(3, { kind: "undo", target: "A:reference:2" }));
    validate(s);
    assert.equal(full(s, s.root), result);
  });

const peer = (seq, intent) => ({
  id: `B:reference:${seq}`,
  actor: "B",
  stream: "reference",
  seq,
  epoch: 1,
  intent,
});
for (const offset of [0, 6])
  for (const peerOffset of [0, 3, 6, 13])
    for (const first of [false, true])
      for (const undo of ["AB", "BA"])
        test(`Mixed grouping parent Enter paste=${offset} enter=${peerOffset} peerFirst=${first} undo=${undo}`, () => {
          const before = original(),
            a = op(1),
            b = peer(1),
            at = (n) =>
              captureRange(
                before,
                { block: "p", offset: n },
                { block: "p", offset: n },
              ),
            anchor = anchorAt(before, "p", 0, 13);
          a.intent = planRichInsert(before, at(offset), slice, a).intent;
          b.intent = planEnter(before, at(peerOffset), b).intent;
          const step = (state, event, label) => {
            try {
              return apply(state, event);
            } catch (e) {
              throw new Error(label + ": " + e.message, { cause: e });
            }
          };
          let s = first
            ? step(step(before, b, "accept B"), a, "accept A after B")
            : step(step(before, a, "accept A"), b, "accept B after A");
          validate(s);
          const expected = full(s, s.root);
          for (const who of undo)
            s = step(
              s,
              who === "A"
                ? op(2, { kind: "undo", target: a.id })
                : peer(2, { kind: "undo", target: b.id }),
              "undo " + who,
            );
          validate(s);
          for (const id of ["p", "cp", "bp", "ap"])
            assert.deepEqual(text(s, id), text(before, id));
          assert.deepEqual(s.nodes.list.children, ["before", "item", "after"]);
          assert.deepEqual(s.nodes.item.children, ["p", "children"]);
          assert.deepEqual(
            resolveAnchor(s, anchor),
            resolveAnchor(before, anchor),
          );
          for (const who of [...undo].reverse())
            s = step(
              s,
              who === "A"
                ? op(3, { kind: "undo", target: "A:reference:2" })
                : peer(3, { kind: "undo", target: "B:reference:2" }),
              "redo " + who,
            );
          validate(s);
          assert.equal(full(s, s.root), expected);
        });

for (const offset of [0, 6])
  for (const undo of ["AB", "BA"])
    test(`Confirmed peer-created bullet survives original paste Undo offset=${offset} undo=${undo}`, () => {
      const before = original(),
        a = op(1),
        at = captureRange(
          before,
          { block: "p", offset },
          { block: "p", offset },
        );
      a.intent = planRichInsert(before, at, slice, a).intent;
      let s = apply(before, a);
      const target = offset === 0 ? "p" : `${a.id}:cut:list-tail`,
        b = peer(1),
        range = captureRange(
          s,
          { block: target, offset: 6 },
          { block: target, offset: 6 },
        );
      b.intent = planEnter(s, range, b).intent;
      assert.equal(b.intent.marker, "bullet_list");
      s = apply(s, b);
      const item = `${b.id}:list-item`,
        tail = `${b.id}:list-tail`;
      s = apply(
        s,
        peer(2, {
          kind: "insert",
          at: gapAt(s, tail, 0),
          text: "Peer keeps this",
        }),
      );
      const peerAtoms = text(s, tail).filter((a) => a.id.startsWith("B:"));
      assert.equal(itemMarker(s, item), "bullet_list");
      // Undo text separately as a normal user action. First test paste Undo while
      // peer-created content is still present, then the two Enter/Paste Undo orders.
      if (undo === "AB") {
        s = apply(s, op(2, { kind: "undo", target: a.id }));
        assert.equal(itemMarker(s, item), "bullet_list");
        const all = Object.values(s.nodes)
          .filter((n) => n.live && n.text)
          .flatMap((n) => text(s, n.id));
        for (const atom of peerAtoms)
          assert.deepEqual(
            all.find((x) => x.id === atom.id),
            atom,
          );
      }
      s = apply(s, peer(3, { kind: "undo", target: "B:reference:2" }));
      s = apply(s, peer(4, { kind: "undo", target: b.id }));
      if (undo === "BA") s = apply(s, op(2, { kind: "undo", target: a.id }));
      validate(s);
      assert.deepEqual(text(s, "p"), text(before, "p"));
      assert.equal(itemMarker(s, "item"), "ordered_list");
      assert.deepEqual(s.nodes.children.children, ["child"]);
    });

for (const offset of [0, 6])
  test(`Offline peer Enter and typing delivered after paste Undo offset=${offset}`, () => {
    const initial = original(),
      a = op(1),
      r = captureRange(initial, { block: "p", offset }, { block: "p", offset });
    a.intent = planRichInsert(initial, r, slice, a).intent;
    const pasted = apply(initial, a),
      target = offset === 0 ? "p" : `${a.id}:cut:list-tail`,
      b = peer(1);
    b.intent = planEnter(
      pasted,
      captureRange(
        pasted,
        { block: target, offset: 6 },
        { block: target, offset: 6 },
      ),
      b,
    ).intent;
    const offline = apply(pasted, b),
      tail = `${b.id}:list-tail`,
      typing = peer(2, {
        kind: "insert",
        at: gapAt(offline, tail, 0),
        text: "Peer keeps this",
      });
    let s = apply(pasted, op(2, { kind: "undo", target: a.id }));
    s = apply(s, b);
    try {
      s = apply(s, typing);
    } catch (e) {
      console.log(
        JSON.stringify(
          {
            offset,
            gap: typing.intent.at,
            replicas: Object.keys(s.replicas),
            runs: Object.keys(s.runs),
            boundaries: Object.keys(s.boundaries),
          },
          null,
          2,
        ),
      );
      throw e;
    }
    assert.equal(itemMarker(s, `${b.id}:list-item`), "bullet_list");
    assert.ok(body(s, tail).includes("Peer keeps this"));
    validate(s);
  });

for (const kind of ["listMarker", "listMarkerActive"])
  test(`Raw marker lifecycle is not public ${kind}`, () => {
    const s = original(),
      before = structuredClone(s);
    assert.throws(() =>
      apply(
        s,
        op(1, {
          kind,
          item: "item",
          type: "bullet_list",
          target: "fake",
          active: true,
        }),
      ),
    );
    assert.deepEqual(s, before);
  });
for (const marker of ["invalid", null, 0])
  test(`Invalid inherited marker rejects unchanged ${marker}`, () => {
    const s = original(),
      before = structuredClone(s);
    assert.throws(() =>
      apply(s, op(1, { kind: "listEnter", at: gapAt(s, "p", 3), marker })),
    );
    assert.deepEqual(s, before);
  });
for (const bad of ["base", "node", "duplicate", "active", "type"])
  test(`Decoded marker ledger validation ${bad}`, () => {
    const s = original();
    if (bad === "base") s.nodes.item.markerBase = "invalid";
    else if (bad === "node") s.nodes.p.markerBase = "bullet_list";
    else {
      s.nodes.item.markerLayers = [
        { id: "x", type: "bullet_list", active: true },
      ];
      if (bad === "duplicate")
        s.nodes.item.markerLayers.push({ ...s.nodes.item.markerLayers[0] });
      if (bad === "active") s.nodes.item.markerLayers[0].active = 1;
      if (bad === "type") s.nodes.item.markerLayers[0].type = "invalid";
    }
    assert.throws(() => validate(s));
  });
test("Rich copy projects peer bullet and original numbered child as separate groups", () => {
  const initial = original(),
    a = op(1),
    r = captureRange(
      initial,
      { block: "p", offset: 6 },
      { block: "p", offset: 6 },
    );
  a.intent = planRichInsert(initial, r, slice, a).intent;
  let s = apply(initial, a);
  const target = `${a.id}:cut:list-tail`,
    b = peer(1);
  b.intent = planEnter(
    s,
    captureRange(s, { block: target, offset: 6 }, { block: target, offset: 6 }),
    b,
  ).intent;
  s = apply(s, b);
  const tail = `${b.id}:list-tail`;
  s = apply(
    s,
    peer(2, { kind: "insert", at: gapAt(s, tail, 0), text: "Keep" }),
  );
  s = apply(s, op(2, { kind: "undo", target: a.id }));
  const copied = copyRange(
    s,
    captureRange(s, { block: tail, offset: 0 }, { block: "cp", offset: 5 }),
  );
  assert.deepEqual(
    copied.fragment.blocks.map((b) => b.type),
    ["bullet_list", "ordered_list"],
  );
  assert.equal(copied.fragment.blocks[1].order, 1);
  assert.doesNotMatch(
    JSON.stringify(copied.fragment),
    /markerBase|markerLayers|reference:/,
  );
  assert.match(copied.html, /<ul>/);
  assert.match(copied.html, /<ol start="1">/);
});

test("Unqualified reverse marker conversion rejects without changing the document", () => {
  const s = original(),
    r = captureRange(s, { block: "p", offset: 0 }, { block: "p", offset: 0 }),
    a = op(1),
    n = apply(s, { ...a, intent: planRichInsert(s, r, slice, a).intent }),
    before = structuredClone(n),
    input = structuredClone(slice);
  input.blocks[0].type = "ordered_list";
  input.blocks[0].order = 1;
  assert.throws(() =>
    planRichInsert(
      n,
      captureRange(n, { block: "p", offset: 1 }, { block: "p", offset: 1 }),
      input,
      op(2),
    ),
  );
  assert.deepEqual(n, before);
});

test("Undone marker contribution does not block removal of an owned pasted forest", () => {
  const initial = original(),
    a = op(1),
    paragraph = (text) => ({
      type: "paragraph",
      content: [{ text, marks: [] }],
    }),
    input = {
      version: 1,
      edges: { start: "partial", end: "partial" },
      blocks: [
        {
          type: "ordered_list",
          order: 1,
          children: [
            {
              type: "list_item",
              children: [
                paragraph("new"),
                {
                  type: "ordered_list",
                  order: 1,
                  children: [
                    { type: "list_item", children: [paragraph("nested")] },
                  ],
                },
              ],
            },
            { type: "list_item", children: [paragraph("last")] },
          ],
        },
      ],
    };
  a.intent = planRichInsert(
    initial,
    captureRange(initial, { block: "p", offset: 6 }, { block: "p", offset: 6 }),
    input,
    a,
  ).intent;
  let s = apply(initial, a);
  const target = Object.values(s.nodes).find(
      (n) => n.live && n.type === "paragraph" && body(s, n.id) === "new",
    ).id,
    b = peer(1);
  b.intent = planRichInsert(
    s,
    captureRange(s, { block: target, offset: 0 }, { block: target, offset: 0 }),
    slice,
    b,
  ).intent;
  s = apply(s, b);
  s = apply(s, peer(2, { kind: "undo", target: b.id }));
  s = apply(s, op(2, { kind: "undo", target: a.id }));
  assert.deepEqual(text(s, "p"), text(initial, "p"));
  assert.deepEqual(s.nodes.children.children, ["child"]);
  validate(s);
});
