// SPDX-License-Identifier: MPL-2.0
import {
  orderedCreationPlacements,
  requiredCreationPlacements,
  suspendCreationPlacements,
  resumeCreationPlacements,
} from "./creation-placement-projection.js";
// Independent structural contributions. A placement holds its prerequisite
// creation content, independently of the source layout. All changes are staged.
import { reconcileCreationContent } from "./creation-lifecycle.js";
export function beginCreationPlacement(state, intent, action, host) {
  if (intent.kind !== "creationItemMove") return null;
  const r = state.creations[intent.creation];
  if (
    !r ||
    r.root !== intent.root ||
    typeof intent.outdent !== "boolean" ||
    !(
      intent.basis === null ||
      state.creationPlacements[intent.basis]?.creations[0] === r.id
    )
  )
    throw host.fail("Unknown whole-item birth");
  const before = orderedCreationPlacements(state)
      .filter((p) => p.projected)
      .map((p) => p.id),
    path = requiredCreationPlacements(state, {
      creation: r.id,
      basis: intent.basis,
    });
  const rebase =
    before.length !== path.length || before.some((id, i) => id !== path[i].id);
  if (rebase) suspendCreationPlacements(state, host);
  const ids = new Set([r.id]);
  const creations = [...ids];
  for (const id of creations) {
    const r = state.creations[id];
    host.write("creations")[id] = {
      ...r,
      holds: { ...r.holds, [action]: true },
    };
    reconcileCreationContent(state, id, { ...host, action });
  }
  if (rebase) resumeCreationPlacements(state, path, host);
  return creations;
}
export function finishCreationPlacement(
  state,
  id,
  creations,
  intent,
  inverse,
  host,
) {
  const predecessor = intent.basis;
  host.write("creationPlacements")[id] = {
    id,
    creations,
    acceptedAt: state.revision + 1,
    active: true,
    projected: true,
    predecessor,
    intent,
    inverse,
  };
  return { kind: "creationPlacementActive", placement: id, active: false };
}
export function executeCreationPlacementActive(state, intent, action, host) {
  const p = state.creationPlacements[intent.placement];
  if (!p || p.active === intent.active)
    throw host.fail("Creation placement ownership changed");
  const previous = orderedCreationPlacements(state)
    .filter((p) => p.projected)
    .map((p) => p.id);
  host.write("creationPlacements")[p.id] = { ...p, active: intent.active };
  const required = requiredCreationPlacements(state),
    same =
      previous.length === required.length &&
      previous.every((id, i) => id === required[i].id);
  // If a later move still selects this exact path, changing an earlier actor's
  // activity must not touch geometry or interpret the later direction again.
  if (!same) suspendCreationPlacements(state, host);
  for (const id of p.creations) {
    const r = state.creations[id];
    host.write("creations")[id] = {
      ...r,
      holds: { ...r.holds, [p.id]: intent.active },
    };
    if (intent.active) reconcileCreationContent(state, id, { ...host, action });
  }
  if (!same) resumeCreationPlacements(state, required, host);
  return { ...intent, active: !intent.active };
}
export function validateCreationPlacements(state) {
  if (!state.creationPlacements || typeof state.creationPlacements !== "object")
    throw Error("Missing creation placements");
  const seen = new Set(),
    ordinals = new Set(),
    required = new Set(requiredCreationPlacements(state).map((p) => p.id));
  for (const p of orderedCreationPlacements(state)) {
    const id = p.id;
    if (
      state.creationPlacements[id] !== p ||
      !Number.isSafeInteger(p.acceptedAt) ||
      p.acceptedAt < 1 ||
      p.acceptedAt > state.revision ||
      ordinals.has(p.acceptedAt)
    )
      throw Error("Invalid placement acceptance order");
    ordinals.add(p.acceptedAt);
    if (
      p.id !== id ||
      typeof p.active !== "boolean" ||
      typeof p.projected !== "boolean" ||
      p.projected !== required.has(id) ||
      !Array.isArray(p.creations) ||
      p.creations.length !== 1 ||
      new Set(p.creations).size !== p.creations.length ||
      !p.inverse
    )
      throw Error("Invalid creation placement");
    if (p.predecessor !== p.intent?.basis)
      throw Error("Placement destination basis changed");
    if (
      p.predecessor !== null &&
      (!seen.has(p.predecessor) ||
        state.creationPlacements[p.predecessor].creations[0] !== p.creations[0])
    )
      throw Error("Invalid accepted placement predecessor");
    if (
      p.intent?.kind !== "creationItemMove" ||
      p.intent.creation !== p.creations[0] ||
      p.intent.root !== state.creations[p.creations[0]]?.root ||
      typeof p.intent.outdent !== "boolean"
    )
      throw Error("Invalid accepted placement intent");
    seen.add(id);
    for (const key of p.creations)
      if (state.creations[key]?.holds[id] !== p.active)
        throw Error("Mismatched creation placement dependency");
  }
  for (const r of Object.values(state.creations)) {
    if (
      typeof r.contentApplied !== "boolean" ||
      typeof r.sourceApplied !== "boolean" ||
      !r.contentInverse ||
      !r.sourceInverse ||
      !r.holds ||
      typeof r.holds !== "object" ||
      r.sourceApplied !== r.active ||
      r.contentApplied !== (r.active || Object.values(r.holds).some(Boolean))
    )
      throw Error("Invalid creation topology lifetime");
    for (const [id, active] of Object.entries(r.holds))
      if (
        typeof active !== "boolean" ||
        !state.creationPlacements[id]?.creations.includes(r.id) ||
        state.creationPlacements[id].active !== active
      )
        throw Error("Unknown creation placement dependency");
  }
}
