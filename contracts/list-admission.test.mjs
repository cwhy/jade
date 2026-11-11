// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { Room, Client } from "@cwhy/jade-testkit/peers";
import {
  apply,
  validate,
  validateDocumentShape,
  gapAt,
  text,
} from "@cwhy/jade-core/base-admission";
import { planListIndent, planListEnter } from "@cwhy/jade-core/list-commands";
import { captureRange } from "@cwhy/jade-core/selection";
const operation = (intent, seq = 1) => ({
  id: `A:admit:${seq}`,
  actor: "A",
  stream: "admit",
  seq,
  epoch: 1,
  intent,
});
const fixture = () => listFixture({ cell: true, parent: true, rich: true });
const rawWrap = {
  kind: "treeWrap",
  id: "new-list",
  type: "bullet_list",
  nodes: ["b", "c"],
  from: "list",
  expected: [null, null],
};
const malformed = [
  ["missing intent", null],
  ["unknown kind", { kind: "wat" }],
  ["empty batch", { kind: "batch", intents: [] }],
  ["missing batch", { kind: "batch" }],
  ["raw wrapper", rawWrap],
  ["incomplete structural batch", { kind: "batch", intents: [rawWrap] }],
  [
    "unwrap item into list",
    {
      kind: "batch",
      intents: [{ kind: "treeUnwrap", node: "b", expected: null }],
    },
  ],
  [
    "row as a body block",
    {
      kind: "batch",
      intents: [
        {
          kind: "treePlace",
          node: "row",
          from: "table",
          parent: "doc",
          before: null,
          expected: null,
        },
      ],
    },
  ],
  [
    "missing expected tokens",
    { kind: "batch", intents: [{ ...rawWrap, expected: null }] },
  ],
  [
    "malformed wrapper type",
    { kind: "batch", intents: [{ ...rawWrap, type: "paragraph" }] },
  ],
  ["forged inverse", { kind: "treeRestore", mode: "wrap" }],
  [
    "forged boundary activation",
    { kind: "listBoundaryActive", family: "x", boundary: "y", active: false },
  ],
  [
    "forged formatting activation",
    { kind: "formatActive", ids: [], active: false },
  ],
  ["empty Undo", { kind: "undo", targets: [] }],
  ["duplicate Undo", { kind: "undo", targets: ["x", "x"] }],
  ["nested Undo", { kind: "batch", intents: [{ kind: "undo", target: "x" }] }],
  ["missing gap", { kind: "listEnter" }],
  ["empty deletion", { kind: "delete", ids: [] }],
  ["unqualified legacy split", { kind: "split", tail: "new" }],
  [
    "invalid formatting domain",
    { kind: "format", ids: ["seed:bp:0"], property: "script", value: "script" },
  ],
];
for (const [name, intent] of malformed)
  test(`rejected receipt is durable and gap-free: ${name}`, () => {
    let room = new Room(fixture());
    const before = room.snapshot().state,
      op = operation(intent),
      receipt = room.accept(op);
    assert.equal(receipt.outcome, "rejected");
    assert.deepEqual(room.record.state, before);
    assert.equal(room.record.frontiers["A:admit"], 1);
    room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
    assert.deepEqual(room.accept(op), receipt);
    const next = operation(
      { kind: "insert", at: gapAt(before, "bp", 0), text: "Q" },
      2,
    );
    assert.equal(room.accept(next).outcome, "accepted");
    assert.equal(room.record.state.revision, 1);
    assert.equal(text(room.record.state, "bp")[0].char, "Q");
  });
const badInsert = [
  ["missing text", (i) => delete i.text],
  ["empty text", (i) => (i.text = "")],
  ["null marks", (i) => (i.marks = null)],
  ["null mark", (i) => (i.marks = [null])],
  [
    "unsafe link",
    (i) =>
      (i.marks = [{ type: "link", attrs: { href: "javascript:alert(1)" } }]),
  ],
  ["forged atoms", (i) => (i.atoms = [])],
  ["forged pieces", (i) => (i.pieces = [])],
  ["forged restore", (i) => (i.restore = false)],
  ["unknown source", (i) => (i.at.text = "unknown")],
  ["invalid generation", (i) => (i.at.generation = "1")],
  ["invalid offset", (i) => (i.at.offset = -1)],
  [
    "invalid slice",
    (i) => (i.at.before = [{ run: "seed:bp", from: -1, length: 1 }]),
  ],
  ["invalid gap codec", (i) => (i.at.codec = 99)],
  [
    "non-list marker affinity",
    (i) => (i.at.listAffinity = { "seed:other:empty": "right" }),
  ],
  ["array affinity", (i) => (i.at.listAffinity = [])],
];
for (const [name, mutate] of badInsert)
  test(`malformed insertion does not allocate local sequence: ${name}`, () => {
    const room = new Room(fixture()),
      client = new Client("A", "admit", room.snapshot()),
      before = JSON.stringify(client.state),
      intent = { kind: "insert", at: gapAt(client.state, "bp", 1), text: "Q" };
    mutate(intent);
    assert.throws(() => client.prepare(intent), /Admission/);
    assert.equal(client.seq, 0);
    assert.deepEqual(client.pending, []);
    assert.equal(JSON.stringify(client.state), before);
    const rejected = room.accept(operation(intent));
    assert.equal(rejected.outcome, "rejected");
    assert.equal(room.record.state.revision, 0);
  });
const badShapes = [
  ["missing node map", (s) => (s.nodes = null)],
  ["non-boolean lifecycle", (s) => (s.nodes.doc.live = "yes")],
  ["mismatched root", (s) => (s.nodes.doc.id = "wrong")],
  ["unknown leaf", (s) => (s.nodes.bp.type = "widget")],
  [
    "list contains paragraph",
    (s) => {
      s.nodes.list.children = ["bp", "a", "c"];
      s.nodes.b.live = false;
    },
  ],
  ["text has children", (s) => (s.nodes.bp.children = [])],
  ["image has text", (s) => (s.nodes.image.text = s.nodes.bp.text)],
  ["empty cell", (s) => (s.nodes.cell.children = [])],
  ["empty list", (s) => (s.nodes.nested.children = [])],
  ["duplicate child", (s) => s.nodes.list.children.push("a")],
  [
    "first paragraph absent",
    (s) => (s.nodes.b.children = ["image", "bp", "code"]),
  ],
  ["invalid numbering", (s) => (s.nodes.list.order = 0)],
  [
    "ragged table",
    (s) => {
      s.nodes.row2 = {
        id: "row2",
        type: "row",
        live: true,
        children: ["cell2"],
      };
      s.nodes.cell2 = {
        id: "cell2",
        type: "cell",
        live: true,
        children: ["p2"],
      };
      s.nodes.p2 = {
        id: "p2",
        type: "paragraph",
        live: true,
        text: s.nodes.bp.text,
      };
      s.nodes.table.children.push("row2");
    },
  ],
  [
    "hidden nested table",
    (s) => {
      s.nodes.b.children.push("nested-table");
      s.nodes["nested-table"] = {
        id: "nested-table",
        type: "table",
        live: true,
        children: ["row"],
      };
    },
  ],
];
for (const [name, mutate] of badShapes)
  test(`decoded document shape rejects ${name}`, () => {
    const s = structuredClone(fixture());
    mutate(s);
    assert.throws(() => validateDocumentShape(s), /Admission/);
    assert.throws(() => validate(s));
  });
for (const cell of [false, true])
  for (const command of ["indent", "outdent", "enter"])
    test(`complete ${command} command publishes valid shape cell=${cell}`, () => {
      const state = listFixture({ cell }),
        point = { block: "bp", offset: 2 },
        range = captureRange(state, point, point),
        op = operation(null),
        plan =
          command === "enter"
            ? planListEnter(state, range, op)
            : planListIndent(state, range, op, {
                outdent: command === "outdent",
              });
      const next = apply(state, { ...op, intent: plan.intent });
      validate(next);
      const restored = apply(
        next,
        operation({ kind: "undo", target: op.id }, 2),
      );
      validate(restored);
      assert.deepEqual(restored.nodes.list.children, state.nodes.list.children);
      assert.deepEqual(text(restored, "bp"), text(state, "bp"));
    });
test("a batch rolls back an earlier valid text edit when its final shape is invalid", () => {
  const s = fixture(),
    intent = {
      kind: "batch",
      intents: [{ kind: "insert", at: gapAt(s, "bp", 1), text: "M" }, rawWrap],
    },
    room = new Room(s),
    before = JSON.stringify(s);
  assert.equal(room.accept(operation(intent)).outcome, "rejected");
  assert.equal(JSON.stringify(room.record.state), before);
  assert.deepEqual(room.record.state.effects, {});
});
test("foreign Undo cannot use a valid envelope to activate another author contribution", () => {
  const s = fixture(),
    op = operation({ kind: "insert", at: gapAt(s, "bp", 1), text: "M" }),
    n = apply(s, op);
  assert.throws(
    () =>
      apply(n, {
        ...operation({ kind: "undo", target: op.id }, 2),
        actor: "B",
      }),
    /another actor/,
  );
});
