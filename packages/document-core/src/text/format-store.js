// SPDX-License-Identifier: MPL-2.0
// Exact formatting histories are interned once and addressed by immutable run
// intervals. No visible offsets, lossy hashes, or separate conversion ledger.
import { isImmutable } from "../model/immutable.js";
import { checkFormat } from "./formatting-contributions.js";
const compact = (store) => store?.version === 1;
const indexes = new WeakMap(),
  checked = new WeakMap();
function identity(id) {
  const colon = id.lastIndexOf(":"),
    run = id.slice(0, colon),
    from = Number(id.slice(colon + 1));
  if (
    colon < 1 ||
    !Number.isSafeInteger(from) ||
    from < 0 ||
    String(from) !== id.slice(colon + 1)
  )
    throw Error("Invalid formatting identity");
  return { run, from };
}
export function formatReader(store = {}) {
  if (!compact(store)) return (id) => store[id];
  let index = isImmutable(store) && indexes.get(store);
  if (!index) {
    index = new Map();
    for (const span of store.spans) {
      if (!index.has(span.run)) index.set(span.run, []);
      index.get(span.run).push(span);
    }
    if (isImmutable(store)) indexes.set(store, index);
  }
  return (id) => {
    const { run, from } = identity(id),
      spans = index.get(run) || [];
    let lo = 0,
      hi = spans.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (spans[mid].from <= from) lo = mid + 1;
      else hi = mid;
    }
    const span = spans[lo - 1];
    return span && from < span.from + span.length
      ? store.values[span.value]
      : undefined;
  };
}
export function* formatEntries(store = {}) {
  if (!compact(store)) {
    yield* Object.entries(store);
    return;
  }
  for (const span of store.spans)
    for (let i = span.from; i < span.from + span.length; i++)
      yield [`${span.run}:${i}`, store.values[span.value]];
}
function segments(store) {
  if (compact(store))
    return store.spans.map((span) => ({
      ...span,
      value: store.values[span.value],
    }));
  return Object.entries(store || {}).map(([id, value]) => ({
    ...identity(id),
    length: 1,
    value,
  }));
}
const order = (a, b) =>
  a.run === b.run ? a.from - b.from : a.run < b.run ? -1 : 1;
// Patches use backing identities. Splitting, joining, moving, deleting and
// restoring text never moves this metadata or copies another history.
export function updateFormats(store, patches) {
  if (!patches.size) return store || {};
  const prior = segments(store).sort(order),
    next = [...patches]
      .map(([id, value]) => ({ ...identity(id), length: 1, value }))
      .sort(order);
  const byRun = new Map();
  for (const [kind, list] of [
    ["prior", prior],
    ["next", next],
  ])
    for (const span of list) {
      if (!byRun.has(span.run)) byRun.set(span.run, { prior: [], next: [] });
      const group = byRun.get(span.run)[kind],
        last = group.at(-1);
      if (
        last &&
        last.from + last.length === span.from &&
        last.value === span.value
      )
        last.length += span.length;
      else group.push({ ...span });
    }
  const values = [],
    spans = [],
    keys = new Map(),
    objectKeys = new WeakMap();
  function append(run, from, length, value) {
    let key = objectKeys.get(value);
    if (key === undefined) {
      key = JSON.stringify(value);
      objectKeys.set(value, key);
    }
    let index = keys.get(key);
    if (index === undefined) {
      index = values.length;
      keys.set(key, index);
      values.push(value);
    }
    const last = spans.at(-1);
    if (
      last?.run === run &&
      last.from + last.length === from &&
      last.value === index
    )
      last.length += length;
    else spans.push({ run, from, length, value: index });
  }
  for (const run of [...byRun.keys()].sort()) {
    const group = byRun.get(run),
      points = [
        ...new Set(
          [...group.prior, ...group.next].flatMap((s) => [
            s.from,
            s.from + s.length,
          ]),
        ),
      ].sort((a, b) => a - b);
    let pi = 0,
      ni = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i],
        to = points[i + 1];
      while (
        group.prior[pi] &&
        group.prior[pi].from + group.prior[pi].length <= from
      )
        pi++;
      while (
        group.next[ni] &&
        group.next[ni].from + group.next[ni].length <= from
      )
        ni++;
      const patch = group.next[ni],
        old = group.prior[pi];
      const value =
        patch?.from <= from
          ? patch.value
          : old?.from <= from
            ? old.value
            : null;
      if (value) append(run, from, to - from, value);
    }
  }
  return { version: 1, values, spans };
}
export function validateFormats(state) {
  const store = state.formats || {};
  if (!compact(store)) return; // Legacy checkpoints remain readable by this isolated candidate.
  const prior = isImmutable(store) && checked.get(store);
  if (prior && prior.every(([run, source]) => state.runs[run] === source))
    return;
  if (
    Object.keys(store).sort().join(",") !== "spans,values,version" ||
    !Array.isArray(store.values) ||
    !Array.isArray(store.spans)
  )
    throw Error("Invalid compact formatting store");
  for (const cell of store.values) {
    if (
      !cell ||
      Object.keys(cell).sort().join(",") !== "base,layers" ||
      !Array.isArray(cell.base) ||
      !Array.isArray(cell.layers)
    )
      throw Error("Invalid formatting history");
    for (const mark of cell.base)
      checkFormat(typeof mark === "string" ? mark : mark.type, mark);
    const ids = new Set();
    for (const layer of cell.layers) {
      if (
        !layer ||
        Object.keys(layer).sort().join(",") !== "active,id,property,value" ||
        typeof layer.id !== "string" ||
        !layer.id ||
        ids.has(layer.id) ||
        typeof layer.active !== "boolean"
      )
        throw Error("Invalid formatting contribution");
      checkFormat(layer.property, layer.value);
      ids.add(layer.id);
    }
  }
  let previous = null;
  for (const span of store.spans) {
    if (
      !span ||
      Object.keys(span).sort().join(",") !== "from,length,run,value" ||
      !state.runs[span.run] ||
      !Number.isSafeInteger(span.from) ||
      span.from < 0 ||
      !Number.isSafeInteger(span.length) ||
      span.length < 1 ||
      span.from + span.length > state.runs[span.run].chars.length ||
      !Number.isInteger(span.value) ||
      span.value < 0 ||
      span.value >= store.values.length ||
      (previous &&
        (order(previous, span) > 0 ||
          (previous.run === span.run &&
            previous.from + previous.length > span.from)))
    )
      throw Error("Invalid formatting span");
    previous = span;
  }
  const sources = [...new Set(store.spans.map((span) => span.run))].map(
    (run) => [run, state.runs[run]],
  );
  if (isImmutable(store) && sources.every(([, source]) => isImmutable(source)))
    checked.set(store, sources);
}
