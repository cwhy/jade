// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seed, text } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
const cases = JSON.parse(
  readFileSync(new URL("./retained-order-fixtures.json", import.meta.url)),
);
for (const { trial, ranges, schedule } of cases)
  test(`Reduced retained erasure ordering schedule ${trial}`, () => {
    let s = seed(
        {
          doc: { id: "doc", type: "doc", live: true, children: ["p"] },
          p: { id: "p", type: "paragraph", live: true },
        },
        { p: [{ text: "abcdefghij", marks: ["strong"] }] },
      ),
      atoms = text(s, "p");
    const active = {},
      seq = {},
      last = {};
    for (const event of schedule) {
      const actor = event.actor;
      let intent;
      if (event.kind === "delete") {
        active[actor] = true;
        seq[actor] = 1;
        intent = {
          kind: "delete",
          ids: atoms.slice(...ranges[actor]).map((a) => a.id),
        };
      } else {
        active[actor] = !active[actor];
        seq[actor]++;
        intent = { kind: "undo", target: last[actor] };
      }
      const id = `${actor}:s:${seq[actor]}`;
      last[actor] = id;
      s = apply(s, {
        id,
        actor,
        stream: "s",
        seq: seq[actor],
        epoch: 1,
        intent,
      });
      validate(s);
      assert.deepEqual(
        text(s, "p"),
        atoms.filter(
          (a, i) =>
            !Object.entries(active).some(
              ([k, on]) => on && i >= ranges[k][0] && i < ranges[k][1],
            ),
        ),
        `trial ${trial}: ${id}`,
      );
    }
  });
