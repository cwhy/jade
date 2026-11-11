// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  executeTree,
  treeParent,
  withTreeParents,
  withTreeProjection,
} from "../packages/document-core/src/model/tree.js";
import { immutable } from "../packages/document-core/src/model/immutable.js";
const fixture = () => ({
  nodes: {
    doc: {
      id: "doc",
      type: "doc",
      live: true,
      children: ["list", "empty", "undefined"],
    },
    list: {
      id: "list",
      type: "ordered_list",
      live: true,
      children: ["a", "b"],
    },
    empty: { id: "empty", type: "bullet_list", live: true, children: [] },
    a: { id: "a", type: "list_item", live: true, children: ["p"] },
    b: { id: "b", type: "list_item", live: true, children: ["q"] },
    p: { id: "p", type: "paragraph", live: true },
    q: { id: "q", type: "paragraph", live: true },
    undefined: { id: "undefined", type: "paragraph", live: true },
  },
});
const exec = (s, i, id) =>
  executeTree(s, i, id, { write: () => s.nodes, fail: (m) => Error(m) });
const oracle = (s, ids) => {
  for (const id of ids)
    assert.equal(
      treeParent(s, id)?.id,
      Object.values(s.nodes).find((n) => n.live && n.children?.includes(id))
        ?.id,
      id,
    );
};
function exercise(s) {
  const events = [],
    ids = Object.keys(s.nodes);
  const run = (i, id) => {
    const inverse = exec(s, i, id);
    events.push({
      inverse: structuredClone(inverse),
      nodes: structuredClone(s.nodes),
    });
    oracle(s, ids);
    return inverse;
  };
  const wrap = run(
    {
      kind: "treeWrap",
      id: "nested",
      type: "bullet_list",
      nodes: ["b"],
      from: "list",
      expected: [null],
    },
    "wrap",
  );
  const place = run(
    {
      kind: "treePlace",
      node: "nested",
      from: "list",
      parent: "a",
      before: null,
      expected: "wrap",
    },
    "place",
  );
  const unwrap = run(
    { kind: "treeUnwrap", node: "nested", expected: "place" },
    "unwrap",
  );
  run(unwrap, "undo-unwrap");
  run(place, "undo-place");
  run(wrap, "undo-wrap");
  const prune = run(
    { kind: "treePrune", node: "empty", expected: null },
    "prune",
  );
  run(prune, "undo-prune");
  return events;
}
test("Scoped parent index matches scan-based operations and all returned inverses", () => {
  const ordinary = fixture(),
    indexed = fixture();
  const expected = exercise(ordinary),
    actual = withTreeParents(indexed, () => exercise(indexed));
  assert.deepEqual(actual, expected);
  assert.deepEqual(indexed, ordinary);
  oracle(indexed, Object.keys(indexed.nodes));
});
test("Nested scope reuses index; exception discards it before non-tree edits", () => {
  const s = fixture();
  assert.throws(
    () =>
      withTreeParents(s, () =>
        withTreeParents(s, () => {
          exec(
            s,
            {
              kind: "treePlace",
              node: "b",
              from: "list",
              parent: "empty",
              before: null,
              expected: null,
            },
            "move",
          );
          oracle(s, Object.keys(s.nodes));
          throw Error("stop");
        }),
      ),
    /stop/,
  );
  s.nodes.empty = { ...s.nodes.empty, children: [] };
  s.nodes.list = { ...s.nodes.list, children: ["a", "b"] };
  assert.equal(treeParent(s, "b").id, "list");
  assert.equal(treeParent(s, "doc"), undefined);
});
test("Planning overlay shadows frozen nodes without mutating the original", () => {
  const s = immutable(fixture()),
    before = JSON.stringify(s);
  withTreeParents(s, () =>
    withTreeProjection(s, (p) => {
      const inverse = exec(
        p,
        {
          kind: "treePlace",
          node: "b",
          from: "list",
          parent: "empty",
          before: null,
          expected: null,
        },
        "move",
      );
      assert.equal(treeParent(p, "b").id, "empty");
      assert.equal(treeParent(s, "b").id, "list");
      assert.deepEqual(s.nodes.list.children, ["a", "b"]);
      exec(p, inverse, "undo");
      assert.equal(treeParent(p, "b").id, "list");
    }),
  );
  assert.equal(JSON.stringify(s), before);
});
test("Failure in a planning overlay cannot escape into source nodes or parent index", () => {
  const s = immutable(fixture()),
    before = JSON.stringify(s);
  assert.throws(
    () =>
      withTreeParents(s, () =>
        withTreeProjection(s, (p) => {
          exec(
            p,
            {
              kind: "treePlace",
              node: "b",
              from: "list",
              parent: "empty",
              before: null,
              expected: null,
            },
            "move",
          );
          exec(
            p,
            {
              kind: "treePlace",
              node: "a",
              from: "list",
              parent: "a",
              before: null,
              expected: null,
            },
            "invalid",
          );
        }),
      ),
    /descendant/,
  );
  assert.equal(JSON.stringify(s), before);
  assert.equal(treeParent(s, "b").id, "list");
});

test("Nested planning forks inherit current placement and isolate their overrides", () => {
  const s = immutable(fixture()),
    before = JSON.stringify(s);
  withTreeParents(s, () =>
    withTreeProjection(s, (outer) => {
      exec(
        outer,
        {
          kind: "treePlace",
          node: "b",
          from: "list",
          parent: "empty",
          before: null,
          expected: null,
        },
        "outer",
      );
      withTreeProjection(outer, (inner) => {
        assert.equal(treeParent(inner, "b").id, "empty");
        exec(
          inner,
          {
            kind: "treePlace",
            node: "b",
            from: "empty",
            parent: "list",
            before: "a",
            expected: "outer",
          },
          "inner",
        );
        assert.equal(treeParent(inner, "b").id, "list");
        assert.equal(treeParent(outer, "b").id, "empty");
        assert.equal(treeParent(s, "b").id, "list");
        exec(
          inner,
          { kind: "treePrune", node: "empty", expected: null },
          "prune",
        );
        assert.equal(treeParent(inner, "empty"), undefined);
        assert.equal(treeParent(outer, "empty").id, "doc");
      });
      assert.equal(treeParent(outer, "b").id, "empty");
      assert.equal(treeParent(outer, "empty").id, "doc");
    }),
  );
  assert.equal(JSON.stringify(s), before);
});
