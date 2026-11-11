// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import {
  apply,
  text,
  gapAt,
  resolveGap,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
import { immutable } from "@cwhy/jade-core/immutability";
import { planListEnter } from "@cwhy/jade-core/list-commands";
import { captureRange } from "@cwhy/jade-core/selection";
import { Room, Client } from "@cwhy/jade-testkit/peers";
const op = (id, intent, actor = "A") => ({ id, actor, epoch: 1, intent });
const logical = (s) => {
  const rows = [];
  function walk(id) {
    const n = s.nodes[id];
    rows.push({
      id,
      type: n.type,
      children: n.children,
      asset: n.asset,
      ...(n.text ? { atoms: text(s, id) } : {}),
    });
    for (const c of n.children || []) walk(c);
  }
  walk(s.root);
  return rows;
};
const value = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const run = (s, e) => immutable(apply(s, e));
const undo = (s, target = "key", id = "undo", actor = "A") =>
  run(s, op(id, { kind: "undo", target }, actor));
const scenarios = [];
for (const parent of [false, true])
  for (const [name, start, end] of [
    ["middle", 1, 3],
    ["prefix", 0, 2],
    ["suffix", 2, 4],
    ["all", 0, 4],
  ])
    scenarios.push({
      name: `${parent ? "parent" : "leaf"}-${name}`,
      parent,
      start: { block: "ap", offset: start },
      end: { block: "ap", offset: end },
      single: true,
    });
scenarios.push(
  {
    name: "siblings",
    parent: false,
    start: { block: "ap", offset: 1 },
    end: { block: "bp", offset: 2 },
    single: false,
  },
  {
    name: "parent-child",
    parent: true,
    start: { block: "ap", offset: 1 },
    end: { block: "childp", offset: 2 },
    single: false,
  },
);
for (const scenario of scenarios)
  for (const backwards of [false, true])
    test(`reference ${scenario.name} backwards=${backwards}`, () => {
      const { parent, start, end, single } = scenario,
        s = listFixture({ cell: true, parent }),
        a = anchorAt(s, "ap", 0, 4),
        range = captureRange(
          s,
          backwards ? end : start,
          backwards ? start : end,
        ),
        p = planListEnter(s, range, op("key")),
        n = run(s, op("key", p.intent));
      validate(n);
      const caret = resolveGap(n, p.after);
      assert.equal(caret.offset, 0);
      assert.equal(value(n, "ap"), "aaaa".slice(0, start.offset));
      if (single) {
        assert.equal(value(n, caret.block), "aaaa".slice(end.offset));
        const newItem = Object.values(n.nodes).find(
          (x) =>
            x.live &&
            x.type === "list_item" &&
            x.children.includes(caret.block),
        );
        if (start.offset === 0) {
          assert.equal(n.nodes.list.children[1], "a");
          assert.equal(newItem.id, "a");
        } else if (parent) {
          assert.equal(n.nodes.nested.children[0], newItem.id);
          assert.equal(n.nodes.nested.children[1], "child");
        } else assert.equal(n.nodes.list.children[1], newItem.id);
      } else {
        assert.equal(caret.block, end.block);
        assert.equal(
          value(n, end.block),
          (parent ? "child" : "bbbb").slice(end.offset),
        );
        assert.deepEqual(n.nodes.list.children, s.nodes.list.children);
        if (parent) assert.deepEqual(n.nodes.nested.children, ["child"]);
      }
      assert.deepEqual(text(n, "ap"), text(s, "ap").slice(0, start.offset));
      assert.equal(value(n, "other"), "other cell");
      const restored = undo(n);
      assert.deepEqual(logical(restored), logical(s));
      assert.equal(resolveAnchor(restored, a).status, "exact");
      assert.deepEqual(logical(undo(restored, "undo", "redo")), logical(n));
    });
for (const scenario of scenarios)
  for (const peerOffset of [0, 1, 2, 3, 4])
    for (const peerFirst of [false, true])
      for (const peerUndoFirst of [false, true])
        test(`owned lifecycle ${scenario.name} offset=${peerOffset} peerFirst=${peerFirst} peerUndoFirst=${peerUndoFirst}`, () => {
          const { parent, start, end } = scenario,
            s = listFixture({ cell: true, parent }),
            range = captureRange(s, start, end),
            p = planListEnter(s, range, op("key")),
            key = op("key", p.intent),
            anchor = anchorAt(s, start.block, 0, 4),
            peer = op(
              "peer",
              {
                kind: "insert",
                at: gapAt(s, start.block, peerOffset),
                text: "中",
                marks: ["strong"],
              },
              "B",
            );
          let n = s;
          for (const e of peerFirst ? [peer, key] : [key, peer]) n = run(n, e);
          validate(n);
          const split = logical(n);
          assert.equal(
            split
              .flatMap((x) => x.atoms || [])
              .filter((a) => a.id === "peer:char:0").length,
            1,
          );
          if (peerUndoFirst) {
            n = undo(n, "peer", "undopeer", "B");
            n = undo(n);
          } else {
            n = undo(n);
            assert.equal(
              value(n, start.block),
              "aaaa".slice(0, peerOffset) + "中" + "aaaa".slice(peerOffset),
            );
            assert.deepEqual(
              text(n, start.block).find((a) => a.char === "中").marks,
              ["strong"],
            );
            assert.equal(resolveAnchor(n, anchor).status, "exact");
            n = undo(n, "peer", "undopeer", "B");
          }
          assert.deepEqual(logical(n), logical(s));
          // Undo inverses are replayed in reverse order to reproduce exact identity/topology.
          if (peerUndoFirst) {
            n = undo(n, "undo", "redo");
            n = undo(n, "undopeer", "redopeer", "B");
          } else {
            n = undo(n, "undopeer", "redopeer", "B");
            n = undo(n, "undo", "redo");
          }
          assert.deepEqual(logical(n), split);
        });
for (const scenario of scenarios)
  for (const peerFirst of [false, true])
    test(`durable uncertain delivery ${scenario.name} peerFirst=${peerFirst}`, () => {
      const { parent, start, end } = scenario,
        initial = listFixture({ cell: true, parent });
      let room = new Room(initial);
      const a = new Client("A", "range", room.snapshot()),
        b = new Client("B", "range", room.snapshot());
      const intent = planListEnter(
        a.state,
        captureRange(a.state, start, end),
        op("A:range:1"),
      ).intent;
      a.prepare(intent);
      b.prepare({
        kind: "insert",
        at: gapAt(b.state, "ap", 2),
        text: "中",
        marks: ["strong"],
      });
      const pending = [a.pending[0], b.pending[0]];
      let receipts = [];
      for (const e of peerFirst ? pending.toReversed() : pending) {
        const receipt = room.accept(e);
        assert.equal(receipt.outcome, "accepted", receipt.reason);
        receipts.push(receipt);
        room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
        assert.deepEqual(room.accept(JSON.parse(JSON.stringify(e))), receipt);
      }
      // Reconstruct the client from its durable local state with the lost-ACK operation still pending.
      const restored = new Client(
        "A",
        "range",
        room.snapshot(),
        JSON.parse(JSON.stringify(a.save())),
      );
      restored.receive(room.snapshot());
      b.receive(room.snapshot());
      assert.equal(restored.pending.length, 0);
      assert.deepEqual(restored.recovery, []);
      assert.deepEqual(restored.state, room.record.state);
      // Live B's Undo must remove only B's contribution; reloaded A starts a fresh session per CO-06.
      b.undo();
      const receipt = room.accept(b.pending[0]);
      assert.equal(receipt.outcome, "accepted", receipt.reason);
      b.receive(room.snapshot());
      restored.receive(room.snapshot());
      assert.equal(
        logical(room.record.state)
          .flatMap((x) => x.atoms || [])
          .filter((x) => x.char === "中").length,
        0,
      );
      assert.deepEqual(b.state, restored.state);
      validate(restored.state);
    });
test("unsupported range shapes reject before mutation", () => {
  const s = listFixture({ cell: true, parent: true, rich: true }),
    before = JSON.stringify(s);
  for (const [a, b] of [
    [
      { block: "bp", offset: 1 },
      { block: "cp", offset: 2 },
    ],
    [
      { block: "ap", offset: 1 },
      { block: "other", offset: 2 },
    ],
    [
      { block: "childp", offset: 1 },
      { block: "bp", offset: 2 },
    ],
    [
      { block: "ap", offset: 1 },
      { block: "cp", offset: 2 },
    ],
  ])
    assert.throws(
      () => planListEnter(s, captureRange(s, a, b), op("key")),
      /qualified|attachment|range|select/i,
    );
  assert.equal(JSON.stringify(s), before);
});
for (const scenario of scenarios)
  for (const peerCut of [0, 2, 4])
    for (const peerFirst of [false, true])
      test(`range with peer Enter ${scenario.name} cut=${peerCut} peerFirst=${peerFirst}`, () => {
        const { parent, start, end } = scenario,
          s = listFixture({ cell: true, parent }),
          key = op(
            "key",
            planListEnter(s, captureRange(s, start, end), op("key")).intent,
          ),
          point = { block: "ap", offset: peerCut },
          peer = op(
            "peer",
            planListEnter(
              s,
              captureRange(s, point, point),
              op("peer", null, "B"),
            ).intent,
            "B",
          );
        let n = s;
        for (const e of peerFirst ? [peer, key] : [key, peer]) n = run(n, e);
        validate(n);
        const split = logical(n);
        for (let cycle = 0; cycle < 3; cycle++) {
          const suffix = cycle ? String(cycle) : "",
            uk = "undo" + suffix,
            up = "undopeer" + suffix,
            rk = "redo" + suffix,
            rp = "redopeer" + suffix;
          n = undo(
            n,
            cycle ? "redo" + (cycle === 1 ? "" : String(cycle - 1)) : "key",
            uk,
          );
          n = undo(
            n,
            cycle
              ? "redopeer" + (cycle === 1 ? "" : String(cycle - 1))
              : "peer",
            up,
            "B",
          );
          assert.deepEqual(logical(n), logical(s));
          n = undo(n, up, rp, "B");
          n = undo(n, uk, rk);
          assert.deepEqual(logical(n), split);
          validate(n);
        }
      });
