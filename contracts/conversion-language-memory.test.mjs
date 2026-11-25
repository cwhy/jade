// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "@cwhy/jade-core/model";
import { documentView } from "@cwhy/jade-core/document-read";
import {
  previewConversion,
  planConversion,
  previewListConversion,
  planListConversion,
} from "@cwhy/jade-core/conversion";
import { planCodeLanguage, codeLanguageState } from "@cwhy/jade-core/commands";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  id: `${actor}:memory:${seq}`,
  actor,
  seq,
  intent,
  stream: "memory",
  epoch: 1,
  modelVersion: 2,
});
function setup(parent, kind, value = "print(1)") {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["a"] },
    a: {
      id: "a",
      type: kind === "native" ? "code" : "paragraph",
      live: true,
      ...(kind === "native" ? { language: "python" } : {}),
    },
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["a"] },
    });
  }
  if (kind === "list") {
    nodes[parent].children = ["list"];
    Object.assign(nodes, {
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["item"],
      },
      item: { id: "item", type: "list_item", live: true, children: ["a"] },
    });
  }
  let room = new Room(seed(nodes, { a: [{ text: value }] })),
    journal = room.snapshot();
  const auth = {
    get state() {
      return room.record.state;
    },
    accept(command) {
      const r = room.accept(command);
      assert.equal(r.outcome, "accepted", r.reason);
      journal = replay(journal, { op: command, receipt: r });
      room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(command), r);
      assert.deepEqual(room.snapshot(), journal);
      return room.record.state;
    },
  };
  if (kind !== "native") {
    const s = auth.state;
    auth.accept(
      op(
        "seed",
        1,
        kind === "list"
          ? planListConversion(
              s,
              previewListConversion(s, parent, "list"),
              op("seed", 1),
            ).intent
          : planConversion(
              s,
              previewConversion(s, parent, ["a"], "code"),
              op("seed", 1),
            ).intent,
      ),
    );
  }
  return auth;
}
const convert = (auth, parent, actor, seq, target) =>
  auth.accept(
    op(
      actor,
      seq,
      planConversion(
        auth.state,
        previewConversion(auth.state, parent, ["a"], target),
        op(actor, seq),
      ).intent,
    ),
  );
const language = (auth) =>
  codeLanguageState(documentView(auth.state).node("a")).language;
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    test(`${parent}/${kind}: explicit roundtrip remembers owned language through independent Undo`, () => {
      const auth = setup(parent, kind);
      auth.accept(
        op(
          "b",
          1,
          planCodeLanguage(auth.state, "a", "python", op("b", 1)).intent,
        ),
      );
      convert(auth, parent, "a", 1, "paragraph");
      convert(auth, parent, "a", 2, "code");
      assert.equal(language(auth), "python");
      auth.accept(
        op("c", 1, planCodeLanguage(auth.state, "a", "sql", op("c", 1)).intent),
      );
      assert.equal(language(auth), "sql");
      auth.accept(op("c", 2, { kind: "undo", target: "c:memory:1" }));
      assert.equal(language(auth), "python");
      auth.accept(op("b", 2, { kind: "undo", target: "b:memory:1" }));
      assert.equal(language(auth), kind === "native" ? "python" : "plaintext");
      auth.accept(op("b", 3, { kind: "undo", target: "b:memory:2" }));
      assert.equal(language(auth), "python");
      convert(auth, parent, "a", 3, "paragraph");
      convert(auth, parent, "a", 4, "code");
      assert.equal(language(auth), "python");
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    for (const early of [false, true])
      test(`${parent}/${kind}: in-flight language choice arrives before new code=${early}`, () => {
        const auth = setup(parent, kind);
        auth.accept(
          op(
            "b",
            1,
            planCodeLanguage(auth.state, "a", "python", op("b", 1)).intent,
          ),
        );
        const pending = planCodeLanguage(
          auth.state,
          "a",
          "sql",
          op("c", 1),
        ).intent;
        convert(auth, parent, "a", 1, "paragraph");
        if (early) auth.accept(op("c", 1, pending));
        convert(auth, parent, "a", 2, "code");
        if (!early) auth.accept(op("c", 1, pending));
        assert.equal(language(auth), "sql");
        auth.accept(op("b", 2, { kind: "undo", target: "b:memory:1" }));
        assert.equal(language(auth), "sql");
        auth.accept(op("c", 2, { kind: "undo", target: "c:memory:1" }));
        assert.equal(
          language(auth),
          kind === "native" ? "python" : "plaintext",
        );
      });
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    test(`${parent}/${kind}: language Undo while Body is visible changes remembered result without resurrecting code`, () => {
      const auth = setup(parent, kind);
      auth.accept(
        op(
          "b",
          1,
          planCodeLanguage(auth.state, "a", "python", op("b", 1)).intent,
        ),
      );
      convert(auth, parent, "a", 1, "paragraph");
      convert(auth, parent, "a", 2, "code");
      auth.accept(
        op("c", 1, planCodeLanguage(auth.state, "a", "sql", op("c", 1)).intent),
      );
      convert(auth, parent, "a", 3, "paragraph");
      auth.accept(op("c", 2, { kind: "undo", target: "c:memory:1" }));
      assert.equal(documentView(auth.state).node("a").type, "paragraph");
      convert(auth, parent, "a", 4, "code");
      assert.equal(language(auth), "python");
      auth.accept(op("c", 3, { kind: "undo", target: "c:memory:2" }));
      assert.equal(language(auth), "sql");
      const records = [
        ...Object.values(auth.state.nodes),
        ...(auth.state.nodes.doc.textConversions || []),
      ];
      assert.equal(
        records.filter((n) =>
          n.codeLanguages?.layers.some((l) => l.id === "c:memory:1"),
        ).length,
        1,
      );
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    test(`${parent}/${kind}: explicitly selected Plain text is also remembered and blocks automatic relabeling`, () => {
      const auth = setup(parent, kind, "");
      auth.accept(
        op(
          "b",
          1,
          planCodeLanguage(auth.state, "a", "plaintext", op("b", 1)).intent,
        ),
      );
      convert(auth, parent, "a", 1, "paragraph");
      convert(auth, parent, "a", 2, "code");
      const node = documentView(auth.state).node("a");
      assert.equal(codeLanguageState(node).language, "plaintext");
      assert.equal(codeLanguageState(node).explicit, true);
      auth.accept(
        op("c", 1, {
          kind: "batch",
          intents: [
            {
              kind: "codeLanguageAuto",
              block: "a",
              conversion: node.codeConversion,
              language: "javascript",
              revision: auth.state.revision,
            },
          ],
        }),
      );
      assert.equal(language(auth), "plaintext");
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: forged remembered-language references cannot alter content`, () => {
    const auth = setup(parent, "prose");
    auth.accept(
      op(
        "b",
        1,
        planCodeLanguage(auth.state, "a", "python", op("b", 1)).intent,
      ),
    );
    convert(auth, parent, "a", 1, "paragraph");
    const preview = previewConversion(auth.state, parent, ["a"], "code");
    for (const source of [
      { kind: "conversion", id: "missing" },
      { kind: "block", id: "a" },
      { kind: "unknown", id: "a" },
      { kind: "conversion", id: "seed:memory:1", extra: 1 },
    ]) {
      const room = new Room(auth.state),
        before = JSON.stringify(room.record.state);
      const intent = { ...preview.intent, languageSource: source };
      let error, receipt;
      try {
        receipt = room.accept(op("x", 1, intent));
      } catch (e) {
        error = e;
      }
      assert.ok(error || receipt?.outcome === "rejected");
      assert.equal(JSON.stringify(room.record.state), before);
    }
  });
