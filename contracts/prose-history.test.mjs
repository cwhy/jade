// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  validate,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { plainFragment } from "@cwhy/jade-core/fragment";
import { planReplace, planEnter } from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const range = (s, a, i, b = a, j = i) =>
  captureRange(s, { block: a, offset: i }, { block: b, offset: j });
for (const container of ["doc", "cell"])
  for (const peerFirst of [false, true])
    for (const restoredEdge of [3, 4, 5])
      test(`Prose restoration retains earlier Undo marker affiliation ${container} peerFirst=${peerFirst} edge=${restoredEdge}`, () => {
        const nodes = {
          doc: {
            id: "doc",
            type: "doc",
            live: true,
            children: container === "doc" ? ["p"] : ["table"],
          },
          p: { id: "p", type: "paragraph", live: true },
        };
        if (container === "cell")
          Object.assign(nodes, {
            table: {
              id: "table",
              type: "table",
              live: true,
              children: ["row"],
            },
            row: { id: "row", type: "row", live: true, children: ["cell"] },
            cell: { id: "cell", type: "cell", live: true, children: ["p"] },
          });
        let s = seed(nodes, {
          p: [{ text: "Cell content here", marks: [{ type: "strong" }] }],
        });
        const root = s,
          logical = (s) =>
            s.nodes[container].children.map((id) => ({
              id,
              atoms: text(s, id),
            })),
          original = logical(s),
          anchor = anchorAt(s, "p", 0, 17);
        const history = op(
          "H",
          1,
          planReplace(
            s,
            range(s, "p", 1, "p", restoredEdge),
            plainFragment("XYZ"),
            op("H", 1),
          ).intent,
        );
        s = apply(s, history);
        const priorReplaced = logical(s);
        s = apply(s, op("H", 2, { kind: "undo", target: history.id }));
        assert.deepEqual(logical(s), original);
        const split = op(
          "A",
          1,
          planEnter(s, range(s, "p", 6), op("A", 1)).intent,
        );
        s = apply(s, split);
        const tail = s.nodes[container].children[1],
          before = s;
        const peer = op(
            "B",
            1,
            planEnter(s, range(s, tail, 1), op("B", 1)).intent,
          ),
          replace = op(
            "A",
            2,
            planReplace(
              s,
              range(s, "p", 2, tail, 3),
              plainFragment("first\nsecond"),
              op("A", 2),
            ).intent,
          );
        for (const mutation of peerFirst ? [peer, replace] : [replace, peer])
          s = apply(s, mutation);
        const concurrent = logical(s);
        s = JSON.parse(JSON.stringify(s));
        s = apply(s, op("A", 3, { kind: "undo", target: replace.id }));
        assert.deepEqual(logical(s), logical(apply(before, peer)));
        assert.deepEqual(
          resolveAnchor(s, anchor).segments.map((x) => x.id),
          anchor.atoms,
        );
        s = apply(s, op("A", 4, { kind: "undo", target: "A:s:3" }));
        assert.deepEqual(logical(s), concurrent);
        s = apply(s, op("A", 5, { kind: "undo", target: "A:s:4" }));
        s = apply(s, op("B", 2, { kind: "undo", target: peer.id }));
        s = apply(s, op("A", 6, { kind: "undo", target: split.id }));
        assert.deepEqual(logical(s), original);
        s = apply(s, op("H", 3, { kind: "undo", target: "H:s:2" }));
        assert.deepEqual(logical(s), priorReplaced);
        s = apply(s, op("H", 4, { kind: "undo", target: "H:s:3" }));
        assert.deepEqual(logical(s), logical(root));
        validate(s);
      });
