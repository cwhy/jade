// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { planReplace } from "@cwhy/jade-core/commands";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
for (const block of ["body", "first", "list-text", "code"])
  for (const peerFirst of [false, true])
    for (const styled of [false, true])
      test(`Whole text replacement ${block} peerFirst=${peerFirst} styled=${styled}`, () => {
        const s =
            block === "body"
              ? seed(
                  {
                    doc: {
                      id: "doc",
                      type: "doc",
                      live: true,
                      children: ["body"],
                    },
                    body: { id: "body", type: "paragraph", live: true },
                  },
                  { body: [{ text: "Original body", marks: ["strong"] }] },
                )
              : tableFixture(),
          original = text(s, block),
          range = captureRange(
            s,
            { block, offset: 0 },
            { block, offset: original.length },
          ),
          fragment = {
            version: 1,
            blocks: [
              {
                type: "paragraph",
                content: [
                  {
                    text: "Replacement 🙂",
                    marks: styled ? [{ type: "em" }] : [],
                  },
                ],
              },
            ],
          },
          a = op("A", 1),
          plan = planReplace(s, range, fragment, a, { strict: true });
        a.intent = plan.intent;
        assert.deepEqual(
          apply(s, a),
          plan.state,
          "public plan and admitted result agree",
        );
        assert.equal(
          text(plan.state, block)
            .map((a) => a.char)
            .join(""),
          "Replacement 🙂",
        );
        const d = op("D", 1, {
          kind: "insert",
          at: gapAt(s, block, 3),
          text: "peer",
          marks: ["underline"],
        });
        let n = s;
        for (const o of peerFirst ? [d, a] : [a, d]) n = apply(n, o);
        validate(n);
        assert.equal(
          text(n, block).filter((x) => x.id.startsWith("D:")).length,
          4,
        );
        const edited = text(n, block);
        n = apply(n, op("A", 2, { kind: "undo", target: a.id }));
        assert.deepEqual(text(n, block), text(apply(s, d), block));
        n = apply(n, op("A", 3, { kind: "undo", target: "A:s:2" }));
        assert.deepEqual(text(n, block), edited);
        n = apply(n, op("A", 4, { kind: "undo", target: "A:s:3" }));
        n = apply(n, op("D", 2, { kind: "undo", target: d.id }));
        assert.deepEqual(text(n, block), original);
      });
test("Whole text replacement does not admit arbitrary future boundary IDs", () => {
  const s = tableFixture(),
    ids = text(s, "first").map((x) => x.id),
    before = structuredClone(s);
  assert.throws(
    () =>
      apply(
        s,
        op("A", 1, {
          kind: "batch",
          intents: [
            { kind: "delete", ids },
            {
              kind: "insert",
              at: { codec: 3, boundary: "forged-future-boundary" },
              text: "x",
            },
          ],
        }),
      ),
    /unknown gap boundary/,
  );
  assert.deepEqual(s, before);
});
