// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, anchorAt, resolveAnchor } from "@cwhy/jade-core/model";
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
for (let trial = 0; trial < 256; trial++)
  test(`Five independent deletion owners schedule ${trial}`, () => {
    let random = trial + 1;
    const rand = (n) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random % n;
    };
    let s = immutable(
      seed(
        {
          doc: { id: "doc", type: "doc", live: true, children: ["p"] },
          p: { id: "p", type: "paragraph", live: true },
        },
        { p: [{ text: "abcdefghij", marks: ["strong"] }] },
      ),
    );
    const original = text(s, "p"),
      anchor = anchorAt(s, "p", 0, 10),
      actors = ["A", "B", "C", "D", "E"],
      targets = {},
      active = {},
      seq = {},
      last = {};
    for (const a of actors) {
      const start = rand(10),
        end = start + 1 + rand(10 - start);
      targets[a] = original.slice(start, end).map((a) => a.id);
      seq[a] = 1;
      last[a] = `${a}:s:1`;
      active[a] = false;
    }
    const order = [...actors];
    for (let i = 4; i > 0; i--) {
      const j = rand(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const step = (o) => {
      const before = JSON.stringify(s),
        prior = s;
      s = immutable(apply(s, o));
      assert.equal(JSON.stringify(prior), before);
      validate(s);
      assert.deepEqual(
        text(s, "p"),
        original.filter(
          (x) => !actors.some((a) => active[a] && targets[a].includes(x.id)),
        ),
        `trial=${trial} action=${o.id}`,
      );
    };
    for (const a of order) {
      active[a] = true;
      step(op(a, 1, { kind: "delete", ids: targets[a] }));
    }
    for (let i = 0; i < 30; i++) {
      const a = actors[rand(5)],
        o = op(a, ++seq[a], { kind: "undo", target: last[a] });
      last[a] = o.id;
      active[a] = !active[a];
      step(o);
      if (i % 3 === 0) s = immutable(JSON.parse(JSON.stringify(s)));
    }
    for (const a of actors)
      if (active[a]) {
        active[a] = false;
        const o = op(a, ++seq[a], { kind: "undo", target: last[a] });
        step(o);
        last[a] = o.id;
      }
    assert.deepEqual(text(s, "p"), original);
    assert.equal(resolveAnchor(s, anchor).status, "exact");
  });
