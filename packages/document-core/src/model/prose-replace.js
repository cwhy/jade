// SPDX-License-Identifier: MPL-2.0
import { locations } from "./locations.js";
import { validateFragment } from "../fragment.js";
import { treeParent } from "./tree.js";
import { joinTarget } from "./join-ledger.js";
// A semantic edit owns selected character/boundary identities. It never takes
// client-authored repartition steps or future character identities.
export function validateProseReplace(state, intent, { resolve, fail }) {
  const bad = (message) => {
    throw fail(message);
  };
  if (
    !intent ||
    Object.keys(intent).some(
      (k) => !["kind", "parent", "at", "ids", "joins", "fragment"].includes(k),
    ) ||
    typeof intent.parent !== "string" ||
    !Array.isArray(intent.ids) ||
    intent.ids.some((id) => typeof id !== "string" || !id) ||
    new Set(intent.ids).size !== intent.ids.length ||
    !Array.isArray(intent.joins)
  )
    bad("Invalid prose replacement");
  const parent = state.nodes[intent.parent];
  if (!parent?.live || !["doc", "cell"].includes(parent.type))
    bad("Invalid prose replacement container");
  let point;
  try {
    point = resolve(intent.at);
  } catch {
    bad("Invalid prose replacement position");
  }
  if (
    state.nodes[point.block]?.type !== "paragraph" ||
    treeParent(state, point.block)?.id !== parent.id
  )
    bad("Prose replacement crosses a container");
  const positions = intent.ids.length ? locations(state) : null;
  for (const id of intent.ids) {
    const located = positions.get(id);
    if (
      located &&
      (state.nodes[located.block]?.type !== "paragraph" ||
        treeParent(state, located.block)?.id !== parent.id)
    )
      bad("Prose erasure crosses a container");
  }
  const seen = new Set();
  for (const target of intent.joins) {
    if (
      !target ||
      typeof target.right !== "string" ||
      Object.keys(target).sort().join(",") !== "creator,id,right" ||
      seen.has(target.id)
    )
      bad("Invalid prose replacement boundary");
    seen.add(target.id);
    const expected = joinTarget(state, target.right),
      existing = state.listJoins[target.id],
      family = target.creator && state.listFamilies[target.creator.family];
    if (
      target.id !== expected.id ||
      JSON.stringify(target.creator) !== JSON.stringify(expected.creator) ||
      !state.nodes[target.right]
    )
      bad("Forged prose replacement boundary");
    const owner = treeParent(state, target.right),
      ownerId =
        owner?.id ??
        (existing?.mode === "prose"
          ? existing.parent
          : family?.kind === "prose"
            ? family.parent
            : null);
    if (ownerId !== parent.id || (existing && existing.mode !== "prose"))
      bad("Prose replacement crosses a structural boundary");
  }
  const fragment = validateFragment(intent.fragment);
  if (fragment.blocks.some((b) => b.type !== "paragraph"))
    bad("Prose replacement requires paragraph content");
  return fragment;
}
export function executeProseReplace(state, intent, action, host) {
  const fragment = validateFragment(intent.fragment),
    inverse = [];
  const step = (i, id) => inverse.unshift(host.execute(i, id));
  // Joins change contributions now; visible joins are projected after the full
  // command. Erasure therefore retains each original paragraph's affiliation.
  for (const [i, target] of intent.joins.entries())
    step({ kind: "proseJoin", target }, `${action}:join:${i}`);
  if (intent.ids.length)
    step({ kind: "delete", ids: intent.ids }, `${action}:erase`);
  let at = host.resolve(intent.at);
  for (const [i, block] of fragment.blocks.entries()) {
    if (i) {
      step(
        { kind: "proseEnter", at: host.gap(at.block, at.offset) },
        `${action}:split:${i}`,
      );
      at = { block: `${action}:split:${i}:paragraph`, offset: 0 };
    }
    const runs = block.content.filter((run) => run.text.length);
    if (runs.length) {
      step(
        { kind: "insert", at: host.gap(at.block, at.offset), runs },
        `${action}:insert:${i}`,
      );
      at = {
        block: at.block,
        offset: at.offset + runs.reduce((n, r) => n + [...r.text].length, 0),
      };
    }
  }
  return { kind: "batch", intents: inverse };
}
