// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { probeDelete } from "@cwhy/jade-testkit/list-probe";
import { Client, Room } from "@cwhy/jade-testkit/peers";
import {
  text,
  gapAt,
  resolveGap,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
import { captureRange } from "@cwhy/jade-core/selection";
import { planListEnter } from "@cwhy/jade-core/list-commands";
const logical = (s) => {
  const out = [];
  function walk(id) {
    const n = s.nodes[id];
    out.push({
      id,
      type: n.type,
      children: n.children,
      ...(n.text ? { atoms: text(s, id) } : {}),
    });
    for (const c of n.children || []) walk(c);
  }
  walk(s.root);
  return out;
};
const round = (s) => JSON.parse(JSON.stringify(s));
function world() {
  const initial = listFixture({ cell: true });
  let room = new Room(initial);
  const clients = ["A", "B", "C"].map(
    (a) => new Client(a, "ledger", room.snapshot()),
  );
  return {
    initial,
    clients,
    get room() {
      return room;
    },
    accept(c) {
      const e = c.pending[0],
        r = room.accept(e);
      assert.equal(r.outcome, "accepted", r.reason);
      room = new Room(null, round(room.snapshot()));
      assert.deepEqual(room.accept(round(e)), r);
      c.receive(room.snapshot());
    },
    settle() {
      for (const c of clients) {
        c.receive(room.snapshot());
        assert.deepEqual(c.recovery, []);
        assert.deepEqual(c.state, room.record.state);
      }
      validate(room.record.state);
    },
  };
}
function del(c, block = "ap") {
  const p = {
      block,
      offset: c.state.replicas[c.state.nodes[block].text].length,
    },
    op = { id: `${c.actor}:ledger:${c.seq + 1}`, actor: c.actor, epoch: 1 };
  c.prepare(probeDelete(c.state, captureRange(c.state, p, p), op).intent);
}
function enter(c, block, offset) {
  const p = { block, offset },
    op = { id: `${c.actor}:ledger:${c.seq + 1}`, actor: c.actor, epoch: 1 };
  c.prepare(planListEnter(c.state, captureRange(c.state, p, p), op).intent);
}
for (const peerBlock of ["ap", "bp"])
  for (const offset of [0, 2, 4])
    for (const order of [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 0],
    ])
      test(`durable two-Delete + peer text block=${peerBlock} offset=${offset} arrival=${order}`, () => {
        const w = world(),
          [a, b, c] = w.clients;
        del(a);
        del(b);
        c.prepare({
          kind: "insert",
          at: gapAt(c.state, peerBlock, offset),
          text: "中",
          marks: ["strong"],
        });
        for (const i of order) w.accept(w.clients[i]);
        w.settle();
        const joined = logical(w.room.record.state);
        for (let k = 0; k < 3; k++) {
          a.undo();
          w.accept(a);
          w.settle();
          assert.equal(w.room.record.state.nodes.b.live, false);
          b.undo();
          w.accept(b);
          w.settle();
          assert.equal(
            text(w.room.record.state, peerBlock)
              .map((a) => a.char)
              .join(""),
            (peerBlock === "ap" ? "aaaa" : "bbbb").slice(0, offset) +
              "中" +
              (peerBlock === "ap" ? "aaaa" : "bbbb").slice(offset),
          );
          b.redo();
          w.accept(b);
          w.settle();
          a.redo();
          w.accept(a);
          w.settle();
          assert.deepEqual(logical(w.room.record.state), joined);
        }
        for (const x of [a, b, c]) {
          x.undo();
          w.accept(x);
          w.settle();
        }
        assert.deepEqual(logical(w.room.record.state), logical(w.initial));
      });
for (const cut of [0, 2, 4])
  for (const joinFirst of [false, true])
    test(`join with peer Enter, repeated owned restoration cut=${cut} joinFirst=${joinFirst}`, () => {
      const w = world(),
        [a, b] = w.clients;
      del(a);
      enter(b, "bp", cut);
      for (const c of joinFirst ? [a, b] : [b, a]) w.accept(c);
      w.settle();
      const joined = logical(w.room.record.state);
      for (let k = 0; k < 3; k++) {
        a.undo();
        w.accept(a);
        w.settle();
        b.undo();
        w.accept(b);
        w.settle();
        assert.deepEqual(logical(w.room.record.state), logical(w.initial));
        b.redo();
        w.accept(b);
        w.settle();
        a.redo();
        w.accept(a);
        w.settle();
        assert.deepEqual(logical(w.room.record.state), joined);
      }
    });
for (const offset of [0, 2, 4, 6, 8])
  test(`typing through a projected join offset=${offset}`, () => {
    const w = world(),
      [a, b] = w.clients,
      anchor = anchorAt(w.initial, "bp", 0, 4);
    del(a);
    w.accept(a);
    w.settle();
    b.prepare({
      kind: "insert",
      at: gapAt(b.state, "ap", offset),
      text: "Q",
      marks: ["em"],
    });
    w.accept(b);
    w.settle();
    assert.equal(
      text(w.room.record.state, "ap")
        .map((a) => a.char)
        .join(""),
      "aaaabbbb".slice(0, offset) + "Q" + "aaaabbbb".slice(offset),
    );
    a.undo();
    w.accept(a);
    w.settle();
    assert.equal(resolveAnchor(w.room.record.state, anchor).status, "exact");
    b.undo();
    w.accept(b);
    w.settle();
    assert.deepEqual(logical(w.room.record.state), logical(w.initial));
  });
for (const cut of [0, 2, 4, 6, 8])
  test(`Enter through projected join then undo both cut=${cut}`, () => {
    const w = world(),
      [a, b] = w.clients;
    del(a);
    w.accept(a);
    w.settle();
    enter(b, "ap", cut);
    w.accept(b);
    w.settle();
    b.undo();
    w.accept(b);
    w.settle();
    a.undo();
    w.accept(a);
    w.settle();
    assert.deepEqual(logical(w.room.record.state), logical(w.initial));
  });
test("successive joins undo independently", () => {
  const w = world(),
    [a, b] = w.clients;
  del(a);
  w.accept(a);
  w.settle();
  del(b);
  w.accept(b);
  w.settle();
  assert.equal(
    text(w.room.record.state, "ap")
      .map((a) => a.char)
      .join(""),
    "aaaabbbbcccc",
  );
  a.undo();
  w.accept(a);
  w.settle();
  assert.equal(
    text(w.room.record.state, "ap")
      .map((a) => a.char)
      .join(""),
    "aaaa",
  );
  assert.equal(
    text(w.room.record.state, "bp")
      .map((a) => a.char)
      .join(""),
    "bbbbcccc",
  );
  b.undo();
  w.accept(b);
  w.settle();
  assert.deepEqual(logical(w.room.record.state), logical(w.initial));
});
test("forged and wrong-context boundaries reject without mutation", () => {
  const w = world(),
    s = w.room.snapshot(),
    before = JSON.stringify(s);
  for (const [i, target] of [
    { id: "seed:other", right: "other", creator: null },
    { id: "fake", right: "bp", creator: null },
    { id: "seed:bp", right: "bp", creator: { family: "fake", cut: "fake" } },
  ].entries()) {
    const r = w.room.accept({
      id: `bad:${i}:1`,
      actor: "bad",
      stream: String(i),
      seq: 1,
      epoch: 1,
      intent: { kind: "listJoin", target },
    });
    assert.equal(r.outcome, "rejected");
    assert.deepEqual(w.room.record.state, s.state);
  }
  assert.equal(JSON.stringify(s), before);
});
for (const cut of [0, 2, 4])
  test(`creator reactivation while suppression remains active cut=${cut}`, () => {
    const w = world(),
      [a, b] = w.clients;
    enter(a, "ap", cut);
    w.accept(a);
    w.settle();
    del(b);
    w.accept(b);
    w.settle();
    const joined = logical(w.room.record.state);
    a.undo();
    w.accept(a);
    w.settle();
    assert.deepEqual(logical(w.room.record.state), logical(w.initial));
    a.redo();
    w.accept(a);
    w.settle();
    assert.deepEqual(
      logical(w.room.record.state),
      joined,
      "Redo restores the original joined identities, including the left wrapper for start-Enter",
    );
    b.undo();
    w.accept(b);
    w.settle();
    assert.equal(w.room.record.state.nodes.list.children.length, 4);
    a.undo();
    w.accept(a);
    w.settle();
    assert.deepEqual(logical(w.room.record.state), logical(w.initial));
  });
for (const offset of [0, 1, 3, 4, 5, 7, 8])
  test(`retained projection typing/Undo exact source ownership offset=${offset}`, () => {
    const w = world(),
      [a, b] = w.clients;
    del(a);
    w.accept(a);
    w.settle();
    const before = Object.keys(b.state.replicas).length;
    for (let i = 0; i < 4; i++) {
      b.prepare({
        kind: "insert",
        at: gapAt(b.state, "ap", offset + i),
        text: "Q",
        marks: ["strong"],
      });
      w.accept(b);
      w.settle();
    }
    if (offset !== 4)
      assert.equal(
        Object.keys(b.state.replicas).length,
        before,
        "Non-seam typing must not manufacture projection generations",
      );
    a.undo();
    w.accept(a);
    w.settle();
    const expectedLeft =
        offset < 4
          ? "aaaa".slice(0, offset) + "QQQQ" + "aaaa".slice(offset)
          : "aaaa",
      expectedRight =
        offset >= 4
          ? "bbbb".slice(0, offset - 4) + "QQQQ" + "bbbb".slice(offset - 4)
          : "bbbb";
    assert.equal(
      text(a.state, "ap")
        .map((x) => x.char)
        .join(""),
      expectedLeft,
    );
    assert.equal(
      text(a.state, "bp")
        .map((x) => x.char)
        .join(""),
      expectedRight,
    );
    for (let i = 0; i < 4; i++) {
      b.undo();
      w.accept(b);
      w.settle();
    }
    assert.deepEqual(logical(w.room.record.state), logical(w.initial));
  });
