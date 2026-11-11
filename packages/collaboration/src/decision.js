// SPDX-License-Identifier: MPL-2.0
import { immutable } from "@cwhy/jade-core/immutability";
import { apply, Conflict } from "@cwhy/jade-core/admission";
const clone = (x) => structuredClone(x);
const fingerprint = (x) => JSON.stringify(x);
export function decide(record, op) {
  const key = `${op.actor}:${op.stream}`,
    previous = record.receipts[op.id],
    bytes = fingerprint(op);
  if (previous) {
    if (previous.bytes !== bytes) throw new Error("Retry payload changed");
    return { record, receipt: clone(previous) };
  }
  if (op.seq !== (record.frontiers[key] || 0) + 1)
    throw new Error("Sequence gap");
  let state = record.state,
    outcome = "accepted",
    reason;
  try {
    state = apply(state, op);
  } catch (e) {
    if (!(e instanceof Conflict)) throw e;
    outcome = "rejected";
    reason = e.message;
  }
  const receipt = {
    bytes,
    outcome,
    revision: state.revision,
    ...(reason ? { reason } : {}),
  };
  record = immutable({
    state,
    receipts: { ...record.receipts, [op.id]: receipt },
    frontiers: { ...record.frontiers, [key]: op.seq },
  });
  return { record, receipt: clone(receipt) };
}
