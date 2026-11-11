// SPDX-License-Identifier: MPL-2.0
import { resolveCellRange } from "../selection/table.js";
import { cellWitness, cellsAlreadyEmpty } from "../model/cell-clear.js";
import { apply } from "../model/engine.js";
export function planClearCells(state, range, op) {
  const selected = resolveCellRange(state, range),
    cells = selected.cells.flat();
  if (cellsAlreadyEmpty(state, cells))
    return { intent: null, state, selection: selected };
  const intent = {
    kind: "clearCells",
    range: selected,
    witness: cellWitness(state, cells),
  };
  return {
    intent,
    state: apply(state, { ...op, intent }),
    selection: selected,
  };
}
