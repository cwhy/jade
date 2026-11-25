// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt, resolveGap } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import { captureBodyContent } from "@cwhy/jade-core/document-content";
import {
  joinTarget,
  proseProjectionSources,
} from "../packages/document-core/src/model/join-ledger.js";
import { conversionView } from "../packages/document-core/src/model/text-conversion.js";
import { previewConversion } from "@cwhy/jade-core/conversion";
// Model schedules explicitly confirm the known fixture formatting loss.
const captureConversion = (...args) => previewConversion(...args).intent;
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:separator:${seq}`,
  stream: "separator",
  epoch: 1,
  modelVersion: 2,
});
const undo = (actor, seq, target) => op(actor, seq, { kind: "undo", target });
const view = (s, p) => conversionView(s, p).map((g) => [g.type, g.text]);
function fixture(parent = "doc", values = ["Alpha", "Beta", "Gamma"]) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["a", "b", "c"] },
    ...Object.fromEntries(
      ["a", "b", "c"].map((id) => [id, { id, type: "paragraph", live: true }]),
    ),
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    nodes.table = { id: "table", type: "table", live: true, children: ["row"] };
    nodes.row = { id: "row", type: "row", live: true, children: ["cell"] };
    nodes.cell = {
      id: "cell",
      type: "cell",
      live: true,
      children: ["a", "b", "c"],
    };
  }
  return seed(
    nodes,
    Object.fromEntries(
      ["a", "b", "c"].map((id, i) => [
        id,
        [{ text: values[i], marks: id === "b" ? ["em"] : [] }],
      ]),
    ),
  );
}
for (const parent of ["doc", "cell"])
  for (const firstUndo of ["conversion", "deletion"])
    for (const lateTyping of [false, true])
      test(`${parent} deleted separator, Undo ${firstUndo} first, typing late=${lateTyping}`, () => {
        const initial = fixture(parent),
          witnesses = ["a", "b", "c"].map((id) => ({
            id,
            atoms: text(initial, id),
            gap: gapAt(initial, id, 1),
          }));
        let room = new Room(initial),
          journal = room.snapshot();
        const accept = (command) => {
          const receipt = room.accept(command);
          assert.equal(receipt.outcome, "accepted", receipt.reason);
          journal = replay(journal, { op: command, receipt });
          room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
          assert.deepEqual(room.accept(command), receipt);
          assert.deepEqual(room.snapshot(), journal);
          return room.record.state;
        };
        let s = accept(
          op("a", 1, captureConversion(initial, parent, ["a", "b"], "code")),
        );
        const typing = op("c", 1, {
          kind: "insert",
          at: gapAt(s, "b", 2),
          text: "同",
        });
        s = accept(
          op("b", 1, { kind: "proseJoin", target: joinTarget(s, "b") }),
        );
        assert.deepEqual(view(s, parent), [
          ["code", "AlphaBeta"],
          ["paragraph", "Gamma"],
        ]);
        if (!lateTyping) s = accept(typing);
        s = accept(
          undo(
            firstUndo === "conversion" ? "a" : "b",
            2,
            `${firstUndo === "conversion" ? "a" : "b"}:separator:1`,
          ),
        );
        if (lateTyping) s = accept(typing);
        assert.deepEqual(
          view(s, parent),
          firstUndo === "conversion"
            ? [
                ["paragraph", "AlphaBe同ta"],
                ["paragraph", "Gamma"],
              ]
            : [
                ["code", "Alpha\nBe同ta"],
                ["paragraph", "Gamma"],
              ],
        );
        s = accept(
          undo(
            firstUndo === "conversion" ? "b" : "a",
            2,
            `${firstUndo === "conversion" ? "b" : "a"}:separator:1`,
          ),
        );
        assert.deepEqual(view(s, parent), [
          ["paragraph", "Alpha"],
          ["paragraph", "Be同ta"],
          ["paragraph", "Gamma"],
        ]);
        for (const { atoms, gap } of witnesses) {
          const at = resolveGap(s, gap);
          assert.equal(text(s, at.block)[at.offset].id, atoms[1].id);
        }
        s = accept(undo("c", 2, "c:separator:1"));
        for (const { id, atoms } of witnesses)
          assert.deepEqual(text(s, id), atoms);
        // Redo both independently: both contributions retain their original IDs.
        s = accept(undo("b", 3, "b:separator:2"));
        s = accept(undo("a", 3, "a:separator:2"));
        assert.deepEqual(view(s, parent), [
          ["code", "AlphaBeta"],
          ["paragraph", "Gamma"],
        ]);
        s = accept(undo("a", 4, "a:separator:3"));
        assert.deepEqual(view(s, parent), [
          ["paragraph", "AlphaBeta"],
          ["paragraph", "Gamma"],
        ]);
        s = accept(undo("b", 4, "b:separator:3"));
        assert.deepEqual(view(s, parent), view(initial, parent));
        validate(s);
      });
for (const order of ["ab", "ba"])
  test(`concurrent original separator removal and conversion ${order}`, () => {
    const initial = fixture(),
      commands = {
        a: op("a", 1, captureConversion(initial, "doc", ["a", "b"], "code")),
        b: op("b", 1, { kind: "proseJoin", target: joinTarget(initial, "b") }),
      };
    let s = initial;
    for (const actor of order) s = apply(s, commands[actor]);
    assert.deepEqual(view(s, "doc"), [
      ["code", "AlphaBeta"],
      ["paragraph", "Gamma"],
    ]);
    s = apply(s, undo("a", 2, "a:separator:1"));
    assert.deepEqual(view(s, "doc"), [
      ["paragraph", "AlphaBeta"],
      ["paragraph", "Gamma"],
    ]);
  });
for (const values of [
  ["Alpha", "Beta", "Gamma"],
  ["", "", ""],
  ["", "Beta", ""],
])
  for (const arrival of [
    ["b", "c"],
    ["c", "b"],
  ])
    test(`multiple joins retain source order ${JSON.stringify(values)} ${arrival}`, () => {
      const initial = fixture("doc", values);
      let s = apply(
        initial,
        op("a", 1, captureConversion(initial, "doc", ["a", "b", "c"], "code")),
      );
      for (const [i, right] of arrival.entries())
        s = apply(
          s,
          op("b", i + 1, {
            kind: "proseJoin",
            target: joinTarget(initial, right),
          }),
        );
      assert.deepEqual(proseProjectionSources(s, "doc").children, [
        "a",
        "b",
        "c",
      ]);
      assert.deepEqual(view(s, "doc"), [["code", values.join("")]]);
      s = apply(s, undo("a", 2, "a:separator:1"));
      assert.deepEqual(view(s, "doc"), [["paragraph", values.join("")]]);
      for (let i = 2; i > 0; i--)
        s = apply(s, undo("b", 5 - i, `b:separator:${i}`));
      assert.deepEqual(
        view(s, "doc"),
        values.map((value) => ["paragraph", value]),
      );
    });
test("conversion captured after a join includes all retained sources and survives join Undo", () => {
  let s = fixture();
  s = apply(s, op("b", 1, { kind: "proseJoin", target: joinTarget(s, "b") }));
  const intent = captureConversion(s, "doc", ["a"], "code");
  assert.deepEqual(
    intent.windows.map((w) => w.source),
    ["a", "b"],
  );
  s = apply(s, op("a", 1, intent));
  s = apply(s, undo("b", 2, "b:separator:1"));
  assert.deepEqual(view(s, "doc"), [
    ["code", "Alpha\nBeta"],
    ["paragraph", "Gamma"],
  ]);
});
test("Body reverse conversion preserves the deleted separator and copy result", () => {
  let s = fixture();
  s = apply(s, op("a", 1, captureConversion(s, "doc", ["a", "b"], "code")));
  s = apply(s, op("b", 1, { kind: "proseJoin", target: joinTarget(s, "b") }));
  s = apply(s, op("c", 1, captureConversion(s, "doc", ["a"], "paragraph")));
  const body = captureBodyContent(s).root.children;
  assert.deepEqual(
    body.map((n) => [n.type, n.content.map((r) => r.text).join("")]),
    [
      ["paragraph", "AlphaBeta"],
      ["paragraph", "Gamma"],
    ],
  );
});
