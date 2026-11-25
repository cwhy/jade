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

import { captureRange } from "@cwhy/jade-core/selection";
import { planEnter } from "@cwhy/jade-core/commands";
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    test(`${parent}/${kind}: split descendants remember Python with independent new language choices`, () => {
      const auth = setup(parent, kind);
      auth.accept(
        op(
          "b",
          1,
          planCodeLanguage(auth.state, "a", "python", op("b", 1)).intent,
        ),
      );
      convert(auth, parent, "a", 1, "paragraph");
      const range = captureRange(
        auth.state,
        { block: "a", offset: 4 },
        { block: "a", offset: 4 },
      );
      auth.accept(op("c", 1, planEnter(auth.state, range, op("c", 1)).intent));
      let v = documentView(auth.state);
      const tail = v.order[1];
      for (const [seq, id] of [
        [2, "a"],
        [3, tail],
      ])
        auth.accept(
          op(
            "a",
            seq,
            planConversion(
              auth.state,
              previewConversion(auth.state, parent, [id], "code"),
              op("a", seq),
            ).intent,
          ),
        );
      v = documentView(auth.state);
      assert.equal(v.order.length, 2);
      assert.equal(codeLanguageState(v.node("a")).language, "python");
      assert.equal(codeLanguageState(v.node(tail)).language, "python");
      assert.equal(
        v
          .text("a")
          .map((a) => a.char)
          .join(""),
        "prin",
      );
      assert.equal(
        v
          .text(tail)
          .map((a) => a.char)
          .join(""),
        "t(1)",
      );
      auth.accept(
        op(
          "d",
          1,
          planCodeLanguage(auth.state, "a", "javascript", op("d", 1)).intent,
        ),
      );
      v = documentView(auth.state);
      assert.equal(codeLanguageState(v.node("a")).language, "javascript");
      assert.equal(codeLanguageState(v.node(tail)).language, "python");
      auth.accept(op("d", 2, { kind: "undo", target: "d:memory:1" }));
      assert.equal(
        codeLanguageState(documentView(auth.state).node("a")).language,
        "python",
      );
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    for (const first of ["left", "right"])
      test(`${parent}/${kind}: split Undo retains independently converted parts until both release, first=${first}`, () => {
        const auth = setup(parent, kind);
        auth.accept(
          op(
            "b",
            1,
            planCodeLanguage(auth.state, "a", "python", op("b", 1)).intent,
          ),
        );
        convert(auth, parent, "a", 1, "paragraph");
        auth.accept(
          op(
            "c",
            1,
            planEnter(
              auth.state,
              captureRange(
                auth.state,
                { block: "a", offset: 4 },
                { block: "a", offset: 4 },
              ),
              op("c", 1),
            ).intent,
          ),
        );
        const tail = documentView(auth.state).order[1];
        for (const [actor, id] of [
          ["left", "a"],
          ["right", tail],
        ])
          auth.accept(
            op(
              actor,
              1,
              planConversion(
                auth.state,
                previewConversion(auth.state, parent, [id], "code"),
                op(actor, 1),
              ).intent,
            ),
          );
        auth.accept(op("c", 2, { kind: "undo", target: "c:memory:1" }));
        assert.equal(documentView(auth.state).order.length, 2);
        auth.accept(
          op(first, 2, { kind: "undo", target: `${first}:memory:1` }),
        );
        assert.equal(documentView(auth.state).order.length, 2);
        const last = first === "left" ? "right" : "left";
        auth.accept(op(last, 2, { kind: "undo", target: `${last}:memory:1` }));
        let v = documentView(auth.state);
        assert.equal(v.order.length, 1);
        assert.equal(v.node("a").type, "paragraph");
        assert.equal(
          v
            .text("a")
            .map((a) => a.char)
            .join(""),
          "print(1)",
        );
        auth.accept(
          op(first, 3, { kind: "undo", target: `${first}:memory:2` }),
        );
        v = documentView(auth.state);
        assert.equal(v.order.length, 2);
        assert.equal(
          codeLanguageState(v.node(first === "left" ? "a" : tail)).language,
          "python",
        );
      });
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    for (const early of [false, true])
      test(`${parent}/${kind}: confirmed offline original SQL preserves descendant JavaScript, early=${early}`, () => {
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
          op("b", 2),
        ).intent;
        convert(auth, parent, "a", 1, "paragraph");
        auth.accept(
          op(
            "c",
            1,
            planEnter(
              auth.state,
              captureRange(
                auth.state,
                { block: "a", offset: 4 },
                { block: "a", offset: 4 },
              ),
              op("c", 1),
            ).intent,
          ),
        );
        const tail = documentView(auth.state).order[1];
        for (const [actor, id] of [
          ["left", "a"],
          ["right", tail],
        ])
          auth.accept(
            op(
              actor,
              1,
              planConversion(
                auth.state,
                previewConversion(auth.state, parent, [id], "code"),
                op(actor, 1),
              ).intent,
            ),
          );
        if (early) auth.accept(op("b", 2, pending));
        auth.accept(
          op(
            "d",
            1,
            planCodeLanguage(auth.state, "a", "javascript", op("d", 1)).intent,
          ),
        );
        if (!early) auth.accept(op("b", 2, pending));
        const languages = () => {
          const v = documentView(auth.state);
          return ["a", tail].map(
            (id) => codeLanguageState(v.node(id)).language,
          );
        };
        assert.deepEqual(languages(), ["javascript", "sql"]);
        auth.accept(op("b", 3, { kind: "undo", target: "b:memory:2" }));
        assert.deepEqual(languages(), ["javascript", "python"]);
        auth.accept(op("d", 2, { kind: "undo", target: "d:memory:1" }));
        assert.deepEqual(languages(), ["python", "python"]);
        auth.accept(op("b", 4, { kind: "undo", target: "b:memory:3" }));
        assert.deepEqual(languages(), ["sql", "sql"]);
      });
