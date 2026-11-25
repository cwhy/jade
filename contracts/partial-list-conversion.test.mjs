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
import { captureRange } from "@cwhy/jade-core/selection";
import { planListEnter } from "@cwhy/jade-core/list-commands";
import {
  previewListConversion,
  planListConversion,
} from "@cwhy/jade-core/conversion";
import { documentView } from "@cwhy/jade-core/document-read";
import {
  captureBodyContent,
  createBodyContent,
} from "@cwhy/jade-core/document-content";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  id: `${actor}:partial:${seq}`,
  actor,
  seq,
  intent,
  stream: "partial",
  epoch: 1,
  modelVersion: 2,
});
function fixture(parent = "doc", type = "ordered_list", start = 1) {
  const nodes = {
      doc: { id: "doc", type: "doc", live: true, children: ["list"] },
      list: {
        id: "list",
        type,
        order: start,
        live: true,
        children: ["a", "b", "c", "d"],
      },
    },
    contents = {};
  for (const [id, value] of [
    ["a", "Setup"],
    ["b", "Example"],
    ["c", "Details"],
    ["d", "Verify"],
  ]) {
    nodes[id] = { id, type: "list_item", live: true, children: [id + "p"] };
    nodes[id + "p"] = { id: id + "p", type: "paragraph", live: true };
    contents[id + "p"] = [{ text: value, marks: ["strong"] }];
  }
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["list"] },
    });
  }
  return seed(nodes, contents);
}
function describe(state, parent) {
  const v = documentView(state);
  return v.node(parent).children.map((id) => {
    const n = v.node(id);
    return n.text
      ? [
          n.type,
          v
            .text(id)
            .map((a) => a.char)
            .join(""),
        ]
      : [n.type, v.listMarkers(id).map((m) => [m.id, m.number ?? null])];
  });
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
  for (const start of [1, 7])
    test(`${parent}: selected middle items become code while unselected numbers and identities remain`, () => {
      const initial = fixture(parent, "ordered_list", start),
        auth = authority(initial),
        before = JSON.stringify(initial),
        preview = previewListConversion(initial, parent, "list", {
          items: ["b", "c"],
        });
      assert.equal(JSON.stringify(initial), before);
      assert.equal(preview.loss.formattedCharacters, 14);
      let s = auth.accept(
        op(
          "a",
          1,
          planListConversion(initial, preview, op("a", 1), {
            confirmLoss: true,
          }).intent,
        ),
      );
      assert.deepEqual(describe(s, parent), [
        ["ordered_list", [["a", start]]],
        ["code", "Example\nDetails"],
        ["ordered_list", [["d", start + 3]]],
      ]);
      assert.deepEqual(text(s, "ap"), text(initial, "ap"));
      assert.deepEqual(text(s, "dp"), text(initial, "dp"));
      assert.deepEqual(s.nodes.list, initial.nodes.list);
      const v = documentView(s);
      assert.equal(v.parent("dp").id, "d");
      assert.equal(v.parent("d").order, start + 3);
      const body = captureBodyContent(s);
      assert.ok(body);
      const copy = createBodyContent(body, { namespace: "fresh" });
      assert.ok(copy);
      s = auth.accept(op("a", 2, { kind: "undo", target: "a:partial:1" }));
      assert.deepEqual(describe(s, parent), [
        [
          "ordered_list",
          [
            ["a", start],
            ["b", start + 1],
            ["c", start + 2],
            ["d", start + 3],
          ],
        ],
      ]);
      for (const id of ["ap", "bp", "cp", "dp"])
        assert.deepEqual(text(s, id), text(initial, id));
      s = auth.accept(op("a", 3, { kind: "undo", target: "a:partial:2" }));
      assert.equal(describe(s, parent)[2][1][0][1], start + 3);
    });

import { copyRange } from "@cwhy/jade-core/commands";
for (const parent of ["doc", "cell"])
  for (const type of ["ordered_list", "bullet_list"])
    for (const items of [
      ["a"],
      ["b"],
      ["d"],
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ])
      test(`${parent} ${type}: exact scope ${items.join(",")}`, () => {
        const initial = fixture(parent, type),
          auth = authority(initial);
        let s = auth.accept(
          op(
            "a",
            1,
            planListConversion(
              initial,
              previewListConversion(initial, parent, "list", { items }),
              op("a", 1),
              { confirmLoss: true },
            ).intent,
          ),
        );
        const v = documentView(s),
          selected = new Set(items.map((id) => id + "p"));
        assert.deepEqual(
          v.order.filter((id) => v.node(id).type === "code"),
          [items[0] + "p"],
        );
        assert.equal(
          v
            .text(items[0] + "p")
            .map((a) => a.char)
            .join(""),
          items
            .map((id) =>
              text(initial, id + "p")
                .map((a) => a.char)
                .join(""),
            )
            .join("\n"),
        );
        for (const id of ["ap", "bp", "cp", "dp"])
          if (!selected.has(id)) {
            assert.equal(v.node(id).type, "paragraph");
            assert.deepEqual(v.text(id), text(initial, id));
            assert.equal(v.parent(id).type, "list_item");
          }
        const copied = copyRange(
          s,
          captureRange(
            s,
            { block: v.order[0], offset: 0 },
            { block: v.order.at(-1), offset: v.length(v.order.at(-1)) },
          ),
        );
        assert.ok(copied);
        assert.ok(copied.plain.includes("Example"));
        assert.ok(copied.html.includes("<pre"));
        const body = captureBodyContent(s),
          copy = createBodyContent(body, { namespace: "copied" });
        const copiedView = documentView(copy.state);
        const starts = v
          .node(parent)
          .children.filter((id) => v.node(id).type === "ordered_list")
          .map((id) => v.listMarkers(id).map((m) => m.number));
        const copiedParent = copy.mapping[parent];
        assert.deepEqual(
          copiedView
            .node(copiedParent)
            .children.filter(
              (id) => copiedView.node(id).type === "ordered_list",
            )
            .map((id) => copiedView.listMarkers(id).map((m) => m.number)),
          starts,
        );
        s = auth.accept(op("a", 2, { kind: "undo", target: "a:partial:1" }));
        assert.deepEqual(s.nodes.list.children, initial.nodes.list.children);
        for (const id of ["ap", "bp", "cp", "dp"])
          assert.deepEqual(text(s, id), text(initial, id));
      });
for (const parent of ["doc", "cell"])
  for (const at of [0, 3, 7])
    for (const early of [false, true])
      for (const conversionFirst of [false, true])
        test(`${parent}: partial Enter@${at} early=${early} conversionUndoFirst=${conversionFirst}`, () => {
          const initial = fixture(parent),
            auth = authority(initial),
            anchor = anchorAt(initial, "bp", 1, 3),
            convert = op(
              "a",
              1,
              planListConversion(
                initial,
                previewListConversion(initial, parent, "list", {
                  items: ["b"],
                }),
                op("a", 1),
                { confirmLoss: true },
              ).intent,
            ),
            enter = op(
              "b",
              1,
              planListEnter(
                initial,
                captureRange(
                  initial,
                  { block: "bp", offset: at },
                  { block: "bp", offset: at },
                ),
                op("b", 1),
              ).intent,
            );
          let s;
          for (const command of early ? [enter, convert] : [convert, enter])
            s = auth.accept(command);
          assert.equal(
            documentView(s)
              .text("bp")
              .map((a) => a.char)
              .join(""),
            "Example".slice(0, at) + "\n" + "Example".slice(at),
          );
          assert.equal(documentView(s).node("ap").type, "paragraph");
          assert.equal(documentView(s).node("cp").type, "paragraph");
          assert.equal(resolveAnchor(s, anchor).status, "exact");
          const original = text(initial, "bp");
          assert.deepEqual(
            resolveAnchor(s, anchor).segments,
            original.slice(1, 4).map((a, i) => ({
              id: a.id,
              char: a.char,
              block: i + 1 < at ? "bp" : "b:partial:1:list-tail",
              offset: i + 1 < at ? i + 1 : i + 1 - at,
            })),
          );
          for (const actor of conversionFirst ? ["a", "b"] : ["b", "a"])
            s = auth.accept(
              op(actor, 2, { kind: "undo", target: `${actor}:partial:1` }),
            );
          assert.deepEqual(describe(s, parent), [
            [
              "ordered_list",
              [
                ["a", 1],
                ["b", 2],
                ["c", 3],
                ["d", 4],
              ],
            ],
          ]);
          assert.deepEqual(text(s, "bp"), text(initial, "bp"));
          for (const actor of ["a", "b"])
            s = auth.accept(
              op(actor, 3, { kind: "undo", target: `${actor}:partial:2` }),
            );
          assert.equal(
            documentView(s)
              .text("bp")
              .map((a) => a.char)
              .join(""),
            "Example".slice(0, at) + "\n" + "Example".slice(at),
          );
        });
for (const parent of ["doc", "cell"])
  for (const conversionFirst of [false, true])
    test(`${parent}: explicit peer numbering and conversion have independent Undo ${conversionFirst}`, () => {
      const initial = fixture(parent),
        auth = authority(initial);
      let s = auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list", { items: ["b"] }),
            op("a", 1),
            { confirmLoss: true },
          ).intent,
        ),
      );
      s = auth.accept(
        op("b", 1, { kind: "listNumbering", list: "list", start: 9 }),
      );
      assert.deepEqual(describe(s, parent), [
        ["ordered_list", [["a", 9]]],
        ["code", "Example"],
        [
          "ordered_list",
          [
            ["c", 11],
            ["d", 12],
          ],
        ],
      ]);
      for (const actor of conversionFirst ? ["a", "b"] : ["b", "a"])
        s = auth.accept(
          op(actor, 2, { kind: "undo", target: `${actor}:partial:1` }),
        );
      assert.deepEqual(describe(s, parent), [
        [
          "ordered_list",
          [
            ["a", 1],
            ["b", 2],
            ["c", 3],
            ["d", 4],
          ],
        ],
      ]);
    });

for (const parent of ["doc", "cell"])
  test(`${parent}: images and existing code outside the selected items keep their positions`, () => {
    let initial = fixture(parent);
    initial.nodes.b.children.push("image", "b2");
    initial.nodes.image = {
      id: "image",
      type: "image",
      asset: "mock.png",
      live: true,
    };
    initial.nodes.b2 = { id: "b2", type: "paragraph", live: true };
    initial.nodes.d.children.push("existing");
    initial.nodes.existing = {
      id: "existing",
      type: "code",
      language: "sql",
      live: true,
    };
    initial = seed(initial.nodes, {
      ap: [{ text: "Setup", marks: ["strong"] }],
      bp: [{ text: "Example" }],
      b2: [{ text: "After image" }],
      cp: [{ text: "Details" }],
      dp: [{ text: "Verify" }],
      existing: [{ text: "select 1;" }],
    });
    const auth = authority(initial),
      enter = op(
        "b",
        1,
        planListEnter(
          initial,
          captureRange(
            initial,
            { block: "bp", offset: 3 },
            { block: "bp", offset: 3 },
          ),
          op("b", 1),
        ).intent,
      );
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["b"] }),
          op("a", 1),
        ).intent,
      ),
    );
    s = auth.accept(enter);
    const v = documentView(s);
    assert.deepEqual(
      v.node(parent).children.map((id) => v.node(id).type),
      ["ordered_list", "code", "image", "code", "ordered_list"],
    );
    assert.equal(
      v
        .text("bp")
        .map((a) => a.char)
        .join(""),
      "Exa\nmple",
    );
    assert.equal(v.node("existing").language, "sql");
    assert.deepEqual(s.nodes.image, initial.nodes.image);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:partial:1" }));
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:partial:1" }));
    assert.deepEqual(s.nodes.b.children, ["bp", "image", "b2"]);
    assert.deepEqual(text(s, "bp"), text(initial, "bp"));
  });
for (const parent of ["doc", "cell"])
  test(`${parent}: explicit restart and mixed markers survive copy through virtual list runs`, () => {
    const initial = fixture(parent);
    initial.nodes.cp.listStartLayers = [
      { id: "original-start", value: 12, active: true },
    ];
    initial.nodes.d.markerBase = "bullet_list";
    const auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["b"] }),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    assert.deepEqual(describe(s, parent), [
      ["ordered_list", [["a", 1]]],
      ["code", "Example"],
      ["ordered_list", [["c", 12]]],
      ["bullet_list", [["d", null]]],
    ]);
    const body = captureBodyContent(s),
      copy = createBodyContent(body, { namespace: "mixed" });
    assert.deepEqual(
      describe(copy.state, copy.mapping[parent]).map(([kind, values]) => [
        kind,
        kind === "code" ? values : values.map((v) => v[1]),
      ]),
      [
        ["ordered_list", [1]],
        ["code", "Example"],
        ["ordered_list", [12]],
        ["bullet_list", [null]],
      ],
    );
    const copied = copyRange(
      s,
      captureRange(s, { block: "ap", offset: 0 }, { block: "dp", offset: 6 }),
    );
    assert.match(copied.html, /start="12"/);
    assert.match(copied.html, /<ul>/);
  });
for (const parent of ["doc", "cell"])
  test(`${parent}: separate conversions have stable source identities and independent Undo`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["b"] }),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    s = auth.accept(
      op(
        "b",
        1,
        planListConversion(
          s,
          previewListConversion(s, parent, "list", { items: ["d"] }),
          op("b", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    assert.deepEqual(describe(s, parent), [
      ["ordered_list", [["a", 1]]],
      ["code", "Example"],
      ["ordered_list", [["c", 3]]],
      ["code", "Verify"],
    ]);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:partial:1" }));
    assert.deepEqual(describe(s, parent), [
      [
        "ordered_list",
        [
          ["a", 1],
          ["b", 2],
          ["c", 3],
        ],
      ],
      ["code", "Verify"],
    ]);
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:partial:1" }));
    for (const id of ["ap", "bp", "cp", "dp"])
      assert.deepEqual(text(s, id), text(initial, id));
  });
import { apply } from "@cwhy/jade-core/admission";
test("partial admission rejects disjoint selection, reordered source, forged partial flags and mixed selected/unselected joins", () => {
  const initial = fixture();
  for (const items of [[], ["b", "b"], ["c", "b"], ["a", "d"], ["ap"]])
    assert.throws(() =>
      previewListConversion(initial, "doc", "list", { items }),
    );
  const intent = planListConversion(
    initial,
    previewListConversion(initial, "doc", "list", { items: ["b"] }),
    op("a", 1),
    { confirmLoss: true },
  ).intent;
  for (const forged of [
    { ...intent, partial: false },
    { ...intent, partial: "true" },
    { ...intent, parts: [...intent.parts, ...intent.parts] },
    { ...intent, scope: "b" },
  ])
    assert.throws(() => apply(initial, op("a", 1, forged)));
  const state = apply(initial, op("a", 1, intent)),
    before = JSON.stringify(state);
  assert.throws(
    () =>
      apply(
        state,
        op("b", 1, {
          kind: "listJoin",
          target: { id: "seed:bp", right: "bp", creator: null },
        }),
      ),
    /unselected joined source/,
  );
  assert.equal(JSON.stringify(state), before);
});

for (const parent of ["doc", "cell"])
  for (const at of [0, 3, 7])
    for (const early of [false, true])
      test(`${parent}: trailing paragraph stays independent during Enter@${at} early=${early}`, () => {
        let initial = fixture(parent);
        initial.nodes.b.children.push("tail");
        initial.nodes.tail = { id: "tail", type: "paragraph", live: true };
        initial = seed(initial.nodes, {
          ap: [{ text: "Setup" }],
          bp: [{ text: "Example" }],
          tail: [{ text: "Trailing", marks: ["em"] }],
          cp: [{ text: "Details" }],
          dp: [{ text: "Verify" }],
        });
        const auth = authority(initial),
          convert = op(
            "a",
            1,
            planListConversion(
              initial,
              previewListConversion(initial, parent, "list", { items: ["b"] }),
              op("a", 1),
              { confirmLoss: true },
            ).intent,
          ),
          enter = op(
            "b",
            1,
            planListEnter(
              initial,
              captureRange(
                initial,
                { block: "bp", offset: at },
                { block: "bp", offset: at },
              ),
              op("b", 1),
            ).intent,
          );
        let s;
        for (const command of early ? [enter, convert] : [convert, enter])
          s = auth.accept(command);
        const trailingIds = text(initial, "tail").map((a) => a.id);
        assert.deepEqual(
          text(s, "tail").map((a) => a.id),
          trailingIds,
        );
        s = auth.accept(
          op("c", 1, { kind: "insert", at: gapAt(s, "tail", 3), text: "同" }),
        );
        s = auth.accept(op("b", 2, { kind: "undo", target: "b:partial:1" }));
        assert.equal(
          documentView(s)
            .text("bp")
            .map((a) => a.char)
            .join(""),
          "Example\nTra同iling",
        );
        s = auth.accept(op("a", 2, { kind: "undo", target: "a:partial:1" }));
        assert.deepEqual(s.nodes.b.children, ["bp", "tail"]);
        assert.equal(
          text(s, "tail")
            .map((a) => a.char)
            .join(""),
          "Tra同iling",
        );
        s = auth.accept(op("c", 2, { kind: "undo", target: "c:partial:1" }));
        assert.deepEqual(text(s, "tail"), text(initial, "tail"));
      });

import { Client } from "@cwhy/jade-collaboration/client";
for (const parent of ["doc", "cell"])
  test(`${parent}: offline partial Enter/typing survives client reload and lost acknowledgement`, () => {
    const initial = fixture(parent),
      room = new Room(initial),
      peer = new Client("b", "partial", room.snapshot());
    peer.prepare(
      planListEnter(
        peer.state,
        captureRange(
          peer.state,
          { block: "bp", offset: 3 },
          { block: "bp", offset: 3 },
        ),
        op("b", 1),
      ).intent,
    );
    peer.prepare({
      kind: "insert",
      at: gapAt(peer.state, "b:partial:1:list-tail", 1),
      text: "同",
    });
    const convert = op(
      "a",
      1,
      planListConversion(
        initial,
        previewListConversion(initial, parent, "list", { items: ["b"] }),
        op("a", 1),
        { confirmLoss: true },
      ).intent,
    );
    assert.equal(room.accept(convert).outcome, "accepted");
    const saved = JSON.parse(JSON.stringify(peer.save())),
      restored = new Client("b", "partial", saved.base, saved);
    let server = new Room(null, JSON.parse(JSON.stringify(room.snapshot())));
    for (const pending of restored.pending) {
      const receipt = server.accept(pending);
      assert.equal(receipt.outcome, "accepted", receipt.reason);
      server = new Room(null, JSON.parse(JSON.stringify(server.snapshot())));
      assert.deepEqual(server.accept(pending), receipt);
    }
    restored.receive(server.snapshot());
    assert.equal(restored.pending.length, 0);
    assert.equal(
      documentView(restored.state)
        .text("bp")
        .map((a) => a.char)
        .join(""),
      "Exa\nm同ple",
    );
    assert.equal(documentView(restored.state).node("cp").type, "paragraph");
    assert.deepEqual(text(restored.state, "dp"), text(initial, "dp"));
  });

for (const parent of ["doc", "cell"])
  for (const early of [false, true])
    test(`${parent}: confirmed offline Enter inside code preserves outside numbering early=${early}`, () => {
      const initial = fixture(parent),
        auth = authority(initial),
        convert = op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list", { items: ["b"] }),
            op("a", 1),
            { confirmLoss: true },
          ).intent,
        ),
        enter = op(
          "b",
          1,
          planListEnter(
            initial,
            captureRange(
              initial,
              { block: "bp", offset: 3 },
              { block: "bp", offset: 3 },
            ),
            op("b", 1),
          ).intent,
        );
      let s;
      for (const command of early ? [enter, convert] : [convert, enter])
        s = auth.accept(command);
      assert.deepEqual(describe(s, parent), [
        ["ordered_list", [["a", 1]]],
        ["code", "Exa\nmple"],
        [
          "ordered_list",
          [
            ["c", 3],
            ["d", 4],
          ],
        ],
      ]);
      s = auth.accept(op("b", 2, { kind: "undo", target: "b:partial:1" }));
      assert.deepEqual(describe(s, parent), [
        ["ordered_list", [["a", 1]]],
        ["code", "Example"],
        [
          "ordered_list",
          [
            ["c", 3],
            ["d", 4],
          ],
        ],
      ]);
    });

for (const parent of ["doc", "cell"])
  test(`${parent}: conversion authored after a prior split keeps its captured marker slots through split Undo`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    let s = auth.accept(
      op(
        "b",
        1,
        planListEnter(
          initial,
          captureRange(
            initial,
            { block: "bp", offset: 3 },
            { block: "bp", offset: 3 },
          ),
          op("b", 1),
        ).intent,
      ),
    );
    const middle = s.nodes.list.children.slice(1, 3);
    s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          s,
          previewListConversion(s, parent, "list", { items: middle }),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    assert.deepEqual(describe(s, parent).at(-1), [
      "ordered_list",
      [
        ["c", 4],
        ["d", 5],
      ],
    ]);
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:partial:1" }));
    assert.equal(
      documentView(s)
        .text("bp")
        .map((a) => a.char)
        .join(""),
      "Example",
    );
    assert.deepEqual(describe(s, parent).at(-1), [
      "ordered_list",
      [
        ["c", 4],
        ["d", 5],
      ],
    ]);
    s = auth.accept(op("a", 2, { kind: "undo", target: "a:partial:1" }));
    assert.deepEqual(describe(s, parent), [
      [
        "ordered_list",
        [
          ["a", 1],
          ["b", 2],
          ["c", 3],
          ["d", 4],
        ],
      ],
    ]);
  });
for (const parent of ["doc", "cell"])
  test(`${parent}: visible Enter outside code still updates the actual numbered list`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    let s = auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["b"] }),
          op("a", 1),
          { confirmLoss: true },
        ).intent,
      ),
    );
    s = auth.accept(
      op(
        "b",
        1,
        planListEnter(
          s,
          captureRange(
            s,
            { block: "ap", offset: 2 },
            { block: "ap", offset: 2 },
          ),
          op("b", 1),
        ).intent,
      ),
    );
    assert.deepEqual(describe(s, parent).at(-1), [
      "ordered_list",
      [
        ["c", 4],
        ["d", 5],
      ],
    ]);
    s = auth.accept(op("b", 2, { kind: "undo", target: "b:partial:1" }));
    assert.deepEqual(describe(s, parent).at(-1), [
      "ordered_list",
      [
        ["c", 3],
        ["d", 4],
      ],
    ]);
  });
test("numbering basis rejects missing, duplicate, forged and stale slots; overlapping conversions reject atomically", () => {
  const initial = fixture(),
    intent = planListConversion(
      initial,
      previewListConversion(initial, "doc", "list", { items: ["b"] }),
      op("a", 1),
      { confirmLoss: true },
    ).intent;
  for (const numbering of [
    [],
    undefined,
    [...intent.numbering, ...intent.numbering],
    [{ ...intent.numbering[0], start: 0 }],
    [{ ...intent.numbering[0], block: "ap" }],
    [{ ...intent.numbering[0], type: "bullet_list" }],
  ])
    assert.throws(() => apply(initial, op("a", 1, { ...intent, numbering })));
  const s = apply(initial, op("a", 1, intent)),
    before = JSON.stringify(s);
  assert.throws(
    () =>
      planListConversion(
        s,
        previewListConversion(s, "doc", "list", { items: ["b", "c"] }),
        op("b", 1),
        { confirmLoss: true },
      ),
    /Overlapping/,
  );
  assert.equal(JSON.stringify(s), before);
});

import {planEnter,planDelete} from '@cwhy/jade-core/commands';
for(const parent of ['doc','cell'])test(`${parent}: logical newline deletion ignores virtual non-text list runs`,()=>{
 const initial=fixture(parent),auth=authority(initial);let s=auth.accept(op('a',1,planListConversion(initial,previewListConversion(initial,parent,'list',{items:['b']}),op('a',1),{confirmLoss:true}).intent));
 s=auth.accept(op('b',1,planEnter(s,captureRange(s,{block:'bp',offset:3},{block:'bp',offset:3}),op('b',1)).intent));assert.equal(documentView(s).text('bp').map(a=>a.char).join(''),'Exa\nmple');assert.deepEqual(describe(s,parent).at(-1),['ordered_list',[['c',3],['d',4]]]);
 s=auth.accept(op('b',2,planDelete(s,captureRange(s,{block:'bp',offset:4},{block:'bp',offset:4}),'backward',op('b',2)).intent));assert.equal(documentView(s).text('bp').map(a=>a.char).join(''),'Example');assert.deepEqual(describe(s,parent).at(-1),['ordered_list',[['c',3],['d',4]]]);
});
