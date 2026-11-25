// SPDX-License-Identifier: MPL-2.0
import {
  captureConversion as captureStructure,
  captureListConversion,
  captureScopedStyle,
  validateListConversion,
  conversionLoss,
  validateConversionReview,
} from "../model/text-conversion.js";
import {
  captureTextSections,
  validateTextSections,
  hasPreservedSections,
} from "../model/conversion-sections.js";
import { captureBodySections } from "../model/body-sections.js";
import { identities } from "../text/pieces.js";
import { apply } from "../model/engine.js";
import { ReviewRequired } from "../selection/range.js";

// Preview is inert. The host owns the dialog; only its explicit confirmation
// calls planConversion with confirmLoss. The authority rechecks the witnessed
// formatting so a stale preview cannot clear a teammate's unseen changes.
export function previewConversion(state, parent, blocks, target) {
  const structure =
    (target === "paragraph" && captureBodySections(state, parent, blocks)) ||
    (target === "code" && hasPreservedSections(state, parent, blocks)
      ? captureTextSections(state, parent, blocks)
      : captureScopedStyle(state, parent, blocks, target) ||
        captureStructure(state, parent, blocks, target));
  const loss = structure.parts
    ? structure.parts.flatMap((p) => p.loss || [])
    : conversionLoss(state, structure);
  return {
    version: 1,
    epoch: state.epoch,
    intent: {
      ...structure,
      ...(!structure.parts && loss.length ? { loss } : {}),
    },
    loss: {
      formattedCharacters: new Set(
        loss.flatMap((entry) => entry.ids || [...identities(entry.idSpans)]),
      ).size,
      properties: [...new Set(loss.map((entry) => entry.property))],
    },
  };
}
export function planConversion(
  state,
  preview,
  op,
  { confirmLoss = false } = {},
) {
  if (preview?.version !== 1 || preview.epoch !== state.epoch)
    throw new ReviewRequired("Review conversion in the current document");
  if (preview.intent.kind === "textSectionsConvert")
    validateTextSections(state, preview.intent);
  else validateConversionReview(state, preview.intent);
  if (
    (preview.intent.parts || [preview.intent]).some((p) => p.loss?.length) &&
    !confirmLoss
  )
    throw new ReviewRequired(
      "Review the formatting loss before converting to code",
    );
  return {
    intent: preview.intent,
    state: apply(state, { ...op, intent: preview.intent }),
  };
}
// Convenience for lossless conversion. Destructive conversion must use preview
// and confirmation; an unreviewed rich selection is never silently flattened.
export function captureConversion(state, parent, blocks, target) {
  const preview = previewConversion(state, parent, blocks, target);
  if ((preview.intent.parts || [preview.intent]).some((p) => p.loss?.length))
    throw new ReviewRequired(
      "Review the formatting loss before converting to code",
    );
  return preview.intent;
}

export function previewListConversion(state, parent, scope, selection = {}) {
  const intent = captureListConversion(state, parent, scope, selection),
    loss = intent.parts.flatMap((p) => p.loss || []);
  return {
    version: 1,
    epoch: state.epoch,
    intent,
    loss: {
      formattedCharacters: new Set(
        loss.flatMap((e) => e.ids || [...identities(e.idSpans)]),
      ).size,
      properties: [...new Set(loss.map((e) => e.property))],
    },
  };
}
export function planListConversion(
  state,
  preview,
  op,
  { confirmLoss = false } = {},
) {
  if (preview?.version !== 1 || preview.epoch !== state.epoch)
    throw new ReviewRequired("Review conversion in the current document");
  validateListConversion(state, preview.intent);
  if (preview.intent.parts.some((p) => p.loss?.length) && !confirmLoss)
    throw new ReviewRequired(
      "Review the formatting loss before converting to code",
    );
  return {
    intent: preview.intent,
    state: apply(state, { ...op, intent: preview.intent }),
  };
}
