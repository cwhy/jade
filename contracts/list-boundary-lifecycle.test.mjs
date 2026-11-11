// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { Room, Client } from "@cwhy/jade-testkit/peers";
import { planListEnter } from "@cwhy/jade-core/list-commands";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
  apply,
  validate,
} from "@cwhy/jade-core/model";
function logical(s) {
  const out = [];
  function walk(id) {
    const n = s.nodes[id];
    out.push({
      id: n.id,
      type: n.type,
      children: n.children,
      ...(n.text ? { atoms: text(s, id) } : {}),
    });
    for (const child of n.children || []) walk(child);
  }
  walk(s.root);
  return out;
}
function world(parent) {
  const initial = listFixture({ cell: true, parent }),
    block = parent ? "ap" : "bp",
    clients = ["A", "B", "C", "D"].map(
      (a) => new Client(a, "life", new Room(initial).snapshot()),
    );
  let room = new Room(initial);
  return {
    initial,
    block,
    clients,
    get room() {
      return room;
    },
    enter(c, at) {
      const point = { block, offset: at },
        op = { id: `${c.actor}:life:${c.seq + 1}`, actor: c.actor, epoch: 1 },
        p = planListEnter(c.state, captureRange(c.state, point, point), op);
      c.prepare(p.intent);
    },
    accept(c) {
      const op = c.pending[0],
        before = room.snapshot(),
        receipt = room.accept(op);
      assert.equal(receipt.outcome, "accepted", receipt.reason);
      room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(op), receipt);
      assert.equal(room.record.state.revision, before.state.revision + 1);
      c.receive(room.snapshot());
    },
    settle() {
      for (const c of clients) c.receive(room.snapshot());
    },
    same() {
      for (const c of clients) {
        assert.deepEqual(c.state, room.record.state);
        assert.deepEqual(c.recovery, []);
      }
      validate(room.record.state);
    },
  };
}
let random = 0x41ca80;
const rnd = (n) => {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
  return random % n;
};
const shuffle = (a) => {
  a = [...a];
  for (let i = a.length - 1; i; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
for (let seed = 0; seed < 60; seed++) {
  const parent = !!(seed % 2),
    cuts = Array.from({ length: 3 }, () => rnd(5)),
    arrival = shuffle([0, 1, 2]),
    undo = shuffle([0, 1, 2]);
  test(`3-peer lifecycle ${seed}: parent=${parent} cuts=${cuts} arrival=${arrival} Undo=${undo}`, () => {
    const w = world(parent),
      { clients: c, block, initial } = w,
      anchor = anchorAt(initial, block, 0, 4);
    for (let i = 0; i < 3; i++) w.enter(c[i], cuts[i]);
    // A distinct fourth peer contributes styled CJK text from the untouched source.
    c[3].prepare({
      kind: "insert",
      at: gapAt(initial, block, 3),
      text: "中",
      marks: ["strong"],
    });
    const all = [...arrival];
    all.splice(seed % 4, 0, 3);
    for (const i of all) w.accept(c[i]);
    w.settle();
    w.same();
    const splitTopology = logical(w.room.record.state);
    const contributed = logical(w.room.record.state)
        .filter((n) => n.atoms)
        .flatMap((n) => n.atoms),
      sourceIds = new Set(text(initial, block).map((a) => a.id));
    assert.deepEqual(
      contributed.filter((a) => sourceIds.has(a.id)),
      text(initial, block),
    );
    assert.equal(contributed.filter((a) => a.char === "中").length, 1);
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const i of undo) {
        c[i].undo();
        w.accept(c[i]);
        w.settle();
      }
      w.same();
      assert.equal(
        text(w.room.record.state, block)
          .map((a) => a.char)
          .join(""),
        parent ? "aaa中a" : "bbb中b",
      );
      assert.equal(resolveAnchor(w.room.record.state, anchor).status, "exact");
      assert.deepEqual(w.room.record.state.nodes.list.children, [
        "a",
        "b",
        "c",
      ]);
      const beforeCuts = Object.keys(w.room.record.state.listFamilies).flatMap(
        (id) => Object.keys(w.room.record.state.listFamilies[id].cuts),
      );
      for (const i of undo.toReversed()) {
        c[i].redo();
        w.accept(c[i]);
        w.settle();
      }
      w.same();
      assert.deepEqual(
        logical(w.room.record.state),
        splitTopology,
        "Redo restores exact partition, item, paragraph and mark identities",
      );
      assert.deepEqual(
        Object.keys(w.room.record.state.listFamilies).flatMap((id) =>
          Object.keys(w.room.record.state.listFamilies[id].cuts),
        ),
        beforeCuts,
        "Redo reactivates the original boundary identities",
      );
    }
    for (const i of [...undo, 3]) {
      c[i].undo();
      w.accept(c[i]);
      w.settle();
    }
    assert.deepEqual(logical(w.room.record.state), logical(initial));
    w.same();
  });
}
for (const parent of [false, true])
  for (const cut of [0, 2, 4])
    test(`new Enter with an inactive boundary parent=${parent} cut=${cut}`, () => {
      const w = world(parent),
        [a, b] = w.clients;
      w.enter(a, cut);
      w.accept(a);
      w.settle();
      a.undo();
      w.accept(a);
      w.settle();
      w.enter(b, cut);
      w.accept(b);
      w.settle();
      a.redo();
      w.accept(a);
      w.settle();
      w.same();
      a.undo();
      w.accept(a);
      w.settle();
      b.undo();
      w.accept(b);
      w.settle();
      assert.deepEqual(logical(w.room.record.state), logical(w.initial));
    });
test("codec 7 is rejected instead of silently interpreting new boundary state", () => {
  const state = structuredClone(listFixture());
  state.storageCodec = 7;
  assert.throws(() => validate(state), /codec/);
});
test("activation cannot be forged outside owned Undo", () => {
  const s = listFixture();
  assert.throws(
    () =>
      apply(s, {
        id: "evil",
        actor: "A",
        epoch: 1,
        intent: {
          kind: "listBoundaryActive",
          family: "f",
          boundary: "c",
          active: false,
        },
      }),
    /internal/,
  );
});
for (const arrival of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
])
  for (const eraseFirst of [false, true])
    test(`deletion crosses active cuts arrival=${arrival} restore-delete-first=${eraseFirst}`, () => {
      const w = world(true),
        [a, b, c] = w.clients;
      w.enter(a, 1);
      w.enter(b, 3);
      c.prepare({
        kind: "delete",
        ids: text(w.initial, w.block)
          .slice(1, 3)
          .map((a) => a.id),
      });
      for (const i of arrival) w.accept(w.clients[i]);
      w.settle();
      const undo = eraseFirst ? [2, 0, 1] : [0, 1, 2];
      for (const i of undo) {
        w.clients[i].undo();
        w.accept(w.clients[i]);
        w.settle();
      }
      w.same();
      assert.deepEqual(logical(w.room.record.state), logical(w.initial));
    });
test("decoded missing registry, duplicate cuts and missing markers fail validation", () => {
  const w = world(false);
  w.enter(w.clients[0], 2);
  w.accept(w.clients[0]);
  const base = w.room.record.state;
  for (const mutate of [
    (s) => delete s.listFamilies,
    (s) =>
      Object.values(s.listFamilies)[0].order.push(
        Object.values(s.listFamilies)[0].order.find((x) => x !== "home"),
      ),
    (s) =>
      (Object.values(Object.values(s.listFamilies)[0].cuts)[0].marker =
        "missing"),
    (s) => (Object.values(s.listFamilies)[0].layout.home = 99),
  ]) {
    const bad = structuredClone(base);
    mutate(bad);
    assert.throws(() => validate(bad), /list|registry/i);
  }
});
test("peer subtree move retains a created boundary through creator Undo", async () => {
  const { planListIndent } = await import("@cwhy/jade-core/list-commands");
  const w = world(false),
    [a, b] = w.clients;
  w.enter(a, 2);
  w.accept(a);
  w.settle();
  const tail = "A:life:1:list-tail",
    point = { block: tail, offset: 0 },
    p = planListIndent(b.state, captureRange(b.state, point, point), {
      id: "B:life:1",
      actor: "B",
      epoch: 1,
    });
  b.prepare(p.intent);
  w.accept(b);
  w.settle();
  const moved = logical(w.room.record.state);
  a.undo();
  w.accept(a);
  w.settle();
  assert.deepEqual(logical(w.room.record.state), moved);
  b.undo();
  w.accept(b);
  w.settle();
  assert.deepEqual(logical(w.room.record.state), logical(w.initial));
});
for (const parent of [false, true])
  for (const cut of [0, 2, 4])
    for (const side of ["left", "right"])
      test(`offline contribution on ${side} survives inactive cut parent=${parent} cut=${cut}`, () => {
        const w = world(parent),
          [a, b] = w.clients;
        w.enter(a, cut);
        w.accept(a);
        w.settle();
        const block = side === "left" ? w.block : "A:life:1:list-tail",
          offset = side === "left" ? cut : 0;
        b.prepare({
          kind: "insert",
          at: gapAt(b.state, block, offset),
          text: "Q",
          marks: ["em"],
        });
        a.undo();
        w.accept(a);
        w.accept(b);
        w.settle();
        a.redo();
        w.accept(a);
        w.settle();
        const original = parent ? "aaaa" : "bbbb";
        assert.equal(
          text(w.room.record.state, w.block)
            .map((a) => a.char)
            .join(""),
          original.slice(0, cut) + (side === "left" ? "Q" : ""),
        );
        assert.equal(
          text(w.room.record.state, "A:life:1:list-tail")
            .map((a) => a.char)
            .join(""),
          (side === "right" ? "Q" : "") + original.slice(cut),
        );
        assert.deepEqual(
          text(
            w.room.record.state,
            side === "left" ? w.block : "A:life:1:list-tail",
          ).find((a) => a.char === "Q").marks,
          ["em"],
        );
        w.same();
      });
