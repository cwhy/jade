// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt, resolveGap } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planEnter,
  planReplace,
  planCodeIndent,
  planDelete,
} from "@cwhy/jade-core/commands";
import { plainFragment, literalFragment } from "@cwhy/jade-core/fragment";
import { upgradeStorage } from "@cwhy/jade-core/storage";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  stream: "code",
  id: `${actor}:code:${seq}`,
  epoch: 1,
  modelVersion: 2,
});
const value = (s) =>
  text(s, "code")
    .map((a) => a.char)
    .join("");
const range = (s, from, to = from) =>
  captureRange(
    s,
    { block: "code", offset: from },
    { block: "code", offset: to },
  );
function fixture(value, cell = false) {
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children: cell ? ["table"] : ["before", "code", "after"],
    },
    before: { id: "before", type: "paragraph", live: true },
    code: { id: "code", type: "code", language: "javascript", live: true },
    after: { id: "after", type: "paragraph", live: true },
  };
  if (cell)
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: ["before", "code", "after"],
      },
    });
  return seed(nodes, {
    before: [{ text: "Before" }],
    code: [{ text: value }],
    after: [{ text: "After" }],
  });
}
for (const cell of [false, true]) {
  for (const [source, offset, expected] of [
    ["  run()", 7, "  run()\n  "],
    ["\t  你好😀", 6, "\t  你好😀\n\t  "],
    ["    run", 2, "  \n    run"],
    ["  x\n\ty", 6, "  x\n\ty\n\t"],
    ["", 0, "\n"],
    ["  ", 2, "  \n  "],
  ]) {
    test(`code Enter carries literal indentation in ${cell ? "cell" : "body"}: ${JSON.stringify(source)}`, () => {
      const s = fixture(source, cell),
        plan = planEnter(s, range(s, offset), op("a", 1));
      assert.equal(value(plan.state), expected);
      validate(plan.state);
      assert.equal(
        resolveGap(plan.state, plan.after).offset,
        offset + 1 + (expected.length - source.length - 1),
      );
      assert.equal(plan.state.nodes.code.language, "javascript");
      const undone = apply(
        plan.state,
        op("a", 2, { kind: "undo", target: "a:code:1" }),
      );
      assert.equal(value(undone), source);
    });
  }
  test(`code paste normalizes line endings and keeps punctuation, tabs, Unicode and one Undo (${cell})`, () => {
    const s = fixture("ab", cell),
      plan = planReplace(
        s,
        range(s, 1),
        plainFragment(" \t你好\r\n# literal\r- bullet\n\n"),
        op("a", 1),
      );
    assert.equal(value(plan.state), "a \t你好\n# literal\n- bullet\n\nb");
    assert.equal(plan.state.nodes.code.language, "javascript");
    assert.equal(
      value(
        apply(plan.state, op("a", 2, { kind: "undo", target: "a:code:1" })),
      ),
      "ab",
    );
  });
  test(`code boundary deletion cannot consume adjacent prose (${cell})`, () => {
    const s = fixture("code", cell);
    assert.equal(
      planDelete(s, range(s, 0), "backward", op("a", 1)).intent,
      null,
    );
    assert.equal(
      planDelete(s, range(s, 4), "forward", op("a", 1)).intent,
      null,
    );
  });
  test(`code line indentation removes spaces but preserves literal tabs (${cell})`, () => {
    const s = fixture("  first\n\tsecond\n third", cell),
      plan = planCodeIndent(s, range(s, 0, 22), op("a", 1), { outdent: true });
    assert.equal(value(plan.state), "first\n\tsecond\nthird");
    assert.equal(
      value(
        apply(plan.state, op("a", 2, { kind: "undo", target: "a:code:1" })),
      ),
      value(s),
    );
  });
}
for (const order of ["ab", "ba"])
  test(`concurrent code Enter and typing retain exact peer text through persisted Undo (${order})`, () => {
    const s = fixture("  hello"),
      a = op("a", 1),
      b = op("b", 1, { kind: "insert", at: gapAt(s, "code", 2), text: "你" });
    a.intent = planEnter(s, range(s, 7), a).intent;
    let n = s;
    for (const actor of order) n = apply(n, actor === "a" ? a : b);
    assert.equal(value(n), "  你hello\n  ");
    n = upgradeStorage(JSON.parse(JSON.stringify(n)));
    n = apply(n, op("a", 2, { kind: "undo", target: a.id }));
    assert.equal(value(n), "  你hello");
    n = apply(n, op("a", 3, { kind: "undo", target: "a:code:2" }));
    assert.equal(value(n), "  你hello\n  ");
    validate(n);
  });

test("3,000-line literal code paste has no paragraph-fragment ceiling, retains LF and one Undo", () => {
  const source = Array.from(
      { length: 3000 },
      (_, i) => `  line_${i}();\r\n`,
    ).join(""),
    s = fixture(""),
    expected = source.replace(/\r\n/g, "\n");
  const plan = planReplace(s, range(s, 0), literalFragment(source), op("a", 1));
  assert.equal(value(plan.state), expected);
  assert.equal(plan.state.nodes.doc.children.length, 3);
  assert.equal(
    value(apply(plan.state, op("a", 2, { kind: "undo", target: "a:code:1" }))),
    "",
  );
  assert.throws(() => literalFragment("x".repeat(100001)), /large/);
});
test("replacing selected code with Enter uses leading indentation and restores selected text", () => {
  const s = fixture("  first\n  second"),
    plan = planEnter(s, range(s, 4, 12), op("a", 1));
  assert.equal(value(plan.state), "  fi\n  cond");
  assert.equal(
    value(apply(plan.state, op("a", 2, { kind: "undo", target: "a:code:1" }))),
    value(s),
  );
});
