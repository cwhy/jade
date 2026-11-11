// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { immutable } from "@cwhy/jade-core/immutability";
import { apply, validate } from "@cwhy/jade-core/admission";
import { text, gapAt } from "@cwhy/jade-core/model";
import { planListIndent, planEnter } from "@cwhy/jade-core/commands";
import {
  fixture,
  paste,
  op,
  point,
  para,
  attachment,
  parent,
} from "../contracts/placement-chain-fixture.mjs";
const run = (s, o) => {
  const before = JSON.stringify(s);
  try {
    const next = immutable(apply(s, o));
    validate(next);
    return next;
  } finally {
    assert.equal(JSON.stringify(s), before);
  }
};
const chars = (s, id) =>
  text(s, id)
    .map((x) => x.char)
    .join("");
for (const type of ["image", "code"])
  for (const offset of [2, 4])
    test(`Outdent to prose, split, then paste Undo ${type} offset=${offset}`, () => {
      const initial = immutable(fixture()),
        a = paste(initial, type, offset);
      let s = run(initial, a),
        b = op("B", 1);
      b.intent = planListIndent(s, point(s, para, 0), b, {
        outdent: true,
      }).intent;
      s = run(s, b);
      assert.equal(parent(s, para).type, "cell");
      const d = op("D", 1);
      d.intent = planEnter(s, point(s, para, 3), d).intent;
      s = run(s, d);
      const tail = "D:s:1:paragraph",
        typing = op("D", 2, {
          kind: "insert",
          at: gapAt(s, tail, 0),
          text: "peer",
          marks: ["strong"],
        });
      s = run(s, typing);
      s = run(s, op("A", 2, { kind: "undo", target: a.id }));
      assert.equal(chars(s, "p"), "ABCD");
      assert.equal(chars(s, para), "Cop");
      assert.equal(chars(s, tail), "peeried");
      assert.equal(s.nodes[attachment].live, true);
      assert.equal(parent(s, para).type, "cell");
      assert.equal(parent(s, tail).type, "cell");
    });
