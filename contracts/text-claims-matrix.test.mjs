// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { immutable } from "@cwhy/jade-core/immutability";
const op = (actor, seq, intent) => ({
  id: `${actor}:s:${seq}`,
  actor,
  stream: "s",
  seq,
  epoch: 1,
  intent,
});
const initial = immutable(
    seed(
      {
        doc: { id: "doc", type: "doc", live: true, children: ["p"] },
        p: { id: "p", type: "paragraph", live: true },
      },
      { p: [{ text: "abcdef", marks: ["strong"] }] },
    ),
  ),
  atoms = text(initial, "p");
const ranges = [];
for (let a = 0; a < 6; a++)
  for (let b = a + 1; b <= 6; b++) ranges.push([a, b]);
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const first of ["A", "B"])
    test(`Deletion interval oracle arrival=${arrival} Undo=${first}: 441 overlapping/adjacent/disjoint pairs`, () => {
      for (const ar of ranges)
        for (const br of ranges) {
          let s = initial;
          const sets = {
              A: atoms.slice(...ar).map((a) => a.id),
              B: atoms.slice(...br).map((a) => a.id),
            },
            active = { A: false, B: false },
            seq = { A: 1, B: 1 },
            target = { A: "A:s:1", B: "B:s:1" },
            message = JSON.stringify({ arrival, first, ar, br });
          const check = () =>
            assert.deepEqual(
              text(s, "p"),
              atoms.filter(
                (a) =>
                  !Object.keys(active).some(
                    (k) => active[k] && sets[k].includes(a.id),
                  ),
              ),
              message,
            );
          const step = (o) => {
            const prior = s,
              before = JSON.stringify(s);
            s = immutable(apply(s, o));
            assert.equal(JSON.stringify(prior), before);
            validate(s);
            check();
          };
          for (const a of arrival) {
            active[a] = true;
            step(op(a, 1, { kind: "delete", ids: sets[a] }));
          }
          for (const a of [
            first,
            first === "A" ? "B" : "A",
            first,
            first === "A" ? "B" : "A",
            first,
            first === "A" ? "B" : "A",
          ]) {
            active[a] = !active[a];
            const o = op(a, ++seq[a], { kind: "undo", target: target[a] });
            target[a] = o.id;
            step(o);
            s = immutable(JSON.parse(JSON.stringify(s)));
          }
        }
    });
