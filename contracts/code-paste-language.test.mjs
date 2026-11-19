// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planCodePaste,
  planCodeLanguage,
  codeLanguageState,
} from "@cwhy/jade-core/commands";
const op = (actor, seq, intent) => ({
  actor,
  stream: "paste",
  seq,
  id: `${actor}:paste:${seq}`,
  epoch: 1,
  modelVersion: 2,
  intent,
});
function fixture(language) {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["code", "p"] },
      code: {
        id: "code",
        type: "code",
        live: true,
        ...(language === undefined ? {} : { language }),
      },
      p: { id: "p", type: "paragraph", live: true },
    },
    { code: [], p: [{ text: "Notes" }] },
  );
}
const value = (s) =>
  text(s, "code")
    .map((a) => a.char)
    .join("");
const undo = (s, actor, seq, target) =>
  apply(s, op(actor, seq, { kind: "undo", target }));
const paste = (
  s,
  actor,
  seq,
  language = "javascript",
  value = "const x = 1;",
) =>
  planCodePaste(
    s,
    captureRange(s, { block: "code", offset: 0 }, { block: "code", offset: 0 }),
    value,
    op(actor, seq),
    { language },
  );
test("code paste and detected language commit and Undo/Redo as one owned action", () => {
  const s = fixture(),
    p = paste(s, "a", 1);
  let n = apply(s, op("a", 1, p.intent));
  assert.equal(value(n), "const x = 1;");
  assert.equal(n.nodes.code.language, "javascript");
  assert.equal(codeLanguageState(n.nodes.code).explicit, false);
  assert.deepEqual(n, p.state);
  n = undo(n, "a", 2, "a:paste:1");
  assert.equal(value(n), "");
  assert.equal(n.nodes.code.language, undefined);
  n = undo(n, "a", 3, "a:paste:2");
  assert.equal(value(n), "const x = 1;");
  assert.equal(n.nodes.code.language, "javascript");
  validate(n);
});
for (const language of ["plaintext", "python", "legacy-language"])
  test(`explicit ${language} prevents automatic choice while accepting literal text`, () => {
    const n = paste(fixture(language), "a", 1).state;
    assert.equal(n.nodes.code.language, language);
    assert.equal(value(n), "const x = 1;");
    assert.equal(codeLanguageState(n.nodes.code).explicit, true);
  });
for (const kind of ["typing", "language", "unrelated", "typing-then-undo"])
  test(`stale classification after ${kind} cannot override current state; paste text still commits`, () => {
    const s = fixture(),
      p = paste(s, "a", 1);
    let n = s;
    if (kind === "language")
      n = planCodeLanguage(n, "code", "python", op("b", 1)).state;
    else
      n = apply(
        n,
        op("b", 1, {
          kind: "insert",
          at: gapAt(n, kind === "unrelated" ? "p" : "code", 0),
          text: "peer",
        }),
      );
    if (kind === "typing-then-undo") n = undo(n, "b", 2, "b:paste:1");
    n = apply(n, op("a", 1, p.intent));
    assert.ok(value(n).includes("const x = 1;"));
    assert.equal(
      n.nodes.code.language,
      kind === "language" ? "python" : undefined,
    );
    n = undo(n, "a", 2, "a:paste:1");
    assert.equal(value(n), kind === "typing" ? "peer" : "");
    assert.equal(
      n.nodes.code.language,
      kind === "language" ? "python" : undefined,
    );
    validate(n);
  });
test("manual choice wins over automatic default, including when manual Undo/Redo brackets a later paste", () => {
  let n = planCodeLanguage(fixture(), "code", "python", op("b", 1)).state;
  n = undo(n, "b", 2, "b:paste:1");
  n = paste(n, "a", 1).state;
  assert.equal(n.nodes.code.language, "javascript");
  n = undo(n, "b", 3, "b:paste:2");
  assert.equal(n.nodes.code.language, "python");
  n = undo(n, "b", 4, "b:paste:3");
  assert.equal(n.nodes.code.language, "javascript");
  validate(n);
});
test("paste Undo preserves peer typing and a later manual choice", () => {
  let n = paste(fixture(), "a", 1).state;
  n = apply(
    n,
    op("b", 1, { kind: "insert", at: gapAt(n, "code", 5), text: "PEER" }),
  );
  n = planCodeLanguage(n, "code", "python", op("b", 2)).state;
  n = undo(n, "a", 2, "a:paste:1");
  assert.equal(value(n), "PEER");
  assert.equal(n.nodes.code.language, "python");
  validate(n);
});
test("nonempty block is never relabeled; plain fallback is implicit and literal", () => {
  let n = paste(fixture(), "a", 1, "plaintext", "unknown\r\n你好").state;
  assert.equal(value(n), "unknown\n你好");
  assert.equal(codeLanguageState(n.nodes.code).explicit, false);
  n = paste(n, "b", 1, "python", "hello").state;
  assert.equal(n.nodes.code.language, "plaintext");
  assert.equal(value(n), "hellounknown\n你好");
});
test("malformed automatic intents and unsupported languages reject without publishing partial text", () => {
  const s = fixture(),
    good = {
      kind: "codeLanguageAuto",
      block: "code",
      language: "python",
      revision: 0,
    };
  for (const intent of [
    good,
    { kind: "batch", intents: [{ ...good, revision: -1 }] },
    { kind: "batch", intents: [{ ...good, language: "unknown" }] },
  ])
    assert.throws(() => apply(s, op("a", 1, intent)));
  assert.equal(value(s), "");
  assert.throws(() => paste(s, "a", 1, "unknown"));
});
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import { upgradeStorage } from "@cwhy/jade-core/storage";
for (const order of ["ab", "ba"])
  test(`concurrent empty-code pastes, lost acknowledgements, reload and owned Undo (${order})`, () => {
    const s = fixture(),
      plans = {
        a: paste(s, "a", 1, "javascript", "JS"),
        b: paste(s, "b", 1, "python", "PY"),
      };
    let room = new Room(s),
      record = room.snapshot();
    const commands = [...order].map((actor) =>
      op(actor, 1, plans[actor].intent),
    );
    commands.push(
      op("a", 2, { kind: "undo", target: "a:paste:1" }),
      op("b", 2, { kind: "undo", target: "b:paste:1" }),
    );
    for (const command of commands) {
      const receipt = room.accept(command);
      assert.equal(receipt.outcome, "accepted");
      record = replay(record, { op: command, receipt });
      room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
      assert.deepEqual(room.accept(command), receipt);
      assert.deepEqual(room.snapshot(), record);
      if (command.seq === 1)
        assert.equal(
          room.record.state.nodes.code.language,
          order[0] === "a" ? "javascript" : "python",
        );
    }
    assert.equal(value(room.record.state), "");
    assert.equal(room.record.state.nodes.code.language, undefined);
  });
test("automatic paste works in a rich cell and leaves sibling text unchanged", () => {
  const s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["table"] },
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["p", "code"] },
      p: { id: "p", type: "paragraph", live: true },
      code: { id: "code", type: "code", live: true },
    },
    { p: [{ text: "Keep me" }], code: [] },
  );
  const n = paste(s, "a", 1).state;
  assert.equal(value(n), "const x = 1;");
  assert.deepEqual(text(n, "p"), text(s, "p"));
  assert.equal(n.nodes.code.language, "javascript");
  assert.deepEqual(text(undo(n, "a", 2, "a:paste:1"), "p"), text(s, "p"));
});
test("codec49 manual layers load unchanged and still restore the original choice", () => {
  const s = planCodeLanguage(
    fixture("sql"),
    "code",
    "python",
    op("a", 1),
  ).state;
  s.storageCodec = 49;
  const before = JSON.stringify(s),
    n = upgradeStorage(s);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual({ ...n, storageCodec: 49 }, s);
  assert.equal(undo(n, "a", 2, "a:paste:1").nodes.code.language, "sql");
});
