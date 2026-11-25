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
function fixture(parent, kind, image, options = {}) {
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
        order: options.start || 1,
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
  if (options.restartSecond)
    nodes.b.listStartLayers = [
      { id: "original-restart", value: 20, active: true },
    ];
  let room = new Room(
      seed(nodes, {
        a: [{ text: options.empty === "a" ? "" : "Alpha\nline" }],
        b: [{ text: options.empty === "b" ? "" : "Beta" }],
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
      [1, options.reverse ? "b" : "a"],
      [2, options.reverse ? "a" : "b"],
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
import { captureRange } from "@cwhy/jade-core/selection";
import { planDelete, planReplace } from "@cwhy/jade-core/commands";
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
const removeSeam = (auth) =>
  op(
    "delete",
    1,
    planDelete(
      auth.state,
      captureRange(
        auth.state,
        { block: "a", offset: 10 },
        { block: "a", offset: 10 },
      ),
      "forward",
      op("delete", 1),
    ).intent,
  );
for (const parent of ["doc", "cell"])
  for (const early of [false, true])
    for (const deletionFirst of [false, true])
      test(`${parent}: joined original claims mergeEarly=${!early} deletionUndoFirst=${deletionFirst}`, () => {
        const auth = fixture(parent, "list", false),
          anchor = anchorAt(auth.initial, "b", 0, 4),
          expectedIds = text(auth.initial, "b").map((a) => a.id);
        auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
        const merge = convert(auth, parent, ["a", "b"], "code", "merge", 1),
          typing = op("peer", 1, {
            kind: "insert",
            at: gapAt(auth.state, "b", 2),
            text: "X",
          });
        if (early)
          auth.accept(
            op("delete", 1, {
              kind: "listJoin",
              target: { id: "seed:b", right: "b", creator: null },
            }),
          );
        auth.accept(merge);
        if (!early) auth.accept(removeSeam(auth));
        auth.accept(typing);
        assert.deepEqual(content(auth, parent), [
          ["code", "Alpha\nlineBeXta", "plaintext"],
        ]);
        assert.deepEqual(outsideNumbers(auth, parent), [3]);
        const checkAnchor = () => {
          const resolved = resolveAnchor(auth.state, anchor);
          assert.equal(resolved.status, "exact");
          assert.deepEqual(
            resolved.segments
              .filter((a) => expectedIds.includes(a.id))
              .map((a) => a.id),
            expectedIds,
          );
        };
        checkAnchor();
        const order = deletionFirst ? ["delete", "merge"] : ["merge", "delete"];
        for (const actor of order) {
          auth.accept(
            op(actor, 2, { kind: "undo", target: actor + ":sections:1" }),
          );
          checkAnchor();
          assert.deepEqual(outsideNumbers(auth, parent), [3]);
          if (actor === order[0])
            assert.deepEqual(
              content(auth, parent),
              deletionFirst
                ? [["code", "Alpha\nline\nBeXta", "plaintext"]]
                : [["paragraph", "Alpha\nlineBeXta"]],
            );
        }
        assert.deepEqual(content(auth, parent), [
          ["paragraph", "Alpha\nline"],
          ["paragraph", "BeXta"],
        ]);
        for (const actor of [...order].reverse())
          auth.accept(
            op(actor, 3, { kind: "undo", target: actor + ":sections:2" }),
          );
        assert.deepEqual(content(auth, parent), [
          ["code", "Alpha\nlineBeXta", "plaintext"],
        ]);
        checkAnchor();
      });
for (const parent of ["doc", "cell"])
  test(`${parent}: scoped original styles retain their boundary without losing the peer deletion`, () => {
    const auth = fixture(parent, "list", false);
    auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
    auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
    auth.accept(removeSeam(auth));
    auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
    assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nlineBeta"]]);
    auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
    assert.deepEqual(content(auth, parent), [
      ["code", "Alpha\nline", "python"],
      ["code", "Beta", "sql"],
    ]);
    assert.ok(
      Object.values(auth.state.listJoins["seed:b"].contributions).some(
        (c) => c.active,
      ),
    );
    assert.ok(!auth.state.joinProjection.some((p) => p.boundary === "seed:b"));
    auth.accept(op("body", 3, { kind: "undo", target: "body:sections:2" }));
    assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nlineBeta"]]);
    auth.accept(op("delete", 2, { kind: "undo", target: "delete:sections:1" }));
    assert.deepEqual(content(auth, parent), [
      ["paragraph", "Alpha\nline"],
      ["paragraph", "Beta"],
    ]);
    auth.accept(op("delete", 3, { kind: "undo", target: "delete:sections:2" }));
    assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nlineBeta"]]);
  });
for (const parent of ["doc", "cell"])
  test(`${parent}: joined Body can be edited and explicitly converted again without losing an original owner`, () => {
    const auth = fixture(parent, "list", false);
    auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
    auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
    auth.accept(removeSeam(auth));
    auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
    const range = captureRange(
      auth.state,
      { block: "a", offset: 12 },
      { block: "a", offset: 12 },
    );
    auth.accept(
      op(
        "peer",
        1,
        planReplace(
          auth.state,
          range,
          {
            version: 1,
            blocks: [
              { type: "paragraph", content: [{ text: "X", marks: [] }] },
            ],
          },
          op("peer", 1),
        ).intent,
      ),
    );
    auth.accept(convert(auth, parent, ["a"], "code", "again", 1));
    assert.deepEqual(content(auth, parent), [
      ["code", "Alpha\nlineBeXta", "plaintext"],
    ]);
    auth.accept(op("again", 2, { kind: "undo", target: "again:sections:1" }));
    assert.deepEqual(content(auth, parent), [
      ["paragraph", "Alpha\nlineBeXta"],
    ]);
    auth.accept(op("delete", 2, { kind: "undo", target: "delete:sections:1" }));
    assert.deepEqual(content(auth, parent), [
      ["paragraph", "Alpha\nline"],
      ["paragraph", "BeXta"],
    ]);
  });
for (const parent of ["doc", "cell"])
  for (const reverse of [false, true])
    test(`${parent}: joined numbering follows source order with reversed creation=${reverse}`, () => {
      const auth = fixture(parent, "list", false, {
        reverse,
        start: 7,
        restartSecond: true,
      });
      auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
      auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
      auth.accept(removeSeam(auth));
      assert.deepEqual(outsideNumbers(auth, parent), [21]);
      auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
      assert.deepEqual(outsideNumbers(auth, parent), [21]);
      auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
      assert.deepEqual(outsideNumbers(auth, parent), [21]);
    });
for (const parent of ["doc", "cell"])
  for (const first of [1, 2])
    test(`${parent}: three original claims survive chained joins and restore order=${first}`, () => {
      const auth = fixture(parent, "list", false);
      auth.accept(
        op(
          "seed",
          3,
          planListConversion(
            auth.state,
            previewListConversion(auth.state, parent, "list", {
              items: ["ic"],
            }),
            op("seed", 3),
          ).intent,
        ),
      );
      auth.accept(convert(auth, parent, ["a", "b", "c"], "paragraph"));
      auth.accept(convert(auth, parent, ["a", "b", "c"], "code", "merge", 1));
      auth.accept(removeSeam(auth));
      auth.accept(
        op(
          "delete",
          2,
          planDelete(
            auth.state,
            captureRange(
              auth.state,
              { block: "a", offset: 14 },
              { block: "a", offset: 14 },
            ),
            "forward",
            op("delete", 2),
          ).intent,
        ),
      );
      assert.deepEqual(content(auth, parent), [
        ["code", "Alpha\nlineBetaVerify", "plaintext"],
      ]);
      auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
      assert.deepEqual(content(auth, parent), [
        ["paragraph", "Alpha\nlineBetaVerify"],
      ]);
      auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
      assert.deepEqual(content(auth, parent), [
        ["code", "Alpha\nline", "python"],
        ["code", "Beta", "sql"],
        ["code", "Verify", "plaintext"],
      ]);
      auth.accept(op("body", 3, { kind: "undo", target: "body:sections:2" }));
      assert.deepEqual(content(auth, parent), [
        ["paragraph", "Alpha\nlineBetaVerify"],
      ]);
      auth.accept(
        op("delete", 3, { kind: "undo", target: "delete:sections:" + first }),
      );
      auth.accept(
        op("delete", 4, {
          kind: "undo",
          target: "delete:sections:" + (first === 1 ? 2 : 1),
        }),
      );
      assert.deepEqual(content(auth, parent), [
        ["paragraph", "Alpha\nline"],
        ["paragraph", "Beta"],
        ["paragraph", "Verify"],
      ]);
    });
for (const parent of ["doc", "cell"])
  for (const empty of ["a", "b"])
    test(`${parent}: empty source ${empty} retains delayed typing and original side`, () => {
      const auth = fixture(parent, "list", false, { empty }),
        value = empty === "a" ? "Beta" : "Alpha\nline",
        at = gapAt(auth.initial, empty, 0),
        seam = text(auth.initial, "a").length;
      auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
      auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
      auth.accept(
        op(
          "delete",
          1,
          planDelete(
            auth.state,
            captureRange(
              auth.state,
              { block: "a", offset: seam },
              { block: "a", offset: seam },
            ),
            "forward",
            op("delete", 1),
          ).intent,
        ),
      );
      auth.accept(op("peer", 1, { kind: "insert", at, text: "X" }));
      assert.deepEqual(content(auth, parent), [
        ["code", empty === "a" ? "X" + value : value + "X", "plaintext"],
      ]);
      auth.accept(op("merge", 2, { kind: "undo", target: "merge:sections:1" }));
      auth.accept(
        op("delete", 2, { kind: "undo", target: "delete:sections:1" }),
      );
      assert.deepEqual(content(auth, parent), [
        ["paragraph", empty === "a" ? "X" : "Alpha\nline"],
        ["paragraph", empty === "b" ? "X" : "Beta"],
      ]);
      assert.deepEqual(outsideNumbers(auth, parent), [3]);
    });
for (const parent of ["doc", "cell"])
  for (const selected of ["a", "b"])
    test(`${parent}: delayed conversion of only ${selected} keeps formatting scope after a peer join`, () => {
      const auth = fixture(parent, "list", false);
      auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
      const selectedIds = text(auth.state, selected).map((a) => a.id),
        other = selected === "a" ? "b" : "a",
        otherIds = text(auth.state, other).map((a) => a.id);
      auth.accept(
        op("marks", 1, {
          kind: "format",
          ids: selectedIds,
          property: "strong",
          value: "strong",
        }),
      );
      auth.accept(
        op("marks", 2, {
          kind: "format",
          ids: otherIds,
          property: "em",
          value: "em",
        }),
      );
      const preview = previewConversion(auth.state, parent, [selected], "code"),
        command = op(
          "style",
          1,
          planConversion(auth.state, preview, op("style", 1), {
            confirmLoss: true,
          }).intent,
        );
      auth.accept(
        op("delete", 1, {
          kind: "listJoin",
          target: { id: "seed:b", right: "b", creator: null },
        }),
      );
      auth.accept(command);
      assert.deepEqual(
        content(auth, parent),
        selected === "a"
          ? [
              ["code", "Alpha\nline", "python"],
              ["paragraph", "Beta"],
            ]
          : [
              ["paragraph", "Alpha\nline"],
              ["code", "Beta", "sql"],
            ],
      );
      assert.ok(
        documentView(auth.state)
          .text(other)
          .every((a) => a.marks.includes("em")),
      );
      assert.ok(
        documentView(auth.state)
          .text(selected)
          .every((a) => !a.marks.includes("strong")),
      );
      auth.accept(op("style", 2, { kind: "undo", target: "style:sections:1" }));
      assert.deepEqual(content(auth, parent), [
        ["paragraph", "Alpha\nlineBeta"],
      ]);
      const atoms = documentView(auth.state).text("a");
      assert.ok(
        atoms
          .filter((a) => selectedIds.includes(a.id))
          .every((a) => a.marks.includes("strong")),
      );
      assert.ok(
        atoms
          .filter((a) => otherIds.includes(a.id))
          .every((a) => a.marks.includes("em")),
      );
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: releasing every conversion leaves only the peer-owned list join`, () => {
    const auth = fixture(parent, "list", false);
    auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
    auth.accept(convert(auth, parent, ["a", "b"], "code", "merge", 1));
    auth.accept(removeSeam(auth));
    for (const actor of ["merge", "body"])
      auth.accept(
        op(actor, 2, { kind: "undo", target: actor + ":sections:1" }),
      );
    auth.accept(op("seed", 3, { kind: "undo", target: "seed:sections:1" }));
    auth.accept(op("seed", 4, { kind: "undo", target: "seed:sections:2" }));
    let v = documentView(auth.state);
    assert.deepEqual(v.node(parent).children, ["list"]);
    assert.deepEqual(outsideNumbers(auth, parent), [1, 2]);
    assert.equal(
      v
        .text("a")
        .map((a) => a.char)
        .join(""),
      "Alpha\nlineBeta",
    );
    auth.accept(op("delete", 2, { kind: "undo", target: "delete:sections:1" }));
    v = documentView(auth.state);
    assert.deepEqual(outsideNumbers(auth, parent), [1, 2, 3]);
    assert.equal(
      v
        .text("a")
        .map((a) => a.char)
        .join(""),
      "Alpha\nline",
    );
    assert.equal(
      v
        .text("b")
        .map((a) => a.char)
        .join(""),
      "Beta",
    );
  });

for (const parent of ["doc", "cell"])
  for (const kind of ["list", "prose", "native"])
    for (const direction of ["forward", "backward"])
      test(`${parent}: keyboard ${direction} joins separate ${kind} converted Body and preserves peer Undo`, () => {
        const auth = fixture(parent, kind, false);
        auth.accept(convert(auth, parent, ["a", "b"], "paragraph"));
        const anchor = anchorAt(auth.state, "b", 0, 4);
        const point = { block: direction === "forward" ? "a" : "b", offset: direction === "forward" ? 10 : 0 };
        const planned = planDelete(auth.state, captureRange(auth.state, point, point), direction, op("delete", 1));
        assert.ok(planned.intent, "keyboard boundary must produce a join");
        auth.accept(op("delete", 1, planned.intent));
        assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nlineBeta"]]);
        assert.deepEqual(documentView(auth.state).resolveGap(planned.after), { block: "a", offset: 10 });
        assert.equal(resolveAnchor(auth.state, anchor).status, "exact");
        auth.accept(op("peer", 1, { kind: "insert", at: gapAt(auth.state, "a", 12), text: "X" }));
        auth.accept(op("delete", 2, { kind: "undo", target: "delete:sections:1" }));
        assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nline"], ["paragraph", "BeXta"]]);
        auth.accept(op("delete", 3, { kind: "undo", target: "delete:sections:2" }));
        assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nlineBeXta"]]);
        auth.accept(op("body", 2, { kind: "undo", target: "body:sections:1" }));
        assert.deepEqual(content(auth, parent), [["code", "Alpha\nline", "python"], ["code", "BeXta", "sql"]]);
        auth.accept(op("body", 3, { kind: "undo", target: "body:sections:2" }));
        assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nlineBeXta"]]);
      });

for (const parent of ["doc", "cell"])
  for (const kind of ["list", "native"])
    for (const direction of ["forward", "backward"])
      test(`${parent}: Body ${direction} never crosses the retained image in ${kind}`, () => {
        const auth = fixture(parent, kind, true);
        auth.accept(convert(auth, parent, ["a", "image", "b"], "paragraph"));
        const point = { block: direction === "forward" ? "a" : "b", offset: direction === "forward" ? 10 : 0 };
        const planned = planDelete(auth.state, captureRange(auth.state, point, point), direction, op("delete", 1));
        assert.equal(planned.intent, null);
        assert.equal(planned.state, auth.state);
        assert.deepEqual(content(auth, parent), [["paragraph", "Alpha\nline"], ["image", "image"], ["paragraph", "Beta"]]);
      });
