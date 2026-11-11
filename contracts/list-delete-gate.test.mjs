// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { probeDelete } from "@cwhy/jade-testkit/list-probe";
import {
  apply,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
  validate,
} from "@cwhy/jade-core/model";
import {
  apply as admittedApply,
  validateDocumentShape,
} from "@cwhy/jade-core/base-admission";
import { immutable } from "@cwhy/jade-core/immutability";
import { captureRange } from "@cwhy/jade-core/selection";
import { planListEnter } from "@cwhy/jade-core/list-commands";
const op = (id, intent, actor = "A") => ({ id, actor, epoch: 1, intent }),
  run = (s, e) => immutable(apply(s, e));
const logical = (s) => {
  const out = [];
  const walk = (id) => {
    const n = s.nodes[id];
    out.push({
      id,
      type: n.type,
      children: n.children,
      ...(n.text ? { atoms: text(s, id) } : {}),
    });
    for (const c of n.children || []) walk(c);
  };
  walk(s.root);
  return out;
};
const value = (s, b) =>
  text(s, b)
    .map((a) => a.char)
    .join("");
const range = (s, b) => {
  const p = { block: b, offset: s.replicas[s.nodes[b].text].length };
  return captureRange(s, p, p);
};
const key = (s, b = "ap", id = "key", actor = "A") =>
  op(id, probeDelete(s, range(s, b), op(id, null, actor)).intent, actor);
const undo = (s, target, id, actor = "A") =>
  run(s, op(id, { kind: "undo", target }, actor));
function fixture(kind) {
  let s = listFixture({ cell: true, parent: kind === "parent-child" });
  if (kind === "leaf-parent") {
    s = structuredClone(listFixture({ cell: true, parent: true }));
    s.nodes.a.children = ["ap"];
    s.nodes.b.children.push("nested");
    s = immutable(s);
  }
  return s;
}
for (const kind of ["leaves", "parent-child", "leaf-parent"])
  test(`reference shape ${kind}`, () => {
    const s = fixture(kind),
      n = run(s, key(s));
    validate(n);
    validateDocumentShape(n);
    assert.equal(
      value(n, "ap"),
      kind === "parent-child" ? "aaaachild" : "aaaabbbb",
    );
    if (kind === "leaf-parent")
      assert.deepEqual(n.nodes.list.children, ["a", "child", "c"]);
    if (kind === "parent-child") assert.deepEqual(n.nodes.a.children, ["ap"]);
    assert.deepEqual(logical(undo(n, "key", "undo")), logical(s));
    assert.deepEqual(
      logical(undo(undo(n, "key", "undo"), "undo", "redo")),
      logical(n),
    );
  });
for (const kind of ["leaves", "parent-child", "leaf-parent"])
  for (const rightSide of [false, true])
    for (const peerFirst of [false, true])
      for (const peerUndoFirst of [false, true])
        test(`typing and owned Undo ${kind} right=${rightSide} peerFirst=${peerFirst} peerUndoFirst=${peerUndoFirst}`, () => {
          const s = fixture(kind),
            right = kind === "parent-child" ? "childp" : "bp",
            block = rightSide ? right : "ap",
            anchor = anchorAt(s, block, 0, text(s, block).length),
            peer = op(
              "peer",
              {
                kind: "insert",
                at: gapAt(s, block, 2),
                text: "中",
                marks: ["strong"],
              },
              "B",
            ),
            join = key(s);
          let n = s;
          for (const e of peerFirst ? [peer, join] : [join, peer])
            n = run(n, e);
          validate(n);
          validateDocumentShape(n);
          const joined = logical(n);
          if (peerUndoFirst) {
            n = undo(n, "peer", "up", "B");
            n = undo(n, "key", "uk");
          } else {
            n = undo(n, "key", "uk");
            assert.equal(resolveAnchor(n, anchor).status, "exact");
            assert.equal(
              value(n, block),
              value(s, block).slice(0, 2) + "中" + value(s, block).slice(2),
            );
            n = undo(n, "peer", "up", "B");
          }
          assert.deepEqual(logical(n), logical(s));
          if (peerUndoFirst) {
            n = undo(n, "uk", "rk");
            n = undo(n, "up", "rp", "B");
          } else {
            n = undo(n, "up", "rp", "B");
            n = undo(n, "uk", "rk");
          }
          assert.deepEqual(logical(n), joined);
        });
test("probe stays outside public admission", () => {
  const s = fixture("leaves");
  assert.throws(() => admittedApply(s, key(s)), /unsupported public operation/);
});
// Feasibility gates, not expected-failure skips. Both peers own independent
// actions against one logical boundary, and neither may consume the other.
for (const order of [
  [0, 1],
  [1, 0],
])
  for (const undoOrder of [
    [0, 1],
    [1, 0],
  ])
    test(`GATE concurrent Delete arrival=${order} Undo=${undoOrder}`, () => {
      const s = fixture("leaves"),
        ops = [key(s, "ap", "Adelete", "A"), key(s, "ap", "Bdelete", "B")];
      let n = s;
      for (const i of order) n = run(n, ops[i]);
      assert.equal(value(n, "ap"), "aaaabbbb");
      for (const [j, i] of undoOrder.entries()) {
        n = undo(n, ops[i].id, "undo" + i, ops[i].actor);
        if (j === 0)
          assert.equal(
            value(n, "ap"),
            "aaaabbbb",
            "Other actor still owns the join",
          );
      }
      assert.deepEqual(logical(n), logical(s));
    });
for (const cut of [0, 2, 4])
  test(`GATE Enter then Delete then original Enter Undo, cut=${cut}`, () => {
    const s = fixture("leaves"),
      p = { block: "ap", offset: cut },
      enter = op(
        "enter",
        planListEnter(s, captureRange(s, p, p), op("enter")).intent,
      );
    let n = run(s, enter);
    n = run(n, key(n));
    assert.equal(value(n, "ap"), "aaaa");
    n = undo(n, "enter", "undoEnter");
    validate(n);
    validateDocumentShape(n);
    assert.deepEqual(logical(n), logical(s));
  });
for (const cut of [0, 2, 4])
  for (const peerFirst of [false, true])
    test(`GATE fresh Delete and peer Enter on right item cut=${cut} peerFirst=${peerFirst}`, () => {
      const s = fixture("leaves"),
        p = { block: "bp", offset: cut },
        enter = op(
          "peerEnter",
          planListEnter(s, captureRange(s, p, p), op("peerEnter", null, "B"))
            .intent,
          "B",
        ),
        join = key(s);
      let n = s;
      for (const e of peerFirst ? [enter, join] : [join, enter]) n = run(n, e);
      n = undo(n, "key", "undoJoin");
      n = undo(n, "peerEnter", "undoEnter", "B");
      assert.deepEqual(logical(n), logical(s));
    });
for (const kind of ["parent-child", "leaf-parent"])
  test(`multiple descendants retain order and identity ${kind}`, async () => {
    const { seed } = await import("@cwhy/jade-core/model");
    const initial = fixture(kind),
      nodes = structuredClone(initial.nodes),
      contents = {};
    for (const n of Object.values(nodes))
      if (n.text) {
        contents[n.id] = text(initial, n.id).map((a) => ({
          text: a.char,
          marks: a.marks,
        }));
        delete n.text;
      }
    for (const id of ["second", "third"]) {
      nodes.nested.children.push(id);
      nodes[id] = { id, type: "list_item", live: true, children: [id + "p"] };
      nodes[id + "p"] = { id: id + "p", type: "paragraph", live: true };
      contents[id + "p"] = [{ text: id, marks: ["strong"] }];
    }
    const s = immutable(seed(nodes, contents)),
      n = run(s, key(s));
    validateDocumentShape(n);
    if (kind === "parent-child")
      assert.deepEqual(n.nodes.nested.children, ["second", "third"]);
    else
      assert.deepEqual(n.nodes.list.children, [
        "a",
        "child",
        "second",
        "third",
        "c",
      ]);
    for (const id of ["secondp", "thirdp"])
      assert.deepEqual(text(n, id), text(s, id));
    assert.deepEqual(logical(undo(n, "key", "undo")), logical(s));
  });
