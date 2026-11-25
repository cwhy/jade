// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  gapAt,
  text,
  anchorAt,
  resolveAnchor,
} from "@cwhy/jade-core/model";
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
        children: ["ia", "ib", "ic"],
      },
      ia: {
        id: "ia",
        type: "list_item",
        live: true,
        children: ["a", ...(image ? ["image"] : [])],
      },
      ib: { id: "ib", type: "list_item", live: true, children: ["b"] },
      ic: { id: "ic", type: "list_item", live: true, children: ["c"] },
      c: { id: "c", type: "paragraph", live: true },
    });
  }
  let room = new Room(
      seed(nodes, {
        a: [{ text: "Alpha\nline" }],
        b: [{ text: "Beta" }],
        ...(kind === "list" ? { c: [{ text: "Verify" }] } : {}),
        ...(image === "body"
          ? { image: [{ text: "Keep bold", marks: ["strong"] }] }
          : {}),
      }),
    ),
    journal = room.snapshot();
  const auth = {
    initial: room.record.state,
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
  return v
    .node(parent)
    .children.filter(
      (id) => !["ordered_list", "bullet_list"].includes(v.node(id).type),
    )
    .map((id) => {
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
  for (const peerFirst of [false, true])
    test(`${parent}: shared conversion preserves independent sources peerFirst=${peerFirst}`, () => {
      const auth = fixture(parent, "list", false);
      auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
      const merge = convert(auth, parent, ["a", "b"], "code", "merge", 1);
      const typing = op("peer", 1, {
        kind: "insert",
        at: gapAt(auth.state, "b", 2),
        text: "X",
      });
      for (const command of peerFirst ? [typing, merge] : [merge, typing])
        auth.accept(command);
      assert.deepEqual(content(auth, parent), [
        ["code", "Alpha\nline\nBeXta", "plaintext"],
      ]);
      auth.accept(op("seed", 3, { kind: "undo", target: "seed:sections:1" }));
      auth.accept(op("seed", 4, { kind: "undo", target: "seed:sections:2" }));
      auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
      assert.deepEqual(content(auth, parent), [
        ["code", "Alpha\nline\nBeXta", "plaintext"],
      ]);
      auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
      const v = documentView(auth.state);
      assert.deepEqual(v.node(parent).children, ["list"]);
      assert.deepEqual(
        v.listMarkers("list").map((m) => m.number),
        [1, 2, 3],
      );
    });
import { captureRange } from "@cwhy/jade-core/selection";
import { planListEnter } from "@cwhy/jade-core/list-commands";
const outsideNumbers = (auth, parent) => {
  const v = documentView(auth.state);
  return v
    .node(parent)
    .children.flatMap((id) =>
      ["ordered_list", "bullet_list"].includes(v.node(id).type)
        ? v.listMarkers(id).map((m) => m.number)
        : [],
    );
};
const orders = [
  ["seed", "body", "merge"],
  ["seed", "merge", "body"],
  ["body", "seed", "merge"],
  ["body", "merge", "seed"],
  ["merge", "seed", "body"],
  ["merge", "body", "seed"],
];
for (const parent of ["doc", "cell"])
  for (const order of orders)
    test(`${parent}: independent conversion Undo/Redo ${order.join("/")}`, () => {
      const auth = fixture(parent, "list", false);
      auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
      auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
      const active = new Set(["seed", "body", "merge"]);
      function check() {
        if (active.has("merge"))
          assert.deepEqual(content(auth, parent), [
            ["code", "Alpha\nline\nBeta", "plaintext"],
          ]);
        else if (active.has("body"))
          assert.deepEqual(content(auth, parent), [
            ["paragraph", "Alpha\nline"],
            ["paragraph", "Beta"],
          ]);
        else if (active.has("seed"))
          assert.deepEqual(content(auth, parent), [
            ["code", "Alpha\nline", "python"],
            ["code", "Beta", "sql"],
          ]);
        else
          assert.deepEqual(documentView(auth.state).node(parent).children, [
            "list",
          ]);
        assert.deepEqual(
          outsideNumbers(auth, parent),
          active.size ? [3] : [1, 2, 3],
        );
      }
      check();
      for (const actor of order) {
        if (actor === "seed") {
          auth.accept(
            op(actor, 3, { kind: "undo", target: "seed:sections:1" }),
          );
          auth.accept(
            op(actor, 4, { kind: "undo", target: "seed:sections:2" }),
          );
        } else
          auth.accept(
            op(actor, 2, { kind: "undo", target: actor + ":sections:1" }),
          );
        active.delete(actor);
        check();
      }
      for (const actor of [...order].reverse()) {
        if (actor === "seed") {
          auth.accept(
            op(actor, 5, { kind: "undo", target: "seed:sections:4" }),
          );
          auth.accept(
            op(actor, 6, { kind: "undo", target: "seed:sections:3" }),
          );
        } else
          auth.accept(
            op(actor, 3, { kind: "undo", target: actor + ":sections:2" }),
          );
        active.add(actor);
        check();
      }
    });
for (const parent of ["doc", "cell"])
  for (const early of [false, true])
    for (const at of [1, 2])
      test(`${parent}: offline original Enter offset=${at} beforeMerge=${early} preserves anchors and numbering`, () => {
        const auth = fixture(parent, "list", false),
          initial = auth.initial,
          anchor = anchorAt(initial, "b", 1, 3);
        const enter = op(
          "offline",
          1,
          planListEnter(
            initial,
            captureRange(
              initial,
              { block: "b", offset: at },
              { block: "b", offset: at },
            ),
            op("offline", 1),
          ).intent,
        );
        auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
        const merge = convert(auth, parent, ["a", "b"], "code", "merge", 1);
        for (const command of early ? [enter, merge] : [merge, enter])
          auth.accept(command);
        assert.deepEqual(content(auth, parent), [
          [
            "code",
            "Alpha\nline\n" + "Beta".slice(0, at) + "\n" + "Beta".slice(at),
            "plaintext",
          ],
        ]);
        assert.deepEqual(outsideNumbers(auth, parent), [3]);
        const resolved = resolveAnchor(auth.state, anchor);
        assert.equal(resolved.status, "exact");
        assert.deepEqual(
          resolved.segments.map((a) => [a.id, a.char]),
          text(initial, "b")
            .slice(1, 4)
            .map((a) => [a.id, a.char]),
        );
        auth.accept(
          op("offline", 2, { kind: "undo", target: "offline:sections:1" }),
        );
        assert.deepEqual(content(auth, parent), [
          ["code", "Alpha\nline\nBeta", "plaintext"],
        ]);
        assert.deepEqual(outsideNumbers(auth, parent), [3]);
      });
for (const parent of ["doc", "cell"])
  for (const early of [false, true])
    test(`${parent}: delayed source language beforeMerge=${early} stays a default under merged choice`, () => {
      const auth = fixture(parent, "list", false),
        sourceChoice = op(
          "language",
          3,
          planCodeLanguage(auth.state, "b", "python", op("language", 3)).intent,
        );
      auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
      const merge = convert(auth, parent, ["a", "b"], "code", "merge", 1);
      if (early) auth.accept(sourceChoice);
      auth.accept(merge);
      auth.accept(
        op(
          "explicit",
          1,
          planCodeLanguage(auth.state, "a", "javascript", op("explicit", 1))
            .intent,
        ),
      );
      if (!early) auth.accept(sourceChoice);
      assert.equal(content(auth, parent)[0][2], "javascript");
      auth.accept(
        op("explicit", 2, { kind: "undo", target: "explicit:sections:1" }),
      );
      assert.equal(content(auth, parent)[0][2], "python");
      auth.accept(
        op("language", 4, { kind: "undo", target: "language:sections:3" }),
      );
      assert.equal(content(auth, parent)[0][2], "plaintext");
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: merged code round trip retains shared source ownership and language`, () => {
    const auth = fixture(parent, "list", false);
    auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
    auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
    auth.accept(
      op(
        "explicit",
        1,
        planCodeLanguage(auth.state, "a", "javascript", op("explicit", 1))
          .intent,
      ),
    );
    auth.accept(convert(auth, parent, ["a", "b"], "paragraph", "roundtrip", 1));
    assert.deepEqual(content(auth, parent), [
      ["paragraph", "Alpha\nline\nBeta"],
    ]);
    auth.accept(convert(auth, parent, ["a", "b"], "code", "roundtrip", 2));
    auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
    assert.deepEqual(content(auth, parent), [
      ["code", "Alpha\nline\nBeta", "javascript"],
    ]);
    assert.deepEqual(outsideNumbers(auth, parent), [3]);
    auth.accept(
      op("explicit", 2, { kind: "undo", target: "explicit:sections:1" }),
    );
    assert.equal(content(auth, parent)[0][2], "plaintext");
  });
const malformedBases = {
  duplicate: (i) => i.bases.push(i.bases[0]),
  missing: (i) => (i.bases = ["absent", "also-absent"]),
  single: (i) => (i.bases = [i.bases[0]]),
  bothForms: (i) => (i.basis = i.bases[0]),
  wrongScope: (i) => (i.scope = "missing"),
  nested: (i) => (i.bases[0] = "body:sections:1:section:0"),
  empty: (i) => (i.bases = []),
  noSecondOwner: (i) => {
    i.basis = i.bases[0];
    delete i.bases;
  },
};
for (const parent of ["doc", "cell"])
  for (const [name, corrupt] of Object.entries(malformedBases))
    test(`${parent}: invalid shared ownership ${name} leaves document unchanged`, () => {
      const auth = fixture(parent, "list", false);
      auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
      const command = convert(auth, parent, ["a", "b"], "code", "merge", 1);
      corrupt(command.intent);
      const room = new Room(auth.state),
        before = structuredClone(room.record.state);
      let error, receipt;
      try {
        receipt = room.accept(command);
      } catch (e) {
        error = e;
      }
      assert.ok(error || receipt?.outcome === "rejected");
      assert.deepEqual(room.record.state, before);
    });
for (const parent of ["doc", "cell"])
  for (const peerFirst of [false, true])
    test(`${parent}: image separates independently owned code sections peerFirst=${peerFirst}`, () => {
      const auth = fixture(parent, "list", true);
      auth.accept(convert(auth, parent, ["a", "image", "b"], "paragraph"));
      const command = convert(
          auth,
          parent,
          ["a", "image", "b"],
          "code",
          "merge",
          1,
        ),
        typing = op("peer", 1, {
          kind: "insert",
          at: gapAt(auth.state, "b", 2),
          text: "X",
        });
      for (const step of peerFirst ? [typing, command] : [command, typing])
        auth.accept(step);
      assert.deepEqual(content(auth, parent), [
        ["code", "Alpha\nline", "python"],
        ["image", "image"],
        ["code", "BeXta", "sql"],
      ]);
      assert.deepEqual(outsideNumbers(auth, parent), [3]);
      auth.accept(op("seed", 3, { kind: "undo", target: "seed:sections:1" }));
      auth.accept(op("seed", 4, { kind: "undo", target: "seed:sections:2" }));
      auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
      assert.deepEqual(content(auth, parent), [
        ["code", "Alpha\nline", "python"],
        ["image", "image"],
        ["code", "BeXta", "sql"],
      ]);
      auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
      assert.deepEqual(documentView(auth.state).node(parent).children, [
        "list",
      ]);
      assert.deepEqual(outsideNumbers(auth, parent), [1, 2, 3]);
    });
import { planDelete } from "@cwhy/jade-core/commands";
for (const parent of ["doc", "cell"])
  test(`${parent}: deleting the shared separator preserves text and independent Undo`, () => {
    const auth = fixture(parent, "list", false);
    auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
    auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
    const deletion = planDelete(
      auth.state,
      captureRange(
        auth.state,
        { block: "a", offset: 10 },
        { block: "a", offset: 10 },
      ),
      "forward",
      op("delete", 1),
    );
    auth.accept(op("delete", 1, deletion.intent));
    assert.deepEqual(content(auth, parent), [
      ["code", "Alpha\nlineBeta", "plaintext"],
    ]);
    assert.deepEqual(outsideNumbers(auth, parent), [3]);
    auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
    assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nlineBeta"]]);
    auth.accept(op("delete", 2, { kind: "undo", target: "delete:sections:1" }));
    assert.deepEqual(content(auth, parent), [
      ["paragraph", "Alpha\nline"],
      ["paragraph", "Beta"],
    ]);
  });
