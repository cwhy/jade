// SPDX-License-Identifier: MPL-2.0
// Validate structural join targets before dispatching to the model.
// Other semantic commands use the shared admission path.
import * as engine from "./engine.js";
import * as base from "./admission.js";
import { joinTarget } from "./join-ledger.js";
export * from "./admission.js";
export function apply(state, op) {
  if (!["listJoin", "proseJoin"].includes(op?.intent?.kind))
    return base.apply(state, op);
  const fail = (m) => {
    throw new engine.Conflict("Admission: " + m);
  };
  if (
    typeof op.id !== "string" ||
    !op.id ||
    typeof op.actor !== "string" ||
    !op.actor
  )
    fail("invalid envelope");
  if (Object.keys(op.intent).some((k) => !["kind", "target"].includes(k)))
    fail("invalid join fields");
  const t = op.intent.target;
  if (
    !t ||
    typeof t.right !== "string" ||
    Object.keys(t).sort().join(",") !== "creator,id,right"
  )
    fail("malformed join target");
  const expected = joinTarget(state, t.right);
  if (
    t.id !== expected.id ||
    JSON.stringify(t.creator) !== JSON.stringify(expected.creator)
  )
    fail("forged join boundary");
  if (!state.nodes[t.right]) fail("unknown join paragraph");
  base.validateDocumentShape(state);
  return engine.apply(state, op, base.validateDocumentShape);
}
