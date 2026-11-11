// SPDX-License-Identifier: MPL-2.0
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  planClearCells,
  planEnter,
  planDelete,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  apply,
  validate,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
import { Client } from "@cwhy/jade-collaboration/client";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s, a = "cell", f = "last-cell") =>
  captureCellRange(s, "table", a, f);
const clear = (s, a = "A", n = 1, r = range(s)) => {
  const o = op(a, n);
  return { ...o, intent: planClearCells(s, r, o).intent };
};
const undo = (s, target, n, a = "A") =>
  apply(s, op(a, n, { kind: "undo", target }));
const point = (s, block, offset = 0) =>
  captureRange(s, { block, offset }, { block, offset });
function view(s, id = s.root) {
  const { live, text: replica, placement, clearOwner, ...n } = s.nodes[id];
  return {
    ...n,
    ...(replica ? { atoms: text(s, id) } : {}),
    ...(n.children ? { children: n.children.map((c) => view(s, c)) } : {}),
  };
}
const characters = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
test("rich rectangle clear preserves grid, assets and exact Undo/Redo identities", () => {
  const s = tableFixture(),
    before = view(s),
    anchor = anchorAt(s, "list-text", 0, 4),
    o = clear(s),
    n = apply(s, o);
  validate(n);
  assert.deepEqual(n.nodes.table.children, s.nodes.table.children);
  assert.deepEqual(n.nodes.row, s.nodes.row);
  assert.equal(
    n.nodes["empty-cell"].children[0],
    "empty",
    "Already-empty cell retains its existing caret target",
  );
  for (const id of range(s).cells.flat()) {
    assert.deepEqual(n.nodes[id].colwidth, s.nodes[id].colwidth);
    const p = n.nodes[n.nodes[id].children[0]];
    assert.equal(p.type, "paragraph");
    assert.equal(characters(n, p.id), "");
  }
  assert.equal(n.nodes.image.live, false);
  assert.equal(n.nodes.image.asset, s.nodes.image.asset);
  assert.notEqual(resolveAnchor(n, anchor).status, "exact");
  const back = undo(n, o.id, 2);
  validate(back);
  assert.deepEqual(view(back), before);
  assert.equal(resolveAnchor(back, anchor).status, "exact");
  const again = undo(back, "A:s:2", 3);
  validate(again);
  assert.deepEqual(view(again), view(n));
  assert.deepEqual(view(undo(again, "A:s:3", 4)), before);
});
test("already-empty cells are a true command no-op", () => {
  const s = tableFixture(),
    p = planClearCells(s, range(s, "empty-cell", "empty-cell"), op("A", 1));
  assert.equal(p.intent, null);
  assert.equal(p.state, s);
});
for (const field of ["text", "format", "structure"])
  test(`unseen peer ${field} invalidates the clear witness atomically`, () => {
    const s = tableFixture(),
      o = clear(s);
    let next;
    if (field === "text")
      next = apply(
        s,
        op("B", 1, {
          kind: "insert",
          at: gapAt(s, "first", 1),
          text: "peer",
          marks: [],
        }),
      );
    if (field === "format")
      next = apply(
        s,
        op("B", 1, {
          kind: "format",
          ids: [text(s, "first")[0].id],
          property: "strong",
          value: "strong",
        }),
      );
    if (field === "structure")
      next = apply(s, {
        ...op("B", 1),
        intent: planEnter(s, point(s, "list-text", 2), op("B", 1)).intent,
      });
    const before = JSON.stringify(next);
    assert.throws(() => apply(next, o), /content changed/);
    assert.equal(JSON.stringify(next), before);
  });
test("unselected peer text survives clear and Undo", () => {
  const s = tableFixture(),
    o = clear(s, "A", 1, range(s, "cell", "cell")),
    next = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "last", 0),
        text: "peer",
        marks: [],
      }),
    ),
    n = apply(next, o);
  assert.equal(characters(n, "last"), "peerLast cell text");
  const back = undo(n, o.id, 2);
  assert.deepEqual(view(back), view(next));
});
for (const kind of ["insert", "delete", "format", "undo"])
  test(`cleared content rejects late ${kind} instead of silently accepting a no-op`, () => {
    const room = new Room(tableFixture());
    const initial = op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, "first", 1),
      text: "B",
      marks: [],
    });
    room.accept(initial);
    const s = room.record.state,
      id = text(s, "first")[1].id;
    const late = op(
      "B",
      2,
      kind === "insert"
        ? { kind: "insert", at: gapAt(s, "first", 2), text: "late", marks: [] }
        : kind === "delete"
          ? { kind: "delete", ids: [id] }
          : kind === "format"
            ? { kind: "format", ids: [id], property: "strong", value: "strong" }
            : { kind: "undo", target: initial.id },
    );
    room.accept(clear(s));
    const before = room.record.state,
      receipt = room.accept(late);
    assert.equal(receipt.outcome, "rejected");
    assert.match(receipt.reason, /cleared/);
    assert.equal(receipt.bytes, JSON.stringify(late));
    assert.deepEqual(room.record.state, before);
    room.accept(op("A", 2, { kind: "undo", target: "A:s:1" }));
    if (kind === "undo") {
      assert.equal(room.accept(op("B", 3, late.intent)).outcome, "accepted");
      assert.equal(characters(room.record.state, "first"), "First cell text");
    }
  });
test("new peer text in a cleared cell blocks Undo until that contribution is undone", () => {
  const room = new Room(tableFixture());
  room.accept(clear(room.record.state));
  const id = room.record.state.nodes.cell.children[0];
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, id, 0),
      text: "new peer",
      marks: [],
    }),
  );
  const before = room.record.state;
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: "A:s:1" })).outcome,
    "rejected",
  );
  assert.deepEqual(room.record.state, before);
  room.accept(op("B", 2, { kind: "undo", target: "B:s:1" }));
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: "A:s:1" })).outcome,
    "accepted",
  );
  assert.equal(characters(room.record.state, "first"), "First cell text");
});
test("Undo clear does not overwrite typing in an already-empty selected cell", () => {
  const room = new Room(tableFixture());
  room.accept(clear(room.record.state));
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, "empty", 0),
      text: "keep",
      marks: [],
    }),
  );
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: "A:s:1" })).outcome,
    "accepted",
  );
  assert.equal(characters(room.record.state, "empty"), "keep");
});
for (const joined of [false, true])
  test(`list Enter ${joined ? "and active join " : ""}survive clear/Undo and retain their own Undo`, () => {
    const room = new Room(tableFixture());
    room.accept({
      ...op("B", 1),
      intent: planEnter(
        room.record.state,
        point(room.record.state, "list-text", 4),
        op("B", 1),
      ).intent,
    });
    if (joined)
      room.accept({
        ...op("B", 2),
        intent: planDelete(
          room.record.state,
          point(room.record.state, "list-text", 4),
          "forward",
          op("B", 2),
        ).intent,
      });
    const before = view(room.record.state);
    room.accept(clear(room.record.state));
    validate(room.record.state);
    const late = room.accept(
      op("B", joined ? 3 : 2, {
        kind: "undo",
        target: joined ? "B:s:2" : "B:s:1",
      }),
    );
    assert.equal(late.outcome, "rejected");
    assert.equal(
      room.accept(op("A", 2, { kind: "undo", target: "A:s:1" })).outcome,
      "accepted",
    );
    validate(room.record.state);
    assert.deepEqual(view(room.record.state), before);
    assert.equal(
      room.accept(
        op("B", joined ? 4 : 3, {
          kind: "undo",
          target: joined ? "B:s:2" : "B:s:1",
        }),
      ).outcome,
      "accepted",
    );
  });
test("nested clear generations unwind without stranding the earlier clear", () => {
  const room = new Room(tableFixture()),
    original = view(room.record.state);
  room.accept(clear(room.record.state));
  const id = room.record.state.nodes.cell.children[0];
  room.accept(
    op("A", 2, {
      kind: "insert",
      at: gapAt(room.record.state, id, 0),
      text: "second generation",
      marks: [],
    }),
  );
  room.accept(clear(room.record.state, "A", 3));
  for (const [seq, target] of [
    [4, "A:s:3"],
    [5, "A:s:2"],
    [6, "A:s:1"],
  ])
    assert.equal(
      room.accept(op("A", seq, { kind: "undo", target })).outcome,
      "accepted",
    );
  assert.deepEqual(view(room.record.state), original);
});
test("lost ACK, duplicate delivery and checkpoint replay preserve one clear lifecycle", () => {
  const room = new Room(tableFixture()),
    start = room.record,
    o = clear(room.record.state),
    receipt = room.accept(o);
  assert.equal(receipt.outcome, "accepted");
  assert.deepEqual(replay(start, { op: o, receipt }), room.record);
  const restored = new Room(null, JSON.parse(JSON.stringify(room.record)));
  assert.deepEqual(restored.accept(o), receipt);
  assert.equal(
    restored.accept(op("A", 2, { kind: "undo", target: o.id })).outcome,
    "accepted",
  );
  assert.deepEqual(view(restored.record.state), view(start.state));
});
test("rejected optimistic clear restores the history of earlier edits", () => {
  const room = new Room(tableFixture()),
    c = new Client("A", "s", room.record);
  c.prepare({
    kind: "insert",
    at: gapAt(c.state, "last", 0),
    text: "own",
    marks: [],
  });
  room.accept(c.pending[0]);
  c.receive(room.record);
  c.prepare(clear(c.state, "A", 2).intent);
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, "first", 0),
      text: "peer",
      marks: [],
    }),
  );
  assert.equal(room.accept(c.pending[0]).outcome, "rejected");
  c.receive(room.record);
  assert.deepEqual(
    c.undoStack.map((g) => g.ids),
    [["A:s:1"]],
  );
  assert.equal(characters(c.state, "first"), "peerFirst cell text");
});
for (const mutate of [
  (i) => (i.range.cells[0][0] = "last-cell"),
  (i) => i.witness.nodes.pop(),
  (i) => (i.extra = "forged"),
  (i) => i.range.epoch++,
])
  test(`forged or stale clear rejected: ${mutate}`, () => {
    const s = tableFixture(),
      o = clear(s);
    mutate(o.intent);
    assert.throws(() => apply(s, o));
  });
test("private restore and old codec remain inaccessible", () => {
  const s = tableFixture();
  assert.throws(
    () => apply(s, op("A", 1, { kind: "restoreClearedCells" })),
    /unsupported|internal/,
  );
  assert.throws(() => apply({ ...s, storageCodec: 12 }, clear(s)), /codec/);
});
test("nested lists, code, marks and image references restore together", () => {
  const s = listFixture({ cell: true, parent: true, rich: true }),
    o = clear(s, "A", 1, range(s, "cell", "other-cell")),
    n = apply(s, o);
  validate(n);
  assert.equal(n.nodes.image.live, false);
  assert.equal(n.nodes.image.asset, "mock.png");
  const back = undo(n, o.id, 2);
  validate(back);
  assert.deepEqual(view(back), view(s));
  assert.deepEqual(text(back, "ap")[0].marks, ["em"]);
});
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const reversal of [
    ["A", "B"],
    ["B", "A"],
  ])
    test(`disjoint clears arrive ${arrival} undo ${reversal} and redo independently`, () => {
      const room = new Room(tableFixture()),
        initial = view(room.record.state),
        ops = {
          A: clear(
            room.record.state,
            "A",
            1,
            range(room.record.state, "cell", "cell"),
          ),
          B: clear(
            room.record.state,
            "B",
            1,
            range(room.record.state, "code-cell", "code-cell"),
          ),
        };
      for (const a of arrival)
        assert.equal(room.accept(ops[a]).outcome, "accepted");
      const cleared = view(room.record.state);
      for (const a of reversal)
        assert.equal(
          room.accept(op(a, 2, { kind: "undo", target: ops[a].id })).outcome,
          "accepted",
        );
      assert.deepEqual(view(room.record.state), initial);
      for (const a of reversal.toReversed())
        assert.equal(
          room.accept(op(a, 3, { kind: "undo", target: `${a}:s:2` })).outcome,
          "accepted",
        );
      assert.deepEqual(view(room.record.state), cleared);
    });
test("overlapping clears do not erase unseen contents or steal another clear lifecycle", () => {
  const room = new Room(tableFixture()),
    a = clear(room.record.state),
    b = clear(room.record.state, "B", 1);
  room.accept(a);
  const before = room.record.state;
  assert.equal(room.accept(b).outcome, "rejected");
  assert.deepEqual(room.record.state, before);
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: a.id })).outcome,
    "accepted",
  );
});
test("current cell dimensions survive clear and restoration without geometry rollback", () => {
  const s = tableFixture(),
    o = clear(s);
  s.nodes.cell.colwidth = [310];
  const n = apply(s, o);
  n.nodes.cell = { ...n.nodes.cell, colwidth: [420] };
  const back = undo(n, o.id, 2);
  assert.deepEqual(back.nodes.cell.colwidth, [420]);
  assert.equal(characters(back, "first"), "First cell text");
});
