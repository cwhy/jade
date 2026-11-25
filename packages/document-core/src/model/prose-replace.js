// SPDX-License-Identifier: MPL-2.0
import { validateDisplayJoin, displayJoinBlocks } from "./display-boundary.js";
import { conversionSourceScope, conversionLayout } from "./text-conversion.js";
import { locations } from "./locations.js";
import { validateFragment } from "../fragment.js";
import { treeParent } from "./tree.js";
import { boundaryJoinIntent, joinTarget } from "./join-ledger.js";
import { paragraphForEnter } from "./list-boundary.js";
// A semantic edit owns selected character/boundary identities. It never takes
// client-authored repartition steps or future character identities.
export function validateProseReplace(state, intent, { resolve, fail }) {
  const bad = (message) => {
    throw fail(message);
  };
  if (
    !intent ||
    Object.keys(intent).some(
      (k) =>
        ![
          "kind",
          "parent",
          "at",
          "end",
          "ids",
          "joins",
          "fragment",
          "conversion",
          "conversions",
        ].includes(k),
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
  if (
    intent.conversions !== undefined &&
    (intent.conversion !== undefined ||
      !Array.isArray(intent.conversions) ||
      !intent.conversions.length ||
      intent.conversions.some((id) => typeof id !== "string") ||
      new Set(intent.conversions).size !== intent.conversions.length)
  )
    bad("Invalid text scope witnesses");
  let scopes = [];
  try {
    scopes = (
      intent.conversions ||
      (intent.conversion === undefined ? [] : [intent.conversion])
    ).map((id) => conversionSourceScope(state, id));
  } catch (error) {
    bad(error.message);
  }
  if (scopes.some((s) => s.entry.parent !== intent.parent))
    bad("Text selection changed container");
  const retained = scopes.length
    ? { sources: [...new Set(scopes.flatMap((s) => s.sources))] }
    : null;
  const sourceAllowed = (id) =>
    treeParent(state, id)?.id === parent.id ||
    !!retained?.sources.includes(id) ||
    !!conversionLayout(state, parent.id)?.some((group) =>
      group.blocks.includes(id),
    );
  let point;
  try {
    point = resolve(intent.at);
  } catch {
    bad("Invalid prose replacement position");
  }
  if (
    !["paragraph", "code"].includes(state.nodes[point.block]?.type) ||
    !sourceAllowed(point.block)
  )
    bad("Prose replacement crosses a container");
  if (intent.end !== undefined) {
    let end;
    try {
      end = resolve(intent.end);
    } catch {
      bad("Invalid replacement end");
    }
    if (
      !["paragraph", "code"].includes(state.nodes[end.block]?.type) ||
      !sourceAllowed(end.block)
    )
      bad("Replacement end crosses a container");
  }
  const positions = intent.ids.length ? locations(state) : null;
  for (const id of intent.ids) {
    const located = positions.get(id);
    if (
      located &&
      (!["paragraph", "code"].includes(state.nodes[located.block]?.type) ||
        !sourceAllowed(located.block))
    )
      bad("Prose erasure crosses a container");
  }
  const seen = new Set();
  for (const target of intent.joins) {
    if (target?.kind === "displayJoin") {
      const key = JSON.stringify(target);
      if (!retained || target.parent !== parent.id || seen.has(key))
        bad("Invalid retained display replacement boundary");
      try {
        validateDisplayJoin(state, target);
        if (displayJoinBlocks(state, target).some((id) => !sourceAllowed(id)))
          bad("Display boundary left its conversion scope");
      } catch (error) {
        bad(error.message);
      }
      seen.add(key);
      continue;
    }
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
    if (retained) {
      if (!retained.sources.includes(target.right))
        bad("Replacement boundary left its retained selection");
      boundaryJoinIntent(state, target);
    } else if (ownerId !== parent.id || (existing && existing.mode !== "prose"))
      bad("Prose replacement crosses a structural boundary");
  }
  const fragment = validateFragment(intent.fragment);
  if (fragment.blocks.some((b) => b.type !== "paragraph"))
    bad("Prose replacement requires paragraph content");
  if (
    (retained || state.nodes[point.block]?.type === "code") &&
    fragment.blocks.length !== 1
  )
    bad("Code source requires literal text replacement");
  return fragment;
}
export function executeProseReplace(state, intent, action, host) {
  const fragment = validateFragment(intent.fragment),
    inverse = [];
  const step = (i, id) => inverse.unshift(host.execute(i, id));
  // Joins change contributions now; visible joins are projected after the full
  // command. Erasure therefore retains each original paragraph's affiliation.
  for (const [i, target] of intent.joins.entries())
    step(
      target.kind === "displayJoin"
        ? target
        : intent.conversion || intent.conversions
          ? boundaryJoinIntent(state, target)
          : { kind: "proseJoin", target },
      `${action}:join:${i}`,
    );
  const retainedReplacement = intent.end && fragment.blocks.length === 1;
  // Anchor new text at the retained source's end. Hidden display boundaries
  // keep its visible placement unchanged, while contributions typed inside it
  // already belong to the source restored after the selected range on Undo.
  if (!retainedReplacement && intent.ids.length)
    step({ kind: "delete", ids: intent.ids }, `${action}:erase`);
  let at = host.resolve(retainedReplacement ? intent.end : intent.at);
  for (const [i, block] of fragment.blocks.entries()) {
    if (i) {
      step(
        { kind: "proseEnter", at: host.gap(at.block, at.offset) },
        `${action}:split:${i}`,
      );
      at = {
        block: paragraphForEnter(state, `${action}:split:${i}`),
        offset: 0,
      };
    }
    const runs = block.content.filter((run) => run.text.length);
    if (runs.length) {
      if (retainedReplacement)
        host.write("replacementOrigins")[`${action}:insert:${i}:char`] = {
          start: intent.at,
          end: intent.end,
          length: runs.reduce((n, r) => n + [...r.text].length, 0),
        };
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
  if (retainedReplacement && intent.ids.length)
    step({ kind: "delete", ids: intent.ids }, `${action}:erase`);
  return { kind: "batch", intents: inverse };
}
