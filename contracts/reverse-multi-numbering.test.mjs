// SPDX-License-Identifier: MPL-2.0
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
import { planRichInsert, copyRange } from "@cwhy/jade-core/commands";
import { listMarkers } from "@cwhy/jade-core/list-marker";
const initial = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["list"] },
      list: { id: "list", type: "bullet_list", live: true, children: ["item"] },
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
    },
    {
      p: [{ text: "Export change:", marks: [{ type: "strong" }] }],
      cp: [{ text: "Existing child" }],
    },
  );
const command = (seq, intent) => ({
  id: `A:run:${seq}`,
  actor: "A",
  stream: "run",
  seq,
  epoch: 1,
  intent,
});
const source = (start, count = 2) => ({
  version: 1,
  edges: { start: "partial", end: "partial" },
  blocks: [
    {
      type: "ordered_list",
      order: start,
      children: Array.from({ length: count }, (_, i) => ({
        type: "list_item",
        children: [
          {
            type: "paragraph",
            content: [
              { text: i ? "Second" : "First", marks: [{ type: "em" }] },
            ],
          },
        ],
      })),
    },
  ],
});
for (const offset of [0, 6, 14])
  for (const start of [1, 5])
    test(`Reverse multi exact numbers, placement, caret and Undo offset=${offset} start=${start}`, () => {
      const s = initial(),
        op = command(1),
        before = structuredClone(s),
        anchor = anchorAt(s, "p", 0, 14),
        plan = planRichInsert(
          s,
          captureRange(s, { block: "p", offset }, { block: "p", offset }),
          source(start),
          op,
        );
      op.intent = plan.intent;
      const next = apply(s, op);
      validate(next);
      const body = (id) =>
        text(next, id)
          .map((a) => a.char)
          .join("");
      const markers = listMarkers(next, offset === 0 ? "list" : "children");
      assert.deepEqual(
        markers.slice(0, 2).map((m) => [m.type, m.number]),
        [
          ["ordered_list", start],
          ["ordered_list", start + 1],
        ],
      );
      const first = next.nodes[markers[0].id],
        second = next.nodes[markers[1].id];
      assert.equal(body(first.children[0]), "First");
      assert.equal(
        body(second.children[0]),
        "Second" + "Export change:".slice(offset),
      );
      assert.deepEqual(plan.after, gapAt(next, second.children[0], 6));
      if (offset === 0) {
        assert.equal(second.children[1], "children");
        assert.equal(listMarkers(next, "children")[0].number, 1);
      } else {
        assert.equal(body("p"), "Export change:".slice(0, offset));
        assert.equal(listMarkers(next, "list")[0].type, "bullet_list");
        assert.equal(markers[2].number, start + 2);
      }
      const originalIds = new Set(text(before, "p").map((a) => a.id));
      const surviving = Object.values(next.nodes)
        .filter((n) => n.live && n.text)
        .flatMap((n) => text(next, n.id))
        .filter((a) => originalIds.has(a.id));
      assert.deepEqual(surviving, text(before, "p"));
      const copied = copyRange(
        next,
        captureRange(
          next,
          { block: first.children[0], offset: 0 },
          {
            block: second.children[0],
            offset: body(second.children[0]).length,
          },
        ),
      );
      assert.equal(copied.fragment.blocks[0].order, start);
      assert.equal(copied.fragment.blocks[0].children.length, 2);
      const restored = apply(next, command(2, { kind: "undo", target: op.id }));
      validate(restored);
      assert.deepEqual(text(restored, "p"), text(before, "p"));
      assert.deepEqual(text(restored, "cp"), text(before, "cp"));
      assert.deepEqual(
        resolveAnchor(restored, anchor),
        resolveAnchor(before, anchor),
      );
      assert.equal(listMarkers(restored, "list")[0].type, "bullet_list");
      assert.equal(listMarkers(restored, "children")[0].number, 1);
      const redone = apply(
        restored,
        command(3, { kind: "undo", target: "A:run:2" }),
      );
      validate(redone);
      assert.deepEqual(
        listMarkers(redone, offset === 0 ? "list" : "children"),
        markers,
      );
    });
for (const field of ["placement", "start", "identity", "duplicate", "active"])
  test(`Decoded restart ledger rejects invalid ${field}`, () => {
    const s = initial(),
      layer = { id: "bad", value: 5, active: true };
    s.nodes.p.listStartLayers = [layer];
    if (field === "placement") {
      delete s.nodes.p.listStartLayers;
      s.nodes.item.listStartLayers = [layer];
    }
    if (field === "start") layer.value = 0;
    if (field === "identity") layer.id = "";
    if (field === "duplicate") s.nodes.p.listStartLayers.push({ ...layer });
    if (field === "active") layer.active = 1;
    assert.throws(() => validate(s));
  });
for (const kind of ["listRunStart", "listRunStartActive"])
  test(`Run restart reducer is not a public mutation ${kind}`, () => {
    const s = initial(),
      before = structuredClone(s);
    assert.throws(() =>
      apply(
        s,
        command(1, {
          kind,
          block: "p",
          start: 5,
          target: "fake",
          active: false,
        }),
      ),
    );
    assert.deepEqual(s, before);
  });

test("Copy splits adjacent ordered runs when an explicit restart changes the number", () => {
  const s = initial();
  s.nodes.item.markerBase = "ordered_list";
  s.nodes.p.listStartLayers = [{ id: "first-restart", value: 5, active: true }];
  s.nodes.list.children.push("item2");
  s.nodes.item2 = {
    id: "item2",
    type: "list_item",
    live: true,
    markerBase: "ordered_list",
    children: ["p2"],
  };
  // Seed a second paragraph replica, then carry the qualified decoded ledger.
  const nodes = structuredClone(s.nodes);
  for (const n of Object.values(nodes)) delete n.text;
  nodes.p2 = {
    id: "p2",
    type: "paragraph",
    live: true,
    listStartLayers: [{ id: "second-restart", value: 20, active: true }],
  };
  const state = seed(nodes, {
    p: [{ text: "First run" }],
    cp: [{ text: "Nested" }],
    p2: [{ text: "Second run" }],
  });
  validate(state);
  const result = copyRange(
    state,
    captureRange(state, { block: "p", offset: 0 }, { block: "p2", offset: 10 }),
  );
  assert.deepEqual(
    result.fragment.blocks.map((b) => b.order),
    [5, 20],
  );
  assert.deepEqual(
    result.fragment.blocks.map((b) => b.children.length),
    [1, 1],
  );
});
