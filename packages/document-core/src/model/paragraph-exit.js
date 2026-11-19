// SPDX-License-Identifier: MPL-2.0
import { treeParent, executeTree, withTreeProjection } from "./tree.js";

export function paragraphCreation(state, block) {
  const family = Object.values(state.listFamilies).find(
    (f) =>
      f.source === block ||
      Object.values(f.cuts).some((c) => c.block === block),
  );
  const source = family?.source ?? block;
  const r = state.creations[state.nodes[source]?.creation];
  return r?.kind === "paragraph" ? r : null;
}
// Paragraph exits use the existing owned-placement graph. Text and cut identity
// stay independent of tree geometry, including later moves and owned Undo.
export function paragraphExitSteps(
  state,
  intent,
  action,
  fail,
  revive = false,
) {
  const block = intent.root,
    n = state.nodes[block],
    item = treeParent(state, block),
    list = item && treeParent(state, item.id),
    to = list && treeParent(state, list.id);
  if (
    !n?.live ||
    n.type !== "paragraph" ||
    item?.type !== "list_item" ||
    item.children[0] === block ||
    item.children.at(-1) !== block ||
    !["ordered_list", "bullet_list"].includes(list?.type) ||
    !["doc", "cell", "list_item"].includes(to?.type)
  )
    throw fail("Continuation exit requires a trailing paragraph");
  let boundary = to;
  while (boundary && !["doc", "cell"].includes(boundary.type))
    boundary = treeParent(state, boundary.id);
  if (boundary?.id !== state.creations[intent.creation]?.scope)
    throw fail("Continuation exit cannot cross its document/cell scope");
  return withTreeProjection(state, (projected) => {
    const steps = [],
      node = (id) => projected.nodes[id],
      parent = (id) => treeParent(projected, id);
    const add = (i) => {
      executeTree(projected, i, `${action}:part:${steps.length}`, {
        write: () => projected.nodes,
        fail,
      });
      steps.push(i);
    };
    const place = (id, target, before) =>
      add({
        kind: "treePlace",
        node: id,
        from: parent(id).id,
        parent: target,
        before,
        expected: node(id).placement ?? null,
      });
    let before = to.children[to.children.indexOf(list.id) + 1] ?? null;
    const following = list.children.slice(list.children.indexOf(item.id) + 1);
    if (following.length) {
      const suffix = action + ":following-list";
      add({
        kind: "treeWrap",
        id: suffix,
        type: list.type,
        nodes: following,
        from: list.id,
        expected: following.map((id) => node(id).placement ?? null),
        ...(revive ? { revive: true } : {}),
      });
      place(suffix, to.id, before);
      before = suffix;
    }
    place(block, to.id, before);
    return { kind: "batch", intents: steps };
  });
}
// A cut made after an exit keeps its own placement when that exit is undone.
// Only destinations certified by the placement ledger are admitted here.
export function retainedParagraphParent(state, r, parent) {
  if (r.kind !== "paragraph" || !parent) return false;
  let scope = parent;
  while (scope && !["doc", "cell"].includes(scope.type))
    scope = treeParent(state, scope.id);
  return (
    scope?.id === r.scope &&
    (parent.id === r.parent ||
      Object.values(state.creationPlacements).some(
        (p) =>
          p.creations.includes(r.id) &&
          p.intent.kind === "creationParagraphExit" &&
          p.destination === parent.id,
      ))
  );
}
