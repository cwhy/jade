// SPDX-License-Identifier: MPL-2.0
import { validate } from "./model/join-admission.js";
import { STORAGE_CODEC } from "./model/codec.js";
export { STORAGE_CODEC };
// Explicit one-way load boundary. Preserve content IDs, revision, ownership and
// operation bytes; codecs 43/44 need no invented document fields or replacement origins. Legacy witness
// arrays remain readable and convert on fresh capture. Never mutate the source.
export function upgradeStorage(state) {
  if (![43, 44, 45, 46, 47, 48, STORAGE_CODEC].includes(state?.storageCodec))
    throw Error("Unsupported storage codec; source retained");
  const next = structuredClone(state);
  next.storageCodec = STORAGE_CODEC;
  validate(next);
  return next;
}
