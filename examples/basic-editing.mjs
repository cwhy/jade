// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { seed, gapAt, text } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";

const initial = seed(
  {
    doc: { id: "doc", type: "doc", live: true, children: ["paragraph"] },
    paragraph: { id: "paragraph", type: "paragraph", live: true },
  },
  { paragraph: [] },
);
const insertion = {
  id: "writer:example:1",
  actor: "writer",
  stream: "example",
  seq: 1,
  epoch: initial.epoch,
  intent: {
    kind: "insert",
    at: gapAt(initial, "paragraph", 0),
    text: "Hello, jade!",
    marks: [],
  },
};
const edited = apply(initial, insertion);
const value = text(edited, "paragraph")
  .map((atom) => atom.char)
  .join("");
assert.equal(value, "Hello, jade!");
const restored = apply(edited, {
  id: "writer:example:2",
  actor: "writer",
  stream: "example",
  seq: 2,
  epoch: edited.epoch,
  intent: { kind: "undo", target: insertion.id },
});
assert.equal(text(restored, "paragraph").length, 0);
console.log(value);
console.log("Owned Undo restored the empty paragraph.");
