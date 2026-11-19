// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  text,
  gapAt,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { captureRange } from "@cwhy/jade-core/selection";
import {
  planCodeLanguage,
  codeLanguageState,
  planRichInsert,
} from "@cwhy/jade-core/commands";
import { upgradeStorage } from "@cwhy/jade-core/storage";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  stream: "language",
  id: `${actor}:language:${seq}`,
  epoch: 1,
  modelVersion: 2,
});
const choose = (s, actor, seq, language, block = "code") =>
  planCodeLanguage(s, block, language, op(actor, seq)).state;
const undo = (s, actor, seq, target) =>
  apply(s, op(actor, seq, { kind: "undo", target }));
function fixture(language) {
  return seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["code"] },
      code: {
        id: "code",
        type: "code",
        live: true,
        ...(language === undefined ? {} : { language }),
      },
    },
    { code: [{ text: "const 你好 = 1;", marks: ["strong"] }] },
  );
}
for (const original of [undefined, "javascript", "legacy-language"])
  test(`language changes restore exact original presence and preserve text/marks/anchors (${original})`, () => {
    const s = fixture(original),
      anchor = anchorAt(s, "code", 7),
      n = choose(s, "a", 1, "python");
    assert.deepEqual(text(n, "code"), text(s, "code"));
    assert.deepEqual(resolveAnchor(n, anchor), resolveAnchor(s, anchor));
    assert.equal(n.nodes.code.language, "python");
    const back = undo(n, "a", 2, "a:language:1");
    assert.equal(back.nodes.code.language, original);
    assert.equal(
      Object.hasOwn(back.nodes.code, "language"),
      Object.hasOwn(s.nodes.code, "language"),
    );
    assert.equal(
      undo(back, "a", 3, "a:language:2").nodes.code.language,
      "python",
    );
    validate(back);
  });
for (const order of ["ab", "ba"])
  test(`last accepted language wins; owned Undo reveals remaining contributions (${order})`, () => {
    const s = fixture(),
      ops = {
        a: op("a", 1, {
          kind: "codeLanguage",
          block: "code",
          language: "python",
        }),
        b: op("b", 1, { kind: "codeLanguage", block: "code", language: "sql" }),
      };
    let n = s;
    for (const actor of order) n = apply(n, ops[actor]);
    assert.equal(n.nodes.code.language, ops[order[1]].intent.language);
    n = upgradeStorage(JSON.parse(JSON.stringify(n)));
    n = undo(n, "a", 2, ops.a.id);
    assert.equal(n.nodes.code.language, "sql");
    n = undo(n, "b", 2, ops.b.id);
    assert.equal(Object.hasOwn(n.nodes.code, "language"), false);
    validate(n);
  });
test("explicit Plain text is a real choice; its Undo restores detection eligibility", () => {
  const s = fixture();
  assert.equal(codeLanguageState(s.nodes.code).explicit, false);
  const n = choose(s, "a", 1, "plaintext");
  assert.equal(codeLanguageState(n.nodes.code).explicit, true);
  assert.equal(
    codeLanguageState(undo(n, "a", 2, "a:language:1").nodes.code).explicit,
    false,
  );
});
test("language and text edits commute without recreating text or changing marks", () => {
  const s = fixture(),
    a = op("a", 1, { kind: "codeLanguage", block: "code", language: "json" }),
    b = op("b", 1, { kind: "insert", at: gapAt(s, "code", 6), text: "peer" });
  const x = apply(apply(s, a), b),
    y = apply(apply(s, b), a);
  assert.deepEqual(text(x, "code"), text(y, "code"));
  assert.equal(x.nodes.code.language, y.nodes.code.language);
  assert.equal(undo(x, "a", 2, a.id).nodes.code.language, undefined);
  assert.ok(
    text(undo(x, "a", 2, a.id), "code")
      .map((a) => a.char)
      .join("")
      .includes("peer"),
  );
});
function pasted() {
  const s = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["p"] },
      p: { id: "p", type: "paragraph", live: true },
    },
    { p: [{ text: "Notes" }] },
  );
  return planRichInsert(
    s,
    captureRange(s, { block: "p", offset: 5 }, { block: "p", offset: 5 }),
    {
      version: 1,
      edges: { start: "boundary", end: "boundary" },
      blocks: [
        { type: "code", language: "javascript", content: [{ text: "run();" }] },
      ],
    },
    op("a", 1),
  ).state;
}
test("inactive language history does not trap created code; insertion Undo and both Redos work", () => {
  let s = pasted(),
    id = "a:language:1:rich:0";
  s = choose(s, "a", 2, "python", id);
  s = undo(s, "a", 3, "a:language:2");
  s = undo(s, "a", 4, "a:language:1");
  assert.equal(s.nodes[id].live, false);
  s = undo(s, "a", 5, "a:language:4");
  assert.equal(s.nodes[id].live, true);
  assert.equal(s.nodes[id].language, "javascript");
  s = undo(s, "a", 6, "a:language:3");
  assert.equal(s.nodes[id].language, "python");
  validate(s);
});
test("an active peer language choice prevents silent structural removal", () => {
  const s = choose(pasted(), "b", 1, "python", "a:language:1:rich:0");
  assert.throws(
    () => undo(s, "a", 2, "a:language:1"),
    /changed|content|contribution|structure/i,
  );
  assert.equal(s.nodes["a:language:1:rich:0"].live, true);
});
test("admission rejects unsupported language, wrong node, extra metadata and forged activation", () => {
  const s = fixture();
  for (const intent of [
    { kind: "codeLanguage", block: "doc", language: "python" },
    { kind: "codeLanguage", block: "code", language: "unsupported" },
    { kind: "codeLanguage", block: "code", language: "python", active: true },
    {
      kind: "codeLanguageActive",
      block: "code",
      target: "other",
      active: false,
    },
  ])
    assert.throws(() => apply(s, op("a", 1, intent)));
  const n = choose(s, "a", 1, "python");
  n.nodes.code.language = "sql";
  assert.throws(() => validate(n), /projection/);
});

import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
import {
  captureBodyContent,
  createBodyContent,
} from "@cwhy/jade-core/document-content";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { captureCellRange } from "@cwhy/jade-core/table-selection";
import { previewTableDelete, planTableDelete } from "@cwhy/jade-core/commands";
test("lost acknowledgement and room reload return the original decision without duplicate language layers", () => {
  let room = new Room(fixture()),
    record = room.snapshot();
  for (const command of [
    op("a", 1, { kind: "codeLanguage", block: "code", language: "python" }),
    op("b", 1, { kind: "codeLanguage", block: "code", language: "sql" }),
    op("a", 2, { kind: "undo", target: "a:language:1" }),
  ]) {
    const receipt = room.accept(command);
    assert.equal(receipt.outcome, "accepted");
    record = replay(record, { op: command, receipt });
    room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
    assert.deepEqual(room.accept(command), receipt);
    assert.deepEqual(room.snapshot(), record);
  }
  assert.equal(room.record.state.nodes.code.language, "sql");
  assert.equal(room.record.state.nodes.code.codeLanguages.layers.length, 2);
});
test("codec48 source stays intact and receives no fabricated language history", () => {
  const s = fixture("typescript");
  s.storageCodec = 48;
  const before = JSON.stringify(s),
    loaded = upgradeStorage(s);
  assert.equal(JSON.stringify(s), before);
  assert.equal(loaded.storageCodec, 51);
  assert.equal(loaded.nodes.code.codeLanguages, undefined);
  assert.deepEqual({ ...loaded, storageCodec: 48 }, s);
});
test("copy carries visible language and text without original contribution identities", () => {
  const s = choose(fixture(), "a", 1, "python"),
    body = captureBodyContent(s),
    copied = createBodyContent(body, { namespace: "copy-code-language" }),
    node = copied.state.nodes[copied.mapping.code];
  assert.equal(node.language, "python");
  assert.equal(node.codeLanguages, undefined);
  assert.ok(!JSON.stringify(body).includes("a:language:1"));
  assert.deepEqual(
    text(copied.state, node.id).map((a) => [a.char, a.marks]),
    text(s, "code").map((a) => [a.char, a.marks]),
  );
});
test("code language Undo waits for deleted rich-cell structure to be restored", () => {
  let s = choose(tableFixture(), "a", 1, "python");
  const selection = captureCellRange(s, "table", "code-cell");
  s = planTableDelete(s, selection, op("b", 1), {
    preview: previewTableDelete(s, selection, "rows"),
  }).state;
  assert.throws(() => undo(s, "a", 2, "a:language:1"), /unavailable|restore/i);
  s = undo(s, "b", 2, "b:language:1");
  assert.equal(s.nodes.code.language, "python");
  s = undo(s, "a", 2, "a:language:1");
  assert.equal(s.nodes.code.language, undefined);
  validate(s);
});

for (const container of ["cell", "list_item"])
  test(`inserted code in ${container}: language Undo releases earlier creation and Redo restores it`, () => {
    const nodes = {
      doc: {
        id: "doc",
        type: "doc",
        live: true,
        children: container === "cell" ? ["table"] : ["list"],
      },
      p: { id: "p", type: "paragraph", live: true },
    };
    if (container === "cell")
      Object.assign(nodes, {
        table: { id: "table", type: "table", live: true, children: ["row"] },
        row: { id: "row", type: "row", live: true, children: ["cell"] },
        cell: { id: "cell", type: "cell", live: true, children: ["p"] },
      });
    else
      Object.assign(nodes, {
        list: {
          id: "list",
          type: "ordered_list",
          live: true,
          children: ["item"],
        },
        item: { id: "item", type: "list_item", live: true, children: ["p"] },
      });
    let s = seed(nodes, { p: [{ text: "Notes" }] });
    const code = {
        type: "code",
        language: "javascript",
        content: [{ text: "run();" }],
      },
      blocks =
        container === "cell"
          ? [code]
          : [
              {
                type: "ordered_list",
                children: [
                  {
                    type: "list_item",
                    children: [
                      { type: "paragraph", content: [{ text: "Copied" }] },
                      code,
                    ],
                  },
                ],
              },
            ];
    s = planRichInsert(
      s,
      captureRange(s, { block: "p", offset: 5 }, { block: "p", offset: 5 }),
      { version: 1, edges: { start: "boundary", end: "boundary" }, blocks },
      op("a", 1),
    ).state;
    const id = Object.values(s.nodes).find(
      (n) => n.type === "code" && n.live,
    ).id;
    s = choose(s, "a", 2, "python", id);
    s = undo(s, "a", 3, "a:language:2");
    s = undo(s, "a", 4, "a:language:1");
    assert.equal(s.nodes[id].live, false);
    s = undo(s, "a", 5, "a:language:4");
    assert.equal(s.nodes[id].language, "javascript");
    s = undo(s, "a", 6, "a:language:3");
    assert.equal(s.nodes[id].language, "python");
    validate(s);
  });
