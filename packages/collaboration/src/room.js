// SPDX-License-Identifier: MPL-2.0
import { immutable } from "@cwhy/jade-core/immutability";
import { decide } from "./decision.js";
export { decide } from "./decision.js";
const clone = (x) => structuredClone(x);
export class Room {
  constructor(state, record) {
    this.record = immutable(
      record
        ? clone(record)
        : { state: clone(state), receipts: {}, frontiers: {} },
    );
  }
  accept(op) {
    const decision = decide(this.record, op);
    this.record = decision.record;
    return decision.receipt;
  }
  snapshot() {
    return this.record;
  } // Immutable checkpoint; JSON encoding remains explicit.
}
