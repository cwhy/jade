// SPDX-License-Identifier: MPL-2.0
// Required behavior gates. Preserve failures; do not weaken to fit the candidate.
import test from "node:test";
import assert from "node:assert/strict";
import { seed, gapAt } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { captureBodyContent } from "@cwhy/jade-core/document-content";
import {
  captureConversion,
  conversionView,
} from "../packages/document-core/src/model/text-conversion.js";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:gate:${seq}`,
  stream: "gate",
  epoch: 1,
  modelVersion: 2,
});
const fixture = () =>
  seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["a", "b"] },
      a: { id: "a", type: "paragraph", live: true },
      b: { id: "b", type: "paragraph", live: true },
    },
    { a: [{ text: "Alpha" }], b: [{ text: "Beta" }] },
  );
test("G1 copy/export sees exactly the same converted block and text", () => {
  let s = fixture();
  s = apply(s, op("a", 1, captureConversion(s, "doc", ["a", "b"], "code")));
  const body = captureBodyContent(s).root.children;
  assert.deepEqual(
    body.map((n) => ({
      type: n.type,
      text: n.content.map((r) => r.text).join(""),
    })),
    [{ type: "code", text: "Alpha\nBeta" }],
  );
});
test("G2 ordinary native code converts to one Body paragraph with preserved line breaks", () => {
  let s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["code"] },
      code: { id: "code", type: "code", live: true },
    },
    { code: [{ text: "a\nb\n" }] },
  );
  s = apply(s, op("a", 1, captureConversion(s, "doc", ["code"], "paragraph")));
  assert.deepEqual(
    conversionView(s, "doc").map((g) => [g.type, g.text]),
    [["paragraph", "a\nb\n"]],
  );
});
test("G3 Undo of a peer boundary remains available after conversion of its tail", () => {
  let s = fixture();
  s = apply(s, op("b", 1, { kind: "proseEnter", at: gapAt(s, "a", 2) }));
  s = apply(
    s,
    op("a", 1, captureConversion(s, "doc", ["b:gate:1:paragraph"], "code")),
  );
  // Exact mixed-type placement needs a general boundary ownership model, but
  // routine Undo must at minimum be admissible and preserve all original text.
  s = apply(s, op("b", 2, { kind: "undo", target: "b:gate:1" }));
  assert.equal(
    conversionView(s, "doc")
      .map((g) => g.text)
      .join(""),
    "AlphaBeta",
  );
  assert.deepEqual(
    conversionView(s, "doc").map((g) => [g.type, g.text]),
    [
      ["paragraph", "Al"],
      ["code", "pha"],
      ["paragraph", "Beta"],
    ],
  );
  s = apply(s, op("a", 2, { kind: "undo", target: "a:gate:1" }));
  assert.deepEqual(
    conversionView(s, "doc").map((g) => [g.type, g.text]),
    [
      ["paragraph", "Alpha"],
      ["paragraph", "Beta"],
    ],
  );
  s = apply(s, op("a", 3, { kind: "undo", target: "a:gate:2" }));
  assert.deepEqual(
    conversionView(s, "doc").map((g) => [g.type, g.text]),
    [
      ["paragraph", "Al"],
      ["code", "pha"],
      ["paragraph", "Beta"],
    ],
  );
});
