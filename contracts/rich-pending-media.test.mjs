// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, gapAt, text } from "@cwhy/jade-core/model";
import { validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planRichInsert,
  previewCellPaste,
  planPasteCells,
  planImageSize,
  previewImageSize,
  planListIndent,
} from "@cwhy/jade-core/commands";
import { validateGridFragment } from "@cwhy/jade-core/grid-fragment";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  stream: "s",
  seq,
  id: `${actor}:s:${seq}`,
  epoch: 1,
  intent,
});
const paragraph = (text) => ({
  type: "paragraph",
  content: [{ text, marks: ["strong"] }],
});
const image = (i) => ({
  type: "image",
  slot: `mock-rich-image-${i.toString().padStart(4, "0")}`,
  width: 90,
  height: 45,
  displayWidth: 96,
  alt: "Mock image",
});
function fixture(kind) {
  const cell = kind !== "body",
    list = kind === "item";
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children: cell ? ["table"] : ["p"],
    },
    p: { id: "p", type: "paragraph", live: true },
  };
  if (cell)
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: [list ? "list" : "p"],
      },
    });
  if (list)
    Object.assign(nodes, {
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item", "next"],
      },
      item: { id: "item", type: "list_item", live: true, children: ["p"] },
      next: { id: "next", type: "list_item", live: true, children: ["q"] },
      q: { id: "q", type: "paragraph", live: true },
    });
  return seed(nodes, {
    p: [{ text: "abcdef", marks: ["em"] }],
    ...(list ? { q: [{ text: "Next" }] } : {}),
  });
}
function paste(s, kind) {
  const a = op("A", 1),
    blocks =
      kind === "item"
        ? [
            {
              type: "ordered_list",
              children: [
                {
                  type: "list_item",
                  children: [paragraph("Copied"), image(0)],
                },
              ],
            },
          ]
        : [
            paragraph("Copied"),
            image(0),
            {
              type: "code",
              language: "text",
              content: [{ text: "hello()", marks: [] }],
            },
            image(1),
            paragraph("Tail"),
          ];
  if (kind === "grid") {
    const range = captureCellRange(s, "table", "cell", "cell");
    a.intent = planPasteCells(s, range, a, {
      preview: previewCellPaste(s, range, { version: 1, rows: [[blocks]] }),
    }).intent;
  } else
    a.intent = planRichInsert(
      s,
      captureRange(s, { block: "p", offset: 3 }, { block: "p", offset: 3 }),
      { version: 1, edges: { start: "boundary", end: "boundary" }, blocks },
      a,
    ).intent;
  return a;
}
function harness(initial) {
  let room = new Room(initial),
    record = room.snapshot();
  return {
    get state() {
      return room.record.state;
    },
    accept(o, expected = "accepted") {
      const before = JSON.stringify(room.record),
        receipt = room.accept(o);
      assert.equal(receipt.outcome, expected, receipt.reason);
      record = replay(record, { op: o, receipt });
      assert.deepEqual(room.accept(o), receipt);
      room = new Room(null, JSON.parse(JSON.stringify(room.record)));
      assert.deepEqual(room.record, record);
      validate(room.record.state);
      return receipt;
    },
  };
}
const images = (s) =>
  Object.values(s.nodes).filter((n) => n.type === "image" && n.mediaSlot);
const completion = (
  h,
  id,
  seq = 1,
  generation = h.state.pendingMedia[id]?.generation,
) =>
  op("system" + seq, 1, {
    kind: "imageComplete",
    image: id,
    generation,
    asset: (seq % 2 ? "a" : "b").repeat(64),
    mime: "image/png",
    bytes: 100,
    width: 320,
    height: 180,
  });
const undo = (seq, target) => op("A", seq, { kind: "undo", target });
for (const kind of ["body", "cell", "grid", "item"])
  for (const beforeUndo of [0, 1, 2])
    test(`rich pending ${kind} completion count before Undo=${beforeUndo}`, () => {
      const h = harness(fixture(kind)),
        a = paste(h.state, kind);
      h.accept(a);
      const ids = images(h.state).map((n) => n.id),
        pending = structuredClone(h.state);
      for (let i = 0; i < Math.min(beforeUndo, ids.length); i++)
        h.accept(completion(h, ids[i], i + 1));
      h.accept(undo(2, a.id));
      assert.ok(ids.every((id) => !h.state.nodes[id].live));
      for (const id of ids)
        assert.equal(
          pending.nodes[id].asset,
          undefined,
          "historical pending snapshot stays unresolved",
        );
      h.accept(undo(3, "A:s:2"));
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i],
          n = h.state.nodes[id];
        assert.equal(n.live, true);
        assert.equal(n.displayWidth, 96);
        if (i < beforeUndo) {
          assert.ok(n.asset);
          assert.equal(n.width, 320);
          assert.equal(h.state.pendingMedia[id], undefined);
        } else {
          assert.equal(h.state.pendingMedia[id].generation, "A:s:3");
          h.accept(completion(h, id, 10 + i, "A:s:1"), "rejected");
          h.accept(completion(h, id, 20 + i));
        }
      }
      h.accept(undo(4, "A:s:3"));
      h.accept(undo(5, "A:s:4"));
      assert.ok(
        ids.every((id) => h.state.nodes[id].live && h.state.nodes[id].asset),
      );
    });
for (const kind of ["body", "cell", "grid", "item"])
  test(`completion is automatic but peer resize is protected ${kind}`, () => {
    const h = harness(fixture(kind)),
      a = paste(h.state, kind);
    h.accept(a);
    const id = images(h.state)[0].id;
    h.accept(completion(h, id));
    const b = op("B", 1);
    b.intent = planImageSize(h.state, null, b, {
      preview: previewImageSize(h.state, id),
      width: 160,
    }).intent;
    h.accept(b);
    const before = structuredClone(h.state.nodes);
    h.accept(undo(2, a.id), "rejected");
    assert.deepEqual(h.state.nodes, before);
    assert.equal(h.state.nodes[id].displayWidth, 160);
  });
for (const kind of ["body", "cell", "grid", "item"])
  test(`completion racing paste Undo remains generation fenced ${kind}`, () => {
    const h = harness(fixture(kind)),
      a = paste(h.state, kind);
    h.accept(a);
    const id = images(h.state)[0].id,
      c = completion(h, id);
    h.accept(undo(2, a.id));
    h.accept(c, "rejected");
    h.accept(undo(3, "A:s:2"));
    assert.equal(h.state.nodes[id].asset, undefined);
    h.accept(completion(h, id, 2));
  });
for (const bad of [
  { ...image(0), asset: "a".repeat(64) },
  { ...image(0), slot: "short" },
  { ...image(0), width: 1.5 },
  { ...image(0), sourceDocumentId: "private" },
  { ...image(0), generation: "forged" },
])
  test("reject invalid pending fragment " + JSON.stringify(bad), () => {
    assert.throws(() => validateGridFragment({ version: 1, rows: [[[bad]]] }));
  });
test("duplicate slots and retained slot reuse are rejected before mutation", () => {
  assert.throws(
    () => validateGridFragment({ version: 1, rows: [[[image(0), image(0)]]] }),
    /reused/,
  );
  assert.throws(
    () =>
      validateGridFragment({
        version: 1,
        rows: [[Array.from({ length: 17 }, (_, i) => image(i))]],
      }),
    /16/,
  );
  const h = harness(fixture("body"));
  h.accept(paste(h.state, "body"));
  assert.throws(() => paste(h.state, "body"), /reused/);
});
for (const kind of ["body", "cell", "grid", "item"])
  for (const completionFirst of [false, true])
    test(`peer text survives pending rich paste ${kind} completionFirst=${completionFirst}`, () => {
      const h = harness(fixture(kind)),
        a = paste(h.state, kind);
      h.accept(a);
      const id = images(h.state)[0].id;
      const p = Object.values(h.state.nodes).find(
        (n) =>
          n.live &&
          n.text &&
          text(h.state, n.id)
            .map((a) => a.char)
            .join("")
            .includes("Copied"),
      );
      const b = op("B", 1, {
          kind: "insert",
          at: gapAt(h.state, p.id, 2),
          text: "PEER",
          marks: ["em"],
        }),
        c = completion(h, id);
      for (const o of completionFirst ? [c, b] : [b, c]) h.accept(o);
      // The first pasted paragraph shares the retained boundary in body/cell
      // range paste. Grid replacement must refuse overwriting a peer contribution.
      h.accept(undo(2, a.id), kind === "grid" ? "rejected" : "accepted");
      assert.ok(
        Object.values(h.state.nodes)
          .filter((n) => n.live && n.text)
          .some((n) =>
            text(h.state, n.id)
              .map((a) => a.char)
              .join("")
              .includes("PEER"),
          ),
      );
    });
for (const completionFirst of [false, true])
  test(`moved image item survives author Undo with completionFirst=${completionFirst}`, () => {
    const h = harness(fixture("item")),
      a = paste(h.state, "item");
    h.accept(a);
    const id = images(h.state)[0].id,
      p = "A:s:1:attached:paragraph",
      b = op("B", 1);
    b.intent = planListIndent(
      h.state,
      captureRange(h.state, { block: p, offset: 0 }, { block: p, offset: 0 }),
      b,
    ).intent;
    const c = completion(h, id);
    for (const o of completionFirst ? [c, b] : [b, c]) h.accept(o);
    h.accept(undo(2, a.id));
    assert.equal(h.state.nodes[id].live, true);
    assert.ok(h.state.nodes[id].asset);
    assert.equal(
      text(h.state, p)
        .map((a) => a.char)
        .join(""),
      "Copied",
    );
  });
