// SPDX-License-Identifier: MPL-2.0
import { retainedParagraphParent } from "./paragraph-exit.js";
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
const dependencyCache = new WeakMap();
const leafCreation = (r) => ["paragraph", "code"].includes(r.kind);
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
    (owner &&
      owner.id !== r.parent &&
      !retainedParagraphParent(state, r, owner))
  )
    throw host.fail(
      "Pasted item placement changed; Undo needs structural review",
    );
  const { roots, children } = topology(state, r, host.fail);
  if (
    roots.some((id) => {
      const p = treeParent(state, id);
      return p && p.id !== r.parent && !retainedParagraphParent(state, r, p);
    })
  )
    throw host.fail(
      "Pasted item placement changed; Undo needs structural review",
    );
  const expected = children.filter((id) => state.nodes[id]?.live);
  if (!leafCreation(r) && root.live && !sameIds(root.children, expected))
    throw host.fail(
      "Pasted item children changed; Undo needs structural review",
    );
}
// A delayed boundary operation may refer to an independently undone leaf.
// Only its certified creation can revive it; explicit deletion/clear still wins.
export function reviveCreationBoundary(state, block, host) {
  const node = state.nodes[block],
    r = state.creations[node?.creation];
  if (!node?.creationHidden || !r || !leafCreation(r)) return;
  requireScope(state, r, host.fail);
  if (!topology(state, r, host.fail).members.includes(block))
    throw host.fail("Unknown retained creation boundary");
  setVisibility(state, r.root, true, host);
  setVisibility(state, block, true, host);
  attachCreation(state, r, host);
}
export function attachCreation(state, r, host) {
  let { roots } = topology(state, r, host.fail);
  if (leafCreation(r)) roots = roots.filter((id) => state.nodes[id]?.live);
  const present = roots.filter((id) => treeParent(state, id));
  if (present.length) {
    if (
      present.length !== roots.length ||
      present.some((id) => {
        const p = treeParent(state, id);
        return p.id !== r.parent && !retainedParagraphParent(state, r, p);
      })
    )
      throw host.fail("Created family moved outside its retained placement");
    return;
  }
  let parent = state.nodes[r.parent],
    children = [...parent.children];
  if (leafCreation(r)) {
    let anchor = state.nodes[r.boundary.anchor];
    const prerequisite = state.creations[anchor?.creation];
    if (
      !anchor?.live &&
      anchor?.creationHidden &&
      prerequisite &&
      leafCreation(prerequisite) &&
      prerequisite.parent === r.parent &&
      prerequisite.scope === r.scope &&
      prerequisite.acceptedAt < r.acceptedAt
    ) {
      requireScope(state, prerequisite, host.fail);
      // Revive only the retained structural boundary. Its creator's inactive
      // text/metadata operations are not replayed by a dependent's Redo.
      setVisibility(state, anchor.id, true, host);
      attachCreation(state, prerequisite, host);
      anchor = state.nodes[anchor.id];
      parent = state.nodes[r.parent];
      children = [...parent.children];
    }
    if (!anchor?.live || !children.includes(anchor.id))
      throw host.fail("Paragraph boundary is unavailable");
    const peers = Object.values(state.creations)
      .filter(
        (other) =>
          leafCreation(other) &&
          other.parent === r.parent &&
          other.boundary.anchor === r.boundary.anchor &&
          other.boundary.side === r.boundary.side,
      )
      .sort(
        (a, b) =>
          (r.boundary.side === "after" ? -1 : 1) *
          (a.acceptedAt - b.acceptedAt),
      );
    const index = peers.findIndex((other) => other.id === r.id);
    let at =
        children.indexOf(anchor.id) + (r.boundary.side === "after" ? 1 : 0),
      found = false;
    for (const other of peers.slice(index + 1)) {
      const ids = topology(state, other, host.fail).roots.filter((id) =>
        children.includes(id),
      );
      if (ids.length) {
        at = children.indexOf(ids[0]);
        found = true;
        break;
      }
    }
    if (!found)
      for (const other of peers.slice(0, index).reverse()) {
        const ids = topology(state, other, host.fail).roots.filter((id) =>
          children.includes(id),
        );
        if (ids.length) {
          at = children.indexOf(ids.at(-1)) + 1;
          break;
        }
      }
    children.splice(at, 0, ...roots);
    host.write("nodes")[parent.id] = { ...parent, children };
    return;
  }
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
    if (!leafCreation(r))
      host.write("nodes")[r.root] = {
        ...state.nodes[r.root],
        children: topology(state, r, host.fail).children,
      };
    attachCreation(state, r, host);
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
  if (r.active || heldCreation(r)) attachCreation(state, r, host);
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
    : [...new Set([r.root, r.children[0], id].filter(Boolean))])
    setVisibility(state, key, true, host);
  const children = r.children.filter((key) => state.nodes[key].live);
  if (!leafCreation(r))
    host.write("nodes")[r.root] = { ...state.nodes[r.root], children };
  attachCreation(state, r, host);
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
function boundaryDependencies(creations) {
  const cached = dependencyCache.get(creations);
  if (cached) return cached;
  const dependents = new Map();
  for (const dependent of Object.values(creations)) {
    const anchor = dependent.boundary?.anchor;
    if (!anchor) continue;
    if (!dependents.has(anchor)) dependents.set(anchor, []);
    dependents.get(anchor).push(dependent.root);
  }
  if (isImmutable(creations)) dependencyCache.set(creations, dependents);
  return dependents;
}
export function projectCreations(state, host) {
  const dependents = boundaryDependencies(state.creations);
  // Boundary dependencies point only to earlier births. Resolve children first
  // so Undo of the last dependent hides its now-unneeded anchor in this pass.
  for (let r of affectedCreations(state).slice().reverse()) {
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
        return (
          (n.text && state.replicas[n.text].length > 0) ||
          (n.type === "code" &&
            n.codeLanguages?.layers.some((layer) => layer.active)) ||
          (dependents.get(id) || []).some((root) => state.nodes[root]?.live)
        );
      }),
    );
    const cuts = f && Object.values(f.cuts).some((c) => c.active);
    if (cuts) for (const id of cutMembers) keep.add(id);
    if (keep.size) {
      keep.add(r.root);
      if (children[0]) keep.add(children[0]);
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
    if (!leafCreation(r) && !sameIds(root.children, visibleChildren))
      host.write("nodes")[r.root] = { ...root, children: visibleChildren };
    if (keep.size) attachCreation(state, r, host);
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
      r.kind !== undefined &&
      (!leafCreation(r) ||
        state.nodes[r.root]?.type !== r.kind ||
        r.children.length ||
        !r.boundary ||
        typeof r.boundary.anchor !== "string" ||
        !["before", "after"].includes(r.boundary.side) ||
        !Number.isSafeInteger(r.acceptedAt))
    )
      throw Error("Invalid paragraph creation ownership");
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
