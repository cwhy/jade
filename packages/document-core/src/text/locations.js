// SPDX-License-Identifier: MPL-2.0
// Index ownership by backing-run intervals, never by one object per character.
// Frozen checkpoints may cache their index; mutable staging states may not.
import { readPieces } from "./pieces.js";
const cached = new WeakMap();
export function locations(state) {
  if (cached.has(state)) return cached.get(state);
  const runs = ownershipRanges(state);
  const result = locationsFromRanges(runs, state.runs);
  if (Object.isFrozen(state)) cached.set(state, result);
  return result;
}
export function ownershipRanges(state) {
  const runs = new Map();
  for (const n of Object.values(state.nodes)) {
    if (!n.live || !n.text) continue;
    const replica = state.replicas[n.text];
    let offset = 0;
    for (const p of replica.pieces) {
      if (!runs.has(p.run)) runs.set(p.run, []);
      runs.get(p.run).push({ ...p, block: n.id, offset });
      offset += p.length;
    }
  }
  for (const ranges of runs.values()) checkRanges(ranges);
  return runs;
}
export function checkRanges(ranges) {
  ranges.sort((a, b) => a.from - b.from);
  for (let i = 1; i < ranges.length; i++)
    if (ranges[i - 1].from + ranges[i - 1].length > ranges[i].from)
      throw Error("Character has two live owners");
}
export function locationsFromRanges(runs, backingRuns) {
  return {
    has(id) {
      return Boolean(this.get(id));
    },
    get(id) {
      if (typeof id !== "string") return undefined;
      const colon = id.lastIndexOf(":"),
        run = id.slice(0, colon),
        at = Number(id.slice(colon + 1)),
        ranges = runs.get(run);
      if (
        !ranges ||
        !Number.isSafeInteger(at) ||
        String(at) !== id.slice(colon + 1)
      )
        return undefined;
      let lo = 0,
        hi = ranges.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1,
          p = ranges[mid];
        if (at < p.from) hi = mid - 1;
        else if (at >= p.from + p.length) lo = mid + 1;
        else
          return {
            block: p.block,
            offset: p.offset + at - p.from,
            atom: readPieces(backingRuns, [{ run, from: at, length: 1 }])[0],
          };
      }
    },
  };
}
