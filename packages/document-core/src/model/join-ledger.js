// SPDX-License-Identifier: MPL-2.0
// Codec-10 experiment: logical deletion contributions are authoritative; visible
// text/tree joins are reversible projections. Never expose projection inverses
// as public operations or mix these checkpoints with earlier codecs.
import { treeParent } from "./tree.js";
import { creationProseParent } from "./creation-extent.js";
const list = (n) => ["ordered_list", "bullet_list"].includes(n?.type);
// Only the first child paragraph is adjacent in traversal order. Atomic blocks
// after its child-list are untouched suffixes, not content crossed by the join.
export function supportedJoinLeft(state, item, firstChild) {
  return firstChild
    ? item.children
        .slice(2)
        .every((id) => ["code", "image"].includes(state.nodes[id]?.type))
    : item.children.length === 1;
}
export function joinTarget(state, right) {
  for (const f of Object.values(state.listFamilies))
    for (const c of Object.values(f.cuts))
      if (c.block === right)
        return { id: c.id, right, creator: { family: f.id, cut: c.id } };
  return { id: `seed:${right}`, right, creator: null };
}
export function executeJoinContribution(
  state,
  intent,
  action,
  { write, fail },
) {
  const joins = write("listJoins");
  if (intent.kind === "listJoinActive") {
    const old = joins[intent.boundary],
      contribution = old?.contributions[intent.contribution];
    if (!contribution || contribution.active === intent.active)
      throw fail("Join contribution changed");
    joins[old.id] = {
      ...old,
      contributions: {
        ...old.contributions,
        [intent.contribution]: { active: intent.active },
      },
    };
    return { ...intent, active: !intent.active };
  }
  const target = intent.target,
    old = joins[target.id];
  if (
    old &&
    (old.right !== target.right ||
      JSON.stringify(old.creator) !== JSON.stringify(target.creator))
  )
    throw fail("Boundary identity changed");
  if (!old && !state.nodes[target.right]?.live)
    throw fail("Join target is unavailable");
  const mode = intent.kind === "proseJoin" ? "prose" : "list";
  if (old && (old.mode || "list") !== mode) throw fail("Join grammar changed");
  if (
    mode === "prose" &&
    !old &&
    !["doc", "cell"].includes(treeParent(state, target.right)?.type)
  )
    throw fail("Prose join context changed");
  joins[target.id] = {
    ...target,
    ...(mode === "prose"
      ? { mode, parent: old?.parent ?? treeParent(state, target.right).id }
      : {}),
    contributions: { ...old?.contributions, [action]: { active: true } },
  };
  return {
    kind: "listJoinActive",
    boundary: target.id,
    contribution: action,
    active: false,
  };
}
export function expandJoins(state, action, host) {
  for (const [i, entry] of [...state.joinProjection].reverse().entries())
    host.execute(entry.inverse, `${action}:expand:${i}`, {
      boundary: entry.boundary,
    });
  const entries = host.write("joinProjection");
  entries.length = 0;
}
function visibleCreator(state, b) {
  return (
    !b.creator ||
    state.listFamilies[b.creator.family]?.cuts[b.creator.cut]?.active
  );
}
function preceding(state, right, fail) {
  const item = treeParent(state, right),
    owner = item && treeParent(state, item.id);
  if (!item || item.children[0] !== right || !list(owner))
    throw fail("Join right side changed structure");
  const index = owner.children.indexOf(item.id);
  if (index === 0) {
    const parent = treeParent(state, owner.id);
    if (parent?.type === "list_item" && parent.children[1] === owner.id)
      return parent.children[0];
    return null;
  }
  const previous = state.nodes[owner.children[index - 1]];
  if (previous.children.length !== 1)
    throw fail("Join would cross an attachment or descendant");
  return previous.children[0];
}
function projectOne(state, b, action, host) {
  if (b.mode === "prose") {
    const owner = treeParent(state, b.right),
      index = owner?.children.indexOf(b.right),
      left = state.nodes[owner?.children[index - 1]],
      right = state.nodes[b.right];
    // A certified prose cut and its join keep the same paragraph grammar when
    // their creation is rewrapped. Follow that existing family only; a move
    // cannot turn an unrelated neighbouring block into a join predecessor.
    const family = b.creator && state.listFamilies[b.creator.family],
      creation =
        family && state.creations[state.nodes[family.source]?.creation];
    const retained =
      family?.kind === "prose" &&
      family.cuts[b.creator.cut]?.block === b.right &&
      creation &&
      [creation.scope, creation.root].includes(b.parent) &&
      family.layout.blocks.includes(left?.id) &&
      creationProseParent(state, family, (id) => treeParent(state, id))?.id ===
        owner?.id;
    if (
      !owner ||
      !(
        (owner.id === b.parent && ["doc", "cell"].includes(owner.type)) ||
        retained
      ) ||
      left?.type !== "paragraph" ||
      right?.type !== "paragraph"
    )
      throw host.fail("Prose join would cross a structural boundary");
    return {
      kind: "batch",
      intents: [
        host.execute(
          { kind: "join", left: left.id, right: right.id },
          `${action}:part:0`,
          { boundary: b.id },
        ),
      ],
    };
  }
  const leftId = preceding(state, b.right, host.fail);
  if (!leftId) throw host.fail("Join predecessor unavailable");
  const left = state.nodes[leftId],
    right = state.nodes[b.right],
    item = treeParent(state, leftId),
    owner = treeParent(state, item.id),
    rightItem = treeParent(state, right.id);
  const child = state.nodes[item.children[1]],
    firstChild = list(child) && child.children[0] === rightItem.id,
    rightChild = state.nodes[rightItem.children[1]];
  if (
    left.type !== "paragraph" ||
    right.type !== "paragraph" ||
    !supportedJoinLeft(state, item, firstChild) ||
    (rightItem.children.length > 1 &&
      (!list(rightChild) || rightItem.children.length !== 2)) ||
    (firstChild && rightChild)
  )
    throw host.fail("Join projection requires a supported text/list shape");
  const inverses = [];
  let part = 0;
  const step = (i) =>
    inverses.unshift(
      host.execute(i, `${action}:part:${part++}`, { boundary: b.id }),
    );
  const place = (id, to, before = null) =>
    step({
      kind: "treePlace",
      node: id,
      from: treeParent(state, id).id,
      parent: to,
      before,
      expected: state.nodes[id].placement ?? null,
    });
  const prune = (id) =>
    step({
      kind: "treePrune",
      node: id,
      expected: state.nodes[id].placement ?? null,
    });
  if (rightChild) {
    const before =
      owner.children[owner.children.indexOf(rightItem.id) + 1] ?? null;
    for (const id of [...rightChild.children]) place(id, owner.id, before);
    prune(rightChild.id);
  }
  place(right.id, item.id, firstChild ? child.id : null);
  step({ kind: "join", left: left.id, right: right.id });
  prune(rightItem.id);
  if (firstChild && !state.nodes[child.id].children.length) prune(child.id);
  return { kind: "batch", intents: inverses };
}
export function projectJoins(state, action, host) {
  const order = [];
  function walk(id) {
    const n = state.nodes[id];
    if (n.text) order.push(id);
    for (const c of n.children || []) walk(c);
  }
  walk(state.root);
  const joins = Object.values(state.listJoins)
    .filter(
      (b) =>
        !b.suspendedBy &&
        visibleCreator(state, b) &&
        Object.values(b.contributions).some((c) => c.active),
    )
    .sort((a, b) => order.indexOf(a.right) - order.indexOf(b.right));
  for (const [i, b] of joins.entries()) {
    if (!state.nodes[b.right]?.live)
      throw host.fail("Active boundary has no logical right partition");
    const inverse = projectOne(state, b, `${action}:project:${i}`, host);
    host.write("joinProjection").push({ boundary: b.id, inverse });
  }
}
export function validateJoins(state) {
  if (!state.listJoins || !Array.isArray(state.joinProjection))
    throw Error("Missing join ledger");
  const projected = new Set();
  for (const p of state.joinProjection) {
    if (
      !state.listJoins[p.boundary] ||
      projected.has(p.boundary) ||
      p.inverse?.kind !== "batch"
    )
      throw Error("Invalid join projection");
    projected.add(p.boundary);
  }
  for (const [id, b] of Object.entries(state.listJoins)) {
    if (
      (b.mode !== undefined && b.mode !== "prose") ||
      (b.mode === "prose" &&
        !["doc", "cell"].includes(state.nodes[b.parent]?.type))
    )
      throw Error("Invalid prose join grammar");
    if (
      b.id !== id ||
      !state.nodes[b.right] ||
      !b.contributions ||
      Object.values(b.contributions).some((c) => typeof c.active !== "boolean")
    )
      throw Error("Invalid join ledger");
    if (
      b.suspendedBy &&
      (typeof b.suspendedBy !== "string" ||
        (state.nodes[b.right]?.clearedBy ??
          state.nodes[b.right]?.structureDeletedBy) !== b.suspendedBy ||
        state.nodes[b.right]?.live)
    )
      throw Error("Invalid suspended join lifecycle");
    const active =
      !b.suspendedBy &&
      !!visibleCreator(state, b) &&
      Object.values(b.contributions).some((c) => c.active);
    if (active !== projected.has(id))
      throw Error("Join projection disagrees with ledger");
  }
}

// Reuse a projection only when the mutation footprint cannot change its
// partition ownership. Existing retained cut markers track offset changes.
// A seam insertion or any restoration/structural operation reprojects; these
// can distinguish authored sides even when their visible offsets coincide.
export function canReuseJoinProjection(state, intent, host) {
  if (!Object.keys(state.listJoins).length)
    return (
      intent.kind !== "richInsert" &&
      intent.kind !== "richForestActive" &&
      intent.kind !== "proseReplace" &&
      intent.kind !== "proseJoin" &&
      intent.kind !== "listJoin" &&
      intent.kind !== "listJoinActive" &&
      !(
        intent.kind === "batch" &&
        intent.intents.some((i) => !canReuseJoinProjection(state, i, host))
      )
    );
  if (intent.kind === "batch")
    return intent.intents.every((i) => canReuseJoinProjection(state, i, host));
  if (intent.kind === "format" || intent.kind === "formatActive") return true;
  if (
    intent.kind !== "insert" ||
    typeof intent.text !== "string" ||
    intent.erasure ||
    intent.restore ||
    intent.origin
  )
    return false;
  const at = host.resolve(intent.at);
  let safe = true;
  function check(i) {
    if (i.kind === "batch") {
      i.intents.forEach(check);
      return;
    }
    if (i.kind !== "split") return;
    const cut = state.boundaries[i.at.boundary];
    if (cut.block === at.block && cut.offset === at.offset) safe = false;
  }
  state.joinProjection.forEach((p) => check(p.inverse));
  return safe;
}
