// SPDX-License-Identifier: MPL-2.0
// A private Undo payload names immutable backing characters, not visible offsets.
// Consecutive identities can share one descriptor without changing ownership.
import {
  compactIdentities,
  validateIdentitySpans,
} from "../text/identity-spans.js";
import { identities } from "../text/pieces.js";
export function compactUndo(intent) {
  if (intent.kind === "batch")
    return { ...intent, intents: intent.intents.map(compactUndo) };
  if (
    !["delete", "formatActive"].includes(intent.kind) ||
    !Array.isArray(intent.ids)
  )
    return intent;
  const { ids, ...rest } = intent;
  return {
    ...rest,
    ...compactIdentities(ids, { unordered: intent.kind === "formatActive" }),
  };
}
export function expandUndo(intent) {
  if (!["delete", "formatActive"].includes(intent.kind) || !intent.idSpans)
    return intent;
  const { idSpans, ...rest } = intent;
  return { ...rest, ids: [...identities(idSpans)] };
}
export function validateUndoStorage(state) {
  function check(i) {
    if (!i || typeof i !== "object") return;
    if (i.kind === "batch") {
      i.intents.forEach(check);
      return;
    }
    if (i.idSpans === undefined) return;
    if (
      !["delete", "formatActive"].includes(i.kind) ||
      i.ids !== undefined ||
      !Array.isArray(i.idSpans) ||
      !i.idSpans.length
    )
      throw Error("Invalid stored Undo identities");
    try {
      validateIdentitySpans(state, i.idSpans);
    } catch (error) {
      throw Error("Invalid stored Undo identity span", { cause: error });
    }
  }
  for (const effect of Object.values(state.effects)) {
    if (
      effect.retiredByRestore !== undefined &&
      (!Number.isSafeInteger(effect.retiredByRestore) ||
        effect.retiredByRestore < 1 ||
        effect.retiredByRestore > state.epoch)
    )
      throw Error("Invalid retired Undo epoch");
    check(effect.inverse);
  }
}

// Replace All is one owned text contribution. Its inserted runs can be removed
// by one semantic claim; executing one separate claim per match repeatedly
// rebuilds the same visibility ledger. Preserve origin-bearing inverses intact.
export function replacementUndo(intent) {
  if (intent.kind !== "batch") return intent;
  const output = [];
  for (const part of intent.intents) {
    const previous = output.at(-1);
    const plain = (i) =>
      i?.kind === "delete" &&
      Array.isArray(i.ids) &&
      Object.keys(i).every((k) => k === "kind" || k === "ids");
    if (plain(part) && plain(previous)) previous.ids.push(...part.ids);
    else
      output.push(plain(part) ? { kind: "delete", ids: [...part.ids] } : part);
  }
  return { ...intent, intents: output };
}
