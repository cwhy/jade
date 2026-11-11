// SPDX-License-Identifier: MPL-2.0
import { validateCreationPlacements } from "./creation-placement.js";
import { validateCreations } from "./creation-lifecycle.js";
import { validateJoins } from "./join-ledger.js";
import { validateListFamilies } from "./list-validation.js";
// C2 dependency-cached validation. The original complete validator remains the
// fallback/oracle. Caches accept only objects sealed transitively by our host.
import { immutable, isImmutable } from "./immutable.js";
import { validateBoundaries } from "./boundaries.js";
import { locations } from "./locations.js";
import { predecessor } from "./draft.js";
import { changedKeys } from "./changed-keys.js";
const forests = new WeakMap(),
  runsChecked = new WeakSet(),
  replicasChecked = new WeakMap(),
  certified = new WeakMap();
const dependencies = [
  "textClaims",
  "textMasks",
  "creationPlacements",
  "creations",
  "nodes",
  "replicas",
  "runs",
  "boundaries",
  "boundaryOrder",
  "cutLinks",
  "erasures",
  "listFamilies",
  "listJoins",
  "joinProjection",
];
const counters = {
  full: 0,
  incremental: 0,
  replicaReuse: 0,
  replicaChecks: 0,
  runReuse: 0,
  runChecks: 0,
};
export function validationStats() {
  return { ...counters };
}
function forest(nodes, root) {
  let cache = forests.get(nodes);
  if (cache?.has(root)) return cache.get(root);
  const visited = new Set(),
    texts = [];
  function walk(id, ancestors = []) {
    const n = nodes[id];
    if (!n?.live || visited.has(id))
      throw Error("Missing, repeated or cyclic node");
    visited.add(id);
    if (n.type === "table" && ancestors.includes("cell"))
      throw Error("Nested table");
    if (n.type === "list_item" && nodes[n.children?.[0]]?.type !== "paragraph")
      throw Error("List item has no first paragraph");
    if (n.text) texts.push(n);
    for (const child of n.children || []) walk(child, [...ancestors, n.type]);
  }
  walk(root);
  for (const n of Object.values(nodes))
    if (n.live && !visited.has(n.id)) throw Error("Orphan node");
  const result = { texts, byReplica: new Map(texts.map((n) => [n.text, n])) };
  if (isImmutable(nodes)) {
    if (!cache) {
      cache = new Map();
      forests.set(nodes, cache);
    }
    cache.set(root, result);
  }
  return result;
}
function checkRun(run) {
  if (isImmutable(run) && runsChecked.has(run)) {
    counters.runReuse++;
    return;
  }
  counters.runChecks++;
  if (
    !Array.isArray(run.chars) ||
    !Array.isArray(run.formats) ||
    run.chars.some((char) => typeof char !== "string" || [...char].length !== 1)
  )
    throw Error("Invalid character");
  let end = 0;
  for (const f of run.formats) {
    if (
      f.from !== end ||
      !Number.isSafeInteger(f.length) ||
      f.length < 1 ||
      !Array.isArray(f.marks)
    )
      throw Error("Invalid mark range");
    end += f.length;
  }
  if (end !== run.chars.length) throw Error("Missing mark range");
  if (isImmutable(run)) runsChecked.add(run);
}
function checkReplica(replica, runs) {
  const cached = isImmutable(replica) && replicasChecked.get(replica);
  if (cached && cached.every(([id, run]) => runs[id] === run)) {
    counters.replicaReuse++;
    return;
  }
  counters.replicaChecks++;
  let length = 0,
    stable = isImmutable(replica);
  const dependencies = new Map();
  for (const p of replica.pieces) {
    const run = runs[p.run];
    if (
      !run ||
      !Number.isSafeInteger(p.from) ||
      !Number.isSafeInteger(p.length) ||
      p.from < 0 ||
      p.length < 1 ||
      p.from + p.length > run.chars.length
    )
      throw Error("Invalid backing slice");
    length += p.length;
    stable = stable && isImmutable(run);
    dependencies.set(p.run, run);
  }
  if (length !== replica.length) throw Error("Replica length mismatch");
  if (stable) replicasChecked.set(replica, [...dependencies]);
}
export function validateChanged(state, full) {
  validateCreations(state);
  validateCreationPlacements(state);
  validateListFamilies(state);
  validateJoins(state);
  const base = predecessor(state);
  function certify() {
    // apply() returns a mutable wrapper. Seal validated dependencies and snapshot
    // their references, so replacing a field before host publication cannot reuse
    // a stale certificate. Never certify externally mutable nested data.
    if (!base || !isImmutable(base)) return;
    for (const key of dependencies) immutable(state[key]);
    certified.set(state, {
      root: state.root,
      storageCodec: state.storageCodec,
      ...Object.fromEntries(dependencies.map((key) => [key, state[key]])),
    });
  }
  function complete() {
    counters.full++;
    full(state, true);
    if (isImmutable(state.nodes)) forest(state.nodes, state.root);
    certify();
  }
  // A sealed object is not necessarily valid. Only our own successful validation
  // certifies a predecessor; decode, mutable input and changed forests fall back.
  const certificate = base && certified.get(base);
  if (
    !base ||
    !isImmutable(base) ||
    !certificate ||
    certificate.root !== base.root ||
    certificate.storageCodec !== base.storageCodec ||
    dependencies.some((key) => certificate[key] !== base[key]) ||
    state.nodes !== base.nodes ||
    state.root !== base.root ||
    state.storageCodec !== 43 ||
    !forests.get(base.nodes)?.has(base.root)
  )
    return complete();
  if (
    state.textClaims !== base.textClaims ||
    state.textMasks !== base.textMasks
  )
    return complete();
  const changedRuns = changedKeys(base.runs, state.runs),
    changedReplicas = changedKeys(base.replicas, state.replicas);
  // Replica bounds depend on backing-run existence/length, not its marks. A
  // shortened/deleted old run invalidates arbitrary unchanged replicas: use the
  // complete validator rather than maintaining another reverse dependency map.
  if (
    changedRuns.some(
      (id) =>
        base.runs[id] &&
        (!state.runs[id] ||
          base.runs[id].chars.length !== state.runs[id].chars?.length),
    )
  )
    return complete();
  // The certified live-owner ID set remains valid only while IDs are stable.
  if (
    changedReplicas.some(
      (id) => base.replicas[id]?.id !== state.replicas[id]?.id,
    )
  )
    return complete();
  counters.incremental++;
  const tree = forest(state.nodes, state.root),
    emptyCandidates = [];
  for (const id of changedReplicas) {
    const r = state.replicas[id],
      n = tree.byReplica.get(id);
    if (!r) return complete();
    if (n) {
      if (!r || r.retired || r.owner !== n.id)
        throw Error("Invalid live text owner");
      emptyCandidates.push(n);
    } else if (r && !r.retired) return complete();
  }
  // The boundary registry itself is still checked completely. Only the scan for
  // newly empty text is restricted to changed replicas in the unchanged forest.
  validateBoundaries(state, emptyCandidates);
  for (const id of changedRuns) checkRun(state.runs[id]);
  for (const id of changedReplicas)
    if (state.replicas[id]) checkReplica(state.replicas[id], state.runs);
  locations(state); // Incremental ranges still check overlap with untouched owners.
  certify();
}
