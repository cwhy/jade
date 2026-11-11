// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "@cwhy/jade-core/admission";
import { text, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
import {
  copyCells,
  previewCellPaste,
  planPasteCells,
} from "@cwhy/jade-core/commands";
import { visible } from "./placement-chain-fixture.mjs";
import {
  run,
  op,
  para,
  range,
  setup,
  changes,
  invalidates,
  structure,
  first,
} from "./rich-grid-preview-fixture.mjs";
for (const type of ["image", "code"])
  for (const kind of ["cut", "replace"])
    for (const peerFirst of [false, true])
      for (const change of changes)
        test(`Retained rich preview ${type} ${kind} peerFirst=${peerFirst} ${change}`, () => {
          const f = setup(type, kind, peerFirst),
            selected = range(f.s),
            fragment = copyCells(f.s, selected),
            saved = JSON.stringify(fragment),
            preview = previewCellPaste(f.s, selected, fragment),
            pending = op("E", 1);
          pending.intent = planPasteCells(f.s, selected, pending, {
            preview,
          }).intent;
          const moved = structure(f.s, change);
          let s = run(f.s, moved);
          const before = s,
            peer = text(s, para).findIndex((a) => a.id.startsWith("D:")),
            anchor = anchorAt(s, para, peer, 1);
          let accepted = pending,
            review = preview;
          if (invalidates(change)) {
            const bytes = JSON.stringify(s);
            assert.throws(() => apply(s, pending), /structure changed/);
            assert.throws(
              () => planPasteCells(s, selected, pending, { preview }),
              /structure changed/,
            );
            assert.equal(JSON.stringify(s), bytes);
            assert.equal(JSON.stringify(fragment), saved);
            // A new explicit one-cell selection and starting-cell review names every
            // overwrite target. No stale rectangle is silently widened or remapped.
            const active = first(s),
              fresh = range(s, active, active);
            review = previewCellPaste(s, fresh, fragment, "start");
            assert.equal(review.outside.length, 3);
            assert.ok(
              review.outside.every(
                (id) => review.range.cells.flat().includes(id) && id !== active,
              ),
            );
            accepted = op("E", 2);
            accepted.intent = planPasteCells(s, fresh, accepted, {
              preview: review,
            }).intent;
          } else
            assert.deepEqual(
              review.range.cells,
              selected.cells,
              "outside insertion keeps the original cell identities",
            );
          const targets = new Set(review.range.cells.flat()),
            untouched = Object.values(s.nodes)
              .filter((n) => n.live && n.type === "cell" && !targets.has(n.id))
              .map((n) => [n.id, visible(s, n.id)]);
          s = run(s, accepted);
          assert.deepEqual(copyCells(s, review.range), fragment);
          for (const [id, tree] of untouched)
            assert.deepEqual(
              visible(s, id),
              tree,
              "unreviewed cell remains intact",
            );
          s = run(
            s,
            op("E", invalidates(change) ? 3 : 2, {
              kind: "undo",
              target: accepted.id,
            }),
          );
          assert.deepEqual(visible(s), visible(before));
          assert.equal(resolveAnchor(s, anchor).status, "exact");
          s = run(s, op("B", 3, { kind: "undo", target: moved.id }));
          s = run(s, op("A", 2, { kind: "undo", target: f.a.id }));
          s = run(s, op("C", 2, { kind: "undo", target: f.c.id }));
          s = run(s, op("B", 4, { kind: "undo", target: f.b.id }));
          assert.equal(
            text(s, para)
              .map((a) => a.char)
              .join(""),
            "中",
          );
          s = run(s, op("D", 2, { kind: "undo", target: f.d.id }));
          assert.deepEqual(visible(s), visible(f.initial));
          assert.equal(JSON.stringify(fragment), saved);
        });

for (const type of ["image", "code"])
  for (const kind of ["cut", "replace"])
    for (const peerFirst of [false, true])
      for (const change of changes)
        test(`Paste accepted before structure ${type} ${kind} peerFirst=${peerFirst} ${change}`, () => {
          const f = setup(type, kind, peerFirst),
            selected = range(f.s),
            fragment = copyCells(f.s, selected),
            pending = op("E", 1);
          pending.intent = planPasteCells(f.s, selected, pending, {
            preview: previewCellPaste(f.s, selected, fragment),
          }).intent;
          const moved = structure(f.s, change),
            ids = selected.cells.flat();
          let s = run(f.s, pending);
          const pasted = new Map(ids.map((id) => [id, visible(s, id)]));
          s = run(s, moved);
          for (const [id, tree] of pasted)
            assert.deepEqual(
              visible(s, id),
              tree,
              "structure does not retarget or rewrite already accepted content",
            );
          for (const n of Object.values(s.nodes))
            if (n.live && n.type === "cell" && !ids.includes(n.id))
              assert.ok(
                n.children.every((id) => text(s, id).length === 0),
                "new cells remain empty",
              );
          s = run(s, op("B", 3, { kind: "undo", target: moved.id }));
          assert.deepEqual(copyCells(s, selected), fragment);
          s = run(s, op("E", 2, { kind: "undo", target: pending.id }));
          assert.deepEqual(visible(s), visible(f.s));
          s = run(s, op("A", 2, { kind: "undo", target: f.a.id }));
          s = run(s, op("C", 2, { kind: "undo", target: f.c.id }));
          s = run(s, op("B", 4, { kind: "undo", target: f.b.id }));
          assert.equal(
            text(s, para)
              .map((a) => a.char)
              .join(""),
            "中",
          );
          s = run(s, op("D", 2, { kind: "undo", target: f.d.id }));
          assert.deepEqual(visible(s), visible(f.initial));
        });
