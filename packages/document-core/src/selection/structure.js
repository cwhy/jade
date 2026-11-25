// SPDX-License-Identifier: MPL-2.0
import { documentView } from "../document/read.js";
export function selectionStructure(state) {
  return documentView(state);
}
