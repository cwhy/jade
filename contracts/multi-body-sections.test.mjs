// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, gapAt } from "@cwhy/jade-core/model";
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
  id: `${actor}:sections:${seq}`,
  actor,
  seq,
  stream: "sections",
  epoch: 1,
  modelVersion: 2,
  intent,
});
function fixture(parent, kind, image) {
  const nodes = {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children: ["a", ...(image ? ["image"] : []), "b"],
    },
    a: {
      id: "a",
      type: kind === "native" ? "code" : "paragraph",
      live: true,
      ...(kind === "native" ? { language: "python" } : {}),
    },
    b: {
      id: "b",
      type: kind === "native" ? "code" : "paragraph",
      live: true,
      ...(kind === "native" ? { language: "sql" } : {}),
    },
  };
  if (image)
    nodes.image =
      image === "body"
        ? { id: "image", type: "paragraph", live: true }
        : { id: "image", type: "image", live: true, asset: "mock.png" };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: {
        id: "cell",
        type: "cell",
        live: true,
        children: ["a", ...(image ? ["image"] : []), "b"],
      },
    });
  }
  if (kind === "list") {
    nodes[parent].children = ["list"];
    Object.assign(nodes, {
      list: {
        id: "list",
        type: "ordered_list",
        live: true,
        children: ["ia", "ib"],
      },
      ia: {
        id: "ia",
        type: "list_item",
        live: true,
        children: ["a", ...(image ? ["image"] : [])],
      },
      ib: { id: "ib", type: "list_item", live: true, children: ["b"] },
    });
  }
  let room = new Room(
      seed(nodes, {
        a: [{ text: "Alpha\nline" }],
        b: [{ text: "Beta" }],
        ...(image === "body"
          ? { image: [{ text: "Keep bold", marks: ["strong"] }] }
          : {}),
      }),
    ),
    journal = room.snapshot();
  const auth = {
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
  if (kind !== "native")
    for (const [seq, id] of [
      [1, "a"],
      [2, "b"],
    ]) {
      const header = op("seed", seq);
      auth.accept({
        ...header,
        intent:
          kind === "list"
            ? planListConversion(
                auth.state,
                previewListConversion(auth.state, parent, "list", {
                  items: [id === "a" ? "ia" : "ib"],
                }),
                header,
              ).intent
            : planConversion(
                auth.state,
                previewConversion(auth.state, parent, [id], "code"),
                header,
              ).intent,
      });
    }
  for (const [seq, id, lang] of [
    [1, "a", "python"],
    [2, "b", "sql"],
  ])
    auth.accept(
      op(
        "language",
        seq,
        planCodeLanguage(auth.state, id, lang, op("language", seq)).intent,
      ),
    );
  return auth;
}
const convert = (auth, parent, blocks, target, actor = "body", seq = 1) =>
  op(
    actor,
    seq,
    planConversion(
      auth.state,
      previewConversion(auth.state, parent, blocks, target),
      op(actor, seq),
    ).intent,
  );
function content(auth, parent) {
  const v = documentView(auth.state);
  return v.node(parent).children.map((id) => {
    const n = v.node(id);
    return [
      n.type,
      ["code", "paragraph"].includes(n.type)
        ? v
            .text(id)
            .map((a) => a.char)
            .join("")
        : id,
      ...(n.type === "code" ? [codeLanguageState(n).language] : []),
    ];
  });
}
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    for (const image of [false, true]) {
      const label = `${parent}/${kind}/image=${image}`;
      test(`${label}: multi-code Body preserves each block, peer text, languages and one-step Undo`, () => {
        const auth = fixture(parent, kind, image),
          blocks = ["a", ...(image ? ["image"] : []), "b"];
        const media = image ? [["image", "image"]] : [];
        auth.accept(convert(auth, parent, blocks, "paragraph"));
        assert.deepEqual(content(auth, parent), [
          ["paragraph", "Alpha\nline"],
          ...media,
          ["paragraph", "Beta"],
        ]);
        auth.accept(
          op("peer", 1, {
            kind: "insert",
            at: gapAt(auth.state, "b", 2),
            text: "X",
          }),
        );
        auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
        assert.deepEqual(content(auth, parent), [
          ["code", "Alpha\nline", "python"],
          ...media,
          ["code", "BeXta", "sql"],
        ]);
        auth.accept(op("body", 3, { kind: "undo", target: "body:sections:2" }));
        assert.deepEqual(content(auth, parent), [
          ["paragraph", "Alpha\nline"],
          ...media,
          ["paragraph", "BeXta"],
        ]);
        auth.accept(convert(auth, parent, ["a"], "code", "recode", 1));
        auth.accept(convert(auth, parent, ["b"], "code", "recode", 2));
        assert.deepEqual(content(auth, parent), [
          ["code", "Alpha\nline", "python"],
          ...media,
          ["code", "BeXta", "sql"],
        ]);
      });
    }
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose", "list"])
    for (const peerFirst of [false, true])
      test(`${parent}/${kind}: delayed Body preview and peer insert order=${peerFirst}`, () => {
        const auth = fixture(parent, kind, true),
          command = convert(auth, parent, ["a", "image", "b"], "paragraph"),
          typing = op("peer", 1, {
            kind: "insert",
            at: gapAt(auth.state, "b", 2),
            text: "X",
          });
        for (const step of peerFirst ? [typing, command] : [command, typing])
          auth.accept(step);
        assert.deepEqual(content(auth, parent), [
          ["paragraph", "Alpha\nline"],
          ["image", "image"],
          ["paragraph", "BeXta"],
        ]);
        auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
        assert.deepEqual(content(auth, parent), [
          ["code", "Alpha\nline", "python"],
          ["image", "image"],
          ["code", "BeXta", "sql"],
        ]);
      });
for (const parent of ["doc", "cell"])
  for (const originalFirst of [false, true])
    test(`${parent}: grouped Body and source list conversions undo order=${originalFirst}`, () => {
      const auth = fixture(parent, "list", true);
      auth.accept(convert(auth, parent, ["a", "image", "b"], "paragraph"));
      const undoSources = () => {
        auth.accept(op("seed", 3, { kind: "undo", target: "seed:sections:1" }));
        auth.accept(op("seed", 4, { kind: "undo", target: "seed:sections:2" }));
      };
      if (originalFirst) {
        undoSources();
        assert.deepEqual(content(auth, parent), [
          ["paragraph", "Alpha\nline"],
          ["image", "image"],
          ["paragraph", "Beta"],
        ]);
      }
      auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
      if (!originalFirst) undoSources();
      const view = documentView(auth.state);
      assert.deepEqual(view.node(parent).children, ["list"]);
      assert.deepEqual(
        view.listMarkers("list").map((m) => m.number),
        [1, 2],
      );
    });
const corruptions = {
  duplicate: (i) => i.parts.push(structuredClone(i.parts[0])),
  reversed: (i) => i.parts.reverse(),
  wrongTarget: (i) => (i.parts[1].target = "code"),
  wrongParent: (i) => (i.parts[1].parent = "unavailable"),
  missingImage: (i) => (i.preserved = []),
  repeatedImage: (i) => i.preserved.push(structuredClone(i.preserved[0])),
  mergedBlocks: (i) => {
    i.parts[0].windows.push(...i.parts[1].windows);
    i.parts.pop();
  },
  unknownField: (i) => (i.unreviewed = true),
};
for (const parent of ["doc", "cell"])
  for (const [name, corrupt] of Object.entries(corruptions))
    test(`${parent}: malformed multi-Body ${name} rejects atomically`, () => {
      const auth = fixture(parent, "list", true),
        command = convert(auth, parent, ["a", "image", "b"], "paragraph");
      corrupt(command.intent);
      const room = new Room(auth.state),
        before = structuredClone(room.record.state),
        receipt = room.accept(command);
      assert.equal(receipt.outcome, "rejected");
      assert.deepEqual(room.record.state, before);
    });
for (const parent of ["doc", "cell"])
  for (const kind of ["native", "prose"])
    test(`${parent}/${kind}: existing formatted Body between codes remains unchanged`, () => {
      const auth = fixture(parent, kind, "body"),
        before = documentView(auth.state).text("image");
      auth.accept(convert(auth, parent, ["a", "image", "b"], "paragraph"));
      assert.deepEqual(content(auth, parent), [
        ["paragraph", "Alpha\nline"],
        ["paragraph", "Keep bold"],
        ["paragraph", "Beta"],
      ]);
      assert.deepEqual(documentView(auth.state).text("image"), before);
      auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
      assert.deepEqual(documentView(auth.state).text("image"), before);
      assert.deepEqual(content(auth, parent), [
        ["code", "Alpha\nline", "python"],
        ["paragraph", "Keep bold"],
        ["code", "Beta", "sql"],
      ]);
    });
