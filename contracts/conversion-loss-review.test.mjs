// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt, resolveGap } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import {
  captureConversion,
  previewConversion,
  planConversion,
} from "@cwhy/jade-core/conversion";
import { documentView } from "@cwhy/jade-core/document-read";
import { captureBodyContent } from "@cwhy/jade-core/document-content";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:loss:${seq}`,
  stream: "loss",
  epoch: 1,
  modelVersion: 2,
});
function fixture(parent = "doc") {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["a", "b"] },
    a: { id: "a", type: "paragraph", live: true },
    b: { id: "b", type: "paragraph", live: true },
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["a", "b"] },
    });
  }
  return seed(nodes, {
    a: [
      {
        text: "Alpha",
        marks: [
          "strong",
          { type: "highlight", attrs: { color: "yellow" } },
          { type: "link", attrs: { href: "https://example.com" } },
        ],
      },
    ],
    b: [{ text: "Beta" }],
  });
}
for (const parent of ["doc", "cell"]) {
  test(`${parent}: preview and cancel are inert; loss requires explicit confirmation`, () => {
    const s = fixture(parent),
      before = JSON.stringify(s),
      preview = previewConversion(s, parent, ["a", "b"], "code");
    assert.equal(preview.loss.formattedCharacters, 5);
    assert.deepEqual(
      new Set(preview.loss.properties),
      new Set(["strong", "highlight", "link"]),
    );
    assert.throws(
      () => captureConversion(s, parent, ["a", "b"], "code"),
      /Review the formatting loss/,
    );
    assert.throws(
      () => planConversion(s, preview, op("a", 1)),
      /Review the formatting loss/,
    );
    assert.equal(JSON.stringify(s), before);
    const raw = { ...preview.intent };
    delete raw.loss;
    assert.throws(() => apply(s, op("a", 1, raw)), /not reviewed/);
    assert.equal(JSON.stringify(s), before);
  });
  for (const conversionFirst of [false, true])
    test(`${parent}: clearing and peer format have separate owned Undo; conversion first=${conversionFirst}`, () => {
      const initial = fixture(parent),
        preview = previewConversion(initial, parent, ["a", "b"], "code"),
        anchor = gapAt(initial, "a", 2),
        ids = text(initial, "a").map((a) => a.id);
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
          planConversion(initial, preview, op("a", 1), { confirmLoss: true })
            .intent,
        ),
      );
      assert.ok(text(s, "a").every((a) => a.marks.length === 0));
      assert.ok(
        documentView(s)
          .text("a")
          .every((a) => a.marks.length === 0),
      );
      assert.deepEqual(s.replicas, initial.replicas);
      assert.equal(resolveGap(s, anchor).offset, 2);
      const blue = { type: "highlight", attrs: { color: "blue" } };
      s = accept(
        op("b", 1, { kind: "format", ids, property: "highlight", value: blue }),
      );
      assert.ok(
        documentView(s)
          .text("a")
          .filter((a) => ids.includes(a.id))
          .every((a) => JSON.stringify(a.marks) === JSON.stringify([blue])),
      );
      if (conversionFirst) {
        s = accept(op("a", 2, { kind: "undo", target: "a:loss:1" }));
        assert.equal(documentView(s).node("a").type, "paragraph");
        assert.ok(
          text(s, "a").every((a) =>
            a.marks.some(
              (m) => m.type === "highlight" && m.attrs.color === "blue",
            ),
          ),
        );
        s = accept(op("b", 2, { kind: "undo", target: "b:loss:1" }));
      } else {
        s = accept(op("b", 2, { kind: "undo", target: "b:loss:1" }));
        assert.ok(text(s, "a").every((a) => a.marks.length === 0));
        s = accept(op("a", 2, { kind: "undo", target: "a:loss:1" }));
      }
      assert.deepEqual(text(s, "a"), text(initial, "a"));
      s = accept(op("a", 3, { kind: "undo", target: "a:loss:2" }));
      assert.ok(text(s, "a").every((a) => a.marks.length === 0));
      // Normal reverse conversion preserves current plain content. Only Undo of the
      // original clearing action restores its formatting.
      s = accept(
        op("c", 1, captureConversion(s, parent, ["a", "b"], "paragraph")),
      );
      assert.equal(documentView(s).node("a").type, "paragraph");
      assert.ok(
        documentView(s)
          .text("a")
          .every((a) => a.marks.length === 0),
      );
      const body = captureBodyContent(s);
      assert.ok(body);
    });
  test(`${parent}: changed formatting invalidates preview atomically`, () => {
    let s = fixture(parent),
      preview = previewConversion(s, parent, ["a"], "code");
    s = apply(
      s,
      op("b", 1, {
        kind: "format",
        ids: [text(s, "a")[0].id],
        property: "strong",
        value: null,
      }),
    );
    const before = JSON.stringify(s);
    assert.throws(
      () => planConversion(s, preview, op("a", 1), { confirmLoss: true }),
      /review conversion again/,
    );
    assert.throws(
      () => apply(s, op("a", 1, preview.intent)),
      /review conversion again/,
    );
    assert.equal(JSON.stringify(s), before);
  });
  test(`${parent}: plain peer insertion and unselected changes do not invalidate review`, () => {
    let s = fixture(parent),
      preview = previewConversion(s, parent, ["a"], "code");
    s = apply(
      s,
      op("b", 1, { kind: "insert", at: gapAt(s, "a", 2), text: "X" }),
    );
    s = apply(
      s,
      op("b", 2, {
        kind: "format",
        ids: text(s, "b").map((a) => a.id),
        property: "em",
        value: "em",
      }),
    );
    s = apply(
      s,
      op(
        "a",
        1,
        planConversion(s, preview, op("a", 1), { confirmLoss: true }).intent,
      ),
    );
    assert.equal(
      documentView(s)
        .text("a")
        .map((a) => a.char)
        .join(""),
      "AlXpha",
    );
    assert.ok(
      documentView(s)
        .text("a")
        .every((a) => a.marks.length === 0),
    );
    assert.ok(text(s, "b").every((a) => a.marks.includes("em")));
  });
}
