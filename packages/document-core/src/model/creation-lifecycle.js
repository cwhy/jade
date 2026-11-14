// SPDX-License-Identifier: MPL-2.0
import { creationExtent } from "./creation-extent.js";
import {
  suspendCreationPlacements,
  resumeCreationPlacements,
} from "./creation-placement-projection.js";
// Isolated creation-ownership experiment. A birth can be inactive while text
// from an independent operation still needs a minimal grammatical container.
import { treeParent } from "./tree.js";
import { predecessor } from "./draft.js";
import { changedKeys } from "./changed-keys.js";
import { isImmutable } from "./immutable.js";
const checkedCreations = new WeakMap();
const sameIds = (a, b) =>
  a.length === b.length && a.every((id, i) => id === b[i]);
const blocked = (n) =>
  !n || n.clearedBy || n.structureDeletedBy || n.richRetiredBy;
export function registerCreation(state, record, { write }) {
  if (state.creations[record.id]) throw Error("Reused creation identity");
  write("creations")[record.id] = { ...record, active: true };
  for (const id of record.members)
    write("nodes")[id] = { ...state.nodes[id], creation: record.id };
}
function requireScope(state, r, fail) {
  const scope = state.nodes[r.scope],
    parent = state.nodes[r.parent];
  if (
    blocked(scope) ||
    !scope.live ||
    blocked(parent) ||
    (!parent.live && !heldCreation(r)) ||
    (scope.clearOwner ?? null) !== r.clearOwner
  )
    throw fail("Created content scope was cleared or deleted");
  for (const id of r.members)
    if (blocked(state.nodes[id]))
      throw fail("Created content was explicitly cleared or deleted");
}
function setVisibility(state, id, live, { write }) {
  const current = state.nodes[id];
  // Visibility is a derived value: an unchanged projection must not invalidate
  // the immutable node/replica maps or their validation/render caches.
  if (
    current.live === live &&
    (live
      ? !current.creationHidden
      : current.creationHidden === current.creation)
  )
    return;
  const n = { ...current, live };
  if (live) {
    delete n.creationHidden;
    delete n.retiredBy;
  } else {
    n.creationHidden = n.creation;
    n.retiredBy = n.creation;
  }
  write("nodes")[id] = n;
  if (n.text)
    write("replicas")[n.text] = { ...state.replicas[n.text], retired: !live };
  for (const [key, b] of Object.entries(state.boundaries))
    if (b.block === id) {
      const next = { ...b };
      if (live) delete next.retiredBy;
      else next.retiredBy = n.creation;
      write("boundaries")[key] = next;
    }
}
const topology = creationExtent;
function requireRetainedPlacement(state, r, host) {
  const root = state.nodes[r.root],
    owner = treeParent(state, r.root);
  if (
    !state.nodes[r.parent]?.live ||
    (!root.live && !root.creationHidden) ||
    (owner && owner.id !== r.parent)
  )
    throw host.fail(
      "Pasted item placement changed; Undo needs structural review",
    );
  const { roots, children } = topology(state, r, host.fail);
  if (
    roots.some((id) => {
      const p = treeParent(state, id);
      return p && p.id !== r.parent;
    })
  )
    throw host.fail(
      "Pasted item placement changed; Undo needs structural review",
    );
  const expected = children.filter((id) => state.nodes[id]?.live);
  if (root.live && !sameIds(root.children, expected))
    throw host.fail(
      "Pasted item children changed; Undo needs structural review",
    );
}
function attach(state, r, host) {
  const { roots } = topology(state, r, host.fail),
    present = roots.filter((id) => treeParent(state, id));
  if (present.length) {
    if (
      present.length !== roots.length ||
      present.some((id) => treeParent(state, id).id !== r.parent)
    )
      throw host.fail("Created family moved outside its retained placement");
    return;
  }
  const parent = state.nodes[r.parent],
    children = [...parent.children];
  let at =
    r.after !== null
      ? children.indexOf(r.after) + 1
      : children.indexOf(r.before);
  if ((r.after !== null && at === 0) || at < 0)
    throw host.fail("Creation placement boundary changed");
  children.splice(at, 0, ...roots);
  host.write("nodes")[parent.id] = { ...parent, children };
}
function detach(state, r, host) {
  const { roots } = topology(state, r, host.fail);
  for (const id of roots) {
    const p = treeParent(state, id);
    if (p)
      host.write("nodes")[p.id] = {
        ...p,
        children: p.children.filter((key) => key !== id),
      };
  }
}
// Canonical activation is distinct from materialized source and content state.
export function heldCreation(r) {
  return Object.values(r.holds).some(Boolean);
}
export function reconcileCreationContent(state, id, host) {
  let r = state.creations[id],
    desired = r.active || heldCreation(r);
  if (r.contentApplied === desired) return;
  // Deactivating a pasted attachment must not erase a later sizing edit. This
  // also applies when the last independent placement hold is being released.
  if (!desired && r.members.some((key) => state.nodes[key]?.imageSizeOwner))
    throw host.fail(
      "Pasted image was resized; Undo cannot remove that contribution",
    );
  requireScope(state, r, host.fail);
  if (desired) {
    for (const key of r.members) setVisibility(state, key, true, host);
    host.write("nodes")[r.root] = {
      ...state.nodes[r.root],
      children: topology(state, r, host.fail).children,
    };
    attach(state, r, host);
  }
  const inverse = host.execute(
    r.contentInverse,
    `${host.action}:content:${id}`,
  );
  host.write("creations")[id] = {
    ...state.creations[id],
    contentApplied: desired,
    contentInverse: inverse,
  };
}
function reconcileCreationSource(state, id, host) {
  let r = state.creations[id];
  if (r.sourceApplied === r.active) return;
  // Source layout has its own activation. Holding the item cannot hold a cut.
  // An unchanged source inverse needs no placement/visibility manipulation.
  if (!r.sourceInverse.intents.length) {
    host.write("creations")[id] = { ...r, sourceApplied: r.active };
    return;
  }
  requireScope(state, r, host.fail);
  const placements = suspendCreationPlacements(state, host);
  detach(state, r, host);
  const inverse = host.execute(r.sourceInverse, `${host.action}:source:${id}`);
  r = {
    ...state.creations[id],
    sourceApplied: r.active,
    sourceInverse: inverse,
  };
  host.write("creations")[id] = r;
  if (r.active || heldCreation(r)) attach(state, r, host);
  resumeCreationPlacements(state, placements, host);
}
export function executeCreationActive(state, intent, action, host) {
  const r = state.creations[intent.creation];
  if (!r || r.active === intent.active)
    throw host.fail("Creation ownership changed");
  if (!heldCreation(r)) requireRetainedPlacement(state, r, host);
  requireScope(state, r, host.fail);
  host.write("creations")[r.id] = { ...r, active: intent.active };
  // Text identity restoration and source-cut ownership are separate transitions.
  // Birth content must be live before the source inverse can repartition it.
  if (intent.active) reconcileCreationContent(state, r.id, { ...host, action });
  reconcileCreationSource(state, r.id, { ...host, action });
  if (!intent.active)
    reconcileCreationContent(state, r.id, { ...host, action });
  return { ...intent, active: !intent.active };
}
export function prepareCreationTarget(state, intent, host) {
  if (!["insert", "listEnter", "proseEnter"].includes(intent.kind)) return;
  const gap = intent.at,
    id =
      gap?.codec === 3
        ? state.boundaries[gap.boundary]?.block
        : state.replicas[gap?.text]?.owner;
  const n = state.nodes[id],
    r = n?.creation && state.creations[n.creation];
  if (!r || !n.creationHidden) return;
  requireScope(state, r, host.fail);
  topology(state, r, host.fail);
  // Only a known retained target and its grammatical ancestors are revived.
  // The original pasted characters remain erased, and unrelated media stays hidden.
  for (const key of intent.kind === "listEnter"
    ? r.members
    : [r.root, r.children[0], id])
    setVisibility(state, key, true, host);
  const children = r.children.filter((key) => state.nodes[key].live);
  host.write("nodes")[r.root] = { ...state.nodes[r.root], children };
  attach(state, r, host);
}
function affectedCreations(state) {
  const base = predecessor(state);
  // With unchanged topology and birth/cut ownership, only a replica whose text
  // changed can alter dependent visibility. Immutable identities prove this;
  // decoded/mutable states or any structural change use the complete fallback.
  if (
    base &&
    isImmutable(base) &&
    state.nodes === base.nodes &&
    state.creations === base.creations &&
    state.listFamilies === base.listFamilies
  ) {
    const ids = new Set();
    for (const key of changedKeys(base.replicas, state.replicas)) {
      for (const replica of [base.replicas[key], state.replicas[key]]) {
        const id = state.nodes[replica?.owner]?.creation;
        if (id) ids.add(id);
      }
    }
    return [...ids].map((id) => state.creations[id]).filter(Boolean);
  }
  return Object.values(state.creations || {});
}
export function projectCreations(state, host) {
  for (let r of affectedCreations(state)) {
    if (r.contentApplied !== (r.active || heldCreation(r)))
      reconcileCreationContent(state, r.id, host);
    r = state.creations[r.id];
    if (r.active || heldCreation(r)) continue;
    // Destructive operations own their retirement; this projector never revives
    // their contents or rewrites their cell/row ownership tokens.
    if (
      !state.nodes[r.scope]?.live ||
      (state.nodes[r.scope].clearOwner ?? null) !== r.clearOwner ||
      r.members.some((id) => blocked(state.nodes[id]))
    )
      continue;
    requireScope(state, r, host.fail);
    const { f, members, children, cutMembers } = topology(state, r, host.fail);
    const keep = new Set(
      members.filter((id) => {
        const n = state.nodes[id];
        return n.text && state.replicas[n.text].length > 0;
      }),
    );
    const cuts = f && Object.values(f.cuts).some((c) => c.active);
    if (cuts) for (const id of cutMembers) keep.add(id);
    if (keep.size) {
      keep.add(r.root);
      keep.add(children[0]);
    }
    for (const id of members) {
      const n = state.nodes[id];
      if (n.creation !== r.id)
        host.write("nodes")[id] = { ...n, creation: r.id };
      // Inactive generated child lists are ordinary family tombstones, not birth
      // nodes. Do not give them a different retirement/activation lifecycle.
      if (id === f?.childList && !n.live && !keep.has(id)) continue;
      setVisibility(state, id, keep.has(id), host);
    }
    const visibleChildren = children.filter((id) => keep.has(id)),
      root = state.nodes[r.root];
    if (!sameIds(root.children, visibleChildren))
      host.write("nodes")[r.root] = { ...root, children: visibleChildren };
    if (keep.size) attach(state, r, host);
    else detach(state, r, host);
  }
}
export function validateCreations(state) {
  if (!state.creations || typeof state.creations !== "object")
    throw Error("Missing creation registry");
  const stable = isImmutable(state.creations) && isImmutable(state.nodes);
  if (stable && checkedCreations.get(state.creations) === state.nodes) return;
  for (const [key, r] of Object.entries(state.creations)) {
    if (
      r.id !== key ||
      typeof r.active !== "boolean" ||
      new Set(r.members).size !== r.members.length ||
      !r.members.includes(r.root) ||
      !Array.isArray(r.children) ||
      r.members.some((id) => state.nodes[id]?.creation !== key) ||
      !state.nodes[r.scope] ||
      !state.nodes[r.parent]
    )
      throw Error("Invalid creation ownership");
    if (
      r.members.some(
        (id) => state.nodes[id].creationHidden && state.nodes[id].live,
      )
    )
      throw Error("Hidden creation is live");
  }
  if (stable) checkedCreations.set(state.creations, state.nodes);
}

export function creationGapAfterStart(state, gap) {
  if (gap?.codec !== 2 || !gap.left || !state.deleted[gap.left]) return false;
  const source = state.replicas[gap.text],
    n = state.nodes[source?.owner],
    r = n?.creation && state.creations[n.creation];
  return !!r && !r.active && gap.offset > 0 && r.members.includes(n.id);
}

// Visibility of a retained, inactive birth is derived from its unjoined
// partitions. A rendered join may hide a live independent cut; do not use that
// rendered view as the source for creation visibility decisions.
export function creationRequiresJoinExpansion(state) {
  return state.joinProjection.some(({ boundary }) => {
    const join = state.listJoins[boundary],
      family = join?.creator && state.listFamilies[join.creator.family];
    const key = state.nodes[family?.source ?? join?.right]?.creation,
      r = key && state.creations[key];
    return r && !r.active && !heldCreation(r);
  });
}
