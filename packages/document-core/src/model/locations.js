// SPDX-License-Identifier: MPL-2.0
import {
  locations as originalLocations,
  ownershipRanges,
  locationsFromRanges,
  checkRanges,
} from "../text/locations.js";
import { isImmutable } from "./immutable.js";
import { predecessor, stagingToken } from "./draft.js";
import { changedKeys } from "./changed-keys.js";
// The cache captures an immutable ownership view, never a mutable state wrapper.
// Every dimension is weak-keyed; values cannot retain a predecessor-state chain.
const cache = new WeakMap(),
  counts = {
    hits: 0,
    builds: 0,
    incremental: 0,
    rangesChecked: 0,
    fallback: 0,
  };
export function ownershipStats() {
  return { ...counts };
}
function cached(state) {
  return cache.get(state.nodes)?.get(state.replicas)?.get(state.runs);
}
function owners(nodes) {
  const result = new Map();
  for (const n of Object.values(nodes))
    if (n.live && n.text) {
      if (!result.has(n.text)) result.set(n.text, []);
      result.get(n.text).push(n.id);
    }
  return result;
}
function updateRanges(state, base, previous) {
  const changed = changedKeys(base.replicas, state.replicas),
    blocks = new Set(),
    affected = new Set(),
    added = new Map();
  for (const id of changed)
    for (const block of previous.owners.get(id) || []) {
      blocks.add(block);
      for (const p of base.replicas[id]?.pieces || []) affected.add(p.run);
      let offset = 0;
      // A live node without its replica is invalid, even if it owns no characters.
      const replica = state.replicas[id];
      if (!replica) throw Error("Missing live text replica");
      for (const p of replica.pieces) {
        affected.add(p.run);
        if (!added.has(p.run)) added.set(p.run, []);
        added.get(p.run).push({ ...p, block, offset });
        offset += p.length;
      }
    }
  if (!affected.size) return previous.ranges;
  const ranges = new Map(previous.ranges);
  for (const id of affected) {
    const next = (previous.ranges.get(id) || [])
      .filter((p) => !blocks.has(p.block))
      .concat(added.get(id) || []);
    checkRanges(next);
    counts.rangesChecked++;
    if (next.length) ranges.set(id, next);
    else ranges.delete(id);
  }
  return ranges;
}
// During one transaction, backing replicas are replaced as immutable values.
// Snapshot the live ownership inputs, then update only changed blocks. Returned
// indexes remain snapshots: never mutate a Map/array held by a prior caller.
// The transaction token is discarded at finish(), so no cache follows history.
const staged = new WeakMap();
function stagedLocations(state, token) {
  const previous=staged.get(token), blocks=new Map(), affected=new Set(), changed=new Set();
  for(const n of Object.values(state.nodes))if(n.live&&n.text){
    const replica=state.replicas[n.text];if(!replica)throw Error('Missing live text replica');
    const old=previous?.blocks.get(n.id);
    blocks.set(n.id,{text:n.text,replica});
    if(!old||old.text!==n.text||old.replica!==replica)changed.add(n.id);
  }
  for(const id of previous?.blocks.keys()||[])if(!blocks.has(id))changed.add(id);
  if(previous&&!changed.size&&previous.backingRuns===state.runs)return previous.index;
  if(!previous){
    const ranges=ownershipRanges(state),index=locationsFromRanges(ranges,state.runs);
    staged.set(token,{blocks,ranges,index,backingRuns:state.runs});return index;
  }
  const added=new Map();
  for(const id of changed){
    for(const p of previous.blocks.get(id)?.replica.pieces||[])affected.add(p.run);
    let offset=0;
    for(const p of blocks.get(id)?.replica.pieces||[]){
      affected.add(p.run);if(!added.has(p.run))added.set(p.run,[]);
      added.get(p.run).push({...p,block:id,offset});offset+=p.length;
    }
  }
  const ranges=new Map(previous.ranges);
  for(const run of affected){
    const next=(ranges.get(run)||[]).filter(p=>!changed.has(p.block)).concat(added.get(run)||[]);
    checkRanges(next);if(next.length)ranges.set(run,next);else ranges.delete(run);
  }
  const index=locationsFromRanges(ranges,state.runs);staged.set(token,{blocks,ranges,index,backingRuns:state.runs});return index;
}
export function locations(state) {
  const { nodes, replicas, runs } = state;
  if (!isImmutable(nodes) || !isImmutable(replicas) || !isImmutable(runs)) {
    const token=stagingToken(state);
    if(token)return stagedLocations(state,token);
    counts.fallback++;
    return originalLocations(state);
  }
  let byReplica = cache.get(nodes);
  if (!byReplica) {
    byReplica = new WeakMap();
    cache.set(nodes, byReplica);
  }
  let byRun = byReplica.get(replicas);
  if (!byRun) {
    byRun = new WeakMap();
    byReplica.set(replicas, byRun);
  }
  let entry = byRun.get(runs);
  if (entry) {
    counts.hits++;
    return entry.index;
  }
  const base = predecessor(state),
    previous =
      base && isImmutable(base) && nodes === base.nodes && cached(base);
  const ranges = previous
    ? updateRanges(state, base, previous)
    : ownershipRanges(state);
  entry = {
    ranges,
    owners: previous ? previous.owners : owners(nodes),
    index: locationsFromRanges(ranges, runs),
  };
  // Entries share immutable range arrays, never predecessor entries or states.
  byRun.set(runs, entry);
  if (previous) counts.incremental++;
  else counts.builds++;
  return entry.index;
}
