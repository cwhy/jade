// SPDX-License-Identifier: MPL-2.0
// Experimental wire version, separate from package SemVer and codec 43.
export const WIRE_VERSION = 45;
export function envelope(op, actor) {
  if (
    !op ||
    op.actor !== actor ||
    typeof op.stream !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(op.stream) ||
    !Number.isSafeInteger(op.seq) ||
    op.seq < 1 ||
    op.id !== `${actor}:${op.stream}:${op.seq}` ||
    !Number.isSafeInteger(op.epoch) ||
    !op.intent ||
    typeof op.intent.kind !== "string"
  )
    throw Error("Invalid operation identity/envelope");
  return op;
}
