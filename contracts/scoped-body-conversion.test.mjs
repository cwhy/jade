// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { seed, gapAt } from "@cwhy/jade-core/model";
import {
  previewConversion,
  planConversion,
  previewListConversion,
  planListConversion,
} from "@cwhy/jade-core/conversion";
import { documentView } from "@cwhy/jade-core/document-read";
import { Room } from "@cwhy/jade-collaboration/room";
import { replay } from "@cwhy/jade-collaboration/replay";
const op = (actor, seq, intent) => ({
  id: `${actor}:reverse:${seq}`,
  actor,
  seq,
  intent,
  stream: "reverse",
  epoch: 1,
  modelVersion: 2,
});
function fixture(parent = "doc", image = false) {
  const nodes = {
    doc: { id: "doc", type: "doc", live: true, children: ["list"] },
    list: {
      id: "list",
      type: "ordered_list",
      live: true,
      children: ["item", "next"],
    },
    item: {
      id: "item",
      type: "list_item",
      live: true,
      children: ["a", ...(image ? ["image"] : []), "b"],
    },
    next: { id: "next", type: "list_item", live: true, children: ["c"] },
    a: { id: "a", type: "paragraph", live: true },
    b: { id: "b", type: "paragraph", live: true },
    c: { id: "c", type: "paragraph", live: true },
  };
  if (image)
    nodes.image = { id: "image", type: "image", live: true, asset: "mock.png" };
  if (parent === "cell") {
    nodes.doc.children = ["table"];
    Object.assign(nodes, {
      table: { id: "table", type: "table", live: true, children: ["row"] },
      row: { id: "row", type: "row", live: true, children: ["cell"] },
      cell: { id: "cell", type: "cell", live: true, children: ["list"] },
    });
  }
  return seed(nodes, {
    a: [{ text: "Alpha" }],
    b: [{ text: "Beta" }],
    c: [{ text: "Verify" }],
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
const desc = (s, parent) => {
  const v = documentView(s);
  return v.node(parent).children.map((id) => {
    const n = v.node(id);
    return ["paragraph", "code"].includes(n.type)
      ? [
          n.type,
          v
            .text(id)
            .map((a) => a.char)
            .join(""),
        ]
      : [n.type, v.listMarkers(id).map((m) => m.number)];
  });
};
const convert = (s, parent, blocks, target, header) =>
  planConversion(s, previewConversion(s, parent, blocks, target), header, {
    confirmLoss: true,
  }).intent;
for (const parent of ["doc", "cell"])
  test(`${parent}: list code becomes one Body paragraph; independent peer typing and Undo survive`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["item"] }),
          op("a", 1),
        ).intent,
      ),
    );
    auth.accept(
      op(
        "b",
        1,
        convert(auth.state, parent, ["a", "b"], "paragraph", op("b", 1)),
      ),
    );
    assert.deepEqual(desc(auth.state, parent), [
      ["paragraph", "Alpha\nBeta"],
      ["ordered_list", [2]],
    ]);
    auth.accept(
      op("c", 1, { kind: "insert", at: gapAt(auth.state, "b", 2), text: "X" }),
    );
    auth.accept(op("b", 2, { kind: "undo", target: "b:reverse:1" }));
    assert.deepEqual(desc(auth.state, parent), [
      ["code", "Alpha\nBeXta"],
      ["ordered_list", [2]],
    ]);
    auth.accept(op("b", 3, { kind: "undo", target: "b:reverse:2" }));
    assert.deepEqual(desc(auth.state, parent), [
      ["paragraph", "Alpha\nBeXta"],
      ["ordered_list", [2]],
    ]);
  });
import { captureRange } from "@cwhy/jade-core/selection";
import { planEnter, planDelete } from "@cwhy/jade-core/commands";
import { planListEnter } from "@cwhy/jade-core/list-commands";
for (const parent of ["doc", "cell"])
  for (const originalFirst of [false, true])
    test(`${parent}: original conversion Undo first=${originalFirst} leaves independent Body ownership`, () => {
      const initial = fixture(parent),
        auth = authority(initial);
      auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list", { items: ["item"] }),
            op("a", 1),
          ).intent,
        ),
      );
      auth.accept(
        op(
          "b",
          1,
          convert(auth.state, parent, ["a", "b"], "paragraph", op("b", 1)),
        ),
      );
      for (const actor of originalFirst ? ["a", "b"] : ["b", "a"]) {
        auth.accept(
          op(actor, 2, { kind: "undo", target: `${actor}:reverse:1` }),
        );
        if (actor === "a" && originalFirst)
          assert.deepEqual(desc(auth.state, parent), [
            ["paragraph", "Alpha\nBeta"],
            ["ordered_list", [2]],
          ]);
      }
      assert.deepEqual(desc(auth.state, parent), [["ordered_list", [1, 2]]]);
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: repeated list/code/Body/code preserves exact content and one Undo per action`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["item"] }),
          op("a", 1),
        ).intent,
      ),
    );
    for (let seq = 2; seq <= 7; seq++) {
      const target = seq % 2 ? "code" : "paragraph";
      auth.accept(
        op(
          "a",
          seq,
          convert(auth.state, parent, ["a", "b"], target, op("a", seq)),
        ),
      );
      assert.deepEqual(desc(auth.state, parent), [
        [target, "Alpha\nBeta"],
        ["ordered_list", [2]],
      ]);
    }
    for (let seq = 8; seq <= 13; seq++) {
      auth.accept(
        op("a", seq, { kind: "undo", target: `a:reverse:${15 - seq}` }),
      );
      assert.deepEqual(desc(auth.state, parent), [
        [seq % 2 ? "code" : "paragraph", "Alpha\nBeta"],
        ["ordered_list", [2]],
      ]);
    }
  });
for (const parent of ["doc", "cell"])
  test(`${parent}: Enter in restored Body creates a Body paragraph and Undo restores one soft-break paragraph`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["item"] }),
          op("a", 1),
        ).intent,
      ),
    );
    auth.accept(
      op(
        "b",
        1,
        convert(auth.state, parent, ["a", "b"], "paragraph", op("b", 1)),
      ),
    );
    const range = captureRange(
      auth.state,
      { block: "a", offset: 2 },
      { block: "a", offset: 2 },
    );
    auth.accept(op("c", 1, planEnter(auth.state, range, op("c", 1)).intent));
    assert.deepEqual(desc(auth.state, parent), [
      ["paragraph", "Al"],
      ["paragraph", "pha\nBeta"],
      ["ordered_list", [2]],
    ]);
    auth.accept(op("c", 2, { kind: "undo", target: "c:reverse:1" }));
    assert.deepEqual(desc(auth.state, parent), [
      ["paragraph", "Alpha\nBeta"],
      ["ordered_list", [2]],
    ]);
  });
for (const parent of ["doc", "cell"])
  for (const offset of [0, 2, 7, 10])
    for (const bodyUndoFirst of [false, true])
      test(`${parent}: Body Enter at ${offset}, undo Body first=${bodyUndoFirst}`, () => {
        const initial = fixture(parent),
          auth = authority(initial);
        auth.accept(
          op(
            "a",
            1,
            planListConversion(
              initial,
              previewListConversion(initial, parent, "list", {
                items: ["item"],
              }),
              op("a", 1),
            ).intent,
          ),
        );
        auth.accept(
          op(
            "b",
            1,
            convert(auth.state, parent, ["a", "b"], "paragraph", op("b", 1)),
          ),
        );
        const range = captureRange(
          auth.state,
          { block: "a", offset },
          { block: "a", offset },
        );
        auth.accept(
          op("c", 1, planEnter(auth.state, range, op("c", 1)).intent),
        );
        const value = "Alpha\nBeta";
        assert.deepEqual(desc(auth.state, parent), [
          ["paragraph", value.slice(0, offset)],
          ["paragraph", value.slice(offset)],
          ["ordered_list", [2]],
        ]);
        for (const actor of bodyUndoFirst ? ["b", "c"] : ["c", "b"])
          auth.accept(
            op(actor, 2, { kind: "undo", target: `${actor}:reverse:1` }),
          );
        assert.deepEqual(desc(auth.state, parent), [
          ["code", "Alpha\nBeta"],
          ["ordered_list", [2]],
        ]);
      });
for (const parent of ["doc", "cell"])
  for (const early of [false, true])
    test(`${parent}: Body Enter survives original conversion Undo before delivery=${early}`, () => {
      const initial = fixture(parent),
        auth = authority(initial);
      auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list", { items: ["item"] }),
            op("a", 1),
          ).intent,
        ),
      );
      auth.accept(
        op(
          "b",
          1,
          convert(auth.state, parent, ["a", "b"], "paragraph", op("b", 1)),
        ),
      );
      const intent = planEnter(
        auth.state,
        captureRange(
          auth.state,
          { block: "a", offset: 2 },
          { block: "a", offset: 2 },
        ),
        op("c", 1),
      ).intent;
      if (early)
        auth.accept(op("a", 2, { kind: "undo", target: "a:reverse:1" }));
      auth.accept(op("c", 1, intent));
      if (!early)
        auth.accept(op("a", 2, { kind: "undo", target: "a:reverse:1" }));
      assert.deepEqual(desc(auth.state, parent), [
        ["paragraph", "Al"],
        ["paragraph", "pha\nBeta"],
        ["ordered_list", [2]],
      ]);
    });
for (const parent of ["doc", "cell"])
  test(`${parent}: reverse conversion rejects forged scope/basis and partial logical section without mutation`, () => {
    const initial = fixture(parent),
      auth = authority(initial);
    auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["item"] }),
          op("a", 1),
        ).intent,
      ),
    );
    const s = auth.state,
      intent = convert(s, parent, ["a", "b"], "paragraph", op("b", 1));
    assert.throws(
      () => convert(s, parent, ["a"], "paragraph", op("b", 1)),
      /complete converted section/,
    );
    for (const mutate of [
      (x) => (x.basis = "missing"),
      (x) => (x.scope = "missing"),
      (x) => (x.windows[0].source = "c"),
      (x) => (x.parent = "missing"),
      (x) => delete x.basis,
    ]) {
      const changed = structuredClone(intent);
      mutate(changed);
      const room = new Room(s),
        before = JSON.stringify(room.record.state);
      let receipt, error;
      try {
        receipt = room.accept(op("b", 1, changed));
      } catch (e) {
        error = e;
      }
      assert.ok(error || receipt?.outcome === "rejected");
      assert.equal(JSON.stringify(room.record.state), before);
    }
  });
for (const parent of ["doc", "cell"])
  test(`${parent}: Body conversion of one image-separated code section leaves the other code intact`, () => {
    const initial = fixture(parent, true),
      auth = authority(initial);
    auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list", { items: ["item"] }),
          op("a", 1),
        ).intent,
      ),
    );
    auth.accept(
      op("b", 1, convert(auth.state, parent, ["a"], "paragraph", op("b", 1))),
    );
    const v = documentView(auth.state);
    assert.deepEqual(v.node(parent).children.slice(0, 3), ["a", "image", "b"]);
    assert.equal(v.node("a").type, "paragraph");
    assert.equal(v.node("b").type, "code");
    // Undo of the Body action remains independent of original whole-item conversion.
    auth.accept(op("b", 2, { kind: "undo", target: "b:reverse:1" }));
    assert.equal(documentView(auth.state).node("a").type, "code");
  });
for (const parent of ["doc", "cell"])
  for (const undoFirst of [false, true])
    test(`${parent}: deleting a preserved soft break stays deleted through Body Undo first=${undoFirst}`, () => {
      const initial = fixture(parent),
        auth = authority(initial);
      auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list", { items: ["item"] }),
            op("a", 1),
          ).intent,
        ),
      );
      auth.accept(
        op(
          "b",
          1,
          convert(auth.state, parent, ["a", "b"], "paragraph", op("b", 1)),
        ),
      );
      const deletion = planDelete(
        auth.state,
        captureRange(
          auth.state,
          { block: "a", offset: 5 },
          { block: "a", offset: 5 },
        ),
        "forward",
        op("c", 1),
      );
      auth.accept(op("c", 1, deletion.intent));
      assert.deepEqual(desc(auth.state, parent), [
        ["paragraph", "AlphaBeta"],
        ["ordered_list", [2]],
      ]);
      for (const actor of undoFirst ? ["b", "c"] : ["c", "b"])
        auth.accept(
          op(actor, 2, { kind: "undo", target: `${actor}:reverse:1` }),
        );
      assert.deepEqual(desc(auth.state, parent), [
        ["code", "Alpha\nBeta"],
        ["ordered_list", [2]],
      ]);
    });

for (const parent of ["doc", "cell"])
  for (const originalFirst of [false, true])
    for (const peerBlock of ["a", "b"])
      test(`${parent}: confirmed whole-item retention, peer=${peerBlock}, original Undo first=${originalFirst}`, () => {
        const initial = fixture(parent, true),
          auth = authority(initial);
        auth.accept(
          op(
            "a",
            1,
            planListConversion(
              initial,
              previewListConversion(initial, parent, "list", {
                items: ["item"],
              }),
              op("a", 1),
            ).intent,
          ),
        );
        auth.accept(
          op(
            "b",
            1,
            convert(auth.state, parent, [peerBlock], "paragraph", op("b", 1)),
          ),
        );
        auth.accept(
          op("c", 1, {
            kind: "insert",
            at: gapAt(auth.state, "b", 2),
            text: "X",
          }),
        );
        for (const actor of originalFirst ? ["a", "b"] : ["b", "a"]) {
          auth.accept(
            op(actor, 2, { kind: "undo", target: `${actor}:reverse:1` }),
          );
          if (actor === "a" && originalFirst) {
            const v = documentView(auth.state);
            assert.deepEqual(v.node(parent).children.slice(0, 3), [
              "a",
              "image",
              "b",
            ]);
            assert.equal(v.node("a").type, "paragraph");
            assert.equal(v.node("b").type, "paragraph");
            assert.equal(
              v
                .text("b")
                .map((x) => x.char)
                .join(""),
              "BeXta",
            );
            assert.deepEqual(v.node("image"), initial.nodes.image);
            assert.deepEqual(
              v.listMarkers(v.node(parent).children[3]).map((m) => m.number),
              [2],
            );
          }
        }
        assert.deepEqual(desc(auth.state, parent), [["ordered_list", [1, 2]]]);
        auth.accept(op("b", 3, { kind: "undo", target: "b:reverse:2" }));
        assert.deepEqual(
          documentView(auth.state).node(parent).children.slice(0, 3),
          ["a", "image", "b"],
        );
        assert.equal(documentView(auth.state).node("a").type, "paragraph");
        assert.equal(documentView(auth.state).node("b").type, "paragraph");
        auth.accept(op("a", 3, { kind: "undo", target: "a:reverse:2" }));
        assert.equal(
          documentView(auth.state).node(peerBlock).type,
          "paragraph",
        );
        assert.equal(
          documentView(auth.state).node(peerBlock === "a" ? "b" : "a").type,
          "code",
        );
      });
for (const parent of ["doc", "cell"])
  test(`${parent}: retained item does not retain other items from the original conversion`, () => {
    const initial = fixture(parent, true),
      auth = authority(initial);
    auth.accept(
      op(
        "a",
        1,
        planListConversion(
          initial,
          previewListConversion(initial, parent, "list"),
          op("a", 1),
        ).intent,
      ),
    );
    auth.accept(
      op("b", 1, convert(auth.state, parent, ["a"], "paragraph", op("b", 1))),
    );
    auth.accept(op("a", 2, { kind: "undo", target: "a:reverse:1" }));
    const v = documentView(auth.state);
    assert.deepEqual(v.node(parent).children.slice(0, 3), ["a", "image", "b"]);
    assert.equal(v.node("a").type, "paragraph");
    assert.equal(v.node("b").type, "paragraph");
    assert.deepEqual(
      v.listMarkers(v.node(parent).children[3]).map((m) => m.number),
      [2],
    );
    assert.deepEqual(v.node(v.node(parent).children[3]).children, ["next"]);
    auth.accept(op("b", 2, { kind: "undo", target: "b:reverse:1" }));
    assert.deepEqual(desc(auth.state, parent), [["ordered_list", [1, 2]]]);
  });
for (const parent of ["doc", "cell"])
  for (const early of [false, true])
    test(`${parent}: peer Body conversion may arrive after original Undo=${early}`, () => {
      const initial = fixture(parent, true),
        auth = authority(initial);
      auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list", { items: ["item"] }),
            op("a", 1),
          ).intent,
        ),
      );
      const body = convert(auth.state, parent, ["a"], "paragraph", op("b", 1));
      if (early)
        auth.accept(op("a", 2, { kind: "undo", target: "a:reverse:1" }));
      auth.accept(op("b", 1, body));
      if (!early)
        auth.accept(op("a", 2, { kind: "undo", target: "a:reverse:1" }));
      const v = documentView(auth.state);
      assert.deepEqual(v.node(parent).children.slice(0, 3), [
        "a",
        "image",
        "b",
      ]);
      assert.equal(v.node("b").type, "paragraph");
      assert.deepEqual(
        v.listMarkers(v.node(parent).children[3]).map((m) => m.number),
        [2],
      );
    });
for (const parent of ["doc", "cell"])
  for (const first of ["b", "c"])
    test(`${parent}: two retaining peer conversions release only after both Undo; first=${first}`, () => {
      const initial = fixture(parent, true),
        auth = authority(initial);
      auth.accept(
        op(
          "a",
          1,
          planListConversion(
            initial,
            previewListConversion(initial, parent, "list", { items: ["item"] }),
            op("a", 1),
          ).intent,
        ),
      );
      auth.accept(
        op("b", 1, convert(auth.state, parent, ["a"], "paragraph", op("b", 1))),
      );
      auth.accept(
        op("c", 1, convert(auth.state, parent, ["b"], "paragraph", op("c", 1))),
      );
      auth.accept(op("a", 2, { kind: "undo", target: "a:reverse:1" }));
      auth.accept(op(first, 2, { kind: "undo", target: `${first}:reverse:1` }));
      assert.deepEqual(
        documentView(auth.state).node(parent).children.slice(0, 3),
        ["a", "image", "b"],
      );
      const last = first === "b" ? "c" : "b";
      auth.accept(op(last, 2, { kind: "undo", target: `${last}:reverse:1` }));
      assert.deepEqual(desc(auth.state, parent), [["ordered_list", [1, 2]]]);
    });
