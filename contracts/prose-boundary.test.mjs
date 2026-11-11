// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planDelete,
  planEnter,
  planClearCells,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { Room, Client } from "@cwhy/jade-testkit/peers";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
function fixture(cell = false, empty = false) {
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      children: cell ? ["table"] : ["p", "q", "r"],
      live: true,
    },
    ...Object.fromEntries(
      ["p", "q", "r"].map((id) => [id, { id, type: "paragraph", live: true }]),
    ),
  };
  if (cell)
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: ["p", "q", "r"],
        colwidth: [200],
      },
    });
  return seed(nodes, {
    p: [{ text: empty ? "" : "aaaa", marks: [] }],
    q: [{ text: empty ? "" : "bbbb", marks: ["strong"] }],
    r: [{ text: "cccc", marks: [] }],
  });
}
const logical = (s) => {
  const out = [];
  const walk = (id) => {
    const n = s.nodes[id];
    out.push({
      id,
      type: n.type,
      ...(n.children
        ? { children: n.children }
        : n.text
          ? { atoms: text(s, id) }
          : {}),
    });
    n.children?.forEach(walk);
  };
  walk(s.root);
  return out;
};
const r = (s, id, offset) =>
  captureRange(s, { block: id, offset }, { block: id, offset });
const join = (s, a = "A", n = 1, id = "p", direction = "forward") =>
  op(
    a,
    n,
    planDelete(
      s,
      r(
        s,
        id,
        direction === "forward" ? s.replicas[s.nodes[id].text].length : 0,
      ),
      direction,
      op(a, n),
    ).intent,
  );
const enter = (s, a, n, id, offset) =>
  op(a, n, planEnter(s, r(s, id, offset), op(a, n)).intent);
const undo = (s, a, target, n = 2) =>
  apply(s, op(a, n, { kind: "undo", target }));
for (const cell of [false, true])
  for (const empty of [false, true])
    for (const order of [
      ["A", "B"],
      ["B", "A"],
    ])
      for (const undoOrder of [
        ["A", "B"],
        ["B", "A"],
      ])
        test(`Prose same-boundary joins cell=${cell} empty=${empty} arrival=${order} Undo=${undoOrder}`, () => {
          const s = fixture(cell, empty),
            operations = {
              A: join(s, "A"),
              B: join(s, "B", 1, "q", "backward"),
            },
            mark = anchorAt(s, "q", 0, text(s, "q").length);
          let room = new Room(s);
          for (const actor of order) {
            const receipt = room.accept(operations[actor]);
            assert.equal(receipt.outcome, "accepted", receipt.reason);
            const record = JSON.parse(JSON.stringify(room.snapshot()));
            room = new Room(null, record);
            assert.deepEqual(room.accept(operations[actor]), receipt);
          }
          const joined = logical(room.record.state);
          for (const [i, a] of undoOrder.entries()) {
            assert.equal(
              room.accept(op(a, 2, { kind: "undo", target: operations[a].id }))
                .outcome,
              "accepted",
            );
            assert.equal(room.record.state.nodes.q.live, i === 1);
          }
          assert.deepEqual(logical(room.record.state), logical(s));
          assert.deepEqual(
            resolveAnchor(room.record.state, mark),
            resolveAnchor(s, mark),
          );
          for (const a of order)
            assert.equal(
              room.accept(op(a, 3, { kind: "undo", target: `${a}:s:2` }))
                .outcome,
              "accepted",
            );
          assert.deepEqual(logical(room.record.state), joined);
          validate(room.record.state);
        });
for (const offset of [0, 2, 4])
  for (const creatorFirst of [false, true])
    test(`Prose creator Undo/Redo with active peer join offset=${offset} creatorUndoFirst=${creatorFirst}`, () => {
      const s = fixture(),
        creation = enter(s, "A", 1, "p", offset),
        split = apply(s, creation),
        tail = "A:s:1:paragraph",
        j = join(split, "B", 1, tail, "backward");
      let n = apply(split, j);
      const joined = logical(n);
      if (creatorFirst) {
        n = undo(n, "A", creation.id);
        assert.deepEqual(logical(n), logical(s));
        n = undo(n, "A", "A:s:2", 3);
        assert.deepEqual(logical(n), joined);
        n = undo(n, "B", j.id);
        assert.deepEqual(logical(n), logical(split));
        n = undo(n, "A", "A:s:3", 4);
      } else {
        n = undo(n, "B", j.id);
        assert.deepEqual(logical(n), logical(split));
        n = undo(n, "A", creation.id);
      }
      assert.deepEqual(logical(n), logical(s));
      validate(n);
    });
for (const peerBlock of ["p", "q"])
  for (const offset of [0, 2, 4])
    for (const peerFirst of [false, true])
      test(`Prose join with offline typing block=${peerBlock} offset=${offset} peerFirst=${peerFirst}`, () => {
        const s = fixture(),
          j = join(s),
          peer = op("B", 1, {
            kind: "insert",
            at: gapAt(s, peerBlock, offset),
            text: "中",
            marks: ["em"],
          });
        let n = s;
        for (const o of peerFirst ? [peer, j] : [j, peer]) n = apply(n, o);
        assert.equal(
          text(n, "p").filter((a) => a.id.startsWith("B:")).length,
          1,
        );
        n = undo(n, "A", j.id);
        assert.deepEqual(logical(n), logical(apply(s, peer)));
        n = undo(n, "B", peer.id);
        assert.deepEqual(logical(n), logical(s));
        validate(n);
      });
for (const offset of [0, 2, 4, 6, 8])
  test(`Prose Enter through projected join and exact owned Undo offset=${offset}`, () => {
    const s = fixture(),
      j = join(s),
      joined = apply(s, j),
      e = enter(joined, "B", 1, "p", offset);
    let n = apply(joined, e);
    n = undo(n, "B", e.id);
    assert.deepEqual(logical(n), logical(joined));
    n = undo(n, "A", j.id);
    assert.deepEqual(logical(n), logical(s));
    validate(n);
  });
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  for (const offset of [0, 2, 4])
    test(`Concurrent prose Enter and owned Undo offset=${offset} arrival=${order}`, () => {
      const s = fixture(),
        operations = {
          A: enter(s, "A", 1, "p", offset),
          B: enter(s, "B", 1, "p", offset),
        };
      let n = s;
      for (const a of order) n = apply(n, operations[a]);
      const withBoth = logical(n);
      for (const a of order) n = undo(n, a, operations[a].id);
      assert.deepEqual(logical(n), logical(s));
      for (const a of order) n = undo(n, a, `${a}:s:2`, 3);
      assert.deepEqual(logical(n), withBoth);
      validate(n);
    });
test("Prose boundary family and active join survive whole-cell clear/Undo without leaked nodes", () => {
  const s = fixture(true),
    e = enter(s, "A", 1, "p", 2),
    split = apply(s, e),
    j = join(split, "B", 1, "A:s:1:paragraph", "backward"),
    joined = apply(split, j),
    clear = op(
      "C",
      1,
      planClearCells(
        joined,
        captureCellRange(joined, "table", "cell"),
        op("C", 1),
      ).intent,
    );
  let n = apply(joined, clear);
  n = undo(n, "C", clear.id);
  assert.deepEqual(logical(n), logical(joined));
  n = undo(n, "B", j.id);
  n = undo(n, "A", e.id);
  assert.deepEqual(logical(n), logical(s));
  validate(n);
});
