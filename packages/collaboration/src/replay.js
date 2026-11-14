// SPDX-License-Identifier: MPL-2.0
import {upgradeRecord} from "./storage.js";
import { decide } from "./decision.js";
export function replay(record, event) {
  const next = decide(upgradeRecord(record), event.op);
  if (JSON.stringify(next.receipt) !== JSON.stringify(event.receipt))
    throw Error("Authority replay mismatch");
  return next.record;
}
