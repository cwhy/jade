// SPDX-License-Identifier: MPL-2.0
import { isImmutable } from "./immutable.js";
// Ephemeral staging metadata: never serialized or retained in the document.
// All mutations of these collections must go through writable()/erase().
const drafts = new WeakMap();
const fields = new Set([
  "textClaims",
  "textMasks",
  "creationPlacements",
  "creations",
  "runs",
  "nodes",
  "replicas",
  "boundaries",
  "boundaryOrder",
  "cutLinks",
  "erasures",
  "effects",
  "lineage",
  "deleted",
  "listFamilies",
  "listJoins",
  "joinProjection",
]);
export function stage(state) {
  const next = { ...state, formats: state.formats || {} };
  const copied = new Set();
  // A mutable decoded/input state has no safe sharing contract: retain the
  // original eager shallow-copy behavior until the host seals it.
  if (!isImmutable(state))
    for (const field of fields) {
      next[field] = Array.isArray(state[field])
        ? [...state[field]]
        : { ...state[field] };
      copied.add(field);
    }
  drafts.set(next, { base: state, copied });
  return next;
}
// Published checkpoints must not retain a predecessor chain through this map.
export function finish(state) {
  drafts.delete(state);
  return state;
}
export function writable(state, field) {
  const draft = drafts.get(state);
  // seed() and focused boundary tests construct mutable states outside apply().
  if (!draft) return state[field];
  if (!fields.has(field)) throw Error("Unknown staged collection: " + field);
  if (!draft.copied.has(field)) {
    const value = state[field];
    state[field] = Array.isArray(value) ? [...value] : { ...value };
    draft.copied.add(field);
  }
  return state[field];
}
export function erase(state, field, key) {
  if (Object.hasOwn(state[field], key)) delete writable(state, field)[key];
}
export function unchangedOwnershipSource(state) {
  const base = drafts.get(state)?.base;
  // Exactly the original index's immutable-state eligibility, never cache a
  // mutable staging index. A copied runs/nodes/replicas map ends reuse.
  return base &&
    isImmutable(base) &&
    state.nodes === base.nodes &&
    state.replicas === base.replicas &&
    state.runs === base.runs
    ? base
    : null;
}
export function predecessor(state) {
  return drafts.get(state)?.base;
}
