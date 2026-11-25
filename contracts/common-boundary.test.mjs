// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { documentView } from "@cwhy/jade-core/document-read";
import {
  previewConversion,
  planConversion,
  previewListConversion,
  planListConversion,
} from "@cwhy/jade-core/conversion";
import {
  planDelete,
  planEnter,
  planCodeLanguage,
  codeLanguageState,
} from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import {
  fixture,
  view,
  conversion,
  remove,
  undo,
  anchorCheck,
} from "./common-boundary-fixture.mjs";
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    for (const early of [false, true])
      for (const joinFirst of [false, true])
        test(`${parent} ${kind}: shared origins, deletion and independent Undo early=${early} joinFirst=${joinFirst}`, () => {
          const a = fixture(parent, kind),
            anchor = anchorAt(a.state, "b", 0, 4),
            ids = text(a.state, "b").map((x) => x.id),
            merge = conversion(a);
          const peer = {
            ...a.header("peer"),
            intent: { kind: "insert", at: gapAt(a.state, "b", 2), text: "X" },
          };
          let deletion;
          if (early) {
            deletion = remove(a);
            a.accept(deletion);
          }
          a.accept(merge);
          if (!early) {
            deletion = remove(a);
            a.accept(deletion);
          }
          a.accept(peer);
          assert.deepEqual(view(a), [["code", "AlphaBeXta", "plaintext"]]);
          anchorCheck(a, anchor, ids);
          const order = joinFirst ? [deletion, merge] : [merge, deletion];
          let first = undo(a, order[0]);
          assert.deepEqual(
            view(a),
            joinFirst
              ? [["code", "Alpha\nBeXta", "plaintext"]]
              : [["paragraph", "AlphaBeXta"]],
          );
          let second = undo(a, order[1]);
          assert.deepEqual(view(a), [
            ["paragraph", "Alpha"],
            ["paragraph", "BeXta"],
          ]);
          anchorCheck(a, anchor, ids);
          undo(a, second);
          undo(a, first);
          assert.deepEqual(view(a), [["code", "AlphaBeXta", "plaintext"]]);
        });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    for (const enterFirst of [false, true])
      test(`${parent} ${kind}: offline Enter inside left source enterFirst=${enterFirst}`, () => {
        const a = fixture(parent, kind),
          merge = conversion(a),
          h = a.header("enter"),
          point = { block: "a", offset: 2 };
        const enter = {
          ...h,
          intent: planEnter(a.state, captureRange(a.state, point, point), h)
            .intent,
        };
        if (enterFirst) a.accept(enter);
        a.accept(merge);
        if (!enterFirst) a.accept(enter);
        assert.deepEqual(view(a), [["code", "Al\npha\nBeta", "plaintext"]]);
        const deletion = a.accept(remove(a));
        assert.deepEqual(view(a), [["code", "Al\nphaBeta", "plaintext"]]);
        undo(a, merge);
        assert.deepEqual(view(a), [
          ["paragraph", "Al"],
          ["paragraph", "phaBeta"],
        ]);
        undo(a, deletion);
        assert.deepEqual(view(a), [
          ["paragraph", "Al"],
          ["paragraph", "pha"],
          ["paragraph", "Beta"],
        ]);
        undo(a, enter);
        assert.deepEqual(view(a), [
          ["paragraph", "Alpha"],
          ["paragraph", "Beta"],
        ]);
      });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    for (const enterFirst of [false, true])
      test(`${parent} ${kind}: a captured join follows offline source descendants enterFirst=${enterFirst}`, () => {
        const a = fixture(parent, kind),
          deletion = remove(a),
          h = a.header("enter"),
          point = { block: "a", offset: 2 };
        const enter = {
          ...h,
          intent: planEnter(a.state, captureRange(a.state, point, point), h)
            .intent,
        };
        if (enterFirst) a.accept(enter);
        a.accept(deletion);
        if (!enterFirst) a.accept(enter);
        assert.deepEqual(view(a), [
          ["paragraph", "Al"],
          ["paragraph", "phaBeta"],
        ]);
        undo(a, enter);
        assert.deepEqual(view(a), [["paragraph", "AlphaBeta"]]);
        undo(a, deletion);
        assert.deepEqual(view(a), [
          ["paragraph", "Alpha"],
          ["paragraph", "Beta"],
        ]);
      });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    test(`${parent} ${kind}: styles suspend the seam and merged ownership retains original sources`, () => {
      const a = fixture(parent, kind),
        deletion = a.accept(remove(a)),
        merge = a.accept(conversion(a));
      assert.deepEqual(view(a), [["code", "AlphaBeta", "plaintext"]]);
      const h = a.header("follow"),
        body = a.accept({
          ...h,
          intent: planConversion(
            a.state,
            previewConversion(a.state, parent, ["a", "b"], "paragraph"),
            h,
          ).intent,
        });
      assert.deepEqual(view(a), [["paragraph", "AlphaBeta"]]);
      undo(a, body);
      assert.deepEqual(view(a), [["code", "AlphaBeta", "plaintext"]]);
      const unmerge = undo(a, merge);
      assert.deepEqual(view(a), [["paragraph", "AlphaBeta"]]);
      const sourceBody = {
        actor: "body",
        id: kind === "two-lists" ? "body:s:2" : "body:s:1",
      };
      const scoped = undo(a, sourceBody);
      assert.deepEqual(view(a), [
        ["paragraph", "Alpha"],
        ["code", "Beta", "sql"],
      ]);
      undo(a, scoped);
      assert.deepEqual(view(a), [["paragraph", "AlphaBeta"]]);
      undo(a, unmerge);
      const seed = {
        actor: "seed",
        id: kind === "two-lists" ? "seed:s:2" : "seed:s:1",
      };
      undo(a, seed);
      assert.deepEqual(view(a), [["code", "AlphaBeta", "plaintext"]]);
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    test(`${parent} ${kind}: common conversion formatting review owns only captured marks`, () => {
      const a = fixture(parent, kind),
        ids = text(a.state, "b").map((x) => x.id),
        h = a.header("format");
      a.accept({
        ...h,
        intent: { kind: "format", ids, property: "strong", value: "strong" },
      });
      const c = a.header("merge"),
        preview = previewConversion(a.state, parent, ["a", "b"], "code");
      assert.equal(preview.loss.formattedCharacters, 4);
      const op = a.accept({
        ...c,
        intent: planConversion(a.state, preview, c, { confirmLoss: true })
          .intent,
      });
      assert.ok(
        documentView(a.state)
          .text("a")
          .filter((x) => ids.includes(x.id))
          .every((x) => x.marks.length === 0),
      );
      undo(a, op);
      assert.ok(text(a.state, "b").every((x) => x.marks.includes("strong")));
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    for (const empty of ["a", "b"])
      test(`${parent} ${kind}: empty ${empty} source retains independent typing across a hidden seam`, () => {
        const a = fixture(parent, kind, { empty }),
          before = gapAt(a.state, empty, 0),
          deletion = a.accept(remove(a));
        a.accept({
          ...a.header("peer"),
          intent: { kind: "insert", at: before, text: "中" },
        });
        assert.deepEqual(view(a), [
          ["paragraph", empty === "a" ? "中Beta" : "Alpha中"],
        ]);
        undo(a, deletion);
        assert.deepEqual(view(a), [
          ["paragraph", empty === "a" ? "中" : "Alpha"],
          ["paragraph", empty === "b" ? "中" : "Beta"],
        ]);
      });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    test(`${parent} ${kind}: unselected numbering survives origin merge and peer split`, () => {
      const a = fixture(parent, kind, { tail: true }),
        h = a.header("merge"),
        merge = a.accept({
          ...h,
          intent: planConversion(
            a.state,
            previewConversion(a.state, parent, ["a", "b"], "code"),
            h,
          ).intent,
        });
      const numbers = () => {
        const v = documentView(a.state);
        return v
          .node(parent)
          .children.flatMap((id) =>
            v.node(id).type === "ordered_list"
              ? v.listMarkers(id).map((x) => x.number)
              : [],
          );
      };
      assert.deepEqual(numbers(), [2]);
      const deletion = a.accept(remove(a));
      assert.deepEqual(numbers(), [2]);
      undo(a, merge);
      assert.deepEqual(numbers(), [2]);
      undo(a, deletion);
      assert.deepEqual(numbers(), [2]);
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    test(`${parent} ${kind}: no boundary command may cross an image`, () => {
      const a = fixture(parent, kind, { barrier: true }),
        h = a.header("delete"),
        point = { block: "a", offset: 5 };
      assert.equal(
        planDelete(a.state, captureRange(a.state, point, point), "forward", h)
          .intent,
        null,
      );
      const clean = fixture(parent, kind),
        forged = { ...a.header("forged"), intent: remove(clean).intent };
      a.reject(forged);
      assert.throws(() =>
        previewConversion(a.state, parent, ["a", "b"], "code"),
      );
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: forged origin membership and external boundary activation reject`, () => {
    const a = fixture(parent, "two-lists"),
      merge = conversion(a);
    merge.intent.origins[0].scope = "lb";
    a.reject(merge);
    a.reject({
      ...a.header("attacker"),
      intent: { kind: "displayJoinActive", target: "not-owned", active: false },
    });
  });
import { planReplace } from "@cwhy/jade-core/commands";
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    test(`${parent} ${kind}: selected code separator uses the same boundary ownership`, () => {
      const a = fixture(parent, kind),
        merge = a.accept(conversion(a)),
        h = a.header("replace");
      const op = a.accept({
        ...h,
        intent: planReplace(
          a.state,
          captureRange(
            a.state,
            { block: "a", offset: 5 },
            { block: "a", offset: 6 },
          ),
          { version: 1, blocks: [{ type: "paragraph", content: [] }] },
          h,
        ).intent,
      });
      assert.deepEqual(view(a), [["code", "AlphaBeta", "plaintext"]]);
      undo(a, merge);
      assert.deepEqual(view(a), [["paragraph", "AlphaBeta"]]);
      undo(a, op);
      assert.deepEqual(view(a), [
        ["paragraph", "Alpha"],
        ["paragraph", "Beta"],
      ]);
    });
for(const parent of ['doc','cell'])for(const reverse of [false,true])test(`${parent}: three source boundaries restore independently reverse=${reverse}`,()=>{
 const a=fixture(parent,'two-lists',{third:true}),merge=a.accept(conversion(a)),first=a.accept(remove(a));
 const h=a.header('second'),p={block:'a',offset:9},second=a.accept({...h,intent:planDelete(a.state,captureRange(a.state,p,p),'forward',h).intent});
 assert.deepEqual(view(a),[['code','AlphaBetaGamma','plaintext']]);undo(a,merge);assert.deepEqual(view(a),[['paragraph','AlphaBetaGamma']]);
 undo(a,reverse?second:first);assert.deepEqual(view(a),reverse?[['paragraph','AlphaBeta'],['paragraph','Gamma']]:[['paragraph','Alpha'],['paragraph','BetaGamma']]);
 undo(a,reverse?first:second);assert.deepEqual(view(a),[['paragraph','Alpha'],['paragraph','Beta'],['paragraph','Gamma']]);
});
