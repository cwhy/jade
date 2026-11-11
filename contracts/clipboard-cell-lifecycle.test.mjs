// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { immutable } from "@cwhy/jade-core/immutability";
import { captureRange } from "@cwhy/jade-core/selection";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planListIndent,
  planReplace,
  previewCut,
  planCut,
  planClearCells,
  copyCells,
  previewCellPaste,
  planPasteCells,
} from "@cwhy/jade-core/commands";
import {
  fixture as baseFixture,
  paste,
  op,
  point,
  visible,
  para,
  attachment,
} from "./placement-chain-fixture.mjs";
import {
  fixture,
  run,
  cell,
  copied,
  words,
  setup,
} from "./clipboard-cell-fixture.mjs";
for (const type of ["image", "code"])
  for (const kind of ["cut", "replace"])
    for (const peerFirst of [false, true])
      for (const destructive of ["clear", "paste"])
        for (const birthUndoFirst of [false, true])
          test(`Rich-cell lifecycle ${type} ${kind} peerFirst=${peerFirst} ${destructive} birthUndoFirst=${birthUndoFirst}`, () => {
            const f = setup(type, kind, peerFirst);
            let { s } = f;
            if (birthUndoFirst)
              s = run(s, op("A", 2, { kind: "undo", target: f.a.id }));
            const prior = s,
              expected = visible(s, "cell"),
              peer = text(s, para).findIndex((x) => x.id.startsWith("D:")),
              anchor = anchorAt(s, para, peer, 1),
              e = op("E", 1);
            e.intent =
              destructive === "clear"
                ? planClearCells(s, cell(s, "cell"), e).intent
                : planPasteCells(s, cell(s, "cell"), e, {
                    preview: previewCellPaste(
                      s,
                      cell(s, "cell"),
                      copied(s, "other-cell"),
                    ),
                  }).intent;
            s = run(s, e);
            assert.equal(s.nodes[attachment].live, false);
            for (const o of [
              op("B", 2, { kind: "undo", target: f.b.id }),
              op("A", birthUndoFirst ? 3 : 2, {
                kind: "undo",
                target: birthUndoFirst ? "A:s:2" : f.a.id,
              }),
            ]) {
              const before = JSON.stringify(s);
              assert.throws(() => apply(s, o));
              assert.equal(JSON.stringify(s), before);
            }
            s = run(s, op("E", 2, { kind: "undo", target: e.id }));
            assert.deepEqual(
              visible(s, "cell"),
              expected,
              "restoring the cell preserves all text identities, marks, descendants and media",
            );
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            assert.deepEqual(
              copied(s, "other-cell"),
              copied(prior, "other-cell"),
            );
            if (!birthUndoFirst)
              s = run(s, op("A", 2, { kind: "undo", target: f.a.id }));
            s = run(s, op("C", 2, { kind: "undo", target: f.c.id }));
            assert.deepEqual(text(s, para), text(run(f.moved, f.d), para));
            s = run(s, op("B", 2, { kind: "undo", target: f.b.id }));
            assert.equal(words(s, para), "中");
            assert.equal(s.nodes[attachment].live, false);
            assert.equal(resolveAnchor(s, anchor).status, "exact");
            s = run(s, op("D", 2, { kind: "undo", target: f.d.id }));
            assert.deepEqual(visible(s), visible(f.initial));
          });
for (const type of ["image", "code"])
  for (const kind of ["cut", "replace"])
    for (const peerFirst of [false, true])
      test(`Detached cell copy ${type} ${kind} peerFirst=${peerFirst}`, () => {
        const f = setup(type, kind, peerFirst);
        let { s } = f;
        const fragment = copied(s, "cell"),
          saved = JSON.stringify(fragment),
          e = op("E", 1);
        e.intent = planPasteCells(s, cell(s, "other-cell"), e, {
          preview: previewCellPaste(s, cell(s, "other-cell"), fragment),
        }).intent;
        s = run(s, e);
        assert.deepEqual(copied(s, "other-cell").rows, fragment.rows);
        const copy = visible(s, "other-cell"),
          sourceIds = new Set(
            Object.values(f.s.nodes)
              .filter((n) => n.live && n.text)
              .flatMap((n) => text(f.s, n.id))
              .map((a) => a.id),
          );
        function atoms(n) {
          return [...(n.atoms || []), ...(n.children || []).flatMap(atoms)];
        }
        assert.ok(atoms(copy).every((a) => !sourceIds.has(a.id)));
        for (const o of [
          op("A", 2, { kind: "undo", target: f.a.id }),
          op("C", 2, { kind: "undo", target: f.c.id }),
          op("B", 2, { kind: "undo", target: f.b.id }),
          op("D", 2, { kind: "undo", target: f.d.id }),
        ]) {
          s = run(s, o);
          assert.deepEqual(
            visible(s, "other-cell"),
            copy,
            "source Undo cannot mutate detached copy",
          );
          assert.equal(JSON.stringify(fragment), saved);
        }
        assert.deepEqual(visible(s, "cell"), visible(f.initial, "cell"));
        s = run(s, op("E", 2, { kind: "undo", target: e.id }));
        assert.deepEqual(visible(s), visible(f.initial));
        s = run(s, op("E", 3, { kind: "undo", target: "E:s:2" }));
        assert.deepEqual(visible(s, "other-cell"), copy);
      });
