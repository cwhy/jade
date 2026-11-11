// SPDX-License-Identifier: MPL-2.0
import { withTreeParents } from "./tree.js";
import { extentRestoration } from "./creation-extent.js";
import { creationItemSteps } from "./item-placement.js";
// A later move records the accepted predecessor of this creation. That path
// encodes its destination relative to the creation's independently owned source
// layout. Inactive predecessors may remain projection dependencies; they are
// not active author contributions and do not themselves hold birth content.
export function orderedCreationPlacements(state) {
  return Object.values(state.creationPlacements).sort(
    (a, b) => a.acceptedAt - b.acceptedAt,
  );
}
export function requiredCreationPlacements(state, override = null) {
  const records = orderedCreationPlacements(state),
    latest = new Map(),
    needed = new Set();
  for (const p of records) if (p.active) latest.set(p.creations[0], p.id);
  if (override) {
    if (override.basis === null) latest.delete(override.creation);
    else latest.set(override.creation, override.basis);
  }
  function include(id) {
    if (needed.has(id)) return;
    const p = state.creationPlacements[id];
    if (!p) throw Error("Missing accepted placement predecessor");
    needed.add(id);
    if (p.predecessor !== null) include(p.predecessor);
  }
  for (const id of latest.values()) include(id);
  return records.filter((p) => needed.has(p.id));
}
// Inverses are caches for the currently materialized path, not the meaning of
// a move. Remove that path atomically before changing its source or membership.
export function suspendCreationPlacements(state, host) {
  const projected = orderedCreationPlacements(state).filter((p) => p.projected);
  withTreeParents(state, () => {
    for (const p of projected.toReversed())
      host.execute(
        extentRestoration(state, p.inverse, p.creations, host.fail),
        p.id + ":suspend",
      );
  });
  for (const p of projected)
    host.write("creationPlacements")[p.id] = {
      ...state.creationPlacements[p.id],
      projected: false,
    };
  return projected;
}
export function resumeCreationPlacements(state, path, host) {
  withTreeParents(state, () => {
    for (const p of path) {
      const steps = creationItemSteps(state, p.intent, p.id, host.fail, true);
      const inverse = host.execute(steps, p.id);
      host.write("creationPlacements")[p.id] = {
        ...state.creationPlacements[p.id],
        projected: true,
        inverse,
      };
    }
  });
}

// List cuts belong to the creation's paragraph lineage, not to temporary move
// wrappers. Rebuild the cut in that lineage's base location, then rematerialize
// the accepted placement path. Text IDs and retained gap/anchor affiliations
// travel through the same boundary machinery used without placements.
export function placementBoundaryPath(state, intent, resolve) {
  if (
    !["listEnter", "listBoundaryActive", "listHold", "listHoldActive"].includes(
      intent.kind,
    )
  )
    return null;
  const path = orderedCreationPlacements(state).filter((p) => p.projected);
  if (!path.length) return null;
  const block = intent.at ? resolve(intent.at).block : null;
  const family = intent.family
    ? state.listFamilies[intent.family]
    : Object.values(state.listFamilies).find((f) =>
        f.layout.blocks.includes(block),
      );
  if (family?.kind) return null;
  const creation = state.nodes[family?.source ?? block]?.creation;
  if (!creation) return null;
  return path.some((p) => p.creations.includes(creation)) ? path : null;
}
