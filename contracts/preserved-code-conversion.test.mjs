// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import {
  previewConversion,
  planConversion,
  previewListConversion,
  planListConversion,
} from "@cwhy/jade-core/conversion";
import { documentView } from "@cwhy/jade-core/document-read";

import {
  planReplace,
  planEnter,
  planDelete,
  planCodeLanguage,
} from "@cwhy/jade-core/commands";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  id: `${actor}:preserve:${seq}`,
  actor,
  seq,
  intent,
  stream: "preserve",
  epoch: 1,
  modelVersion: 2,
});
function fixture(parent = "doc", list = false) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["a", "code", "b"] },
    a: { id: "a", type: "paragraph", live: true },
    code: { id: "code", type: "code", language: "python", live: true },
    b: { id: "b", type: "paragraph", live: true },
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: ["a", "code", "b"],
      },
    });
  }
  if (list) {
    nodes[parent].children = ["list"];
    Object.assign(nodes, {
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item"],
      },
      item: {
        id: "item",
        type: "list_item",
        live: true,
        children: ["a", "code", "b"],
      },
    });
  }
  return seed(nodes, {
    a: [{ text: "Before", marks: ["strong"] }],
    code: [{ text: "print(1)" }],
    b: [{ text: "After", marks: ["em"] }],
  });
}
function convert(state, parent, list, header) {
  return list
    ? planListConversion(
        state,
        previewListConversion(state, parent, "list"),
        header,
        { confirmLoss: true },
      )
    : planConversion(
        state,
        previewConversion(state, parent, ["a", "code", "b"], "code"),
        header,
        { confirmLoss: true },
      );
}
function authority(initial) {
  let room = new Room(initial),
    journal = room.snapshot();
  return {
    get state() {
      return room.record.state;
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
  for (const list of [false, true])
    test(`${parent} list=${list}: native code keeps its boundary, language and independent peer edits`, () => {
      const initial = fixture(parent, list),
        auth = authority(initial);
      let s = auth.accept(
        op("a", 1, convert(initial, parent, list, op("a", 1)).intent),
      );
      const view = documentView(s);
      assert.deepEqual(view.node(parent).children, ["a", "code", "b"]);
      assert.deepEqual(
        view.order.map((id) => [
          view.node(id).type,
          view
            .text(id)
            .map((a) => a.char)
            .join(""),
        ]),
        [
          ["code", "Before"],
          ["code", "print(1)"],
          ["code", "After"],
        ],
      );
      assert.deepEqual(s.nodes.code, initial.nodes.code);
      s = auth.accept(
        op("b", 1, { kind: "insert", at: gapAt(s, "code", 5), text: "x" }),
      );
      s = auth.accept(
        op("b", 2, planCodeLanguage(s, "code", "sql", op("b", 2)).intent),
      );
      s = auth.accept(op("a", 2, { kind: "undo", target: "a:preserve:1" }));
      assert.equal(documentView(s).node("code").language, "sql");
      assert.equal(
        text(s, "code")
          .map((a) => a.char)
          .join(""),
        "printx(1)",
      );
      assert.deepEqual(text(s, "a"), text(initial, "a"));
      assert.deepEqual(text(s, "b"), text(initial, "b"));
      s = auth.accept(op("a", 3, { kind: "undo", target: "a:preserve:2" }));
      assert.equal(documentView(s).node("code").language, "sql");
      s = auth.accept(op("b", 3, { kind: "undo", target: "b:preserve:2" }));
      assert.equal(documentView(s).node("code").language, "python");
    });

import { captureRange } from "@cwhy/jade-core/selection";

import { planListEnter } from "@cwhy/jade-core/list-commands";
const visible = (s) => {
  const v = documentView(s);
  return v.order.map((id) => [
    v.node(id).type,
    v
      .text(id)
      .map((a) => a.char)
      .join(""),
  ]);
};
for (const parent of ["doc", "cell"])
  for (const list of [false, true])
    for (const early of [false, true])
      for (const conversionFirst of [false, true])
        test(`${parent} list=${list}: offline Enter early=${early} undoConversionFirst=${conversionFirst}`, () => {
          const initial = fixture(parent, list),
            auth = authority(initial),
            conversion = convert(initial, parent, list, op("a", 1));
          const enter = (list ? planListEnter : planEnter)(
            initial,
            captureRange(
              initial,
              { block: "a", offset: 3 },
              { block: "a", offset: 3 },
            ),
            op("b", 1),
          );
          if (early) auth.accept(op("b", 1, enter.intent));
          auth.accept(op("a", 1, conversion.intent));
          if (!early) auth.accept(op("b", 1, enter.intent));
          assert.deepEqual(visible(auth.state), [
            ["code", "Bef\nore"],
            ["code", "print(1)"],
            ["code", "After"],
          ]);
          const order = conversionFirst ? ["a", "b"] : ["b", "a"];
          for (const actor of order)
            auth.accept(
              op(actor, 2, { kind: "undo", target: `${actor}:preserve:1` }),
            );
          assert.deepEqual(visible(auth.state), [
            ["paragraph", "Before"],
            ["code", "print(1)"],
            ["paragraph", "After"],
          ]);
          assert.deepEqual(text(auth.state, "a"), text(initial, "a"));
          assert.equal(
            documentView(auth.state).node("code").language,
            "python",
          );
        });
for (const parent of ["doc", "cell"])
  for (const list of [false, true])
    for (const early of [false, true])
      test(`${parent} list=${list}: preserved code changes may precede conversion early=${early}`, () => {
        const initial = fixture(parent, list),
          auth = authority(initial),
          conversion = convert(initial, parent, list, op("a", 1));
        const typing = op("b", 1, {
            kind: "insert",
            at: gapAt(initial, "code", 5),
            text: "同",
          }),
          language = op(
            "b",
            2,
            planCodeLanguage(initial, "code", "sql", op("b", 2)).intent,
          );
        if (early) {
          auth.accept(typing);
          auth.accept(language);
        }
        auth.accept(op("a", 1, conversion.intent));
        if (!early) {
          auth.accept(typing);
          auth.accept(language);
        }
        assert.equal(documentView(auth.state).node("code").language, "sql");
        assert.deepEqual(visible(auth.state), [
          ["code", "Before"],
          ["code", "print同(1)"],
          ["code", "After"],
        ]);
        auth.accept(op("a", 2, { kind: "undo", target: "a:preserve:1" }));
        assert.equal(documentView(auth.state).node("code").language, "sql");
        assert.equal(visible(auth.state)[1][1], "print同(1)");
      });
for (const parent of ["doc", "cell"])
  for (const list of [false, true])
    test(`${parent} list=${list}: preview is inert and requires prose loss confirmation`, () => {
      const initial = fixture(parent, list),
        before = JSON.stringify(initial),
        preview = list
          ? previewListConversion(initial, parent, "list")
          : previewConversion(initial, parent, ["a", "code", "b"], "code");
      assert.equal(preview.loss.formattedCharacters, 11);
      assert.deepEqual(
        new Set(preview.loss.properties),
        new Set(["strong", "em"]),
      );
      assert.equal(JSON.stringify(initial), before);
      assert.throws(
        () =>
          (list ? planListConversion : planConversion)(
            initial,
            preview,
            op("a", 1),
          ),
        /formatting loss/,
      );
      const room = new Room(initial);
      const changed = room.accept(
        op("b", 1, {
          kind: "format",
          ids: [text(initial, "a")[0].id],
          property: "strong",
          value: null,
        }),
      );
      assert.equal(changed.outcome, "accepted");
      const snapshot = JSON.stringify(room.record.state);
      const stale = op("a", 1, preview.intent);
      if (list)
        assert.throws(() => room.accept(stale), /review conversion again/);
      else {
        const rejection = room.accept(stale);
        assert.equal(rejection.outcome, "rejected");
        assert.match(rejection.reason, /review conversion again/);
        assert.deepEqual(room.accept(stale), rejection);
      }
      assert.equal(JSON.stringify(room.record.state), snapshot);
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: malformed mixed scopes cannot partially commit`, () => {
    const initial = fixture(parent),
      intent = previewConversion(
        initial,
        parent,
        ["a", "code", "b"],
        "code",
      ).intent;
    const mutants = [
      (v) => v.parts.reverse(),
      (v) => (v.parts = []),
      (v) => v.parts.push(v.parts[0]),
      (v) => v.preserved.push(v.preserved[0]),
      (v) => (v.preserved[0].id = "a"),
      (v) => (v.preserved[0].type = "image"),
      (v) => (v.parts[0].parent = "missing"),
      (v) => (v.parts[0].scope = "missing"),
      (v) => (v.unexpected = true),
    ];
    for (const mutate of mutants) {
      const changed = structuredClone(intent);
      mutate(changed);
      const room = new Room(initial),
        before = JSON.stringify(room.record.state);
      const command = op("a", 1, changed),
        rejection = room.accept(command);
      assert.equal(rejection.outcome, "rejected");
      assert.deepEqual(room.accept(command), rejection);
      assert.equal(JSON.stringify(room.record.state), before);
    }
  });

for (const parent of ["doc", "cell"])
  test(`${parent}: an earlier prose-to-code conversion remains a separate language-owning block`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    // Reuse the surrounding paragraph as the previously converted code boundary.
    auth.accept(
      op(
        "b",
        1,
        planConversion(
          initial,
          previewConversion(initial, parent, ["a"], "code"),
          op("b", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    auth.accept(
      op(
        "b",
        2,
        planCodeLanguage(auth.state, "a", "javascript", op("b", 2)).intent,
      ),
    );
    const before = documentView(auth.state).node("a").codeConversion;
    auth.accept(
      op("a", 1, convert(auth.state, parent, false, op("a", 1)).intent),
    );
    assert.deepEqual(visible(auth.state), [
      ["code", "Before"],
      ["code", "print(1)"],
      ["code", "After"],
    ]);
    assert.equal(documentView(auth.state).node("a").codeConversion, before);
    assert.equal(documentView(auth.state).node("a").language, "javascript");
    auth.accept(op("a", 2, { kind: "undo", target: "a:preserve:1" }));
    assert.deepEqual(visible(auth.state), [
      ["code", "Before"],
      ["code", "print(1)"],
      ["paragraph", "After"],
    ]);
    auth.accept(op("b", 3, { kind: "undo", target: "b:preserve:1" }));
    assert.equal(documentView(auth.state).node("a").type, "paragraph");
  });
for (const parent of ["doc", "cell"])
  for (const list of [false, true])
    test(`${parent} list=${list}: multiple prose sections merge only within code and image boundaries`, () => {
      const original = fixture(parent, list),
        nodes = structuredClone(original.nodes);
      // Seed fresh nodes rather than reuse any serialized text replicas.
      for (const n of Object.values(nodes)) {
        delete n.text;
      }
      const owner = list ? "item" : parent;
      nodes[owner].children = [
        "a",
        "a2",
        "code",
        "image",
        "b",
        "code2",
        "tail",
      ];
      nodes.a2 = { id: "a2", type: "paragraph", live: true };
      nodes.image = {
        id: "image",
        type: "image",
        asset: "mock.png",
        live: true,
      };
      nodes.code2 = { id: "code2", type: "code", language: "sql", live: true };
      nodes.tail = { id: "tail", type: "paragraph", live: true };
      const initial = seed(nodes, {
          a: [{ text: "Before" }],
          a2: [{ text: "More" }],
          code: [{ text: "print(1)" }],
          b: [{ text: "After" }],
          code2: [{ text: "SELECT 1" }],
          tail: [],
        }),
        auth = authority(initial);
      const preview = list
        ? previewListConversion(initial, parent, "list")
        : previewConversion(initial, parent, nodes[owner].children, "code");
      auth.accept(
        op(
          "a",
          1,
          (list ? planListConversion : planConversion)(
            initial,
            preview,
            op("a", 1),
          ).intent,
        ),
      );
      assert.deepEqual(visible(auth.state), [
        ["code", "Before\nMore"],
        ["code", "print(1)"],
        ["code", "After"],
        ["code", "SELECT 1"],
        ["code", ""],
      ]);
      const v = documentView(auth.state);
      assert.deepEqual(v.node(parent).children, [
        "a",
        "code",
        "image",
        "b",
        "code2",
        "tail",
      ]);
      assert.equal(v.node("code").language, "python");
      assert.equal(v.node("code2").language, "sql");
      assert.deepEqual(auth.state.nodes.image, initial.nodes.image);
      auth.accept(op("a", 2, { kind: "undo", target: "a:preserve:1" }));
      assert.deepEqual(visible(auth.state), visible(initial));
    });

for (const parent of ["doc", "cell"])
  for (const list of [false, true])
    test(`${parent} list=${list}: preserved native code remains editable after surrounding conversion`, () => {
      const a = authority(fixture(parent, list));
      const first = op("convert", 1);
      a.accept({
        ...first,
        intent: convert(a.state, parent, list, first).intent,
      });
      const original = documentView(a.state)
        .text("code")
        .map((x) => x.id);
      const h = op("type", 1),
        range = captureRange(
          a.state,
          { block: "code", offset: 2 },
          { block: "code", offset: 4 },
        );
      a.accept({
        ...h,
        intent: planReplace(
          a.state,
          range,
          {
            version: 1,
            blocks: [
              { type: "paragraph", content: [{ text: "Z", marks: [] }] },
            ],
          },
          h,
        ).intent,
      });
      assert.equal(
        documentView(a.state)
          .text("code")
          .map((x) => x.char)
          .join(""),
        "prZt(1)",
      );
      a.accept(op("type", 2, { kind: "undo", target: h.id }));
      assert.deepEqual(
        documentView(a.state)
          .text("code")
          .map((x) => x.id),
        original,
      );
      const enter = op("enter", 1);
      a.accept({
        ...enter,
        intent: planEnter(
          a.state,
          captureRange(
            a.state,
            { block: "code", offset: 2 },
            { block: "code", offset: 2 },
          ),
          enter,
        ).intent,
      });
      assert.equal(
        documentView(a.state)
          .text("code")
          .map((x) => x.char)
          .join(""),
        "pr\nint(1)",
      );
      const backspace = op("backspace", 1);
      a.accept({
        ...backspace,
        intent: planDelete(
          a.state,
          captureRange(
            a.state,
            { block: "code", offset: 3 },
            { block: "code", offset: 3 },
          ),
          "backward",
          backspace,
        ).intent,
      });
      assert.equal(
        documentView(a.state)
          .text("code")
          .map((x) => x.char)
          .join(""),
        "print(1)",
      );
      assert.equal(documentView(a.state).node("code").language, "python");
    });
