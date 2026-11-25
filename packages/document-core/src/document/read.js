// SPDX-License-Identifier: MPL-2.0
import { effectiveLanguageRecord } from "../model/code-language.js";
// Effective editor document. Storage partitions stay private to the model.
// Metadata traversal is independent of atom materialization; reading a caret or
// one leaf never walks text in unrelated leaves.
import {
  text as storedText,
  gapAt as storedGap,
  resolveGap as storedResolve,
} from "../model/engine.js";
import {
  conversionLayout,
  conversionTokens,
} from "../model/text-conversion.js";
import { listMarkers as storedListMarkers } from "../model/list-marker.js";
import { isImmutable } from "../model/immutable.js";
const readers = new WeakMap(),
  topologies = new WeakMap();
export function documentView(state) {
  if (isImmutable(state) && readers.has(state)) return readers.get(state);
  const stable =
    isImmutable(state.nodes) &&
    isImmutable(state.listFamilies) &&
    isImmutable(state.joinProjection);
  const prior = stable && topologies.get(state.nodes);
  const reused = !!(
    prior &&
    prior.root === state.root &&
    prior.families === state.listFamilies &&
    prior.projection === state.joinProjection
  );
  const metadata = reused
    ? prior.metadata
    : {
        groups: new Map(),
        parents: new Map(),
        nodes: new Map(),
        sources: new Map(),
        order: [],
        positions: new Map(),
        fields: new Set(),
      };
  const { groups, parents, nodes, sources, order, positions, fields } =
      metadata,
    atoms = new Map();
  let materialized = 0;
  function walk(id, parent, group = null, field = false) {
    const raw = group?.node || state.nodes[id];
    if (!raw?.live || nodes.has(id))
      throw Error("Invalid logical document structure");
    const own = Object.freeze({
      ...(group || { id, type: raw.type, blocks: [id], boundaries: [] }),
      blocks: Object.freeze([...(group?.blocks || [id])]),
      boundaries: Object.freeze(
        (group?.boundaries || []).map((x) => Object.freeze({ ...x })),
      ),
    });
    let children = raw.children;
    const layout =
      children && ["doc", "cell"].includes(raw.type)
        ? conversionLayout(state, id)
        : null;
    if (layout) children = layout.map((g) => g.id);
    let node =
      own.type === raw.type && children === raw.children
        ? raw
        : { ...raw, type: own.type, ...(children ? { children } : {}) };
    if (own.conversion) {
      const entry = state.nodes[state.root].textConversions.find(
        (e) => e.id === own.conversion,
      );
      node = { ...node, codeConversion: entry.id };
      delete node.language;
      delete node.codeLanguages;
      const owner = effectiveLanguageRecord(state, entry);
      if (owner.codeLanguages) node.codeLanguages = owner.codeLanguages;
      if (Object.hasOwn(owner, "language")) node.language = owner.language;
    }
    nodes.set(id, node);
    parents.set(id, parent);
    groups.set(id, own);
    for (const source of own.blocks) sources.set(source, id);
    if (raw.text) {
      if (field) {
        fields.add(id);
        positions.set(id, -fields.size);
      } else {
        positions.set(id, order.length);
        order.push(id);
      }
    }
    if (id === state.root)
      for (const f of Object.values(raw.fields || {}))
        walk(f, node, null, true);
    const byId = new Map((layout || []).map((g) => [g.id, g]));
    for (const child of children || [])
      walk(child, node, byId.get(child) || null);
  }
  if (!reused) {
    walk(state.root);
    if (stable)
      topologies.set(state.nodes, {
        root: state.root,
        families: state.listFamilies,
        projection: state.joinProjection,
        metadata,
      });
  }
  function group(id) {
    const g = groups.get(id);
    if (!g || !nodes.get(id)?.text) throw Error("Choose a logical text block");
    return g;
  }
  function length(id) {
    return (
      group(id).blocks.reduce(
        (n, b) => n + state.replicas[state.nodes[b].text].length,
        0,
      ) + group(id).boundaries.filter((b) => !b.hidden).length
    );
  }
  function text(id) {
    if (!atoms.has(id)) {
      const g = group(id);
      materialized += g.blocks.length;
      atoms.set(
        id,
        g.blocks.length === 1 && g.type === state.nodes[id].type
          ? storedText(state, id)
          : conversionTokens(state, g),
      );
    }
    return atoms.get(id);
  }
  function gapAt(id, offset, affinity = "right") {
    const g = group(id);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > length(id))
      throw Error("Invalid logical offset");
    for (const [index, source] of g.blocks.entries()) {
      const size = state.replicas[state.nodes[source].text].length;
      if (
        offset < size ||
        (offset === size &&
          !(g.boundaries[index]?.hidden && affinity === "right"))
      )
        return storedGap(state, source, offset, affinity);
      offset -= size + (g.boundaries[index]?.hidden ? 0 : 1);
    }
    throw Error("Unmapped logical gap");
  }
  function resolveGap(gap) {
    const p = storedResolve(state, gap),
      id = sources.get(p.block);
    if (!id) throw Error("Logical point is unavailable");
    let offset = p.offset;
    for (const [index, b] of group(id).blocks.entries()) {
      if (b === p.block) break;
      offset +=
        state.replicas[state.nodes[b].text].length +
        (group(id).boundaries[index]?.hidden ? 0 : 1);
    }
    return { ...p, block: id, offset };
  }
  const view = Object.freeze({
    root: state.root,
    sourceId: (id) => sources.get(id),
    node: (id) => nodes.get(id),
    parent: (id) => parents.get(id),
    listMarkers: (id) => {
      const node = nodes.get(id),
        allowed = new Set(node?.children || []);
      if (node?.markers) return node.markers.map((m) => ({ ...m }));
      return storedListMarkers(state, node?.sourceList || id).filter((m) =>
        allowed.has(m.id),
      );
    },
    group,
    length,
    text,
    gapAt,
    resolveGap,
    signature: (id) => {
      const g = group(id);
      return [
        g.type,
        g.blocks.join("\0"),
        g.boundaries.map((b) => `${b.id}:${!!b.hidden}`).join("\0"),
        state.formats,
        ...g.blocks.map((b) => state.replicas[state.nodes[b].text]),
      ];
    },
    order: Object.freeze(order),
    position: (id) => positions.get(id),
    isField: (id) => fields.has(id),
    changed: (id) => {
      const g = group(id);
      return (
        !!g.projectedParent ||
        g.blocks.length !== 1 ||
        g.type !== state.nodes[id].type
      );
    },
    stats: () => ({ materializedLeaves: materialized, reusedTopology: reused }),
  });
  if (isImmutable(state)) readers.set(state, view);
  return view;
}

export const text = (state, id) => documentView(state).text(id);
export const gapAt = (state, id, offset, affinity) =>
  documentView(state).gapAt(id, offset, affinity);
export const resolveGap = (state, gap) => documentView(state).resolveGap(gap);
