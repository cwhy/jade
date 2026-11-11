// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import {
  copyCells,
  previewCellPaste,
  planPasteCells,
  planEnter,
  planClearCells,
} from "@cwhy/jade-core/commands";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  validateGridFragment,
  gridPlainText,
  gridFromText,
  gridHTML,
} from "@cwhy/jade-core/grid-fragment";
import {
  apply,
  validate,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/admission";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
// Retained inactive contributions support Redo; assert they are all inactive
// before comparing the exact original node identity, properties and children.
const restoredNode = (n) => {
  const { tableFormats, ...node } = n;
  if (tableFormats) assert.ok(tableFormats.layers.every((l) => !l.active));
  return node;
};

const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s, a = "cell", b = "last-cell") =>
    captureCellRange(s, "table", a, b),
  content = (s, id) =>
    text(s, id)
      .map((a) => a.char)
      .join("");
const fragment = (s, a, b = a) => copyCells(s, range(s, a, b));
const paste = (s, f, r = range(s), mode = "match", a = "A", n = 1) => {
  const o = op(a, n),
    preview = previewCellPaste(s, r, f, mode);
  return { ...o, intent: planPasteCells(s, r, o, { preview }).intent };
};
const undo = (s, id, n = 2) =>
  apply(s, op("A", n, { kind: "undo", target: id }));
test("rich rectangle paste clones identities and restores content, anchors and media with Undo/Redo", () => {
  let s = tableFixture();
  s = apply(
    s,
    op("B", 1, {
      kind: "format",
      ids: text(s, "first")
        .slice(0, 3)
        .map((a) => a.id),
      property: "highlight",
      value: { type: "highlight", attrs: { color: "yellow" } },
    }),
  );
  s.nodes.code.language = "javascript";
  s.nodes.list.order = 4;
  const before = fragment(s, "cell", "last-cell"),
    a = anchorAt(s, "first", 0, 3),
    o = paste(s, before),
    n = apply(s, o);
  validate(n);
  assert.deepEqual(fragment(n, "cell", "last-cell"), before);
  assert.notEqual(n.nodes.cell.children[0], "first");
  assert.equal(n.nodes.first.live, false);
  assert.equal(
    Object.values(n.nodes).find((n) => n.live && n.type === "image").asset,
    "fixture.png",
  );
  assert.notEqual(resolveAnchor(n, a).status, "exact");
  const originalIds = new Set(text(s, "first").map((a) => a.id));
  assert.ok(
    text(n, n.nodes.cell.children[0]).every((a) => !originalIds.has(a.id)),
  );
  const restored = undo(n, o.id);
  assert.equal(resolveAnchor(restored, a).status, "exact");
  for (const id of range(s).cells.flat())
    assert.deepEqual(restoredNode(restored.nodes[id]), s.nodes[id]);
  assert.deepEqual(fragment(restored, "cell", "last-cell"), before);
  const again = undo(restored, "A:s:2", 3);
  assert.deepEqual(fragment(again, "cell", "last-cell"), before);
  assert.deepEqual(again.nodes.cell.children, n.nodes.cell.children);
});
test("copy is detached from later source edits", () => {
  const s = tableFixture(),
    f = fragment(s, "cell"),
    saved = JSON.stringify(f),
    next = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "first", 0),
        text: "later ",
        marks: [],
      }),
    );
  assert.equal(JSON.stringify(f), saved);
  const n = apply(next, paste(next, f, range(next, "last-cell", "last-cell")));
  assert.equal(content(n, n.nodes["last-cell"].children[0]), "First cell text");
  assert.equal(content(n, "first"), "later First cell text");
});
test("start preview lists all outside-selection targets without a mutation", () => {
  const s = tableFixture(),
    r = range(s, "empty-cell", "empty-cell"),
    before = JSON.stringify(s),
    f = fragment(s, "cell", "code-cell"),
    p = previewCellPaste(s, r, f, "start");
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(p.outside, ["image-cell", "last-cell"]);
  assert.deepEqual(p.range.cells, [["empty-cell", "image-cell", "last-cell"]]);
  assert.deepEqual(r.cells, [["empty-cell"]]);
  const n = apply(
    s,
    op("A", 1, planPasteCells(s, r, op("A", 1), { preview: p }).intent),
  );
  assert.deepEqual(fragment(n, "empty-cell", "last-cell"), f);
  assert.deepEqual(fragment(n, "cell", "code-cell"), f);
});
test("Fill requires an explicit mode and generates different IDs in each cell", () => {
  const s = tableFixture(),
    f = fragment(s, "cell");
  assert.throws(() => previewCellPaste(s, range(s), f), /size differs/);
  const n = apply(s, paste(s, f, range(s), "fill")),
    ids = range(n)
      .cells.flat()
      .map((id) => n.nodes[id].children[0]);
  assert.equal(new Set(ids).size, 6);
  for (const id of ids) assert.equal(content(n, id), "First cell text");
});
test("expansion rejects without truncation or mutation", () => {
  const s = tableFixture(),
    before = JSON.stringify(s);
  assert.throws(
    () =>
      previewCellPaste(
        s,
        range(s, "last-cell", "last-cell"),
        fragment(s, "cell", "code-cell"),
        "start",
      ),
    /expansion/,
  );
  assert.equal(JSON.stringify(s), before);
});
for (const change of ["text", "format", "structure"])
  test(`peer ${change} after preview rejects entire paste`, () => {
    const s = tableFixture(),
      o = paste(s, fragment(s, "cell", "last-cell"));
    let next;
    if (change === "text")
      next = apply(
        s,
        op("B", 1, {
          kind: "insert",
          at: gapAt(s, "first", 1),
          text: "peer",
          marks: [],
        }),
      );
    if (change === "format")
      next = apply(
        s,
        op("B", 1, {
          kind: "format",
          ids: [text(s, "first")[0].id],
          property: "strong",
          value: "strong",
        }),
      );
    if (change === "structure") {
      const p = captureRange(
        s,
        { block: "list-text", offset: 2 },
        { block: "list-text", offset: 2 },
      );
      next = apply(s, op("B", 1, planEnter(s, p, op("B", 1)).intent));
    }
    const before = JSON.stringify(next);
    assert.throws(() => apply(next, o), /content changed/);
    assert.equal(JSON.stringify(next), before);
  });
test("unrelated peer text survives paste and Undo", () => {
  const s = tableFixture(),
    o = paste(s, fragment(s, "cell"), range(s, "empty-cell", "empty-cell")),
    next = apply(
      s,
      op("B", 1, {
        kind: "insert",
        at: gapAt(s, "last", 0),
        text: "peer ",
        marks: [],
      }),
    ),
    n = apply(next, o),
    back = undo(n, o.id);
  assert.equal(content(back, "last"), "peer Last cell text");
  assert.deepEqual(
    restoredNode(back.nodes["empty-cell"]),
    s.nodes["empty-cell"],
  );
});
test("peer input in replacement blocks Undo until peer Undo", () => {
  const room = new Room(tableFixture());
  room.accept(
    paste(
      room.record.state,
      fragment(room.record.state, "cell"),
      range(room.record.state, "empty-cell", "empty-cell"),
    ),
  );
  const id = room.record.state.nodes["empty-cell"].children[0];
  room.accept(
    op("B", 1, {
      kind: "insert",
      at: gapAt(room.record.state, id, 0),
      text: "peer ",
      marks: [],
    }),
  );
  assert.equal(
    room.accept(op("A", 2, { kind: "undo", target: "A:s:1" })).outcome,
    "rejected",
  );
  assert.equal(content(room.record.state, id), "peer First cell text");
  room.accept(op("B", 2, { kind: "undo", target: "B:s:1" }));
  assert.equal(
    room.accept(op("A", 3, { kind: "undo", target: "A:s:1" })).outcome,
    "accepted",
  );
  assert.equal(room.record.state.nodes["empty-cell"].children[0], "empty");
});
test("clear after paste unwinds both lifecycles", () => {
  const s = tableFixture(),
    o = paste(
      s,
      fragment(s, "image-cell"),
      range(s, "empty-cell", "empty-cell"),
    ),
    n = apply(s, o),
    c = op(
      "A",
      2,
      planClearCells(n, range(n, "empty-cell", "empty-cell"), op("A", 2))
        .intent,
    ),
    back = undo(apply(n, c), c.id, 3),
    original = undo(back, o.id, 4);
  assert.deepEqual(
    restoredNode(original.nodes["empty-cell"]),
    s.nodes["empty-cell"],
  );
  assert.equal(original.nodes.image.live, true);
});
for (const order of [
  ["A", "B"],
  ["B", "A"],
])
  test(`disjoint pastes and independent Undo in ${order} order`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      f = fragment(s, "cell"),
      ops = {
        A: paste(s, f, range(s, "empty-cell", "empty-cell")),
        B: paste(s, f, range(s, "last-cell", "last-cell"), "match", "B"),
      };
    for (const a of order)
      assert.equal(room.accept(ops[a]).outcome, "accepted");
    for (const a of order.toReversed())
      assert.equal(
        room.accept(op(a, 2, { kind: "undo", target: ops[a].id })).outcome,
        "accepted",
      );
    assert.deepEqual(
      fragment(room.record.state, "cell", "last-cell"),
      fragment(s, "cell", "last-cell"),
    );
  });
test("duplicate and replay produce one identical paste", () => {
  const room = new Room(tableFixture()),
    record = room.record,
    s = record.state,
    o = paste(s, fragment(s, "cell"), range(s, "empty-cell", "empty-cell")),
    r = room.accept(o);
  assert.equal(r.outcome, "accepted");
  assert.deepEqual(room.accept(o), r);
  assert.deepEqual(
    replay(record, { op: o, receipt: r }).state,
    room.record.state,
  );
});
test("invented image references reject at both planner and authority", () => {
  const s = tableFixture(),
    f = fragment(s, "image-cell");
  assert.doesNotThrow(() => paste(s, f, range(s, "empty-cell", "empty-cell")));
  f.rows[0][0][0].asset = "foreign-secret";
  assert.throws(
    () => paste(s, f, range(s, "empty-cell", "empty-cell")),
    /unavailable/,
  );
  const forged = paste(
    s,
    fragment(s, "image-cell"),
    range(s, "empty-cell", "empty-cell"),
  );
  forged.intent.fragment.rows[0][0][0].asset = "foreign-secret";
  assert.throws(() => apply(s, forged), /unavailable/);
});
for (const [label, mutate] of [
  ["nested table", (f) => f.rows[0][0].push({ type: "table", children: [] })],
  ["forged identity", (f) => (f.rows[0][0][0].id = "first")],
  [
    "unsafe link",
    (f) =>
      (f.rows[0][0][0].content[0].marks = [
        { type: "link", attrs: { href: "javascript:alert(1)" } },
      ]),
  ],
  [
    "unsafe language",
    (f) =>
      (f.rows[0][0][0] = { type: "code", language: "<script>", content: [] }),
  ],
  ["ragged grid", (f) => f.rows.push([])],
  ["empty cell", (f) => (f.rows[0][0] = [])],
  ["forged lifecycle", (f) => (f.rows[0][0][0].retiredBy = "other")],
  [
    "invalid list first block",
    (f) =>
      (f.rows[0][0] = [
        {
          type: "bullet_list",
          children: [
            { type: "list_item", children: [{ type: "code", content: [] }] },
          ],
        },
      ]),
  ],
])
  test(`untrusted clipboard rejects ${label}`, () => {
    const f = fragment(tableFixture(), "cell");
    mutate(f);
    assert.throws(() => validateGridFragment(f));
  });
test("plain fallback preserves quoted tabs/newlines and treats formulas literally", () => {
  const f = gridFromText('"line\none"\t"tab\there"\n"a""b"\t=SUM(A1)');
  assert.equal(f.rows[0][0][0].content[0].text, "line\none");
  assert.equal(f.rows[1][1][0].content[0].text, "=SUM(A1)");
  assert.deepEqual(gridFromText(gridPlainText(f)), f);
  assert.throws(() => gridFromText('"unclosed'), /Unclosed/);
  assert.throws(() => gridFromText("a\tb\nc"), /regular grid/);
});
test("HTML fallback escapes image descriptions without embedding URLs", () => {
  const f = fragment(tableFixture(), "image-cell");
  f.rows[0][0][0].alt = "<private>";
  const html = gridHTML(f);
  assert.ok(html.includes("&lt;private&gt;"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("<table>"));
});

import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { planDelete } from "@cwhy/jade-core/commands";
for (const joined of [false, true])
  test(`nested rich list paste with active source join=${joined}, new editing and ordered Undo`, () => {
    let s = listFixture({ cell: true, parent: true, rich: true });
    if (joined) {
      const r = captureRange(
        s,
        { block: "ap", offset: 4 },
        { block: "ap", offset: 4 },
      );
      s = apply(s, op("B", 1, planDelete(s, r, "forward", op("B", 1)).intent));
    }
    const f = fragment(s, "cell"),
      o = paste(s, f, range(s, "other-cell", "other-cell")),
      n = apply(s, o);
    assert.deepEqual(fragment(n, "other-cell"), f);
    assert.deepEqual(fragment(n, "cell"), f);
    const list = n.nodes[n.nodes["other-cell"].children[0]],
      first = n.nodes[n.nodes[list.children[0]].children[0]],
      r = captureRange(
        n,
        { block: first.id, offset: 2 },
        { block: first.id, offset: 2 },
      );
    const entered = apply(n, op("A", 2, planEnter(n, r, op("A", 2)).intent)),
      back = undo(entered, "A:s:2", 3),
      restored = undo(back, o.id, 4);
    assert.deepEqual(
      restoredNode(restored.nodes["other-cell"]),
      s.nodes["other-cell"],
    );
    assert.deepEqual(fragment(restored, "cell"), f);
    validate(restored);
  });
for (const kind of ["insert", "delete", "format"])
  test(`late offline ${kind} into replaced contents rejects with original payload`, () => {
    const room = new Room(tableFixture()),
      s = room.record.state,
      id = text(s, "last")[0].id,
      late = op(
        "B",
        1,
        kind === "insert"
          ? {
              kind: "insert",
              at: gapAt(s, "last", 1),
              text: "offline",
              marks: [],
            }
          : kind === "delete"
            ? { kind: "delete", ids: [id] }
            : {
                kind: "format",
                ids: [id],
                property: "strong",
                value: "strong",
              },
      );
    room.accept(
      paste(s, fragment(s, "cell"), range(s, "last-cell", "last-cell")),
    );
    const before = room.record.state,
      r = room.accept(late);
    assert.equal(r.outcome, "rejected");
    assert.match(r.reason, /cleared/);
    assert.equal(r.bytes, JSON.stringify(late));
    assert.deepEqual(room.record.state, before);
  });
