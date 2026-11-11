// SPDX-License-Identifier: MPL-2.0
// Checkpoints are immutable values. Sharing them inside this lab is safe; disk
// and network boundaries still require explicit encoding and independent decode.
const sealed = new WeakSet();
export function immutable(value) {
  if (value && typeof value === "object" && !sealed.has(value)) {
    for (const item of Object.values(value)) immutable(item);
    Object.freeze(value);
    sealed.add(value);
  }
  return value;
}
// Proof of transitive sealing by this module, not merely Object.isFrozen(root).
export function isImmutable(value) {
  return !!value && typeof value === "object" && sealed.has(value);
}
