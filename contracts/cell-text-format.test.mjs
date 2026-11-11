// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { Room } from "@cwhy/jade-collaboration/room";
import {
  captureRange,
  insertionMarks,
  planReplace,
} from "@cwhy/jade-core/selection";
import { plainFragment } from "@cwhy/jade-core/fragment";
import { apply, validate, text, gapAt } from "@cwhy/jade-core/admission";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import {
  planCellTextFormat,
  cellTextFormatState,
  planInsertColumn,
  copyCells,
} from "@cwhy/jade-core/commands";
const op = (a, n, intent) => ({
  id: `${a}:s:${n}`,
  actor: a,
  stream: "s",
  seq: n,
  epoch: 1,
  intent,
});
const range = (s) => captureCellRange(s, "table", "code-cell", "cell");
const format = (
  s,
  property = "strong",
  value = undefined,
  a = "A",
  n = 1,
  r = range(s),
) => {
  const p = planCellTextFormat(s, r, op(a, n), { property, value });
  return { ...p, op: op(a, n, p.intent) };
};
const undo = (s, target, a = "A", n = 2) =>
  apply(s, op(a, n, { kind: "undo", target }));
const marks = (s, b) => text(s, b).map((a) => a.marks);
for (const property of [
  "strong",
  "em",
  "underline",
  "strike",
  "highlight",
  "color",
])
  test(`selected cells ${property} includes code and list prose, exact identities/geometry/selection and one Undo`, () => {
    const s = tableFixture();
    s.nodes.code.language = "javascript";
    const r = range(s),
      p = format(
        s,
        property,
        ["highlight", "color"].includes(property)
          ? { type: property, attrs: { color: "yellow" } }
          : undefined,
      );
    validate(p.state);
    assert.deepEqual(p.selection, r);
    assert.deepEqual(p.state.nodes, s.nodes);
    assert.deepEqual(p.state.replicas, s.replicas);
    assert.deepEqual(p.state.runs, s.runs);
    for (const b of ["first", "list-text", "code"])
      assert.ok(
        marks(p.state, b).every((m) => m.some((x) => x.type === property)),
      );
    for (const b of ["image-text", "last"])
      assert.deepEqual(text(p.state, b), text(s, b));
    const back = undo(p.state, p.op.id);
    for (const b of ["first", "list-text", "code"])
      assert.deepEqual(text(back, b), text(s, b));
    const redo = undo(back, "A:s:2", "A", 3);
    for (const b of ["first", "list-text", "code"])
      assert.deepEqual(text(redo, b), text(p.state, b));
  });
test("mixed toggle enables all; fully enabled toggles off; code participates in mixed state", () => {
  const s = tableFixture(),
    a = format(
      s,
      "strong",
      undefined,
      "A",
      1,
      captureCellRange(s, "table", "cell"),
    ).state;
  assert.equal(cellTextFormatState(a, range(a), "strong").mixed, true);
  const b = format(a, "strong", undefined, "A", 2).state;
  assert.equal(cellTextFormatState(b, range(b), "strong").enabled, true);
  const c = format(b, "strong", undefined, "A", 3).state;
  assert.equal(cellTextFormatState(c, range(c), "strong").enabled, false);
  assert.deepEqual(marks(c, "code"), marks(s, "code"));
});
for (const arrival of [
  ["A", "B"],
  ["B", "A"],
])
  for (const removal of [
    ["A", "B"],
    ["B", "A"],
  ])
    test(`code highlight peers arrive ${arrival}, Undo ${removal} returns remaining then original`, () => {
      const s = tableFixture(),
        room = new Room(s),
        r = captureCellRange(s, "table", "code-cell"),
        ops = {
          A: format(
            s,
            "highlight",
            { type: "highlight", attrs: { color: "yellow" } },
            "A",
            1,
            r,
          ).op,
          B: format(
            s,
            "highlight",
            { type: "highlight", attrs: { color: "blue" } },
            "B",
            1,
            r,
          ).op,
        };
      for (const a of arrival)
        assert.equal(room.accept(ops[a]).outcome, "accepted");
      assert.equal(
        text(room.record.state, "code")[0].marks[0].attrs.color,
        arrival[1] === "A" ? "yellow" : "blue",
      );
      for (const a of removal) {
        assert.equal(
          room.accept(op(a, 2, { kind: "undo", target: ops[a].id })).outcome,
          "accepted",
        );
        if (a === removal[0])
          assert.equal(
            text(room.record.state, "code")[0].marks[0].attrs.color,
            removal[1] === "A" ? "yellow" : "blue",
          );
      }
      assert.deepEqual(text(room.record.state, "code"), text(s, "code"));
    });
test("Redo retains original format order behind later peer color", () => {
  const s = tableFixture(),
    a = format(s, "highlight", {
      type: "highlight",
      attrs: { color: "yellow" },
    }),
    b = format(
      a.state,
      "highlight",
      { type: "highlight", attrs: { color: "blue" } },
      "B",
    ),
    back = undo(b.state, a.op.id),
    redo = undo(back, "A:s:2", "A", 3);
  assert.equal(text(redo, "code")[0].marks[0].attrs.color, "blue");
});
for (const first of [false, true])
  test(`concurrent code typing is not swept into frozen selected-cell format; typing first=${first}`, () => {
    const s = tableFixture(),
      f = format(s),
      insert = op("B", 1, {
        kind: "insert",
        at: gapAt(s, "code", 5),
        text: "peer",
      });
    const next = first ? apply(apply(s, insert), f.op) : apply(f.state, insert);
    assert.equal(
      text(next, "code")
        .map((a) => a.char)
        .join(""),
      "constpeer value = 1;",
    );
    assert.ok(
      text(next, "code")
        .filter((a) => a.id.startsWith("B:"))
        .every((a) => !a.marks.length),
    );
    const back = undo(next, f.op.id);
    assert.deepEqual(text(back, "code"), text(apply(s, insert), "code"));
  });
test("empty selected cell is a no-op, image remains intact, stale grid is refused", () => {
  const s = tableFixture(),
    empty = format(
      s,
      "strong",
      undefined,
      "A",
      1,
      captureCellRange(s, "table", "empty-cell"),
    );
  assert.equal(empty.intent, null);
  assert.equal(empty.state, s);
  const p = format(
    s,
    "em",
    undefined,
    "A",
    1,
    captureCellRange(s, "table", "image-cell"),
  );
  assert.deepEqual(p.state.nodes.image, s.nodes.image);
  const old = range(s),
    n = planInsertColumn(
      s,
      captureCellRange(s, "table", "list-cell"),
      op("B", 1),
      { side: "left" },
    ).state;
  assert.throws(
    () => planCellTextFormat(n, old, op("A", 1), { property: "strong" }),
    /changed/,
  );
});
test("formatted code survives rich grid copy with language and exact text", () => {
  const s = tableFixture();
  s.nodes.code.language = "javascript";
  const p = format(s, "strong").state,
    fragment = copyCells(p, range(p)),
    code = fragment.rows[0][2][0];
  assert.equal(code.language, "javascript");
  assert.equal(code.content.map((c) => c.text).join(""), "const value = 1;");
  assert.ok(
    code.content.every((c) => c.marks.some((m) => m.type === "strong")),
  );
});
for (const options of [
  { property: "link" },
  { property: "strong", value: null },
  { property: "highlight" },
  {
    property: "highlight",
    value: { type: "highlight", attrs: { color: "url(evil)" } },
  },
])
  test(`invalid selected-cell formatting rejects unchanged ${JSON.stringify(options)}`, () => {
    const s = tableFixture(),
      before = JSON.stringify(s);
    assert.throws(() => planCellTextFormat(s, range(s), op("A", 1), options));
    assert.equal(JSON.stringify(s), before);
  });

test("native code typing inherits supported text style while external paste stays literal", () => {
  const s = format(tableFixture(), "strong").state,
    r = captureRange(
      s,
      { block: "code", offset: 5 },
      { block: "code", offset: 5 },
    ),
    typed = planReplace(s, r, plainFragment("中"), op("A", 2), {
      inheritedMarks: insertionMarks(s, r),
    }).state;
  assert.ok(text(typed, "code")[5].marks.some((m) => m.type === "strong"));
  assert.deepEqual(text(undo(typed, "A:s:2", "A", 3), "code"), text(s, "code"));
  const pasted = planReplace(
    s,
    r,
    {
      version: 1,
      blocks: [
        {
          type: "paragraph",
          content: [{ text: "literal", marks: [{ type: "em" }] }],
        },
      ],
    },
    op("B", 1),
  ).state;
  assert.ok(
    text(pasted, "code")
      .slice(5, 12)
      .every((a) => !a.marks.length),
  );
});

for (const removal of [
  ["A", "B"],
  ["B", "A"],
])
  test(`color reset is atomic and owned; peer Undo ${removal}`, () => {
    const s = tableFixture(),
      r = range(s);
    let seed = format(s, "strong").state;
    seed = format(seed, "strike", undefined, "A", 2).state;
    seed = format(
      seed,
      "color",
      { type: "color", attrs: { color: "red" } },
      "A",
      3,
    ).state;
    seed = format(
      seed,
      "highlight",
      { type: "highlight", attrs: { color: "yellow" } },
      "A",
      4,
    ).state;
    const reset = format(seed, "resetColors", undefined, "A", 5),
      peer = format(
        reset.state,
        "color",
        { type: "color", attrs: { color: "blue" } },
        "B",
        1,
      );
    let n = peer.state;
    const ids = { A: "A:s:5", B: "B:s:1" };
    for (const b of ["first", "list-text", "code"])
      assert.ok(
        marks(reset.state, b).every(
          (ms) =>
            ms.some((m) => m.type === "strong") &&
            ms.some((m) => m.type === "strike") &&
            !ms.some((m) => ["color", "highlight"].includes(m.type)),
        ),
      );
    for (const a of removal) n = undo(n, ids[a], a, a === "A" ? 6 : 2);
    for (const b of ["first", "list-text", "code"])
      assert.deepEqual(text(n, b), text(seed, b));
    const redone = undo(n, "A:s:6", "A", 7);
    for (const b of ["first", "list-text", "code"])
      assert.ok(
        marks(redone, b).every(
          (ms) => !ms.some((m) => ["color", "highlight"].includes(m.type)),
        ),
      );
  });
test("default text color preserves highlight and decorations; Reset preserves links in prose", () => {
  let s = tableFixture();
  s = apply(
    s,
    op("seed", 1, {
      kind: "format",
      ids: text(s, "first").map((a) => a.id),
      property: "link",
      value: { type: "link", attrs: { href: "https://example.com" } },
    }),
  );
  s = format(s, "underline").state;
  s = format(
    s,
    "color",
    { type: "color", attrs: { color: "red" } },
    "A",
    2,
  ).state;
  s = format(
    s,
    "highlight",
    { type: "highlight", attrs: { color: "yellow" } },
    "A",
    3,
  ).state;
  const d = format(s, "color", null, "A", 4).state;
  assert.ok(
    marks(d, "code").every(
      (ms) =>
        ms.some((m) => m.type === "highlight") &&
        ms.some((m) => m.type === "underline") &&
        !ms.some((m) => m.type === "color"),
    ),
  );
  const reset = format(d, "resetColors", undefined, "A", 5).state;
  assert.ok(
    marks(reset, "first").every(
      (ms) =>
        ms.some((m) => m.type === "link") &&
        ms.some((m) => m.type === "underline"),
    ),
  );
});
test("text color validates at admission, native code inheritance and rich copy preserve it", () => {
  const s = tableFixture(),
    before = JSON.stringify(s);
  assert.throws(
    () =>
      apply(
        s,
        op("A", 1, {
          kind: "format",
          ids: text(s, "code").map((a) => a.id),
          property: "color",
          value: { type: "color", attrs: { color: "red;position:fixed" } },
        }),
      ),
    /Admission: invalid formatting value/,
  );
  assert.equal(JSON.stringify(s), before);
  const n = format(s, "color", {
      type: "color",
      attrs: { color: "#aabbcc" },
    }).state,
    r = captureRange(
      n,
      { block: "code", offset: 5 },
      { block: "code", offset: 5 },
    );
  const typed = planReplace(n, r, plainFragment("中"), op("A", 2), {
    inheritedMarks: insertionMarks(n, r),
  }).state;
  assert.deepEqual(text(typed, "code")[5].marks, [
    { type: "color", attrs: { color: "#aabbcc" } },
  ]);
  assert.ok(
    copyCells(typed, range(typed)).rows[0][2][0].content.every((c) =>
      c.marks.some((m) => m.type === "color"),
    ),
  );
});
