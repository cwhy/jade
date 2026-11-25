// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { captureConversion } from "../packages/document-core/src/model/text-conversion.js";
import {
  logicalBlocks,
  logicalPointAt,
  planLogicalDelete,
  planLogicalEnter,
} from "../packages/document-core/src/logical-text.js";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:logical-delete:${seq}`,
  stream: "logical-delete",
  epoch: 1,
  modelVersion: 2,
});
const undo = (s, a, q, target) => apply(s, op(a, q, { kind: "undo", target }));
const view = (s) => logicalBlocks(s, "doc").map((g) => [g.type, g.text]);
const fixture = (type = "paragraph", value = "Alpha") =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["a", "b"] },
      a: { id: "a", type, live: true },
      b: { id: "b", type: "paragraph", live: true },
    },
    { a: [{ text: value }], b: [{ text: "Beta" }] },
  );
for (const direction of ["backward", "forward"])
  for (const late of [false, true])
    test(`planned ${direction} separator deletion arrives after conversion Undo=${late}`, () => {
      let s = fixture();
      s = apply(s, op("a", 1, captureConversion(s, "doc", ["a", "b"], "code")));
      const intent = planLogicalDelete(
        s,
        logicalPointAt(s, "doc", "a", direction === "forward" ? 5 : 6),
        direction,
      );
      assert.equal(intent.kind, "proseJoin");
      if (late) s = undo(s, "a", 2, "a:logical-delete:1");
      s = apply(s, op("b", 1, intent));
      if (!late) s = undo(s, "a", 2, "a:logical-delete:1");
      assert.deepEqual(view(s), [["paragraph", "AlphaBeta"]]);
      s = undo(s, "b", 2, "b:logical-delete:1");
      assert.deepEqual(view(s), [
        ["paragraph", "Alpha"],
        ["paragraph", "Beta"],
      ]);
    });
for (const direction of ["backward", "forward"])
  test(`native code cut delete and independent Undo ${direction}`, () => {
    let s = fixture("code", "Alpha");
    s = apply(s, op("a", 1, captureConversion(s, "doc", ["a"], "paragraph")));
    s = apply(
      s,
      op("b", 1, planLogicalEnter(s, logicalPointAt(s, "doc", "a", 2))),
    );
    s = undo(s, "a", 2, "a:logical-delete:1");
    assert.deepEqual(view(s), [
      ["code", "Al\npha"],
      ["paragraph", "Beta"],
    ]);
    s = apply(
      s,
      op(
        "c",
        1,
        planLogicalDelete(
          s,
          logicalPointAt(s, "doc", "a", direction === "forward" ? 2 : 3),
          direction,
        ),
      ),
    );
    assert.deepEqual(view(s), [
      ["code", "Alpha"],
      ["paragraph", "Beta"],
    ]);
    s = undo(s, "c", 2, "c:logical-delete:1");
    assert.deepEqual(view(s), [
      ["code", "Al\npha"],
      ["paragraph", "Beta"],
    ]);
    s = undo(s, "b", 2, "b:logical-delete:1");
    assert.deepEqual(view(s), [
      ["code", "Alpha"],
      ["paragraph", "Beta"],
    ]);
  });
for (const direction of ["backward", "forward"])
  test(`grapheme identity deletion ${direction}`, () => {
    let s = fixture("code", "A👩🏽‍💻B");
    const before = text(s, "a");
    const offset = direction === "forward" ? 1 : before.length - 1;
    s = apply(
      s,
      op(
        "b",
        1,
        planLogicalDelete(s, logicalPointAt(s, "doc", "a", offset), direction),
      ),
    );
    assert.deepEqual(view(s), [
      ["code", "AB"],
      ["paragraph", "Beta"],
    ]);
    s = undo(s, "b", 2, "b:logical-delete:1");
    assert.deepEqual(text(s, "a"), before);
  });
test("code block edges do not consume the adjacent block", () => {
  const s = fixture("code", "Alpha");
  assert.equal(
    planLogicalDelete(s, logicalPointAt(s, "doc", "a", 0), "backward"),
    null,
  );
  assert.equal(
    planLogicalDelete(s, logicalPointAt(s, "doc", "a", 5), "forward"),
    null,
  );
});
