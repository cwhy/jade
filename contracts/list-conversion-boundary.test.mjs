// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  resolveGap,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import { planListEnter } from "@cwhy/jade-core/list-commands";
import { documentView } from "@cwhy/jade-core/document-read";
import {
  previewListConversion,
  planListConversion,
} from "@cwhy/jade-core/conversion";
import { captureBodyContent } from "@cwhy/jade-core/document-content";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import { Client } from "@cwhy/jade-collaboration/client";
const op = (actor, seq, intent) => ({
  id: `${actor}:list-convert:${seq}`,
  actor,
  seq,
  intent,
  stream: "list-convert",
  epoch: 1,
  modelVersion: 2,
});
function fixture(parent = "doc", type = "ordered_list", image = false) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["list"] },
    list: { id: "list", type, live: true, children: ["a", "b"] },
    a: {
      id: "a",
      type: "list_item",
      live: true,
      children: ["ap", ...(image ? ["image"] : [])],
    },
    ap: { id: "ap", type: "paragraph", live: true },
    b: { id: "b", type: "list_item", live: true, children: ["bp"] },
    bp: { id: "bp", type: "paragraph", live: true },
  };
  if (image)
    nodes.image = { id: "image", type: "image", asset: "mock.png", live: true };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["list"] },
    });
  }
  return seed(nodes, {
    ap: [{ text: "Alpha", marks: ["strong"] }],
    bp: [{ text: "Beta" }],
  });
}
const shape = (s, parent) => {
  const v = documentView(s);
  return v.node(parent).children.map((id) => {
    const n = v.node(id);
    return n.text
      ? [
          n.type,
          v
            .text(id)
            .map((a) => a.char)
            .join(""),
        ]
      : [n.type, n.asset ?? id];
  });
};
function authority(initial) {
  let room = new Room(initial),
    journal = room.snapshot();
  return {
    get room() {
      return room;
    },
    accept(command) {
      const receipt = room.accept(command);
      assert.equal(receipt.outcome, "accepted", receipt.reason);
      journal = replay(journal, { op: command, receipt });
      room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(command), receipt);
      assert.deepEqual(room.snapshot(), journal);
      return room.record.state;
    },
  };
}
for (const parent of ["doc", "cell"])
  for (const type of ["ordered_list", "bullet_list"])
    for (const image of [false, true])
      for (const at of [0, 2, 5])
        for (const early of [false, true])
          for (const conversionUndoFirst of [false, true])
            test(`${parent} ${type} image=${image} Enter@${at} early=${early} Undo conversion first=${conversionUndoFirst}`, () => {
              const initial = fixture(parent, type, image),
                anchor = anchorAt(initial, "ap", 1, 4),
                original = text(initial, "ap"),
                preview = previewListConversion(initial, parent, "list");
              const convert = op(
                  "a",
                  1,
                  planListConversion(initial, preview, op("a", 1), {
                    confirmLoss: true,
                  }).intent,
                ),
                enter = op(
                  "b",
                  1,
                  planListEnter(
                    initial,
                    captureRange(
                      initial,
                      { block: "ap", offset: at },
                      { block: "ap", offset: at },
                    ),
                    op("b", 1),
                  ).intent,
                ),
                auth = authority(initial);
              for (const command of early ? [enter, convert] : [convert, enter])
                auth.accept(command);
              let s = auth.room.record.state;
              const code = "Alpha".slice(0, at) + "\n" + "Alpha".slice(at);
              assert.deepEqual(
                shape(s, parent),
                image
                  ? [
                      ["code", code],
                      ["image", "mock.png"],
                      ["code", "Beta"],
                    ]
                  : [["code", code + "\nBeta"]],
              );
              assert.deepEqual(s.nodes[parent].children, ["list"]);
              assert.equal(resolveAnchor(s, anchor).status, "exact");
              assert.deepEqual(
                resolveAnchor(s, anchor).segments,
                original.slice(1, 5).map((atom, index) => ({
                  block: index + 1 < at ? "ap" : "b:list-convert:1:list-tail",
                  offset: index + 1 < at ? index + 1 : index + 1 - at,
                  id: atom.id,
                  char: atom.char,
                })),
              );
              assert.deepEqual(
                documentView(s).order.flatMap((id) =>
                  documentView(s)
                    .text(id)
                    .filter((a) => !a.boundary)
                    .map((a) => a.id),
                ),
                [...original, ...text(initial, "bp")].map((a) => a.id),
              );
              const tail = "b:list-convert:1:list-tail",
                offset = Math.min(1, text(s, tail).length);
              s = auth.accept(
                op("c", 1, {
                  kind: "insert",
                  at: gapAt(s, tail, offset),
                  text: "同",
                }),
              );
              const peer = text(s, tail).find((a) => a.char === "同").id;
              s = auth.accept(
                op(conversionUndoFirst ? "a" : "b", 2, {
                  kind: "undo",
                  target: conversionUndoFirst ? convert.id : enter.id,
                }),
              );
              s = auth.accept(
                op(conversionUndoFirst ? "b" : "a", 2, {
                  kind: "undo",
                  target: conversionUndoFirst ? enter.id : convert.id,
                }),
              );
              assert.equal(s.nodes.list.live, true);
              assert.equal(s.nodes.list.children.length, 2);
              assert.ok(text(s, "ap").some((a) => a.id === peer));
              assert.equal(resolveAnchor(s, anchor).status, "exact");
              s = auth.accept(
                op("c", 2, { kind: "undo", target: "c:list-convert:1" }),
              );
              assert.deepEqual(text(s, "ap"), original);
              // Redo in reverse actor order proves that wrapper restoration is not needed
              // to interpret the same retained source boundary.
              s = auth.accept(
                op("a", 3, { kind: "undo", target: "a:list-convert:2" }),
              );
              s = auth.accept(
                op("b", 3, { kind: "undo", target: "b:list-convert:2" }),
              );
              assert.deepEqual(
                shape(s, parent),
                image
                  ? [
                      ["code", code],
                      ["image", "mock.png"],
                      ["code", "Beta"],
                    ]
                  : [["code", code + "\nBeta"]],
              );
              const body = captureBodyContent(s);
              assert.ok(body);
              if (image) assert.deepEqual(s.nodes.image, initial.nodes.image);
            });
for (const parent of ["doc", "cell"])
  test(`${parent}: offline Enter plus typing survives both client reload and lost acknowledgement`, () => {
    const initial = fixture(parent),
      room = new Room(initial),
      client = new Client("b", "list-convert", room.snapshot());
    client.prepare(
      planListEnter(
        client.state,
        captureRange(
          client.state,
          { block: "ap", offset: 2 },
          { block: "ap", offset: 2 },
        ),
        op("b", 1),
      ).intent,
    );
    const tail = "b:list-convert:1:list-tail";
    client.prepare({
      kind: "insert",
      at: gapAt(client.state, tail, 1),
      text: "同",
    });
    const author = op(
      "a",
      1,
      planListConversion(
        initial,
        previewListConversion(initial, parent, "list"),
        op("a", 1),
        { confirmLoss: true },
      ).intent,
    );
    assert.equal(room.accept(author).outcome, "accepted");
    const saved = JSON.parse(JSON.stringify(client.save())),
      restored = new Client("b", "list-convert", saved.base, saved);
    let server = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
    for (const pending of restored.pending) {
      const receipt = server.accept(pending);
      assert.equal(receipt.outcome, "accepted", receipt.reason);
      server = new Room(null, JSON.parse(JSON.stringify(server.snapshot())));
      assert.deepEqual(server.accept(pending), receipt);
    }
    restored.receive(server.snapshot());
    assert.equal(restored.pending.length, 0);
    assert.deepEqual(shape(restored.state, parent), [
      ["code", "Al\np同ha\nBeta"],
    ]);
  });

import {
  planDelete,
  planReplace,
  planEnter,
  planCodeLanguage,
  codeLanguageState,
} from "@cwhy/jade-core/commands";
import { plainFragment } from "@cwhy/jade-core/fragment";
for (const parent of ["doc", "cell"])
  for (const conversionFirst of [false, true])
    test(`${parent}: deleting a displayed source separator preserves independent Undo; conversion first=${conversionFirst}`, () => {
      const initial = fixture(parent),
        auth = authority(initial);
      let s = auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list"),
            op("a", 1),
            { confirmLoss: true },
          ).intent,
        ),
      );
      const range = captureRange(
          s,
          { block: "ap", offset: 5 },
          { block: "ap", offset: 5 },
        ),
        plan = planDelete(s, range, "forward", op("b", 1));
      s = auth.accept(op("b", 1, plan.intent));
      assert.deepEqual(shape(s, parent), [["code", "AlphaBeta"]]);
      s = auth.accept(
        op(conversionFirst ? "a" : "b", 2, {
          kind: "undo",
          target: conversionFirst ? "a:list-convert:1" : "b:list-convert:1",
        }),
      );
      s = auth.accept(
        op(conversionFirst ? "b" : "a", 2, {
          kind: "undo",
          target: conversionFirst ? "b:list-convert:1" : "a:list-convert:1",
        }),
      );
      assert.deepEqual(text(s, "ap"), text(initial, "ap"));
      assert.deepEqual(text(s, "bp"), text(initial, "bp"));
      s = auth.accept(op("a", 3, { kind: "undo", target: "a:list-convert:2" }));
      s = auth.accept(op("b", 3, { kind: "undo", target: "b:list-convert:2" }));
      assert.deepEqual(shape(s, parent), [["code", "AlphaBeta"]]);
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: replacement uses retained source identities while conversion Undo precedes delivery`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    const plan = planReplace(
      s,
      captureRange(s, { block: "ap", offset: 3 }, { block: "ap", offset: 8 }),
      plainFragment("X"),
      op("b", 1),
    );
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    s = auth.accept(op("b", 1, plan.intent));
    assert.equal(
      text(s, "ap")
        .map((a) => a.char)
        .join(""),
      "AlpXta",
    );
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
    assert.deepEqual(text(s, "ap"), text(initial, "ap"));
    assert.deepEqual(text(s, "bp"), text(initial, "bp"));
  });

for (const parent of ["doc", "cell"])
  test(`${parent}: a conversion covering an existing split does not retain the internal cut`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    let s = auth.accept(
      op(
        "b",
        1,
        planListEnter(
          initial,
          captureRange(
            initial,
            { block: "ap", offset: 2 },
            { block: "ap", offset: 2 },
          ),
          op("b", 1),
        ).intent,
      ),
    );
    s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          s,
          previewListConversion(s, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    assert.deepEqual(shape(s, parent), [["code", "Al\npha\nBeta"]]);
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
    assert.deepEqual(shape(s, parent), [["code", "Alpha\nBeta"]]);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    assert.deepEqual(text(s, "ap"), text(initial, "ap"));
    assert.deepEqual(s.nodes.list.children, ["a", "b"]);
  });
for (const parent of ["doc", "cell"])
  for (const reverse of [false, true])
    test(`${parent}: concurrent cuts and repeated Enter retain identities reverse=${reverse}`, () => {
      const initial = fixture(parent),
        auth = authority(initial),
        commands = [2, 4].map((offset, i) =>
          op(
            i ? "c" : "b",
            1,
            planListEnter(
              initial,
              captureRange(
                initial,
                { block: "ap", offset },
                { block: "ap", offset },
              ),
              op(i ? "c" : "b", 1),
            ).intent,
          ),
        );
      let s = auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list"),
            op("a", 1),
            { confirmLoss: true },
          ).intent,
        ),
      );
      for (const command of reverse ? [...commands].reverse() : commands)
        s = auth.accept(command);
      assert.deepEqual(shape(s, parent), [["code", "Al\nph\na\nBeta"]]);
      s = auth.accept(
        op(
          "d",
          1,
          planEnter(
            s,
            captureRange(
              s,
              { block: "ap", offset: 4 },
              { block: "ap", offset: 4 },
            ),
            op("d", 1),
          ).intent,
        ),
      );
      assert.deepEqual(shape(s, parent), [["code", "Al\np\nh\na\nBeta"]]);
      for (const actor of ["a", "c", "b", "d"])
        s = auth.accept(
          op(actor, 2, { kind: "undo", target: `${actor}:list-convert:1` }),
        );
      assert.deepEqual(text(s, "ap"), text(initial, "ap"));
      assert.deepEqual(s.nodes.list.children, ["a", "b"]);
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: a code newline is retained as text when conversion is undone`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    s = auth.accept(
      op(
        "b",
        1,
        planEnter(
          s,
          captureRange(
            s,
            { block: "ap", offset: 2 },
            { block: "ap", offset: 2 },
          ),
          op("b", 1),
        ).intent,
      ),
    );
    assert.deepEqual(shape(s, parent), [["code", "Al\npha\nBeta"]]);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    assert.equal(
      text(s, "ap")
        .map((a) => a.char)
        .join(""),
      "Al\npha",
    );
    assert.deepEqual(s.nodes.list.children, ["a", "b"]);
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
    assert.deepEqual(text(s, "ap"), text(initial, "ap"));
  });

for (const parent of ["doc", "cell"])
  test(`${parent}: media inside one item separates code sections and language ownership`, () => {
    let initial = fixture(parent, "bullet_list", true);
    initial.nodes.a.children.push("bp");
    initial.nodes.list.children = ["a"];
    initial.nodes.b.live = false;
    const auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    assert.deepEqual(shape(s, parent), [
      ["code", "Alpha"],
      ["image", "mock.png"],
      ["code", "Beta"],
    ]);
    s = auth.accept(
      op("b", 1, planCodeLanguage(s, "ap", "python", op("b", 1)).intent),
    );
    s = auth.accept(
      op("c", 1, planCodeLanguage(s, "bp", "sql", op("c", 1)).intent),
    );
    const before = s.nodes.image;
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    assert.deepEqual(s.nodes.a.children, ["ap", "image", "bp"]);
    assert.deepEqual(text(s, "ap"), text(initial, "ap"));
    s = auth.accept(op("a", 3, { kind: "undo", target: "a:list-convert:2" }));
    assert.equal(
      codeLanguageState(documentView(s).node("ap")).language,
      "python",
    );
    assert.equal(codeLanguageState(documentView(s).node("bp")).language, "sql");
    assert.deepEqual(s.nodes.image, before);
    assert.throws(
      () =>
        planReplace(
          s,
          captureRange(
            s,
            { block: "ap", offset: 3 },
            { block: "bp", offset: 2 },
          ),
          plainFragment("X"),
          op("d", 1),
        ),
      /selection|media|paragraph|code|container|logical|cross/i,
    );
  });
for (const parent of ["doc", "cell"])
  test(`${parent}: nested list text keeps its source identity through conversion and Undo`, () => {
    let initial = fixture(parent);
    initial.nodes.a.children.push("nested");
    initial.nodes.list.children = ["a"];
    initial.nodes.nested = {
      id: "nested",
      type: "bullet_list",
      live: true,
      children: ["b"],
    };
    const auth = authority(initial),
      anchor = anchorAt(initial, "bp", 1, 3),
      enter = op(
        "b",
        1,
        planListEnter(
          initial,
          captureRange(
            initial,
            { block: "bp", offset: 2 },
            { block: "bp", offset: 2 },
          ),
          op("b", 1),
        ).intent,
      );
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    s = auth.accept(enter);
    assert.deepEqual(shape(s, parent), [["code", "Alpha\nBe\nta"]]);
    assert.equal(resolveAnchor(s, anchor).status, "exact");
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    s = auth.accept(op("b", 2, { kind: "undo", target: enter.id }));
    assert.deepEqual(s.nodes.nested, initial.nodes.nested);
    assert.deepEqual(text(s, "bp"), text(initial, "bp"));
  });
test("whole-list admission rejects missing media sections, forged scope, direct scoped operations and stale review atomically", () => {
  const initial = fixture("doc", "ordered_list", true),
    preview = previewListConversion(initial, "doc", "list"),
    before = JSON.stringify(initial);
  assert.throws(
    () => planListConversion(initial, preview, op("a", 1)),
    /formatting loss/,
  );
  const malformed = [
    { ...preview.intent, parts: preview.intent.parts.slice(0, 1) },
    { ...preview.intent, scope: "a" },
    preview.intent.parts[0],
    {
      ...preview.intent,
      parts: [preview.intent.parts[1], preview.intent.parts[0]],
    },
  ];
  for (const intent of malformed)
    assert.throws(() => apply(initial, op("a", 1, intent)));
  const changed = apply(
    initial,
    op("b", 1, {
      kind: "format",
      ids: [text(initial, "ap")[0].id],
      property: "em",
      value: "em",
    }),
  );
  assert.throws(
    () =>
      planListConversion(changed, preview, op("a", 1), { confirmLoss: true }),
    /review conversion again/,
  );
  assert.equal(JSON.stringify(initial), before);
});

test("joining a converted parent/child list boundary preserves hierarchy on independent Undo", () => {
  let initial = fixture();
  initial.nodes.a.children.push("nested");
  initial.nodes.list.children = ["a"];
  initial.nodes.nested = {
    id: "nested",
    type: "bullet_list",
    live: true,
    placement: null,
    children: ["b"],
  };
  const auth = authority(initial);
  let s = auth.accept(
    op(
      "a",
      1,
      planListConversion(
        initial,
        previewListConversion(initial, "doc", "list"),
        op("a", 1),
        { confirmLoss: true },
      ).intent,
    ),
  );
  s = auth.accept(
    op(
      "b",
      1,
      planDelete(
        s,
        captureRange(s, { block: "ap", offset: 5 }, { block: "ap", offset: 5 }),
        "forward",
        op("b", 1),
      ).intent,
    ),
  );
  assert.deepEqual(shape(s, "doc"), [["code", "AlphaBeta"]]);
  s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
  assert.equal(
    text(s, "ap")
      .map((a) => a.char)
      .join(""),
    "AlphaBeta",
  );
  s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
  assert.deepEqual(s.nodes.nested, initial.nodes.nested);
  assert.deepEqual(text(s, "ap"), text(initial, "ap"));
  assert.deepEqual(text(s, "bp"), text(initial, "bp"));
});

for (const parent of ["doc", "cell"])
  for (const enterFirst of [false, true])
    for (const conversionUndoFirst of [false, true])
      test(`${parent}: nested-list exit join, delayed Enter and independent Undo early=${enterFirst} conversionUndo=${conversionUndoFirst}`, () => {
        let initial = fixture(parent);
        initial.nodes.a.children.push("nested");
        initial.nodes.list.children = ["a", "c"];
        initial.nodes.nested = {
          id: "nested",
          type: "bullet_list",
          live: true,
          children: ["b"],
        };
        initial.nodes.c = {
          id: "c",
          type: "list_item",
          live: true,
          children: ["cp"],
        };
        initial.nodes.cp = { id: "cp", type: "paragraph", live: true };
        // Re-seed to create the third source through the public constructor.
        initial = seed(initial.nodes, {
          ap: [{ text: "Alpha", marks: ["strong"] }],
          bp: [{ text: "Beta" }],
          cp: [{ text: "Gamma" }],
        });
        const auth = authority(initial),
          enter = op(
            "c",
            1,
            planListEnter(
              initial,
              captureRange(
                initial,
                { block: "cp", offset: 2 },
                { block: "cp", offset: 2 },
              ),
              op("c", 1),
            ).intent,
          );
        let s = auth.accept(
          op(
            "a",
            1,
            planListConversion(
              initial,
              previewListConversion(initial, parent, "list"),
              op("a", 1),
              { confirmLoss: true },
            ).intent,
          ),
        );
        const deletion = op(
          "b",
          1,
          planDelete(
            s,
            captureRange(
              s,
              { block: "ap", offset: 10 },
              { block: "ap", offset: 10 },
            ),
            "forward",
            op("b", 1),
          ).intent,
        );
        for (const command of enterFirst
          ? [enter, deletion]
          : [deletion, enter])
          s = auth.accept(command);
        assert.deepEqual(shape(s, parent), [["code", "Alpha\nBetaGa\nmma"]]);
        for (const actor of conversionUndoFirst
          ? ["a", "b", "c"]
          : ["c", "b", "a"])
          s = auth.accept(
            op(actor, 2, { kind: "undo", target: `${actor}:list-convert:1` }),
          );
        for (const id of ["list", "a", "nested", "b", "c"])
          assert.deepEqual(s.nodes[id].children, initial.nodes[id].children);
        for (const id of ["ap", "bp", "cp"])
          assert.deepEqual(text(s, id), text(initial, id));
      });
for (const parent of ["doc", "cell"])
  test(`${parent}: two paragraphs in one item share the same reversible join`, () => {
    let initial = fixture(parent);
    initial.nodes.list.children = ["a"];
    initial.nodes.a.children.push("bp");
    initial.nodes.b.live = false;
    const auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    s = auth.accept(
      op(
        "b",
        1,
        planDelete(
          s,
          captureRange(
            s,
            { block: "ap", offset: 5 },
            { block: "ap", offset: 5 },
          ),
          "forward",
          op("b", 1),
        ).intent,
      ),
    );
    assert.deepEqual(shape(s, parent), [["code", "AlphaBeta"]]);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
    assert.deepEqual(s.nodes.a.children, ["ap", "bp"]);
    assert.deepEqual(text(s, "ap"), text(initial, "ap"));
    assert.deepEqual(text(s, "bp"), text(initial, "bp"));
  });

for (const parent of ["doc", "cell"])
  test(`${parent}: join after an image preserves the image and all preceding text`, () => {
    let initial = fixture(parent, "ordered_list", true);
    initial.nodes.a.children.push("bp");
    initial.nodes.list.children = ["a", "c"];
    initial.nodes.b.live = false;
    initial.nodes.c = {
      id: "c",
      type: "list_item",
      live: true,
      children: ["cp"],
    };
    initial.nodes.cp = { id: "cp", type: "paragraph", live: true };
    initial = seed(initial.nodes, {
      ap: [{ text: "Alpha", marks: ["strong"] }],
      bp: [{ text: "Beta" }],
      cp: [{ text: "Gamma" }],
    });
    const auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    assert.deepEqual(shape(s, parent), [
      ["code", "Alpha"],
      ["image", "mock.png"],
      ["code", "Beta\nGamma"],
    ]);
    s = auth.accept(
      op(
        "b",
        1,
        planDelete(
          s,
          captureRange(
            s,
            { block: "bp", offset: 4 },
            { block: "bp", offset: 4 },
          ),
          "forward",
          op("b", 1),
        ).intent,
      ),
    );
    assert.deepEqual(shape(s, parent), [
      ["code", "Alpha"],
      ["image", "mock.png"],
      ["code", "BetaGamma"],
    ]);
    assert.deepEqual(s.nodes.image, initial.nodes.image);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
    assert.deepEqual(s.nodes.a.children, initial.nodes.a.children);
    for (const id of ["ap", "bp", "cp"])
      assert.deepEqual(text(s, id), text(initial, id));
  });

for (const parent of ["doc", "cell"])
  test(`${parent}: conversion captured after a join retains both original source identities`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    let s = auth.accept(
      op(
        "b",
        1,
        planDelete(
          initial,
          captureRange(
            initial,
            { block: "ap", offset: 5 },
            { block: "ap", offset: 5 },
          ),
          "forward",
          op("b", 1),
        ).intent,
      ),
    );
    s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          s,
          previewListConversion(s, parent, "list"),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    assert.deepEqual(shape(s, parent), [["code", "AlphaBeta"]]);
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
    assert.deepEqual(shape(s, parent), [["code", "Alpha\nBeta"]]);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
    assert.deepEqual(text(s, "ap"), text(initial, "ap"));
    assert.deepEqual(text(s, "bp"), text(initial, "bp"));
  });

import { previewConversion, planConversion } from "@cwhy/jade-core/conversion";
test("list boundary witness does not restrict delayed ordinary-code replacement after its exterior cut rejoins", () => {
  const initial = seed(
      {
        doc: { id: "doc", type: "doc", live: true, children: ["p"] },
        p: { id: "p", type: "paragraph", live: true },
      },
      { p: [{ text: "Alpha" }] },
    ),
    auth = authority(initial);
  let s = auth.accept(
    op(
      "a",
      1,
      planEnter(
        initial,
        captureRange(
          initial,
          { block: "p", offset: 2 },
          { block: "p", offset: 2 },
        ),
        op("a", 1),
      ).intent,
    ),
  );
  const tail = "a:list-convert:1:paragraph";
  s = auth.accept(
    op(
      "b",
      1,
      planConversion(s, previewConversion(s, "doc", [tail], "code"), op("b", 1))
        .intent,
    ),
  );
  const delayed = op(
    "c",
    1,
    planReplace(
      s,
      captureRange(s, { block: tail, offset: 0 }, { block: tail, offset: 1 }),
      plainFragment("X"),
      op("c", 1),
    ).intent,
  );
  s = auth.accept(op("b", 2, { kind: "undo", target: "b:list-convert:1" }));
  s = auth.accept(op("a", 2, { kind: "undo", target: "a:list-convert:1" }));
  s = auth.accept(delayed);
  assert.equal(
    text(s, "p")
      .map((a) => a.char)
      .join(""),
    "AlXha",
  );
});
