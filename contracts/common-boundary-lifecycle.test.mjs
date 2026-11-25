// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  fixture,
  view,
  conversion,
  remove,
  undo,
} from "./common-boundary-fixture.mjs";
import {
  planClearCells,
  previewTableDelete,
  planTableDelete,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { documentView } from "@cwhy/jade-core/document-read";
import { anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
for (const kind of ["two-lists", "direct-and-list"])
  for (const shape of ["body", "code"])
    for (const action of ["clear", "table"])
      test(`${kind} ${shape}: ${action} restores common source identities through Undo/Redo`, () => {
        const a = fixture("cell", kind);
        if (shape === "code") a.accept(conversion(a));
        a.accept(remove(a));
        const before = view(a),
          anchor = anchorAt(a.state, "b", 0, 4),
          selection = captureCellRange(a.state, "table", "cell", "cell"),
          h = a.header("clear");
        const planned =
          action === "clear"
            ? planClearCells(a.state, selection, h)
            : planTableDelete(a.state, selection, h, {
                preview: previewTableDelete(a.state, selection, "table"),
              });
        const deletion = a.accept({ ...h, intent: planned.intent });
        assert.notEqual(resolveAnchor(a.state, anchor).status, "exact");
        if (action === "clear") {
          const v = documentView(a.state);
          assert.equal(v.node("cell").children.length, 1);
          assert.equal(v.length(v.node("cell").children[0]), 0);
        } else assert.equal(a.state.nodes.table.live, false);
        const restoration = undo(a, deletion);
        assert.deepEqual(view(a), before);
        assert.equal(resolveAnchor(a.state, anchor).status, "exact");
        const redo = undo(a, restoration);
        undo(a, redo);
        assert.deepEqual(view(a), before);
      });
for (const action of ["clear", "table"])
  test(`${action}: peer conversion after review invalidates deletion without mutating the source`, () => {
    const a = fixture("cell", "two-lists"),
      selection = captureCellRange(a.state, "table", "cell", "cell"),
      h = a.header("clear");
    const planned =
      action === "clear"
        ? planClearCells(a.state, selection, h)
        : planTableDelete(a.state, selection, h, {
            preview: previewTableDelete(a.state, selection, "table"),
          });
    a.accept(conversion(a));
    a.reject({ ...h, intent: planned.intent });
    assert.deepEqual(view(a), [["code", "Alpha\nBeta", "plaintext"]]);
  });
for (const target of ["conversion", "boundary"])
  test(`Undo of retired ${target} rejects; restoring the cell keeps its original ownership`, () => {
    const a = fixture("cell", "two-lists"),
      merged = a.accept(conversion(a)),
      joined = a.accept(remove(a)),
      selection = captureCellRange(a.state, "table", "cell", "cell"),
      h = a.header("clear"),
      deleted = a.accept({
        ...h,
        intent: planClearCells(a.state, selection, h).intent,
      });
    const owned = target === "conversion" ? merged : joined;
    a.reject({
      ...a.header(owned.actor),
      intent: { kind: "undo", target: owned.id },
    });
    undo(a, deleted);
    assert.deepEqual(view(a), [["code", "AlphaBeta", "plaintext"]]);
    undo(a, owned);
    assert.deepEqual(
      view(a),
      target === "conversion"
        ? [["paragraph", "AlphaBeta"]]
        : [["code", "Alpha\nBeta", "plaintext"]],
    );
  });
