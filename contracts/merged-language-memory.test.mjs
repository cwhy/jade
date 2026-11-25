// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "@cwhy/jade-core/model";
import { documentView } from "@cwhy/jade-core/document-read";
import { previewConversion, planConversion } from "@cwhy/jade-core/conversion";
import { planCodeLanguage, codeLanguageState } from "@cwhy/jade-core/commands";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  id: `${actor}:merge:${seq}`,
  actor,
  seq,
  intent,
  stream: "merge",
  epoch: 1,
  modelVersion: 2,
});
function setup(parent, langs, derived = false) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["a", "b"] },
    a: { id: "a", type: "code", language: langs[0], live: true },
    b: { id: "b", type: "code", language: langs[1], live: true },
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["a", "b"] },
    });
  }
  if (derived)
    for (const id of ["a", "b"]) {
      nodes[id].type = "paragraph";
      delete nodes[id].language;
    }
  let room = new Room(
      seed(nodes, { a: [{ text: "first" }], b: [{ text: "second" }] }),
    ),
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
  if (derived) {
    convert(auth, parent, ["a"], "code", "seed", 1);
    convert(auth, parent, ["b"], "code", "seed", 2);
    auth.accept(
      op(
        "seed",
        3,
        planCodeLanguage(auth.state, "a", langs[0], op("seed", 3)).intent,
      ),
    );
    auth.accept(
      op(
        "seed",
        4,
        planCodeLanguage(auth.state, "b", langs[1], op("seed", 4)).intent,
      ),
    );
  }
  convert(auth, parent, ["a"], "paragraph", "a", 1);
  convert(auth, parent, ["b"], "paragraph", "a", 2);
  return auth;
}
function convert(auth, parent, blocks, target, actor, seq) {
  return auth.accept(
    op(
      actor,
      seq,
      planConversion(
        auth.state,
        previewConversion(auth.state, parent, blocks, target),
        op(actor, seq),
      ).intent,
    ),
  );
}
const lang = (auth, id = "a") =>
  codeLanguageState(documentView(auth.state).node(id)).language;
for (const parent of ["doc", "cell"])
  for (const langs of [
    ["python", "sql"],
    ["python", "python"],
    ["plaintext", "python"],
    ["plaintext", "plaintext"],
  ])
    test(`${parent}: merge remembered ${langs.join("/")} and independently undo new language`, () => {
      const auth = setup(parent, langs),
        expected = langs[0] === langs[1] ? langs[0] : "plaintext";
      convert(auth, parent, ["a", "b"], "code", "a", 3);
      assert.equal(lang(auth), expected);
      assert.equal(
        documentView(auth.state)
          .text("a")
          .map((a) => a.char)
          .join(""),
        "first\nsecond",
      );
      auth.accept(
        op(
          "b",
          1,
          planCodeLanguage(auth.state, "a", "javascript", op("b", 1)).intent,
        ),
      );
      assert.equal(lang(auth), "javascript");
      auth.accept(op("b", 2, { kind: "undo", target: "b:merge:1" }));
      assert.equal(lang(auth), expected);
      auth.accept(op("a", 4, { kind: "undo", target: "a:merge:3" }));
      auth.accept(op("a", 5, { kind: "undo", target: "a:merge:2" }));
      auth.accept(op("a", 6, { kind: "undo", target: "a:merge:1" }));
      assert.equal(lang(auth, "a"), langs[0]);
      assert.equal(lang(auth, "b"), langs[1]);
    });
for (const parent of ["doc", "cell"])
  for (const early of [false, true])
    test(`${parent}: delayed original language change before merge=${early} and independent merged choice`, () => {
      const auth = setup(parent, ["python", "sql"]);
      const delayed = { kind: "codeLanguage", block: "b", language: "python" };
      if (early) auth.accept(op("b", 1, delayed));
      convert(auth, parent, ["a", "b"], "code", "a", 3);
      if (!early) auth.accept(op("b", 1, delayed));
      assert.equal(lang(auth), "python");
      auth.accept(
        op(
          "c",
          1,
          planCodeLanguage(auth.state, "a", "javascript", op("c", 1)).intent,
        ),
      );
      auth.accept(op("b", 2, { kind: "undo", target: "b:merge:1" }));
      assert.equal(lang(auth), "javascript");
      auth.accept(op("c", 2, { kind: "undo", target: "c:merge:1" }));
      assert.equal(lang(auth), "plaintext");
      auth.accept(op("b", 3, { kind: "undo", target: "b:merge:2" }));
      assert.equal(lang(auth), "python");
    });
for (const parent of ["doc", "cell"])
  for (const langs of [
    ["python", "sql"],
    ["python", "python"],
  ])
    test(`${parent}: merged code language survives repeated Body conversion ${langs}`, () => {
      const auth = setup(parent, langs);
      convert(auth, parent, ["a", "b"], "code", "a", 3);
      const expected = langs[0] === langs[1] ? "python" : "plaintext";
      assert.equal(lang(auth), expected);
      convert(auth, parent, ["a", "b"], "paragraph", "a", 4);
      convert(auth, parent, ["a", "b"], "code", "a", 5);
      assert.equal(lang(auth), expected);
      auth.accept(
        op(
          "b",
          1,
          planCodeLanguage(auth.state, "a", "javascript", op("b", 1)).intent,
        ),
      );
      convert(auth, parent, ["a", "b"], "paragraph", "a", 6);
      auth.accept(op("b", 2, { kind: "undo", target: "b:merge:1" }));
      convert(auth, parent, ["a", "b"], "code", "a", 7);
      assert.equal(lang(auth), expected);
      const layers = (auth.state.nodes.doc.textConversions || []).flatMap(
        (e) => e.codeLanguages?.layers || [],
      );
      assert.equal(layers.filter((x) => x.id === "b:merge:1").length, 1);
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: malformed remembered-language coverage cannot partially change document`, () => {
    const auth = setup(parent, ["python", "sql"]),
      preview = previewConversion(auth.state, parent, ["a", "b"], "code");
    assert.equal(preview.intent.languageOrigins.length, 2);
    for (const mutate of [
      (i) => i.languageOrigins.reverse(),
      (i) => i.languageOrigins.pop(),
      (i) => i.languageOrigins.push(i.languageOrigins[0]),
      (i) => (i.languageOrigins[0].source.id = "b"),
      (i) => (i.languageOrigins[0].windows[0].source = "b"),
      (i) => (i.languageSource = { kind: "block", id: "a" }),
    ]) {
      const intent = structuredClone(preview.intent);
      mutate(intent);
      const room = new Room(auth.state),
        before = JSON.stringify(room.record.state);
      let error, r;
      try {
        r = room.accept(op("z", 1, intent));
      } catch (e) {
        error = e;
      }
      assert.ok(error || r?.outcome === "rejected");
      assert.equal(JSON.stringify(room.record.state), before);
    }
  });

for (const parent of ["doc", "cell"])
  for (const langs of [
    ["python", "sql"],
    ["python", "python"],
  ])
    test(`${parent}: separate prose-derived histories merge ${langs}`, () => {
      const auth = setup(parent, langs, true);
      convert(auth, parent, ["a", "b"], "code", "a", 3);
      assert.equal(lang(auth), langs[0] === langs[1] ? "python" : "plaintext");
      auth.accept(
        op(
          "b",
          1,
          planCodeLanguage(auth.state, "a", "javascript", op("b", 1)).intent,
        ),
      );
      auth.accept(op("a", 4, { kind: "undo", target: "a:merge:3" }));
      auth.accept(op("a", 5, { kind: "undo", target: "a:merge:2" }));
      auth.accept(op("a", 6, { kind: "undo", target: "a:merge:1" }));
      assert.equal(lang(auth, "a"), langs[0]);
      assert.equal(lang(auth, "b"), langs[1]);
    });
