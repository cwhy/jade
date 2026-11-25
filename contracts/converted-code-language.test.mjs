// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, text } from "@cwhy/jade-core/model";
import { apply, validate } from "@cwhy/jade-core/admission";
import { documentView } from "@cwhy/jade-core/document-read";
import { captureConversion } from "@cwhy/jade-core/conversion";
import { planCodeLanguage, codeLanguageState } from "@cwhy/jade-core/commands";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  actor,
  seq,
  intent,
  id: `${actor}:language-conversion:${seq}`,
  stream: "language-conversion",
  epoch: 1,
  modelVersion: 2,
});
function fixture(parent = "doc", value = "Alpha") {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["a", "b"] },
    a: { id: "a", type: "paragraph", live: true },
    b: { id: "b", type: "paragraph", live: true },
  };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["a", "b"] },
    });
  }
  return seed(nodes, { a: [{ text: value }], b: [{ text: "Beta" }] });
}
for (const parent of ["doc", "cell"])
  for (const late of [false, true])
    for (const firstUndo of ["conversion", "language"])
      test(`${parent} Python contribution, late=${late}, Undo ${firstUndo} first`, () => {
        const initial = fixture(parent);
        let room = new Room(initial),
          journal = room.snapshot();
        const accept = (command) => {
          const receipt = room.accept(command);
          assert.equal(receipt.outcome, "accepted", receipt.reason);
          journal = replay(journal, { op: command, receipt });
          room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
          assert.deepEqual(room.accept(command), receipt);
          assert.deepEqual(room.snapshot(), journal);
          return room.record.state;
        };
        let s = accept(
          op("a", 1, captureConversion(initial, parent, ["a", "b"], "code")),
        );
        const language = op(
          "b",
          1,
          planCodeLanguage(s, "a", "python", op("b", 1)).intent,
        );
        if (late)
          s = accept(
            op("a", 2, { kind: "undo", target: "a:language-conversion:1" }),
          );
        s = accept(language);
        if (late) {
          assert.equal(documentView(s).node("a").type, "paragraph");
          assert.throws(() => planCodeLanguage(s, "a", "sql", op("c", 1)));
          s = accept(
            op("a", 3, { kind: "undo", target: "a:language-conversion:2" }),
          );
        }
        assert.equal(
          codeLanguageState(documentView(s).node("a")).language,
          "python",
        );
        const aq = late ? 4 : 2;
        if (firstUndo === "conversion") {
          s = accept(
            op("a", aq, {
              kind: "undo",
              target: late
                ? "a:language-conversion:3"
                : "a:language-conversion:1",
            }),
          );
          assert.equal(documentView(s).node("a").type, "paragraph");
          s = accept(
            op("b", 2, { kind: "undo", target: "b:language-conversion:1" }),
          );
          s = accept(
            op("b", 3, { kind: "undo", target: "b:language-conversion:2" }),
          );
          assert.equal(documentView(s).node("a").type, "paragraph");
          s = accept(
            op("a", aq + 1, {
              kind: "undo",
              target: `a:language-conversion:${aq}`,
            }),
          );
          assert.equal(
            codeLanguageState(documentView(s).node("a")).language,
            "python",
          );
        } else {
          s = accept(
            op("b", 2, { kind: "undo", target: "b:language-conversion:1" }),
          );
          assert.equal(
            codeLanguageState(documentView(s).node("a")).language,
            "plaintext",
          );
          s = accept(
            op("a", aq, {
              kind: "undo",
              target: late
                ? "a:language-conversion:3"
                : "a:language-conversion:1",
            }),
          );
          assert.equal(documentView(s).node("a").type, "paragraph");
          s = accept(
            op("a", aq + 1, {
              kind: "undo",
              target: `a:language-conversion:${aq}`,
            }),
          );
          assert.equal(
            codeLanguageState(documentView(s).node("a")).language,
            "plaintext",
          );
          s = accept(
            op("b", 3, { kind: "undo", target: "b:language-conversion:2" }),
          );
          assert.equal(
            codeLanguageState(documentView(s).node("a")).language,
            "python",
          );
        }
        for (const id of ["a", "b"])
          assert.deepEqual(text(s, id), text(initial, id));
        validate(s);
      });
test("multiple independent language choices reveal the latest remaining choice after conversion Redo", () => {
  let s = fixture();
  s = apply(s, op("a", 1, captureConversion(s, "doc", ["a"], "code")));
  s = apply(
    s,
    op("b", 1, planCodeLanguage(s, "a", "python", op("b", 1)).intent),
  );
  s = apply(s, op("c", 1, planCodeLanguage(s, "a", "sql", op("c", 1)).intent));
  s = apply(s, op("a", 2, { kind: "undo", target: "a:language-conversion:1" }));
  s = apply(s, op("c", 2, { kind: "undo", target: "c:language-conversion:1" }));
  s = apply(s, op("a", 3, { kind: "undo", target: "a:language-conversion:2" }));
  assert.equal(codeLanguageState(documentView(s).node("a")).language, "python");
});
test("unknown conversion witness does not mutate document", () => {
  const s = fixture(),
    bytes = JSON.stringify(s);
  assert.throws(() =>
    apply(
      s,
      op("b", 1, {
        kind: "codeLanguage",
        block: "a",
        language: "python",
        conversion: "fake",
      }),
    ),
  );
  assert.equal(JSON.stringify(s), bytes);
});

import { captureRange } from "@cwhy/jade-core/selection";
import { planCodePaste, copyRange } from "@cwhy/jade-core/commands";
import {
  captureBodyContent,
  createBodyContent,
} from "@cwhy/jade-core/document-content";
test("copy/export uses effective language and a fresh copy has no source ownership", () => {
  let s = fixture();
  s = apply(s, op("a", 1, captureConversion(s, "doc", ["a", "b"], "code")));
  s = apply(
    s,
    op("b", 1, planCodeLanguage(s, "a", "python", op("b", 1)).intent),
  );
  const body = captureBodyContent(s),
    leaf = body.root.children[0];
  assert.equal(leaf.type, "code");
  assert.equal(leaf.attrs.language, "python");
  const range = captureRange(
    s,
    { block: "a", offset: 0 },
    { block: "a", offset: 10 },
  );
  assert.equal(copyRange(s, range).fragment.blocks[0].language, "python");
  const copied = createBodyContent(body, { namespace: "copy" });
  assert.equal(
    captureBodyContent(copied.state).root.children[0].attrs.language,
    "python",
  );
  assert.deepEqual(copied.state.effects, {});
  assert.equal(JSON.stringify(copied).includes("language-conversion"), false);
  s = apply(s, op("a", 2, { kind: "undo", target: "a:language-conversion:1" }));
  assert.deepEqual(
    captureBodyContent(s).root.children.map((n) => n.attrs),
    [{}, {}],
  );
});
for (const manual of [false, true])
  test(`empty converted code paste detects language atomically; manual=${manual}`, () => {
    let s = fixture("doc", "");
    s = apply(s, op("a", 1, captureConversion(s, "doc", ["a"], "code")));
    if (manual)
      s = apply(
        s,
        op("c", 1, planCodeLanguage(s, "a", "sql", op("c", 1)).intent),
      );
    const range = captureRange(
        s,
        { block: "a", offset: 0 },
        { block: "a", offset: 0 },
      ),
      plan = planCodePaste(s, range, "print(1)", op("b", 1), {
        language: "python",
      });
    s = apply(s, op("b", 1, plan.intent));
    assert.equal(
      documentView(s)
        .text("a")
        .map((x) => x.char)
        .join(""),
      "print(1)",
    );
    assert.equal(
      codeLanguageState(documentView(s).node("a")).language,
      manual ? "sql" : "python",
    );
    s = apply(
      s,
      op("a", 2, { kind: "undo", target: "a:language-conversion:1" }),
    );
    assert.equal(documentView(s).node("a").type, "paragraph");
    s = apply(
      s,
      op("b", 2, { kind: "undo", target: "b:language-conversion:1" }),
    );
    assert.equal(text(s, "a").length, 0);
    s = apply(
      s,
      op("a", 3, { kind: "undo", target: "a:language-conversion:2" }),
    );
    assert.equal(
      codeLanguageState(documentView(s).node("a")).language,
      manual ? "sql" : "plaintext",
    );
  });

import { gapAt } from "@cwhy/jade-core/model";
for (const parent of ["doc", "cell"])
  for (const late of [false, true])
    test(`${parent}: language remains independently owned after its source partition rejoins; late=${late}`, () => {
      let s = fixture(parent),
        room = new Room(s),
        journal = room.snapshot();
      const accept = (command) => {
        const receipt = room.accept(command);
        assert.equal(receipt.outcome, "accepted", receipt.reason);
        journal = replay(journal, { op: command, receipt });
        room = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
        assert.deepEqual(room.accept(command), receipt);
        assert.deepEqual(room.snapshot(), journal);
        return room.record.state;
      };
      s = accept(op("split", 1, { kind: "proseEnter", at: gapAt(s, "a", 2) }));
      const tail = "split:language-conversion:1:paragraph";
      s = accept(
        op("convert", 1, captureConversion(s, parent, [tail], "code")),
      );
      const language = op(
        "language",
        1,
        planCodeLanguage(s, tail, "python", op("language", 1)).intent,
      );
      if (!late) s = accept(language);
      s = accept(
        op("split", 2, { kind: "undo", target: "split:language-conversion:1" }),
      );
      s = accept(
        op("convert", 2, {
          kind: "undo",
          target: "convert:language-conversion:1",
        }),
      );
      assert.equal(
        documentView(s)
          .text("a")
          .map((a) => a.char)
          .join(""),
        "Alpha",
      );
      if (late) s = accept(language);
      s = accept(
        op("language", 2, {
          kind: "undo",
          target: "language:language-conversion:1",
        }),
      );
      s = accept(
        op("language", 3, {
          kind: "undo",
          target: "language:language-conversion:2",
        }),
      );
      assert.equal(documentView(s).node("a").type, "paragraph");
      s = accept(
        op("convert", 3, {
          kind: "undo",
          target: "convert:language-conversion:2",
        }),
      );
      assert.equal(
        codeLanguageState(documentView(s).node(tail)).language,
        "python",
      );
      assert.deepEqual(
        documentView(s).order.map((id) =>
          documentView(s)
            .text(id)
            .map((a) => a.char)
            .join(""),
        ),
        ["Al", "pha", "Beta"],
      );
    });

test("a real conversion witness cannot target an unselected source", () => {
  let s = fixture();
  s = apply(s, op("a", 1, captureConversion(s, "doc", ["a"], "code")));
  const before = JSON.stringify(s);
  assert.throws(
    () =>
      apply(
        s,
        op("b", 1, {
          kind: "codeLanguage",
          block: "b",
          language: "python",
          conversion: "a:language-conversion:1",
        }),
      ),
    /source left/,
  );
  assert.equal(JSON.stringify(s), before);
});
