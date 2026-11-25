// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import {
  captureBodyContent,
  createBodyContent,
} from "@cwhy/jade-core/document-content";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import { captureConversion } from "../packages/document-core/src/model/text-conversion.js";
import {
  logicalBlocks,
  logicalPointAt,
  resolveLogicalPoint,
  planLogicalEnter,
} from "../packages/document-core/src/logical-text.js";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:logical:${seq}`,
  stream: "logical",
  epoch: 1,
  modelVersion: 2,
});
const undo = (actor, seq, target) => op(actor, seq, { kind: "undo", target });
function fixture(parent = "doc", type = "code", value = "Alpha\nBeta\n") {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["source", "after"] },
    source: {
      id: "source",
      type,
      live: true,
      ...(type === "code" ? { language: "python" } : {}),
    },
    after: { id: "after", type: "paragraph", live: true },
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    nodes.table = { id: "table", type: "table", live: true, children: ["row"] };
    nodes.row = { id: "row", type: "row", live: true, children: ["cell"] };
    nodes.cell = {
      id: "cell",
      type: "cell",
      live: true,
      children: ["source", "after"],
    };
  }
  return seed(nodes, { source: [{ text: value }], after: [{ text: "After" }] });
}
const view = (s, p) => logicalBlocks(s, p).map((g) => [g.type, g.text]);
const bodyText = (node) =>
  node.children
    ? node.children.map(bodyText)
    : [node.type, node.content.map((r) => r.text).join("")];
for (const parent of ["doc", "cell"])
  for (const offset of [0, 3, 11])
    for (const late of [false, true])
      test(`native code Body Enter ${parent} offset=${offset}, after conversion Undo=${late}`, () => {
        const initial = fixture(parent),
          original = text(initial, "source");
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
          op(
            "a",
            1,
            captureConversion(initial, parent, ["source"], "paragraph"),
          ),
        );
        const points = Array.from({ length: 12 }, (_, i) =>
          logicalPointAt(s, parent, "source", i),
        );
        const intent = planLogicalEnter(
          s,
          logicalPointAt(s, parent, "source", offset),
        );
        if (late) s = accept(undo("a", 2, "a:logical:1"));
        s = accept(op("b", 1, intent));
        const originalValue = "Alpha\nBeta\n";
        if (late)
          assert.deepEqual(view(s, parent), [
            [
              "code",
              originalValue.slice(0, offset) +
                "\n" +
                originalValue.slice(offset),
            ],
            ["paragraph", "After"],
          ]);
        else
          assert.deepEqual(view(s, parent), [
            ["paragraph", originalValue.slice(0, offset)],
            ["paragraph", originalValue.slice(offset)],
            ["paragraph", "After"],
          ]);
        const all = logicalBlocks(s, parent)
          .flatMap((g) => g.tokens)
          .filter((t) => !t.boundary)
          .map((t) => t.id);
        assert.deepEqual(
          all.slice(0, original.length),
          original.map((t) => t.id),
        );
        for (let i = 0; i < points.length; i++) {
          const p = resolveLogicalPoint(s, points[i]);
          assert.ok(p.offset >= 0);
          const g = logicalBlocks(s, parent).find((g) => g.id === p.block);
          if (i < original.length)
            assert.equal(g.tokens[p.offset]?.id, original[i].id);
        }
        if (!late) s = accept(undo("a", 2, "a:logical:1"));
        const peer = op("c", 1, {
          kind: "insert",
          at: gapAt(s, "b:logical:1:paragraph", 0),
          text: "同",
        });
        s = accept(peer);
        s = accept(undo("b", 2, "b:logical:1"));
        assert.deepEqual(view(s, parent), [
          [
            "code",
            originalValue.slice(0, offset) + "同" + originalValue.slice(offset),
          ],
          ["paragraph", "After"],
        ]);
        s = accept(undo("c", 2, "c:logical:1"));
        assert.deepEqual(view(s, parent), view(initial, parent));
        s = accept(undo("a", 3, "a:logical:2"));
        assert.deepEqual(view(s, parent), [
          ["paragraph", originalValue],
          ["paragraph", "After"],
        ]);
        s = accept(undo("b", 3, "b:logical:2"));
        assert.deepEqual(view(s, parent), [
          ["paragraph", originalValue.slice(0, offset)],
          ["paragraph", originalValue.slice(offset)],
          ["paragraph", "After"],
        ]);
      });
for (const parent of ["doc", "cell"])
  test(`copy round trip and every logical offset agree in ${parent}`, () => {
    let s = fixture(parent, "paragraph", "Alpha");
    s = apply(
      s,
      op("a", 1, captureConversion(s, parent, ["source", "after"], "code")),
    );
    const group = logicalBlocks(s, parent)[0];
    assert.equal(group.text, "Alpha\nAfter");
    for (let i = 0; i <= group.tokens.length; i++) {
      const point = logicalPointAt(s, parent, "source", i);
      assert.equal(resolveLogicalPoint(s, point).offset, i);
    }
    const captured = captureBodyContent(s),
      copy = createBodyContent(captured, { namespace: "copy" });
    const copyState = copy.state ?? copy;
    assert.deepEqual(
      bodyText(captureBodyContent(copyState).root),
      bodyText(captured.root),
    );
    assert.equal(JSON.stringify(captured).includes("textConversions"), false);
  });
for (const late of [false, true])
  test(`code Enter is literal even if conversion Undo precedes delivery=${late}`, () => {
    let s = fixture("doc", "paragraph", "Alpha");
    s = apply(s, op("a", 1, captureConversion(s, "doc", ["source"], "code")));
    const command = op(
      "b",
      1,
      planLogicalEnter(s, logicalPointAt(s, "doc", "source", 2)),
    );
    assert.equal(command.intent.kind, "insert");
    if (late) s = apply(s, undo("a", 2, "a:logical:1"));
    s = apply(s, command);
    if (!late) s = apply(s, undo("a", 2, "a:logical:1"));
    assert.deepEqual(view(s, "doc"), [
      ["paragraph", "Al\npha"],
      ["paragraph", "After"],
    ]);
    s = apply(s, undo("b", 2, "b:logical:1"));
    assert.deepEqual(view(s, "doc"), [
      ["paragraph", "Alpha"],
      ["paragraph", "After"],
    ]);
  });
test("native code cannot forge Body Enter without a witnessed conversion", () => {
  const s = fixture();
  const bytes = JSON.stringify(s);
  assert.throws(() =>
    apply(
      s,
      op("b", 1, {
        kind: "logicalEnter",
        at: gapAt(s, "source", 2),
        conversion: "missing",
      }),
    ),
  );
  assert.equal(JSON.stringify(s), bytes);
});
