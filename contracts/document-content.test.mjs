// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  captureBodyContent,
  createBodyContent,
} from "@cwhy/jade-core/document-content";
import { tableFixture } from "@cwhy/jade-testkit/table-fixture";
import { listFixture } from "@cwhy/jade-testkit/list-fixture";
import { seed, text, gapAt } from "@cwhy/jade-core/model";
import { apply } from "@cwhy/jade-core/admission";
import { listMarkers } from "@cwhy/jade-core/list-marker";
const envelope = (state, intent, seq = 1) => ({
  id: `A:s:${seq}`,
  actor: "A",
  stream: "s",
  seq,
  epoch: state.epoch,
  modelVersion: 2,
  intent,
});
const edit = (state, intent, seq = 1) =>
  apply(state, envelope(state, intent, seq));
const semantic = (body) =>
  JSON.stringify(body.root, (key, value) =>
    key === "sourceId" ? undefined : value,
  );
test("whole rich body copies exact visible content with fresh identities and no operational history", () => {
  let source = tableFixture();
  source = edit(source, {
    kind: "insert",
    at: gapAt(source, "first", 2),
    text: "😀 中\n",
    marks: [
      { type: "strong" },
      { type: "highlight", attrs: { color: "yellow" } },
    ],
  });
  const original = structuredClone(source),
    body = captureBodyContent(source),
    copy = createBodyContent(body, { namespace: "copy-one" });
  assert.equal(semantic(captureBodyContent(copy.state)), semantic(body));
  assert.deepEqual(source, original);
  assert.deepEqual(copy.state.effects, {});
  assert.equal(copy.state.revision, 0);
  assert.equal(copy.state.epoch, 1);
  assert.deepEqual(body.assets, ["fixture.png"]);
  const sourceIds = new Set(
    Object.values(source.nodes)
      .filter((n) => n.text)
      .flatMap((n) => text(source, n.id).map((a) => a.id)),
  );
  for (const node of Object.values(copy.state.nodes)) {
    assert.equal(!!source.nodes[node.id], false);
    if (node.text)
      for (const atom of text(copy.state, node.id))
        assert.equal(sourceIds.has(atom.id), false);
  }
});
test("literal code text is not normalized through a clipboard representation", () => {
  const source = seed(
    {
      doc: { id: "doc", type: "doc", live: true, children: ["code"] },
      code: { id: "code", type: "code", live: true, language: "typescript" },
    },
    { code: [{ text: "const x = `a`;\r\n\t你好\n", marks: [] }] },
  );
  const body = captureBodyContent(source),
    copy = createBodyContent(body, { namespace: "literal" });
  assert.equal(
    text(copy.state, copy.mapping.code)
      .map((a) => a.char)
      .join(""),
    "const x = `a`;\r\n\t你好\n",
  );
});
test("copy refuses incomplete images and malformed portable fields", () => {
  const source = tableFixture();
  delete source.nodes.image.asset;
  assert.throws(() => captureBodyContent(source));
  const body = structuredClone(captureBodyContent(tableFixture()));
  body.root.attrs.effects = {};
  assert.throws(
    () => createBodyContent(body, { namespace: "invalid" }),
    /attributes/,
  );
  const changed = structuredClone(captureBodyContent(tableFixture()));
  changed.assets = [];
  assert.throws(
    () => createBodyContent(changed, { namespace: "invalid" }),
    /inventory/,
  );
});
test("new namespace must not reuse visible source IDs", () => {
  const body = captureBodyContent(tableFixture()),
    first = createBodyContent(body, { namespace: "same" });
  assert.throws(
    () =>
      createBodyContent(captureBodyContent(first.state), { namespace: "same" }),
    /reuses/,
  );
});

const { captureRange } = await import("@cwhy/jade-core/selection");
const { planEnter } = await import("@cwhy/jade-core/commands");
for (const explicit of [false, true])
  test(`copy preserves ${explicit ? "explicit" : "inherited"} marker behavior for Enter before a nested list`, () => {
    let source = structuredClone(listFixture({ parent: true, rich: true }));
    if (explicit) source.nodes.a.markerBase = "ordered_list";
    const copy = createBodyContent(captureBodyContent(source), {
      namespace: explicit ? "explicit" : "inherited",
    });
    const insert = (state, block) => {
      const point = { block, offset: 2 };
      return planEnter(
        state,
        captureRange(state, point, point),
        envelope(state),
      ).state;
    };
    const originalNext = insert(source, "ap"),
      copyNext = insert(copy.state, copy.mapping.ap);
    assert.equal(
      semantic(captureBodyContent(copyNext)),
      semantic(captureBodyContent(originalNext)),
    );
  });
test("mixed list marker baselines and restart numbers survive without source contributions", () => {
  const source = structuredClone(listFixture({ cell: true, parent: true }));
  source.nodes.b.markerBase = "bullet_list";
  source.nodes.cp.listStartLayers = [
    { id: "old-restart", value: 9, active: true },
  ];
  source.nodes.list.order = 3;
  const copy = createBodyContent(captureBodyContent(source), {
    namespace: "numbered",
  });
  assert.deepEqual(
    listMarkers(copy.state, copy.mapping.list).map(
      ({ id, ...marker }) => marker,
    ),
    listMarkers(source, "list").map(({ id, ...marker }) => marker),
  );
  assert.equal(copy.state.nodes[copy.mapping.cp].listStartLayers[0].value, 9);
  assert.notEqual(
    copy.state.nodes[copy.mapping.cp].listStartLayers[0].id,
    "old-restart",
  );
  assert.deepEqual(copy.state.effects, {});
});
test("whole-body copy exceeds clipboard top-level limits without flattening structure", () => {
  const nodes = { doc: { id: "doc", type: "doc", live: true, children: [] } },
    contents = {};
  for (let i = 0; i < 120; i++) {
    const id = "p" + i;
    nodes.doc.children.push(id);
    nodes[id] = { id, type: "paragraph", live: true };
    contents[id] = [{ text: "Line " + i, marks: [] }];
  }
  const source = seed(nodes, contents),
    copy = createBodyContent(captureBodyContent(source), { namespace: "long" });
  assert.equal(copy.state.nodes[copy.state.root].children.length, 120);
  assert.equal(
    semantic(captureBodyContent(copy.state)),
    semantic(captureBodyContent(source)),
  );
});
test("copy rejects executable links and accidental source ledger fields", () => {
  const body = structuredClone(captureBodyContent(tableFixture())),
    paragraph = body.root.children[0].children[0].children[0].children[0];
  paragraph.content[0].marks = [
    { type: "link", attrs: { href: "javascript:alert(1)" } },
  ];
  assert.throws(
    () => createBodyContent(body, { namespace: "badlink" }),
    /Unsafe/,
  );
});

test("paragraph and item marker precedence survive as fresh baselines", () => {
  const source = structuredClone(listFixture({ parent: true }));
  source.nodes.ap.listMarkerBase = "bullet_list";
  source.nodes.a.markerLayers = [
    { id: "source-item-style", type: "ordered_list", active: true },
  ];
  source.nodes.cp.markerLayers = [
    { id: "source-inactive", type: "ordered_list", active: false },
    { id: "source-paragraph-style", type: "bullet_list", active: true },
  ];
  const copy = createBodyContent(captureBodyContent(source), {
    namespace: "scoped",
  });
  assert.deepEqual(
    listMarkers(copy.state, copy.mapping.list).map(({ id, ...x }) => x),
    listMarkers(source, "list").map(({ id, ...x }) => x),
  );
  assert.equal(copy.state.nodes[copy.mapping.ap].listMarkerBase, "bullet_list");
  assert.equal(
    copy.state.nodes[copy.mapping.a].markerLayers[0].type,
    "ordered_list",
  );
  assert.equal(copy.state.nodes[copy.mapping.cp].markerLayers.length, 1);
  assert.equal(JSON.stringify(copy.state).includes("source-item-style"), false);
});

test("copy starts a new Undo boundary and excludes source named fields and deleted text", () => {
  let source = tableFixture();
  source = edit(source, {
    kind: "textFieldCreate",
    name: "title",
    text: "Private original title",
  });
  source = edit(
    source,
    {
      kind: "delete",
      ids: text(source, "first")
        .slice(0, 2)
        .map((a) => a.id),
    },
    2,
  );
  const body = captureBodyContent(source),
    copy = createBodyContent(body, { namespace: "private" }),
    block = copy.mapping.first;
  assert.equal(copy.state.nodes[copy.state.root].fields, undefined);
  assert.equal(
    JSON.stringify(copy.state).includes("Private original title"),
    false,
  );
  assert.deepEqual(copy.state.effects, {});
  const next = edit(copy.state, {
    kind: "insert",
    at: gapAt(copy.state, block, 0),
    text: "NEW",
    marks: [],
  });
  const undone = edit(next, { kind: "undo", target: "A:s:1" }, 2);
  assert.equal(semantic(captureBodyContent(undone)), semantic(body));
});
test("copy preserves visible table geometry, cell styles and image presentation", () => {
  const source = tableFixture(),
    table = Object.values(source.nodes).find((n) => n.type === "table"),
    row = Object.values(source.nodes).find((n) => n.type === "row"),
    cell = Object.values(source.nodes).find((n) => n.type === "cell");
  table.headerRow = true;
  row.minHeight = 140;
  cell.background = "#112233";
  cell.verticalAlign = "middle";
  cell.textAlign = "right";
  source.nodes.image.alt = "Mock screenshot";
  source.nodes.image.width = 640;
  source.nodes.image.height = 480;
  source.nodes.image.displayWidth = 320;
  const copy = createBodyContent(captureBodyContent(source), {
    namespace: "geometry",
  });
  assert.equal(copy.state.nodes[copy.mapping[table.id]].headerRow, true);
  assert.equal(copy.state.nodes[copy.mapping[row.id]].minHeight, 140);
  assert.deepEqual(
    copy.state.nodes[copy.mapping[cell.id]].colwidth,
    cell.colwidth,
  );
  assert.equal(copy.state.nodes[copy.mapping[cell.id]].background, "#112233");
  assert.equal(copy.state.nodes[copy.mapping.image].displayWidth, 320);
  assert.equal(copy.state.nodes[copy.mapping.image].alt, "Mock screenshot");
});
