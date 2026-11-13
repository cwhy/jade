// SPDX-License-Identifier: MPL-2.0
import { writable, erase } from "./draft.js";
// Exact erasure membership as immutable, interned prefix chains. Each erasure
// has one head; a link records a cut ordinal, its erased offset and its prefix.
export function rememberBoundary(state, id, block, offset) {
  if (state.boundaries[id]) throw Error("Boundary identity reused");
  const ordinal = state.boundaryOrder.length;
  writable(state, "boundaryOrder").push(id);
  writable(state, "boundaries")[id] = { block, offset, ordinal };
  return { codec: 3, boundary: id };
}
// Match B2's existential ordering rule without modifying the shared chains.
export function members(state, entry) {
  const result = [];
  for (let id = entry.head; id !== null; id = state.cutLinks[id].previous) {
    const link = state.cutLinks[id];
    result.push([link.ordinal, link.at]);
  }
  return result.reverse();
}
function preceding(state, divider) {
  const earlier = new Set();
  if (!divider) return earlier;
  for (const entry of Object.values(state.erasures)) {
    const list = members(state, entry),
      match = list.find(([ordinal]) => ordinal === divider.ordinal);
    if (match)
      for (const [ordinal, at] of list) if (at < match[1]) earlier.add(ordinal);
  }
  return earlier;
}
export function repartitionBoundaries(
  state,
  sources,
  destinations,
  splitCut = null,
  listCuts = [],
) {
  const bases = new Map();
  let total = 0;
  for (const block of sources) {
    bases.set(block, total);
    total += state.replicas[state.nodes[block].text].length;
  }
  const lengths = destinations.map((d) =>
    d.pieces.reduce((n, p) => n + p.length, 0),
  );
  if (lengths.reduce((a, b) => a + b, 0) !== total)
    throw Error("Boundary repartition must preserve text length");
  const earlier = preceding(state, splitCut && state.boundaries[splitCut]),
    original = { ...state.boundaries };
  for (const [id, cut] of Object.entries(state.boundaries)) {
    if (!bases.has(cut.block)) continue;
    let offset = bases.get(cut.block) + cut.offset;
    // Retained erasure starts remember which side of a coincident list cut they
    // belonged to. Equal numeric offsets alone cannot survive Undo/Redo.
    const sides = listCuts.filter(
      (c) =>
        cut.listAffinity?.[c.marker] &&
        offset ===
          bases.get(original[c.marker]?.block) + original[c.marker]?.offset,
    );
    const low = Math.max(
      0,
      ...sides
        .filter((c) => cut.listAffinity[c.marker] === "right")
        .map((c) => destinations.findIndex((d) => d.block === c.right)),
    );
    const high = Math.min(
      destinations.length - 1,
      ...sides
        .filter((c) => cut.listAffinity[c.marker] === "left")
        .map((c) => destinations.findIndex((d) => d.block === c.right) - 1),
    );
    if (low > high) throw Error("Contradictory retained list-cut affinity");
    for (let i = 0; i < destinations.length; i++) {
      if (
        i >= low &&
        i <= high &&
        (offset < lengths[i] ||
          (offset === lengths[i] &&
            (i === high || (i === 0 && earlier.has(cut.ordinal)))) ||
          i === destinations.length - 1)
      ) {
        writable(state, "boundaries")[id] = {
          ...cut,
          block: destinations[i].block,
          offset,
        };
        break;
      }
      offset -= lengths[i];
    }
  }
}
export function insertAtBoundaries(
  state,
  block,
  at,
  length,
  gap,
  restoration = false,
) {
  const earlier =
    restoration && gap?.codec === 3
      ? preceding(state, state.boundaries[gap.boundary])
      : new Set();
  for (const [id, cut] of Object.entries(state.boundaries))
    if (
      cut.block === block &&
      cut.offset >= at &&
      // A logical paragraph start can sit inside a joined paragraph. Typing
      // before it must move the marker; only typing exactly at that start
      // stays on its right. Otherwise expanding the join restores a stale cut.
      (cut.edge !== "start" || cut.offset > at) &&
      !(cut.offset === at && earlier.has(cut.ordinal)) &&
      !(cut.offset === at && gap?.listAffinity?.[id] === "right")
    )
      writable(state, "boundaries")[id] = {
        ...cut,
        offset: cut.offset + length,
      };
}
export function deleteAtBoundaries(state, block, from, length, erasure) {
  if (erasure && state.erasures[erasure])
    throw Error("Erasure identity reused");
  // This index is derived once per deletion, never persisted as another source
  // of truth. Canonical triples share exact immutable prefixes across erasures.
  const intern = new Map(
    state.cutLinks.map((link, id) => [
      `${link.previous}/${link.ordinal}/${link.at}`,
      id,
    ]),
  );
  let head = null;
  for (const id of state.boundaryOrder) {
    const cut = state.boundaries[id];
    if (cut.block !== block || cut.offset < from) continue;
    if (erasure && cut.offset <= from + length) {
      const at = cut.offset - from,
        key = `${head}/${cut.ordinal}/${at}`;
      if (!intern.has(key)) {
        intern.set(key, state.cutLinks.length);
        writable(state, "cutLinks").push({
          previous: head,
          ordinal: cut.ordinal,
          at,
        });
      }
      head = intern.get(key);
    }
    writable(state, "boundaries")[id] = {
      ...cut,
      offset: Math.max(from, cut.offset - length),
    };
  }
  if (erasure) writable(state, "erasures")[erasure] = { length, head };
}
export function erasureCuts(state, key) {
  return state.erasures[key]
    ? members(state, state.erasures[key]).map(([n, at]) => [
        state.boundaryOrder[n],
        at,
      ])
    : [];
}
export function clearErasure(state, key) {
  erase(state, "erasures", key);
}
export function validateBoundaries(
  state,
  emptyCandidates = Object.values(state.nodes),
) {
  if (
    !Array.isArray(state.boundaryOrder) ||
    !Array.isArray(state.cutLinks) ||
    !state.erasures ||
    typeof state.erasures !== "object"
  )
    throw Error("Invalid shared cut index");
  for (const node of emptyCandidates) {
    const replica = state.replicas[node.text];
    if (
      node.live &&
      replica?.length === 0 &&
      !state.boundaries?.[`${node.text}:empty`]
    )
      throw Error("Empty text has no structural boundary");
  }
  if (Object.keys(state.boundaries).length !== state.boundaryOrder.length)
    throw Error("Invalid structural boundary ordinal count");
  for (const [id, cut] of Object.entries(state.boundaries)) {
    const node = state.nodes[cut.block],
      replica = state.replicas[node?.text];
    const retired =
      !!cut.retiredBy &&
      node?.live === false &&
      node.retiredBy === cut.retiredBy &&
      replica?.retired === true;
    if (
      (!node?.live && !retired) ||
      (node?.live && cut.retiredBy) ||
      !replica ||
      !Number.isSafeInteger(cut.offset) ||
      cut.offset < 0 ||
      cut.offset > replica.length ||
      !Number.isSafeInteger(cut.ordinal) ||
      state.boundaryOrder[cut.ordinal] !== id ||
      "erased" in cut
    )
      throw Error("Invalid structural boundary");
  }
  // Earlier link references form an acyclic graph. Strictly increasing ordinals
  // prevent duplicate membership. Prefix maxima validate each erasure in O(1).
  const maxima = [];
  for (const [id, link] of state.cutLinks.entries()) {
    const prev = link.previous;
    if (
      (prev !== null &&
        (!Number.isSafeInteger(prev) || prev < 0 || prev >= id)) ||
      !Number.isSafeInteger(link.ordinal) ||
      link.ordinal < 0 ||
      link.ordinal >= state.boundaryOrder.length ||
      !Number.isSafeInteger(link.at) ||
      link.at < 0
    )
      throw Error("Invalid cut membership link");
    if (prev !== null && state.cutLinks[prev].ordinal >= link.ordinal)
      throw Error("Cut membership order must increase");
    maxima.push(Math.max(link.at, prev === null ? 0 : maxima[prev]));
  }
  for (const [key, entry] of Object.entries(state.erasures)) {
    if (!state.boundaries[key]) throw Error("Missing erasure start");
    if (
      !Number.isSafeInteger(entry.length) ||
      entry.length < 1 ||
      !Number.isSafeInteger(entry.head) ||
      entry.head < 0 ||
      entry.head >= state.cutLinks.length ||
      maxima[entry.head] > entry.length
    )
      throw Error("Invalid erasure head/offset");
  }
}

// A new boundary authored offline inside erased text still has an exact place
// in that erased run. Retain its membership so restoration can repartition it.
export function addErasureBoundary(state, key, id, at) {
  const entry = state.erasures[key],
    cut = state.boundaries[id];
  if (!entry || !cut || at < 0 || at > entry.length)
    throw Error("Invalid erased boundary origin");
  const prior = members(state, entry);
  if (prior.some(([ordinal]) => ordinal === cut.ordinal)) return;
  // Capture authored side relationships once. Later Undo erasures may collapse
  // the same markers differently; those transient offsets must not reinterpret
  // their original relationship. Existing affinity handles subsequent replay.
  for (const [ordinal, position] of prior) {
    if (position === at) continue;
    const other = state.boundaryOrder[ordinal],
      before = state.boundaries[other],
      side = position < at ? "left" : "right";
    writable(state, "boundaries")[other] = {
      ...before,
      listAffinity: { ...before.listAffinity, [id]: side },
    };
    const current = state.boundaries[id];
    writable(state, "boundaries")[id] = {
      ...current,
      listAffinity: {
        ...current.listAffinity,
        [other]: side === "left" ? "right" : "left",
      },
    };
  }
  const head = state.cutLinks.length;
  writable(state, "cutLinks").push({
    previous: entry.head,
    ordinal: cut.ordinal,
    at,
  });
  writable(state, "erasures")[key] = { ...entry, head };
}
export function compareErasedBoundaries(state, a, b) {
  let order = 0;
  for (const entry of Object.values(state.erasures)) {
    const entries = members(state, entry),
      x = entries.find(([n]) => n === state.boundaries[a].ordinal),
      y = entries.find(([n]) => n === state.boundaries[b].ordinal);
    if (!x || !y || x[1] === y[1]) continue;
    const next = Math.sign(x[1] - y[1]);
    if (order && order !== next)
      throw Error("Contradictory erased boundary order");
    order = next;
  }
  return order;
}
