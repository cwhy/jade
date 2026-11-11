// SPDX-License-Identifier: MPL-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  apply,
  gapAt,
  text,
  validate,
  findCharacter,
} from "../packages/document-core/src/model/engine.js";
import { immutable } from "../packages/document-core/src/model/immutable.js";
import {
  stage,
  writable,
  finish,
} from "../packages/document-core/src/model/draft.js";
import {
  validateChanged,
  validationStats,
} from "../packages/document-core/src/model/validation.js";
import {
  locations,
  ownershipStats,
} from "../packages/document-core/src/model/locations.js";
import { validateListFamilies } from "../packages/document-core/src/model/list-validation.js";

function fixture(count = 3) {
  const nodes = { doc: { id: "doc", type: "doc", live: true, children: [] } },
    contents = {};
  for (let i = 0; i < count; i++) {
    const id = "p" + i;
    nodes.doc.children.push(id);
    nodes[id] = { id, type: "paragraph", live: true };
    contents[id] = [{ text: i === 2 ? "" : "abcd", marks: ["strong"] }];
  }
  const s = immutable(seed(nodes, contents));
  return immutable(
    apply(s, {
      id: "warm",
      actor: "A",
      epoch: 1,
      intent: { kind: "insert", at: gapAt(s, "p0", 1), text: "W", marks: [] },
    }),
  );
}
function staged(base, edit) {
  const s = stage(base);
  edit(s);
  immutable(s.nodes);
  immutable(s.replicas);
  immutable(s.runs);
  return s;
}
function outcome(fn) {
  try {
    fn();
    return "valid";
  } catch {
    return "invalid";
  }
}
function oracle(s, expected) {
  // Fresh mutable decode bypasses both ownership and validator certificates.
  const complete = outcome(() => validate(structuredClone(s)));
  assert.equal(complete, expected);
  assert.equal(
    outcome(() => validateChanged(s, validate)),
    complete,
  );
  finish(s);
}
function replaceReplica(s, id, patch) {
  writable(s, "replicas")[id] = { ...s.replicas[id], ...patch };
}
const cases = [
  ["owner mismatch", (s) => replaceReplica(s, "seed:p0", { owner: "p1" })],
  ["retired live text", (s) => replaceReplica(s, "seed:p0", { retired: true })],
  ["missing live replica", (s) => delete writable(s, "replicas")["seed:p0"]],
  [
    "backing run removed while replica unchanged",
    (s) => delete writable(s, "runs")["seed:p1"],
  ],
  [
    "backing run shrunk while replica unchanged",
    (s) => {
      const r = s.runs["seed:p1"];
      writable(s, "runs")["seed:p1"] = {
        ...r,
        chars: ["a"],
        formats: [{ from: 0, length: 1, marks: [] }],
      };
    },
  ],
  [
    "invalid marks with unchanged backing length",
    (s) => {
      const r = s.runs["seed:p1"];
      writable(s, "runs")["seed:p1"] = { ...r, formats: [] };
    },
  ],
  [
    "undefined added run is not mistaken for an unchanged key",
    (s) => {
      writable(s, "runs").absent = undefined;
    },
  ],
  [
    "undefined added replica is rejected",
    (s) => {
      writable(s, "replicas").absent = undefined;
    },
  ],
  [
    "overlap with untouched owner",
    (s) =>
      replaceReplica(s, "seed:p0", {
        pieces: s.replicas["seed:p1"].pieces,
        length: 4,
      }),
  ],
  [
    "overlap inside changed owner",
    (s) => {
      const p = s.replicas["seed:p0"].pieces[0];
      replaceReplica(s, "seed:p0", { pieces: [p, p], length: p.length * 2 });
    },
  ],
  [
    "invalid backing slice",
    (s) =>
      replaceReplica(s, "seed:p0", {
        pieces: [{ run: "seed:p0", from: 100, length: 1 }],
        length: 1,
      }),
  ],
  ["length mismatch", (s) => replaceReplica(s, "seed:p0", { length: 42 })],
  [
    "new empty text without retained boundary",
    (s) => replaceReplica(s, "seed:p0", { pieces: [], length: 0 }),
  ],
  [
    "empty boundary removed with unchanged replica",
    (s) => delete writable(s, "boundaries")["seed:p2:empty"],
  ],
  [
    "boundary outside changed replica",
    (s) => {
      writable(s, "boundaries")["seed:p2:empty"] = {
        ...s.boundaries["seed:p2:empty"],
        offset: 1,
      };
    },
  ],
  [
    "orphan active replica",
    (s) => {
      writable(s, "replicas").extra = { ...s.replicas["seed:p1"], id: "extra" };
    },
  ],
  [
    "codec changed",
    (s) => {
      s.storageCodec = 9;
    },
  ],
  [
    "forest changed",
    (s) => {
      writable(s, "nodes").p1 = { ...s.nodes.p1, live: false };
    },
  ],
];
for (const [name, edit] of cases)
  test("differential invalidation: " + name, () =>
    oracle(staged(fixture(), edit), "invalid"),
  );

test("changed run marks retain ownership but resolve against current backing data", () => {
  const base = fixture(),
    old = locations(base);
  const s = staged(base, (s) => {
    const r = s.runs["seed:p1"];
    writable(s, "runs")["seed:p1"] = {
      ...r,
      formats: [{ from: 0, length: 4, marks: ["em"] }],
    };
  });
  oracle(s, "valid");
  assert.deepEqual(locations(s).get("seed:p1:0").atom.marks, ["em"]);
  assert.deepEqual(old.get("seed:p1:0").atom.marks, ["strong"]);
});
test("retired replica slices are still checked", () => {
  const base = fixture();
  const s = staged(base, (s) => {
    writable(s, "replicas").old = {
      id: "old",
      owner: "gone",
      retired: true,
      pieces: [{ run: "absent", from: 0, length: 1 }],
      length: 1,
    };
  });
  oracle(s, "invalid");
});
test("unvalidated immutable and mutable predecessors cannot certify an unchanged forest", () => {
  for (const seal of [(x) => x, immutable]) {
    const bad = structuredClone(fixture());
    bad.replicas["seed:p1"].owner = "wrong";
    const base = seal(bad);
    oracle(
      staged(base, () => {}),
      "invalid",
    );
  }
});
test("replacing a validated wrapper dependency before publication invalidates its certificate", () => {
  const base = fixture();
  const s = apply(base, {
    id: "wrapper",
    actor: "A",
    epoch: 1,
    intent: { kind: "insert", at: gapAt(base, "p0", 1), text: "X", marks: [] },
  });
  s.replicas = {
    ...s.replicas,
    "seed:p1": { ...s.replicas["seed:p1"], owner: "wrong" },
  };
  oracle(
    staged(immutable(s), () => {}),
    "invalid",
  );
});
test("mutable replica content after validation cannot change a certified dependency", () => {
  const base = fixture(),
    s = apply(base, {
      id: "seal",
      actor: "A",
      epoch: 1,
      intent: {
        kind: "insert",
        at: gapAt(base, "p0", 1),
        text: "X",
        marks: [],
      },
    });
  assert.throws(() => {
    s.replicas["seed:p0"].length = 999;
  }, TypeError);
  assert.throws(() => {
    s.boundaries["seed:p2:empty"].offset = 999;
  }, TypeError);
});
test("list-family certificate includes node and boundary references", () => {
  const family = {
    id: "f",
    source: "p",
    homeItem: "i",
    list: "l",
    rest: [],
    order: ["home", "c"],
    cuts: {
      c: { id: "c", active: true, block: "q", wrapper: "j", marker: "m" },
    },
    layout: { home: 0, blocks: ["p", "q"], parentItems: [], childItems: [] },
    placements: {},
  };
  const s = immutable({
    listFamilies: { f: family },
    nodes: { q: {}, j: {} },
    boundaries: { m: {} },
  });
  validateListFamilies(s);
  assert.throws(() =>
    validateListFamilies({ ...s, nodes: immutable({ j: {} }) }),
  );
  assert.throws(() =>
    validateListFamilies({ ...s, boundaries: immutable({}) }),
  );
});
test("sequential typing checks one changed replica and retains independent snapshot indexes", () => {
  let s = fixture(250);
  const original = s,
    old = locations(s),
    before = validationStats(),
    ranges = ownershipStats();
  for (let i = 0; i < 80; i++) {
    const next = immutable(
      apply(s, {
        id: "typing:" + i,
        actor: i % 2 ? "B" : "A",
        epoch: 1,
        intent: {
          kind: "insert",
          at: gapAt(s, "p0", i % 5),
          text: "中",
          marks: i % 2 ? ["em"] : [],
        },
      }),
    );
    validate(structuredClone(next));
    const index = locations(next);
    for (const atom of text(next, "p0"))
      assert.deepEqual(
        index.get(atom.id),
        findCharacter(structuredClone(next), atom.id),
      );
    s = next;
  }
  const after = validationStats(),
    indexed = ownershipStats();
  assert.equal(after.incremental - before.incremental, 80);
  assert.equal(after.replicaChecks - before.replicaChecks, 80);
  assert.equal(indexed.incremental - ranges.incremental, 80);
  assert.equal(old.get("seed:p0:0").offset, 0);
  assert.equal(text(original, "p0").length, 5);
  assert.equal(text(s, "p0").length, 85);
});
test("insert/delete/Undo, reload and structural split agree with the full oracle", () => {
  let s = fixture();
  let serial = 0;
  function run(intent) {
    const id = "mixed:" + serial++;
    s = immutable(apply(s, { id, actor: "A", epoch: 1, intent }));
    validate(structuredClone(s));
    return id;
  }
  for (let i = 0; i < 25; i++) {
    const insertion = run({
      kind: "insert",
      at: gapAt(s, "p0", 2),
      text: "中😀",
      marks: ["em"],
    });
    const deletion = run({
      kind: "delete",
      ids: text(s, "p0")
        .slice(1, 4)
        .map((a) => a.id),
    });
    run({ kind: "undo", target: deletion });
    run({ kind: "undo", target: insertion });
    if (i % 5 === 0) s = immutable(structuredClone(s));
  }
  const split = run({ kind: "split", at: gapAt(s, "p0", 2), tail: "tail" });
  run({ kind: "undo", target: split });
  assert.equal(
    text(s, "p0")
      .map((a) => a.char)
      .join(""),
    "aWbcd",
  );
});
