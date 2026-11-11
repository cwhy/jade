// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { immutable } from "@cwhy/jade-core/immutability";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planListIndent,
  planEnter,
  planClearCells,
} from "@cwhy/jade-core/commands";
import {
  fixture,
  paste,
  op,
  point,
  para,
  attachment,
  parent,
} from "./placement-chain-fixture.mjs";
function setup(type) {
  let s = apply(fixture(), paste(fixture(), type, 2));
  const b = op("B", 1);
  b.intent = planListIndent(s, point(s, para, 0), b, { outdent: true }).intent;
  s = apply(s, b);
  const d = op("D", 1);
  d.intent = planEnter(s, point(s, para, 3), d).intent;
  return apply(s, d);
}
for (const type of ["image", "code"])
  for (const obstruction of ["foreign-between", "foreign-after", "clear"])
    test(`Extent does not absorb independent structure ${type} ${obstruction}`, () => {
      let s = structuredClone(setup(type));
      if (obstruction === "clear") {
        const e = op("E", 1);
        e.intent = planClearCells(
          s,
          captureCellRange(s, "table", "cell", "cell"),
          e,
        ).intent;
        s = apply(s, e);
      } else {
        // Valid-tree perturbation isolates the extent guard; this is not claimed as
        // a browser drag. The foreign image has no paragraph-family affiliation.
        const owner = parent(s, para),
          children = owner.children.filter((id) => id !== "asset"),
          at = children.indexOf(
            obstruction === "foreign-between" ? para : attachment,
          );
        children.splice(at + 1, 0, "asset");
        s.nodes[owner.id].children = children;
      }
      validate(s);
      s = immutable(s);
      const before = JSON.stringify(s);
      if (obstruction === "foreign-after") {
        const next = apply(s, op("A", 2, { kind: "undo", target: "A:s:1" }));
        validate(next);
        assert.equal(parent(next, "asset").type, "cell");
        assert.ok(
          !next.nodes["A:s:1:attached:item"].children.includes("asset"),
        );
      } else
        assert.throws(
          () => apply(s, op("A", 2, { kind: "undo", target: "A:s:1" })),
          /contiguous|cleared|deleted/,
        );
      assert.equal(JSON.stringify(s), before);
    });
