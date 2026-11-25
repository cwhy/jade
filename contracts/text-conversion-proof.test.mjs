// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt, resolveGap } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import { conversionView } from "../packages/document-core/src/model/text-conversion.js";
import { previewConversion } from "@cwhy/jade-core/conversion";
// These model schedules explicitly accept the fixture's known bold-format loss.
// Public confirmation/cancellation and stale-review behavior have separate tests.
const captureConversion = (...args) => previewConversion(...args).intent;
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:conversion:${seq}`,
  stream: "conversion",
  epoch: 1,
  modelVersion: 2,
});
const undo = (actor, seq, target) => op(actor, seq, { kind: "undo", target });
function fixture(container = "doc", values = ["Alpha", "Beta", "Gamma"]) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["a", "b", "c"] },
    ...Object.fromEntries(
      ["a", "b", "c"].map((id) => [id, { id, type: "paragraph", live: true }]),
    ),
  };
  if (container === "cell") {
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
        [{ text: values[i], marks: i === 0 ? ["strong"] : [] }],
      ]),
    ),
  );
}
const plain = (s, p = "doc") =>
  conversionView(s, p).map((g) => [g.type, g.text]);
const realTokens = (s, p = "doc") =>
  conversionView(s, p)
    .flatMap((g) => g.tokens)
    .filter((t) => !t.boundary)
    .map((t) => t.id);
for (const parent of ["doc", "cell"])
  for (const count of [1, 2, 3])
    test(`group ${count} paragraphs in ${parent}; owned Undo and Redo`, () => {
      const s = fixture(parent),
        blocks = ["a", "b", "c"].slice(0, count),
        before = blocks.flatMap((id) => text(s, id));
      const cmd = op("a", 1, captureConversion(s, parent, blocks, "code"));
      let n = apply(s, cmd);
      assert.equal(
        conversionView(n, parent)[0].text,
        ["Alpha", "Beta", "Gamma"].slice(0, count).join("\n"),
      );
      assert.deepEqual(
        blocks.flatMap((id) => text(n, id)).map(({ marks, ...atom }) => atom),
        before.map(({ marks, ...atom }) => atom),
      );
      // Formatting is now an owned clear contribution. Original replica content
      // (including its base marks) is untouched; Undo reveals it again.
      assert.deepEqual(n.replicas, s.replicas);
      assert.equal(conversionView(n, parent)[0].type, "code");
      assert.ok(
        conversionView(n, parent)[0].tokens.every((t) => t.marks.length === 0),
      );
      n = apply(n, undo("a", 2, cmd.id));
      assert.deepEqual(plain(n, parent), plain(s, parent));
      assert.deepEqual(
        blocks.flatMap((id) => text(n, id)),
        before,
      );
      n = apply(n, undo("a", 3, "a:conversion:2"));
      assert.equal(conversionView(n, parent)[0].type, "code");
      validate(n);
    });
for (const parent of ["doc", "cell"])
  for (const order of ["convert-first", "enter-first"])
    for (const offset of [0, 2, 5])
      for (const conversionFirstUndo of [true, false])
        test(`${parent} ${order} Enter at ${offset}, conversion Undo first=${conversionFirstUndo}`, () => {
          const initial = fixture(parent),
            original = text(initial, "a"),
            anchor = gapAt(initial, "a", 3);
          const convert = op(
            "a",
            1,
            captureConversion(initial, parent, ["a", "b"], "code"),
          );
          const enter = op("b", 1, {
            kind: "proseEnter",
            at: gapAt(initial, "a", offset),
          });
          let room = new Room(initial),
            journal = room.snapshot();
          const accept = (command) => {
            const receipt = room.accept(command);
            assert.equal(receipt.outcome, "accepted", receipt.reason);
            journal = replay(journal, { op: command, receipt });
            room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
            assert.deepEqual(
              room.accept(command),
              receipt,
              "lost acknowledgement retry must not repeat",
            );
            assert.deepEqual(
              room.snapshot(),
              journal,
              "journal replay equals restored authority",
            );
            return room.record.state;
          };
          for (const cmd of order === "convert-first"
            ? [convert, enter]
            : [enter, convert])
            accept(cmd);
          let n = room.record.state,
            expected =
              "Alpha".slice(0, offset) +
              "\n" +
              "Alpha".slice(offset) +
              "\nBeta";
          assert.deepEqual(plain(n, parent), [
            ["code", expected],
            ["paragraph", "Gamma"],
          ]);
          assert.deepEqual(
            realTokens(n, parent),
            ["a", "b", "c"].flatMap((id) => text(initial, id).map((t) => t.id)),
          );
          const point = resolveGap(n, anchor);
          assert.equal(text(n, point.block)[point.offset]?.id, original[3].id);
          const tail = "b:conversion:1:paragraph";
          n = accept(
            op("b", 2, { kind: "insert", at: gapAt(n, tail, 0), text: "同" }),
          );
          const peerId = text(n, tail)[0].id;
          n = accept(
            undo(
              conversionFirstUndo ? "a" : "b",
              conversionFirstUndo ? 2 : 3,
              conversionFirstUndo ? convert.id : enter.id,
            ),
          );
          assert.ok(realTokens(n, parent).includes(peerId));
          if (conversionFirstUndo)
            assert.equal(plain(n, parent)[0][0], "paragraph");
          else
            assert.deepEqual(plain(n, parent), [
              [
                "code",
                "Alpha".slice(0, offset) +
                  "同" +
                  "Alpha".slice(offset) +
                  "\nBeta",
              ],
              ["paragraph", "Gamma"],
            ]);
          n = accept(
            undo(
              conversionFirstUndo ? "b" : "a",
              conversionFirstUndo ? 3 : 2,
              conversionFirstUndo ? enter.id : convert.id,
            ),
          );
          assert.deepEqual(plain(n, parent), [
            [
              "paragraph",
              "Alpha".slice(0, offset) + "同" + "Alpha".slice(offset),
            ],
            ["paragraph", "Beta"],
            ["paragraph", "Gamma"],
          ]);
          n = accept(undo("b", 4, "b:conversion:2"));
          assert.deepEqual(plain(n, parent), plain(initial, parent));
          n = accept(undo("b", 5, "b:conversion:3"));
          n = accept(undo("a", 3, "a:conversion:2"));
          assert.deepEqual(plain(n, parent), [
            ["code", expected],
            ["paragraph", "Gamma"],
          ]);
        });
test("reverse conversion preserves current breaks; later Body Enter stays structural", () => {
  const s = fixture();
  let n = apply(s, op("a", 1, captureConversion(s, "doc", ["a", "b"], "code")));
  n = apply(
    n,
    op("a", 2, captureConversion(n, "doc", ["a", "b"], "paragraph")),
  );
  assert.deepEqual(plain(n), [
    ["paragraph", "Alpha\nBeta"],
    ["paragraph", "Gamma"],
  ]);
  n = apply(n, op("b", 1, { kind: "proseEnter", at: gapAt(n, "a", 2) }));
  assert.deepEqual(plain(n), [
    ["paragraph", "Al"],
    ["paragraph", "pha\nBeta"],
    ["paragraph", "Gamma"],
  ]);
  n = apply(n, undo("a", 3, "a:conversion:2"));
  assert.deepEqual(plain(n), [
    ["code", "Al\npha\nBeta"],
    ["paragraph", "Gamma"],
  ]);
});
test("empty source and repeated Enter retain empty logical lines", () => {
  const s = fixture("doc", ["", "", "Gamma"]);
  let n = apply(s, op("a", 1, captureConversion(s, "doc", ["a", "b"], "code")));
  for (let i = 1; i <= 3; i++)
    n = apply(n, op("b", i, { kind: "proseEnter", at: gapAt(n, "a", 0) }));
  assert.deepEqual(plain(n), [
    ["code", "\n\n\n\n"],
    ["paragraph", "Gamma"],
  ]);
  for (let i = 3; i >= 1; i--)
    n = apply(n, undo("b", 7 - i, `b:conversion:${i}`));
  assert.deepEqual(plain(n), [
    ["code", "\n"],
    ["paragraph", "Gamma"],
  ]);
});
test("a selected partition does not absorb neighboring partitions", () => {
  let n = fixture();
  n = apply(n, op("b", 1, { kind: "proseEnter", at: gapAt(n, "a", 2) }));
  const tail = "b:conversion:1:paragraph";
  n = apply(n, op("a", 1, captureConversion(n, "doc", [tail], "code")));
  n = apply(n, op("b", 2, { kind: "proseEnter", at: gapAt(n, tail, 1) }));
  assert.deepEqual(plain(n), [
    ["paragraph", "Al"],
    ["code", "p\nha"],
    ["paragraph", "Beta"],
    ["paragraph", "Gamma"],
  ]);
});
test("noncontiguous sources remain rejected; native code reverse preserves text", () => {
  const s = fixture();
  assert.throws(() => captureConversion(s, "doc", ["a", "c"], "code"));
  const c = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["code"] },
      code: { id: "code", type: "code", live: true },
    },
    { code: [{ text: "a\nb" }] },
  );
  const n = apply(
    c,
    op("a", 1, captureConversion(c, "doc", ["code"], "paragraph")),
  );
  assert.deepEqual(plain(n), [["paragraph", "a\nb"]]);
});
test("forged internal toggle and malformed contribution reject atomically", () => {
  const s = fixture(),
    before = JSON.stringify(s);
  assert.throws(() =>
    apply(
      s,
      op("a", 1, { kind: "textConversionActive", target: "x", active: false }),
    ),
  );
  assert.throws(() =>
    apply(
      s,
      op("a", 1, {
        kind: "textConvert",
        parent: "doc",
        target: "code",
        windows: [{ source: "a", left: null, right: null }],
        edges: ["fake"],
      }),
    ),
  );
  assert.equal(JSON.stringify(s), before);
});
