// SPDX-License-Identifier: MPL-2.0
import { identities } from "../text/pieces.js";
import { locations } from "./locations.js";
// Semantic deletion membership is independent of the currently visible text.
// Physical masks retain the existing erasure/cut metadata and are caches of
// visibility transitions, never the authority for Undo ownership.
export function executeTextClaim(state, intent, action, host) {
  let id, claim;
  if (intent.kind === "textClaimActive") {
    id = intent.claim;
    claim = state.textClaims[id];
    if (
      !claim ||
      typeof intent.active !== "boolean" ||
      claim.active === intent.active
    )
      throw host.fail("Text deletion activity changed");
    host.write("textClaims")[id] = { ...claim, active: intent.active };
  } else {
    id = action;
    if (state.textClaims[id]) throw host.fail("Text deletion identity reused");
    // Preserve the existing no-op meaning of unknown identities. A deletion
    // cannot reserve a future actor/sequence identity before it exists.
    const live = locations(state);
    claim = {
      id,
      ids: intent.ids.filter((id) => live.has(id) || state.deleted[id]),
      active: true,
    };
    host.write("textClaims")[id] = claim;
  }
  const target = new Set(claim.ids),
    affected = new Set(target),
    expanded = [];
  // Rebuild the masks intersecting this contribution, including hidden overlap.
  // Other inactive edits keep their own restoration affiliations unchanged.
  const masks = Object.entries(state.textMasks).map(([key, mask]) => ({
      key,
      mask,
    })),
    selected = new Set();
  for (const entry of masks)
    if (entry.mask.ids.some((id) => target.has(id))) selected.add(entry.key);
  for (const entry of masks)
    if (selected.has(entry.key)) {
      expanded.push([entry.key, entry.mask]);
      for (const id of entry.mask.ids) affected.add(id);
    }
  // Invert physical removals in reverse order. Semantic claim order does not
  // determine text order; retained boundaries and origins do.
  for (const [key, mask] of expanded.toReversed()) {
    host.execute(mask.inverse, `${action}:unmask:${key}`);
    delete host.write("textMasks")[key];
  }
  const hidden = new Set();
  for (const c of Object.values(state.textClaims))
    if (c.active) for (const id of c.ids) if (affected.has(id)) hidden.add(id);
  if (hidden.size) {
    const key = `${action}:mask`,
      inverse = host.remove({ kind: "delete", ids: [...hidden] }, key),
      ids = [];
    function collect(i) {
      if (i.kind === "batch") i.intents.forEach(collect);
      else if (i.kind === "insert") ids.push(...host.identities(i.pieces));
    }
    collect(inverse);
    if (ids.length) host.write("textMasks")[key] = { ids, inverse };
  }
  return {
    kind: "textClaimActive",
    claim: id,
    active: intent.kind === "textClaimActive" ? !intent.active : false,
  };
}
export function validateTextClaims(state) {
  if (!state.textClaims || !state.textMasks)
    throw Error("Missing text visibility ledger");
  for (const [id, c] of Object.entries(state.textClaims))
    if (
      c.id !== id ||
      typeof c.active !== "boolean" ||
      !Array.isArray(c.ids) ||
      new Set(c.ids).size !== c.ids.length ||
      c.ids.some((id) => typeof id !== "string")
    )
      throw Error("Invalid text deletion claim");
  const masked = new Set(),
    active = new Set(),
    live = locations(state);
  for (const c of Object.values(state.textClaims))
    if (c.active)
      for (const id of c.ids) {
        active.add(id);
        if (live.has(id)) throw Error("Active deletion claim has visible text");
      }
  for (const mask of Object.values(state.textMasks)) {
    if (!Array.isArray(mask.ids) || mask.inverse?.kind !== "batch")
      throw Error("Invalid text mask");
    const restored = [];
    function collect(i) {
      if (i.kind === "batch") i.intents.forEach(collect);
      else if (i.kind === "insert" && i.pieces && i.erasure && i.restore) {
        for (const id of identities(i.pieces)) {
          if (state.deleted[id] !== i.restore)
            throw Error("Physical deletion ownership mismatch");
          restored.push(id);
        }
      } else throw Error("Invalid physical text restoration");
    }
    collect(mask.inverse);
    if (JSON.stringify(restored) !== JSON.stringify(mask.ids))
      throw Error("Text mask identities mismatch");
    for (const id of mask.ids) {
      if (masked.has(id) || !state.deleted[id] || !active.has(id))
        throw Error("Text mask ownership mismatch");
      masked.add(id);
    }
  }
}
