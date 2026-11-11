// SPDX-License-Identifier: MPL-2.0
import { Client, Room } from "@cwhy/jade-testkit/peers";
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate, Conflict } from "@cwhy/jade-core/admission";
import { immutable } from "@cwhy/jade-core/immutability";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planRichInsert,
  planEnter,
  planClearCells,
  previewTableDelete,
  planTableDelete,
  planListIndent,
  planDelete,
} from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const point = (s, id, offset) =>
  captureRange(s, { block: id, offset }, { block: id, offset });
function fixture() {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["table"] },
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: ["list", "asset"],
      },
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item", "next"],
      },
      item: { id: "item", type: "list_item", live: true, children: ["p"] },
      next: { id: "next", type: "list_item", live: true, children: ["q"] },
      p: { id: "p", type: "paragraph", live: true },
      q: { id: "q", type: "paragraph", live: true },
      asset: { id: "asset", type: "image", live: true, asset: "mock.png" },
    },
    { p: [{ text: "ABCD", marks: ["strong"] }], q: [{ text: "Next" }] },
  );
}
function paste(s, type, offset) {
  const slice = {
    version: 1,
    edges: { start: "boundary", end: "boundary" },
    blocks: [
      {
        type: "ordered_list",
        order: 2,
        children: [
          {
            type: "list_item",
            children: [
              {
                type: "paragraph",
                content: [{ text: "Copied", marks: ["em"] }],
              },
              type === "image"
                ? { type: "image", asset: "mock.png" }
                : {
                    type: "code",
                    language: "text",
                    content: [{ text: "const ready = true;", marks: [] }],
                  },
            ],
          },
        ],
      },
    ],
  };
  return op(
    "A",
    1,
    planRichInsert(s, point(s, "p", offset), slice, op("A", 1)).intent,
  );
}
const para = "A:s:1:attached:paragraph",
  attachment = "A:s:1:attached:attachment";
const undo = (s, actor, seq, target) =>
  apply(s, op(actor, seq, { kind: "undo", target }));
const parent = (s, id) =>
  Object.values(s.nodes).find((n) => n.live && n.children?.includes(id));
function visible(s, id = s.root) {
  const n = s.nodes[id];
  return {
    id: n.id,
    type: n.type,
    ...(n.text ? { atoms: text(s, id) } : {}),
    ...(n.type === "code" ? { language: n.language } : {}),
    ...(n.type === "image" ? { asset: n.asset } : {}),
    ...(n.children ? { children: n.children.map((x) => visible(s, x)) } : {}),
  };
}
const all = (s) =>
  Object.values(s.nodes)
    .filter((n) => n.live && n.text)
    .flatMap((n) => text(s, n.id));

for (const type of ["image", "code"])
  for (const [command, offset] of [["backspace", 4]])
    for (const reload of [false, true])
      test(`Offline structural rejection ${type} ${command} reload=${reload}`, () => {
        const initial = fixture();
        let room = new Room(initial),
          a = new Client("A", "s", room.snapshot());
        const pasteOp = a.prepare(paste(initial, type, offset).intent);
        room.accept(pasteOp);
        a.receive(room.snapshot());
        const pasted = room.snapshot().state,
          b = op("B", 1),
          range = point(pasted, para, 0);
        b.intent = (
          command === "backspace"
            ? planDelete(pasted, range, "backward", b)
            : planListIndent(pasted, range, b, {
                outdent: command === "outdent",
              })
        ).intent;
        assert.equal(a.undo(), true);
        const pending = structuredClone(a.pending[0]);
        room.accept(b);
        const peer = op("C", 1, {
          kind: "insert",
          at: gapAt(room.snapshot().state, para, 2),
          text: "peer",
          marks: ["strong"],
        });
        room.accept(peer);
        const expected = room.snapshot().state;
        if (reload) {
          const saved = JSON.parse(JSON.stringify(a.save()));
          room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
          a = new Client("A", "s", room.snapshot(), saved);
        }
        // The actor learns newer authority state while their original Undo is unresolved.
        a.receive(room.snapshot());
        assert.deepEqual(a.pending, [pending]);
        assert.deepEqual(a.state, expected);
        const receipt = room.accept(pending);
        assert.equal(receipt.outcome, "rejected");
        assert.match(
          receipt.reason,
          /placement changed; Undo needs structural review/,
        );
        a.receive(room.snapshot());
        assert.deepEqual(a.state, expected);
        assert.equal(a.pending.length, 0);
        assert.deepEqual(a.recovery, [
          { id: pending.id, reason: receipt.reason },
        ]);
        assert.deepEqual(room.accept(pending), receipt);
        a.receive(room.snapshot());
        assert.equal(
          a.recovery.length,
          1,
          "duplicate decision does not duplicate recovery",
        );
        if (!reload) {
          assert.deepEqual(
            a.undoStack.map((g) => g.ids),
            [[pasteOp.id]],
          );
          assert.deepEqual(a.redoStack, []);
        }
        const next = a.prepare({
          kind: "insert",
          at: gapAt(a.state, "q", 4),
          text: "!",
        });
        assert.equal(next.seq, 3);
        assert.equal(room.accept(next).outcome, "accepted");
        a.receive(room.snapshot());
        assert.equal(
          text(a.state, "q")
            .map((x) => x.char)
            .join(""),
          "Next!",
        );
        assert.equal(a.undo(), true);
        assert.equal(room.accept(a.pending[0]).outcome, "accepted");
        a.receive(room.snapshot());
        assert.equal(
          text(a.state, "q")
            .map((x) => x.char)
            .join(""),
          "Next",
        );
        assert.equal(
          text(a.state, para)
            .map((x) => x.char)
            .join(""),
          "Copeerpied",
        );
      });
