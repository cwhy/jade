// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  apply,
  text,
  gapAt,
  resolveGap,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
import { immutable } from "@cwhy/jade-core/immutability";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planListEnter,
  planListIndent,
  planListBackspace,
} from "@cwhy/jade-core/list-commands";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";

const op = (id, intent, actor = "A") => ({ id, actor, epoch: 1, intent });
const r = (s, b = "bp", at = 0, end = b, to = at) =>
  captureRange(s, { block: b, offset: at }, { block: end, offset: to });
const run = (s, p) => immutable(apply(s, op("key", p.intent)));
const undo = (s, target = "key", id = "undo") =>
  immutable(apply(s, op(id, { kind: "undo", target })));
const val = (s, id) =>
  text(s, id)
    .map((a) => a.char)
    .join("");
const logical = (s) =>
  Object.values(s.nodes)
    .filter((n) => n.live)
    .map((n) => ({
      id: n.id,
      type: n.type,
      children: n.children,
      language: n.language,
      asset: n.asset,
      ...(n.text ? { atoms: text(s, n.id) } : {}),
    }));
function shape(s) {
  for (const n of Object.values(s.nodes).filter((n) => n.live)) {
    if (["bullet_list", "ordered_list"].includes(n.type))
      assert.ok(n.children.every((id) => s.nodes[id].type === "list_item"));
    if (n.type === "list_item")
      assert.equal(s.nodes[n.children[0]].type, "paragraph");
  }
  validate(s);
}
for (const cell of [false, true])
  for (const parent of [false, true])
    for (const at of [0, 2, 4])
      test(`Enter cell=${cell} parent=${parent} at=${at}`, () => {
        const s = listFixture({ cell, parent }),
          p = planListEnter(s, r(s, "ap", at), op("key")),
          n = run(s, p);
        shape(n);
        assert.equal(
          Object.values(n.nodes).filter((x) => x.live && x.type === "list_item")
            .length,
          Object.values(s.nodes).filter((x) => x.live && x.type === "list_item")
            .length + 1,
        );
        const pos = resolveGap(n, p.after);
        assert.equal(pos.offset, 0);
        assert.equal(val(n, pos.block), "aaaa".slice(at));
        if (parent && at > 0) {
          assert.equal(n.nodes.nested.children.at(-1), "child");
          assert.equal(n.nodes.a.children[1], "nested");
        }
        if (at === 0) assert.equal(n.nodes.list.children[1], "a");
        const restored = undo(n);
        assert.deepEqual(logical(restored), logical(s));
        const redo = undo(restored, "undo", "redo");
        assert.deepEqual(logical(redo), logical(n));
      });
for (const cell of [false, true])
  for (const rich of [false, true])
    test(`indent/outdent carries descendants and assets cell=${cell} rich=${rich}`, () => {
      const s = listFixture({ cell, rich }),
        p = planListIndent(s, r(s), op("key")),
        n = run(s, p);
      shape(n);
      assert.deepEqual(n.nodes.list.children, ["a", "c"]);
      const nested = n.nodes.a.children[1];
      assert.deepEqual(n.nodes[nested].children, ["b"]);
      const lifted = planListIndent(n, r(n), op("lift"), { outdent: true }),
        back = immutable(apply(n, op("lift", lifted.intent)));
      shape(back);
      assert.deepEqual(back.nodes.list.children, ["a", "b", "c"]);
      assert.deepEqual(logical(undo(n)), logical(s));
    });
test("first-item indent is a true no-op", () => {
  const s = listFixture();
  assert.equal(planListIndent(s, r(s, "ap"), op("key")).intent, null);
});
test("multiple sibling indentation retains order and backward selection", () => {
  const s = listFixture(),
    range = r(s, "cp", 2, "bp", 1),
    p = planListIndent(s, range, op("key")),
    n = run(s, p);
  assert.deepEqual(n.nodes.list.children, ["a"]);
  assert.deepEqual(n.nodes[n.nodes.a.children[1]].children, ["b", "c"]);
  assert.deepEqual(logical(undo(n)), logical(s));
});
for (const cell of [false, true])
  test(`top-level outdent splits surrounding lists and retains rich content, cell=${cell}`, () => {
    const s = listFixture({ cell, rich: true }),
      p = planListIndent(s, r(s), op("key"), { outdent: true }),
      n = run(s, p),
      owner = cell ? "cell" : "doc";
    shape(n);
    assert.deepEqual(n.nodes[owner].children.slice(0, 4), [
      "list",
      "bp",
      "code",
      "image",
    ]);
    assert.deepEqual(n.nodes.list.children, ["a"]);
    assert.deepEqual(n.nodes[n.nodes[owner].children[4]].children, ["c"]);
    assert.deepEqual(logical(undo(n)), logical(s));
  });
for (const cell of [false, true])
  test(`empty Enter and boundary Backspace exit one level, cell=${cell}`, () => {
    const s = listFixture({ cell, empty: true });
    for (const plan of [planListEnter, planListBackspace]) {
      const n = run(s, plan(s, r(s), op("key")));
      shape(n);
      assert.equal(n.nodes.b.live, false);
      assert.equal(val(n, "bp"), "");
      assert.deepEqual(logical(undo(n)), logical(s));
    }
  });
for (const order of [0, 1])
  for (const command of ["indent", "outdent", "enter"])
    test(`${command} and peer text, arrival ${order}`, () => {
      const s = listFixture({ cell: true }),
        anchor = anchorAt(s, "bp", 0, 4),
        plan =
          command === "enter"
            ? planListEnter(s, r(s, "bp", 2), op("key"))
            : planListIndent(s, r(s), op("key"), {
                outdent: command === "outdent",
              }),
        key = op("key", plan.intent),
        peer = op(
          "peer",
          {
            kind: "insert",
            at: gapAt(s, "bp", 3),
            text: "Q",
            marks: ["strong"],
          },
          "B",
        );
      let n = s;
      for (const e of order ? [peer, key] : [key, peer])
        n = immutable(apply(n, e));
      shape(n);
      assert.equal(resolveAnchor(n, anchor).status, "exact");
      n = undo(n);
      assert.equal(val(n, "bp"), "bbbQb");
      assert.deepEqual(n.nodes.cell.children, ["list"]);
      assert.deepEqual(n.nodes.list.children, ["a", "b", "c"]);
      assert.equal(text(n, "bp")[3].marks[0], "strong");
      n = immutable(
        apply(n, op("undopeer", { kind: "undo", target: "peer" }, "B")),
      );
      assert.deepEqual(logical(n), logical(s));
    });
test("nested outdent adopts following siblings to preserve traversal order", () => {
  let s = listFixture();
  const first = planListIndent(s, r(s, "bp", 0, "cp", 4), op("nest"));
  s = immutable(apply(s, op("nest", first.intent)));
  const p = planListIndent(s, r(s), op("key"), { outdent: true }),
    n = run(s, p);
  shape(n);
  assert.deepEqual(n.nodes.list.children, ["a", "b"]);
  assert.deepEqual(n.nodes[n.nodes.b.children[1]].children, ["c"]);
  assert.deepEqual(logical(undo(n)), logical(s));
});
test("selected attachment ranges and continuation paragraphs remain explicit gates, no mutation", () => {
  const s = listFixture({ rich: true }),
    before = structuredClone(s);
  assert.throws(
    () => planListEnter(s, r(s, "bp", 1, "bp", 2), op("key")),
    /attachments/,
  );
  assert.deepEqual(s, before);
  const unsupported = structuredClone(s);
  unsupported.nodes.code.type = "paragraph";
  const unchanged = structuredClone(unsupported);
  assert.throws(
    () => planListEnter(unsupported, r(unsupported, "bp", 2), op("key")),
    /attachments/,
  );
  assert.deepEqual(unsupported, unchanged);
});
