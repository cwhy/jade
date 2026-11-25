// SPDX-License-Identifier: MPL-2.0
// Admission gate only: the exact result after conversion Undo needs a product
// decision. This test does not choose it or relax any existing contract.
import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { joinTarget } from "../packages/document-core/src/model/join-ledger.js";
import {
  captureConversion,
  conversionView,
} from "../packages/document-core/src/model/text-conversion.js";
const op = (actor, intent) => ({
  actor,
  seq: 1,
  intent,
  id: `${actor}:seam:1`,
  stream: "seam",
  epoch: 1,
  modelVersion: 2,
});
test("deleting a converted paragraph separator is one admissible peer edit", () => {
  let s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["a", "b"] },
      a: { id: "a", type: "paragraph", live: true },
      b: { id: "b", type: "paragraph", live: true },
    },
    { a: [{ text: "Alpha" }], b: [{ text: "Beta" }] },
  );
  s = apply(s, op("a", captureConversion(s, "doc", ["a", "b"], "code")));
  // Candidate mapping: delete the displayed separator through its canonical
  // boundary contribution. Do not delete/reinsert source text to imitate it.
  s = apply(s, op("b", { kind: "proseJoin", target: joinTarget(s, "b") }));
  assert.deepEqual(
    conversionView(s, "doc").map((g) => [g.type, g.text]),
    [["code", "AlphaBeta"]],
  );
});
