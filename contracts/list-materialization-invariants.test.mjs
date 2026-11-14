// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  apply,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
import { immutable } from "@cwhy/jade-core/immutability";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { probeDelete } from "@cwhy/jade-testkit/list-probe";
import { captureRange } from "@cwhy/jade-core/selection";
import { planListEnter } from "@cwhy/jade-core/list-commands";

const logical = (s) => {
  const result = [];
  function walk(id) {
    const n = s.nodes[id];
    result.push({
      id,
      type: n.type,
      children: n.children,
      ...(n.text ? { atoms: text(s, id) } : {}),
    });
    for (const child of n.children || []) walk(child);
  }
  walk(s.root);
  return result;
};
const value = (s, b) =>
  text(s, b)
    .map((a) => a.char)
    .join("");
const count = (s) => ({
  replicas: Object.keys(s.replicas).length,
  lineage: s.lineage.length,
  boundaries: Object.keys(s.boundaries).length,
});
const run = (s, id, intent, actor = "A") =>
  immutable(apply(s, { id, intent, actor, epoch: 1 }));
const undo = (s, id, target, actor = "A") =>
  run(s, id, { kind: "undo", target }, actor);
function join(s, id, block = "ap") {
  const p = { block, offset: s.replicas[s.nodes[block].text].length },
    op = { id, actor: "A", epoch: 1 };
  return run(s, id, probeDelete(s, captureRange(s, p, p), op).intent);
}
function enter(s, id, block, offset) {
  const p = { block, offset },
    op = { id, actor: "B", epoch: 1 };
  return run(s, id, planListEnter(s, captureRange(s, p, p), op).intent, "B");
}
const reload = (s) => {
  const result = immutable(JSON.parse(JSON.stringify(s)));
  validate(result);
  return result;
};

test("join materialization allocates no replica generations across 200 cycles and decode", () => {
  const initial = listFixture({ cell: true });
  let s = join(initial, "join");
  const expected = logical(s),
    baseline = count(s),
    before = JSON.stringify(initial);
  let target = "join";
  for (let i = 0; i < 200; i++) {
    s = undo(s, `u:${i}`, target);
    assert.deepEqual(logical(s), logical(initial));
    s = undo(s, `r:${i}`, `u:${i}`);
    target = `r:${i}`;
    assert.deepEqual(logical(s), expected);
    if (i % 20 === 0) s = reload(s);
    assert.deepEqual(count(s), baseline);
  }
  assert.equal(
    JSON.stringify(initial),
    before,
    "Published predecessor must remain immutable",
  );
});

for (const emptyLeft of [false, true])
  for (const emptyRight of [false, true])
    for (const peerFirst of [false, true])
      for (const block of ["ap", "bp"])
        test(`offline source gap survives toggles leftEmpty=${emptyLeft} rightEmpty=${emptyRight} peerFirst=${peerFirst} block=${block}`, () => {
          const nodes = structuredClone(listFixture().nodes);
          const initial = immutable(
            seed(nodes, {
              ap: [{ text: emptyLeft ? "" : "aaaa" }],
              bp: [{ text: emptyRight ? "" : "bbbb" }],
              cp: [{ text: "cccc" }],
            }),
          );
          const before = JSON.stringify(initial),
            size = text(initial, block).length,
            offset = size ? 2 : 0;
          const pending = {
            kind: "insert",
            at: gapAt(initial, block, offset),
            text: "中",
            marks: ["strong"],
          };
          let s = initial;
          if (peerFirst) s = run(s, "peer", pending, "B");
          s = join(s, "join");
          let target = "join";
          for (let i = 0; i < 5; i++) {
            s = undo(s, `u:${i}`, target);
            s = undo(s, `r:${i}`, `u:${i}`);
            target = `r:${i}`;
            s = reload(s);
          }
          if (!peerFirst) s = run(s, "peer", pending, "B");
          s = undo(s, "final-unjoin", target);
          const old = value(initial, block);
          assert.equal(
            value(s, block),
            old.slice(0, offset) + "中" + old.slice(offset),
          );
          s = undo(s, "undo-peer", "peer", "B");
          assert.deepEqual(logical(s), logical(initial));
          assert.equal(JSON.stringify(initial), before);
        });

for (const source of ["ap", "bp"])
  for (const side of ["left", "right"])
    test(`all authored witnesses erased after reuse, offline insertion restored source=${source} affinity=${side}`, () => {
      const initial = listFixture({ cell: true }),
        pending = {
          kind: "insert",
          at: gapAt(initial, source, 2, side),
          text: "中",
          marks: ["strong"],
        },
        anchor = anchorAt(initial, source, 0, 4);
      let s = join(initial, "join"),
        target = "join";
      for (let i = 0; i < 5; i++) {
        s = undo(s, `u:${i}`, target);
        s = undo(s, `r:${i}`, `u:${i}`);
        target = `r:${i}`;
      }
      s = run(s, "erase", {
        kind: "delete",
        ids: text(s, "ap").map((a) => a.id),
      });
      s = run(reload(s), "peer", pending, "B");
      s = undo(s, "restore", "erase");
      s = undo(s, "unjoin", target);
      assert.equal(
        value(s, source),
        (source === "ap" ? "aa" : "bb") +
          "中" +
          (source === "ap" ? "aa" : "bb"),
      );
      assert.equal(resolveAnchor(s, anchor).status, "exact");
      s = undo(s, "undo-peer", "peer", "B");
      assert.deepEqual(logical(s), logical(initial));
    });

for (const offset of [0, 2, 4, 6, 8])
  test(`long mixed Enter/typing/erasure/Undo through joined view offset=${offset}`, () => {
    const initial = listFixture({ cell: true });
    let s = join(initial, "join");
    const expected = logical(s),
      base = count(s);
    let target = "join";
    for (let cycle = 0; cycle < 30; cycle++) {
      const prefix = `mixed:${cycle}`,
        pending = {
          kind: "insert",
          at: gapAt(s, "ap", offset),
          text: "中🙂",
          marks: ["strong"],
        };
      s = run(s, `${prefix}:type`, pending, "B");
      s = enter(s, `${prefix}:enter`, "ap", offset);
      s = undo(s, `${prefix}:unenter`, `${prefix}:enter`, "B");
      s = run(
        s,
        `${prefix}:erase`,
        {
          kind: "delete",
          ids: text(s, "ap")
            .filter((a) => a.id.startsWith(`${prefix}:type:char:`))
            .map((a) => a.id),
        },
        "B",
      );
      s = undo(s, `${prefix}:restore`, `${prefix}:erase`, "B");
      s = undo(s, `${prefix}:untype`, `${prefix}:type`, "B");
      s = undo(s, `${prefix}:unjoin`, target);
      assert.deepEqual(logical(s), logical(initial));
      s = undo(s, `${prefix}:rejoin`, `${prefix}:unjoin`);
      target = `${prefix}:rejoin`;
      if (cycle % 5 === 0) s = reload(s);
      assert.deepEqual(logical(s), expected);
      // Two semantic list partitions per Enter, then one on its Undo. Projection
      // must add no generations beyond these authored structural transitions.
      assert.equal(count(s).replicas, base.replicas + 3 * (cycle + 1));
    }
  });

test("older snapshots cannot be accepted as the current codec", () => {
  const s = structuredClone(listFixture());
  assert.equal(s.storageCodec, 44);
  s.storageCodec = 9;
  assert.throws(
    () =>
      apply(s, {
        id: "bad",
        actor: "A",
        epoch: 1,
        intent: { kind: "insert", at: {}, text: "x" },
      }),
    /Incompatible storage codec/,
  );
});

// A logical start marker inside a joined view must follow edits before it.
// Unjoining can look correct while a later cut toggle reveals a stale marker.
import { planEnter, planDelete } from "@cwhy/jade-core/commands";
for (const grammar of ["list", "prose"])
  for (const offset of [0, 1, 2])
    for (const peerFirst of [false, true])
      test(`logical start follows joined typing grammar=${grammar} offset=${offset} peerFirst=${peerFirst}`, () => {
        const initial =
          grammar === "list"
            ? listFixture({ cell: true })
            : seed(
                {
                  doc: { id: "doc", type: "doc", children: ["ap"], live: true },
                  ap: { id: "ap", type: "paragraph", live: true },
                },
                { ap: [{ text: "aaaa" }] },
              );
        const original = text(initial, "ap"),
          suffix = grammar === "list" ? "list-tail" : "paragraph";
        const range = (s, block, offset) =>
          captureRange(s, { block, offset }, { block, offset });
        let s = run(
          initial,
          "cut-one",
          planEnter(initial, range(initial, "ap", 1), {
            id: "cut-one",
            actor: "A",
            epoch: 1,
          }).intent,
        );
        const middle = `cut-one:${suffix}`,
          last = `cut-two:${suffix}`;
        s = run(
          s,
          "cut-two",
          planEnter(s, range(s, middle, 2), {
            id: "cut-two",
            actor: "A",
            epoch: 1,
          }).intent,
        );
        const peer = {
            kind: "insert",
            at: gapAt(s, middle, offset),
            text: "友",
            marks: ["strong"],
          },
          joined = planDelete(s, range(s, middle, 2), "forward", {
            id: "join",
            actor: "A",
            epoch: 1,
          }).intent;
        if (peerFirst) s = run(s, "peer", peer, "B");
        s = run(s, "join", joined);
        if (!peerFirst) s = run(s, "peer", peer, "B");
        s = undo(reload(s), "unjoin", "join");
        const added = { id: "peer:char:0", char: "友", marks: ["strong"] },
          expected = [
            ...original.slice(1, 1 + offset),
            added,
            ...original.slice(1 + offset, 3),
          ];
        assert.deepEqual(text(s, middle), expected);
        assert.deepEqual(text(s, last), original.slice(3));
        s = undo(s, "uncut-one", "cut-one");
        for (let cycle = 0; cycle < 3; cycle++) {
          assert.deepEqual(text(s, "ap"), [original[0], ...expected]);
          assert.deepEqual(text(s, last), original.slice(3));
          s = undo(
            reload(s),
            `redo-one:${cycle}`,
            cycle ? `undo-one:${cycle - 1}` : "uncut-one",
          );
          assert.deepEqual(text(s, middle), expected);
          s = undo(s, `undo-one:${cycle}`, `redo-one:${cycle}`);
        }
        s = undo(s, "uncut-two", "cut-two");
        s = undo(s, "unpeer", "peer", "B");
        assert.deepEqual(text(s, "ap"), original);
        validate(s);
      });
