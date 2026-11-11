// SPDX-License-Identifier: MPL-2.0
import { executeTableFormat } from "./table-format.js";
import { validateGridFragment, validateGridAssets } from "../grid-fragment.js";
import { createReplica, internAtoms } from "../text/pieces.js";
import { resolveCellRange } from "../selection/grid.js";
import { isImmutable } from "./immutable.js";
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => structuredClone(x);
function forest(state, cells) {
  const ids = [];
  const seen = new Set();
  function walk(id) {
    const n = state.nodes[id];
    if (!n?.live || seen.has(id)) throw Error("Cell content is unavailable");
    seen.add(id);
    ids.push(id);
    for (const c of n.children || []) walk(c);
  }
  for (const id of cells) {
    const c = state.nodes[id];
    if (!c?.live || c.type !== "cell")
      throw Error("Cell target is unavailable");
    for (const child of c.children) walk(child);
  }
  return ids;
}
const splitId = (id) => {
  const at = id.lastIndexOf(":");
  return { run: id.slice(0, at), offset: Number(id.slice(at + 1)) };
};
function inPieces(pieces, id) {
  const { run, offset } = splitId(id);
  return pieces.some(
    (p) => p.run === run && offset >= p.from && offset < p.from + p.length,
  );
}
// Backing runs are immutable: piece identities capture text and intrinsic marks
// without serializing all characters. Explicit formatting contributions are
// included separately. Numeric replica generations and projection placement
// tokens are not user content and may change during an own split/join Undo.
export function cellWitness(state, cells) {
  const ids = forest(state, cells),
    pieces = [];
  const nodes = ids.map((id) => {
    const { live, text, placement, ...node } = state.nodes[id];
    if (text) {
      const ps = state.replicas[text].pieces;
      pieces.push(...ps);
      return { ...node, pieces: ps };
    }
    return node;
  });
  // Store each exact formatting ledger once and encode its target identities as
  // contiguous source-run spans. This is lossless (including inactive history),
  // avoids hash collisions, and does not repeat a ledger for every character.
  const values = [],
    indices = new Map(),
    runs = [];
  const entries = Object.entries(state.formats || {})
    .filter(([id]) => inPieces(pieces, id))
    .map(([id, value]) => ({ ...splitId(id), value }))
    .sort((a, b) =>
      a.run === b.run ? a.offset - b.offset : a.run < b.run ? -1 : 1,
    );
  for (const { run, offset, value } of entries) {
    const key = JSON.stringify(value);
    let format = indices.get(key);
    if (format === undefined) {
      format = values.length;
      indices.set(key, format);
      values.push(value);
    }
    const last = runs.at(-1);
    if (
      last?.run === run &&
      last.from + last.length === offset &&
      last.format === format
    )
      last.length++;
    else runs.push({ run, from: offset, length: 1, format });
  }
  return {
    version: 2,
    cells: cells.map((id) => ({
      id,
      children: state.nodes[id].children,
      owner: state.nodes[id].clearOwner ?? null,
    })),
    nodes,
    formats: { values, runs },
  };
}
export function validateClearRequest(state, intent) {
  const range = resolveCellRange(state, intent.range),
    cells = range.cells.flat();
  if (!same(cellWitness(state, cells), intent.witness))
    throw Error("Selected cell content changed; review clear again");
  if (intent.kind === "pasteCells") {
    const f = validateGridFragment(intent.fragment);
    validateGridAssets(state, f);
    if (
      f.rows.length !== range.cells.length ||
      f.rows[0].length !== range.cells[0].length
    )
      throw Error("Paste rectangle dimensions differ");
  }
  return cells;
}
export function cellsAlreadyEmpty(state, cells) {
  return cells.every((id) => {
    const c = state.nodes[id],
      n = c?.children.length === 1 && state.nodes[c.children[0]];
    return n?.type === "paragraph" && state.replicas[n.text]?.length === 0;
  });
}
function snapshot(state, cells) {
  const ids = forest(state, cells),
    set = new Set(ids);
  return {
    cells: cells.map((id) => ({
      id,
      children: [...state.nodes[id].children],
      owner: state.nodes[id].clearOwner ?? null,
    })),
    nodes: ids.map((id) => clone(state.nodes[id])),
    joins: Object.values(state.listJoins)
      .filter((j) => set.has(j.right))
      .map(clone),
  };
}
function retire(state, ids, token, write) {
  for (const id of ids) {
    const n = state.nodes[id];
    write("nodes")[id] = {
      ...n,
      live: false,
      retiredBy: token,
      clearedBy: token,
    };
    if (n.text)
      write("replicas")[n.text] = { ...state.replicas[n.text], retired: true };
  }
  const set = new Set(ids);
  for (const [id, cut] of Object.entries(state.boundaries))
    if (set.has(cut.block))
      write("boundaries")[id] = { ...cut, retiredBy: token };
  for (const [id, j] of Object.entries(state.listJoins))
    if (set.has(j.right)) write("listJoins")[id] = { ...j, suspendedBy: token };
}
export function executeCellClear(
  state,
  intent,
  action,
  { write, remember, fail },
) {
  const cells =
    intent.kind === "clearCells"
      ? intent.range.cells
          .flat()
          .filter((id) => !cellsAlreadyEmpty(state, [id]))
      : intent.kind === "pasteCells"
        ? intent.range.cells.flat()
        : intent.cells;
  if (!cells.length) throw fail("Selected cells are already empty");
  if (
    !["clearCells", "pasteCells", "restoreClearedCells"].includes(intent.kind)
  )
    throw fail("Unknown cell lifecycle");
  if (intent.kind === "restoreClearedCells") {
    if (!same(cellWitness(state, cells), intent.expected))
      throw fail(
        "Cleared cells have new content or structure; Undo cannot overwrite it",
      );
    for (const n of intent.restore.nodes) {
      const current = state.nodes[n.id];
      if (current?.live || current?.clearedBy !== intent.retirement)
        throw fail("Retained cell content lifecycle changed");
    }
    for (const j of intent.restore.joins) {
      const current = state.listJoins[j.id];
      if (
        current?.suspendedBy !== intent.retirement ||
        !same(
          { ...current, suspendedBy: undefined },
          { ...j, suspendedBy: undefined },
        )
      )
        throw fail("Retained list contributions changed");
    }
  }
  const before = snapshot(state, cells),
    expected = cellWitness(state, cells),
    styleInverses = [];
  retire(
    state,
    before.nodes.map((n) => n.id),
    action,
    write,
  );
  if (intent.kind === "clearCells") {
    for (const [i, id] of cells.entries()) {
      const block = `${action}:cell:${i}:paragraph`,
        replica = `${action}:cell:${i}:text`;
      if (state.nodes[block] || state.replicas[replica])
        throw fail("Clear placeholder identity reused");
      write("nodes")[block] = {
        id: block,
        type: "paragraph",
        live: true,
        text: replica,
      };
      write("replicas")[replica] = createReplica(replica, block, [], action);
      remember(`${replica}:empty`, block, 0);
      write("nodes")[id] = {
        ...state.nodes[id],
        children: [block],
        clearOwner: action,
      };
    }
  } else if (intent.kind === "pasteCells") {
    const fragment = validateGridFragment(intent.fragment),
      content = fragment.rows.flat();
    let serial = 0;
    function create(b) {
      const id = `${action}:paste:${serial++}`,
        n = { id, type: b.type, live: true };
      if (state.nodes[id]) throw fail("Pasted identity reused");
      for (const key of [
        "order",
        "language",
        "asset",
        "alt",
        "width",
        "height",
      ])
        if (b[key] !== undefined) n[key] = b[key];
      if (b.content) {
        const replica = `${id}:text`,
          atoms = b.content
            .flatMap((run) =>
              [...run.text].map((char) => ({ char, marks: run.marks })),
            )
            .map((a, i) => ({ ...a, id: `${id}:chars:${i}` }));
        if (state.replicas[replica]) throw fail("Pasted text identity reused");
        n.text = replica;
        write("replicas")[replica] = createReplica(
          replica,
          id,
          internAtoms(write("runs"), atoms),
          action,
        );
      } else if (b.children) n.children = b.children.map(create);
      write("nodes")[id] = n;
      if (n.text && state.replicas[n.text].length === 0)
        remember(`${n.text}:empty`, id, 0);
      return id;
    }
    for (const [i, id] of cells.entries()) {
      write("nodes")[id] = {
        ...state.nodes[id],
        children: content[i].map(create),
        clearOwner: action,
      };
    }
    // Complete the content forest before querying structural membership.
    if (fragment.styles) {
      const groups = new Map(),
        styles = fragment.styles.flat();
      for (const [i, id] of cells.entries()) {
        const patch = styles[i],
          key = JSON.stringify(patch);
        if (!groups.has(key)) groups.set(key, { patch, targets: [] });
        groups.get(key).targets.push(id);
      }
      for (const group of groups.values())
        styleInverses.push(
          executeTableFormat(
            state,
            { kind: "tableFormat", table: intent.range.table, ...group },
            action,
            { write, fail },
          ),
        );
    }
  } else {
    for (const n of intent.restore.nodes) {
      write("nodes")[n.id] = { ...n };
      if (n.text)
        write("replicas")[n.text] = {
          ...state.replicas[n.text],
          retired: false,
        };
    }
    const ids = new Set(intent.restore.nodes.map((n) => n.id));
    for (const [id, cut] of Object.entries(state.boundaries))
      if (ids.has(cut.block)) {
        const next = { ...cut };
        delete next.retiredBy;
        write("boundaries")[id] = next;
      }
    for (const j of intent.restore.joins) write("listJoins")[j.id] = clone(j);
    for (const c of intent.restore.cells) {
      const next = { ...state.nodes[c.id], children: c.children };
      if (c.owner === null) delete next.clearOwner;
      else next.clearOwner = c.owner;
      write("nodes")[c.id] = next;
    }
  }
  const inverse = {
    kind: "restoreClearedCells",
    cells,
    expected:
      intent.kind !== "restoreClearedCells"
        ? cellWitness(state, cells)
        : intent.restoreExpected,
    restore: before,
    restoreExpected: expected,
    retirement: action,
  };
  return styleInverses.length
    ? { kind: "batch", intents: [...styleInverses, inverse] }
    : inverse;
}
// Use retained piece intervals, not a second array of all character IDs. A
// weak node-map cache is reusable while ordinary live text changes; every
// retained replica dependency is checked before reusing the interval view.
const hiddenCache = new WeakMap();
function hiddenPieces(state) {
  const cached = isImmutable(state.nodes) && hiddenCache.get(state.nodes);
  if (
    cached &&
    cached.dependencies.every(([id, r]) => state.replicas[id] === r)
  )
    return cached.pieces;
  const dependencies = [],
    pieces = new Map();
  for (const n of Object.values(state.nodes))
    if ((n.clearedBy || n.structureDeletedBy || n.richRetiredBy) && n.text) {
      const r = state.replicas[n.text];
      dependencies.push([n.text, r]);
      for (const p of r.pieces) {
        if (!pieces.has(p.run)) pieces.set(p.run, []);
        pieces.get(p.run).push(p);
      }
    }
  if (isImmutable(state.nodes) && dependencies.every(([, r]) => isImmutable(r)))
    hiddenCache.set(state.nodes, { dependencies, pieces });
  return pieces;
}
export function assertClearTargetsAvailable(state, intent, fail) {
  if (
    ["clearCells", "pasteCells", "restoreClearedCells", "batch"].includes(
      intent.kind,
    )
  )
    return;
  const blocked = (id) =>
    id &&
    (state.nodes[id]?.clearedBy ||
      state.nodes[id]?.structureDeletedBy ||
      state.nodes[id]?.richRetiredBy);
  const gap = intent.at,
    block =
      gap?.codec === 3
        ? state.boundaries[gap.boundary]?.block
        : gap?.codec === 2
          ? state.replicas[gap.text]?.owner
          : null;
  const family = intent.family && state.listFamilies[intent.family];
  if (
    blocked(block) ||
    blocked(intent.node) ||
    intent.nodes?.some(blocked) ||
    blocked(intent.target?.right) ||
    blocked(family?.source) ||
    state.listJoins[intent.boundary]?.suspendedBy
  )
    throw fail(
      "Target content was cleared or structurally deleted; original action retained for recovery",
    );
  if (intent.ids?.length) {
    const pieces = hiddenPieces(state);
    if (
      intent.ids.some((id) => {
        const p = splitId(id);
        return pieces
          .get(p.run)
          ?.some((r) => p.offset >= r.from && p.offset < r.from + r.length);
      })
    )
      throw fail(
        "Target text was cleared or structurally deleted; original action retained for recovery",
      );
  }
}
