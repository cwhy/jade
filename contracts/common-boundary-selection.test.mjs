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
import { documentView } from "@cwhy/jade-core/document-read";
import { planReplace } from "@cwhy/jade-core/commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { gapAt, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    for (const joined of [false, true])
      test(`${parent} ${kind}: replacement spans ${joined ? "joined" : "separate"} Body sources and restores exact text`, () => {
        const a = fixture(parent, kind);
        if (joined) a.accept(remove(a));
        const anchor = anchorAt(a.state, "b", 0, 4),
          pointA = { block: "a", offset: 2 },
          pointB = joined
            ? { block: "a", offset: 7 }
            : { block: "b", offset: 2 },
          h = a.header("replace");
        const replacement = a.accept({
          ...h,
          intent: planReplace(
            a.state,
            captureRange(a.state, pointA, pointB),
            {
              version: 1,
              blocks: [
                { type: "paragraph", content: [{ text: "Z", marks: [] }] },
              ],
            },
            h,
            { strict: true },
          ).intent,
        });
        assert.deepEqual(view(a), [["paragraph", "AlZta"]]);
        const undone = undo(a, replacement);
        assert.deepEqual(
          view(a),
          joined
            ? [["paragraph", "AlphaBeta"]]
            : [
                ["paragraph", "Alpha"],
                ["paragraph", "Beta"],
              ],
        );
        assert.equal(resolveAnchor(a.state, anchor).status, "exact");
        undo(a, undone);
        assert.deepEqual(view(a), [["paragraph", "AlZta"]]);
      });
for (const parent of ["doc", "cell"])
  for (const peerFirst of [false, true])
    test(`${parent}: source-side offline typing survives cross-source replacement peerFirst=${peerFirst}`, () => {
      const a = fixture(parent, "two-lists"),
        h = a.header("replace"),
        replacement = {
          ...h,
          intent: planReplace(
            a.state,
            captureRange(
              a.state,
              { block: "a", offset: 2 },
              { block: "b", offset: 2 },
            ),
            {
              version: 1,
              blocks: [
                { type: "paragraph", content: [{ text: "Z", marks: [] }] },
              ],
            },
            h,
          ).intent,
        };
      const peer = {
        ...a.header("peer"),
        intent: { kind: "insert", at: gapAt(a.state, "b", 1), text: "X" },
      };
      if (peerFirst) a.accept(peer);
      a.accept(replacement);
      if (!peerFirst) a.accept(peer);
      undo(a, replacement);
      assert.deepEqual(view(a), [
        ["paragraph", "Alpha"],
        ["paragraph", "BXeta"],
      ]);
    });
for (const parent of ["doc", "cell"])
  for (const joined of [false, true])
    test(`${parent}: peer typing inside replacement follows the restored range joined=${joined}`, () => {
      const a = fixture(parent, "two-lists");
      if (joined) a.accept(remove(a));
      const h = a.header("replace");
      const replacement = a.accept({
        ...h,
        intent: planReplace(
          a.state,
          captureRange(
            a.state,
            { block: "a", offset: 2 },
            joined ? { block: "a", offset: 7 } : { block: "b", offset: 2 },
          ),
          {
            version: 1,
            blocks: [
              { type: "paragraph", content: [{ text: "Final", marks: [] }] },
            ],
          },
          h,
        ).intent,
      });
      a.accept({
        ...a.header("peer"),
        intent: {
          kind: "insert",
          at: documentView(a.state).gapAt("a", 4),
          text: "X",
        },
      });
      undo(a, replacement);
      assert.deepEqual(
        view(a),
        joined
          ? [["paragraph", "AlphaBeXta"]]
          : [
              ["paragraph", "Alpha"],
              ["paragraph", "BeXta"],
            ],
      );
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["two-lists", "direct-and-list"])
    for (const joined of [false, true])
      for (const side of ["before", "inside", "after"])
        for (const late of [false, true])
          test(`${parent} ${kind}: replacement ${side} contribution late=${late} joined=${joined} retains marks and independent Undo`, () => {
            const a = fixture(parent, kind);
            if (joined) a.accept(remove(a));
            const original = anchorAt(a.state, "b", 0, 4),
              h = a.header("replace");
            const replacement = a.accept({
              ...h,
              intent: planReplace(
                a.state,
                captureRange(
                  a.state,
                  { block: "a", offset: 2 },
                  joined
                    ? { block: "a", offset: 7 }
                    : { block: "b", offset: 2 },
                ),
                {
                  version: 1,
                  blocks: [
                    {
                      type: "paragraph",
                      content: [{ text: "Final", marks: [] }],
                    },
                  ],
                },
                h,
              ).intent,
            });
            const peer = {
              ...a.header("peer"),
              intent: {
                kind: "insert",
                at: documentView(a.state).gapAt(
                  "a",
                  { before: 2, inside: 4, after: 7 }[side],
                ),
                text: "X",
                marks: ["underline"],
              },
            };
            if (!late) a.accept(peer);
            const undone = undo(a, replacement);
            if (late) a.accept(peer);
            assert.deepEqual(
              view(a),
              joined
                ? [
                    [
                      "paragraph",
                      side === "before" ? "AlXphaBeta" : "AlphaBeXta",
                    ],
                  ]
                : side === "before"
                  ? [
                      ["paragraph", "AlXpha"],
                      ["paragraph", "Beta"],
                    ]
                  : [
                      ["paragraph", "Alpha"],
                      ["paragraph", "BeXta"],
                    ],
            );
            assert.equal(resolveAnchor(a.state, original).status, "exact");
            const values = () =>
              documentView(a.state)
                .node(parent)
                .children.flatMap((id) => documentView(a.state).text(id));
            assert.deepEqual(values().find((x) => x.char === "X").marks, [
              "underline",
            ]);
            const redone = undo(a, undone);
            assert.deepEqual(view(a), [
              [
                "paragraph",
                {
                  before: "AlXFinalta",
                  inside: "AlFiXnalta",
                  after: "AlFinalXta",
                }[side],
              ],
            ]);
            undo(a, peer);
            assert.deepEqual(view(a), [["paragraph", "AlFinalta"]]);
            undo(a, redone);
            assert.deepEqual(
              view(a),
              joined
                ? [["paragraph", "AlphaBeta"]]
                : [
                    ["paragraph", "Alpha"],
                    ["paragraph", "Beta"],
                  ],
            );
          });
for (const parent of ["doc", "cell"])
  for (const content of ["", "One\nTwo"])
    test(`${parent}: empty or literal multiline replacement retains exact source identities: ${JSON.stringify(content)}`, () => {
      const a = fixture(parent, "two-lists"),
        h = a.header("replace"),
        original = anchorAt(a.state, "b", 0, 4);
      const replacement = a.accept({
        ...h,
        intent: planReplace(
          a.state,
          captureRange(
            a.state,
            { block: "a", offset: 2 },
            { block: "b", offset: 2 },
          ),
          {
            version: 1,
            blocks: [
              { type: "paragraph", content: [{ text: content, marks: [] }] },
            ],
          },
          h,
        ).intent,
      });
      assert.deepEqual(view(a), [["paragraph", `Al${content}ta`]]);
      const u = undo(a, replacement);
      assert.deepEqual(view(a), [
        ["paragraph", "Alpha"],
        ["paragraph", "Beta"],
      ]);
      assert.equal(resolveAnchor(a.state, original).status, "exact");
      undo(a, u);
      assert.deepEqual(view(a), [["paragraph", `Al${content}ta`]]);
    });
test("replacement end cannot escape retained source scope", () => {
  const a = fixture("doc", "two-lists", { contextParagraphs: 1 }),
    h = a.header("replace"),
    intent = planReplace(
      a.state,
      captureRange(
        a.state,
        { block: "a", offset: 2 },
        { block: "b", offset: 2 },
      ),
      {
        version: 1,
        blocks: [
          { type: "paragraph", content: [{ text: "Final", marks: [] }] },
        ],
      },
      h,
    ).intent;
  // A valid gap in an unrelated cell/document must not authorize a different container.
  a.reject({
    ...h,
    intent: {
      ...intent,
      end: {
        codec: 2,
        text: "missing",
        generation: 0,
        offset: 0,
        left: null,
        right: null,
        before: [],
        after: [],
      },
    },
  });
});
