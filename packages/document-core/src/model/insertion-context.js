// SPDX-License-Identifier: MPL-2.0
import {ownedOriginInverses} from './origins.js';
import {members} from './boundaries.js';
import {ownershipRanges,locationsFromRanges,checkRanges} from '../text/locations.js';
// A private scratch index for consecutive insertions and erased-fragment restorations. These
// change pieces and offsets, never block/cut ownership. No caller may retain an
// index across update(); the batch discards the context before any other action.
export function insertionContext(state){
 const ranges=ownershipRanges(state),cuts=new Map(),pieces=new Map(),erasedAt=new Map();let indexed=state.boundaryOrder.length;
 for(const [key,entry] of Object.entries(state.erasures))for(const [ordinal] of members(state,entry)){
  if(!erasedAt.has(ordinal))erasedAt.set(ordinal,[]);erasedAt.get(ordinal).push({key,entry});
 }
 for(const [id,cut] of Object.entries(state.boundaries)){
  if(!cuts.has(cut.block))cuts.set(cut.block,[]);cuts.get(cut.block).push(id);
 }
 for(const node of Object.values(state.nodes))if(node.live&&node.text)pieces.set(node.id,state.replicas[node.text].pieces);
 return {
  locations(){return locationsFromRanges(ranges,state.runs);},
  originInverses:ownedOriginInverses(state),
  preceding(divider){
   const earlier=new Set();if(!divider)return earlier;
   for(const {key,entry} of erasedAt.get(divider.ordinal)||[]){
    if(state.erasures[key]!==entry)continue;
    const list=members(state,entry),at=list.find(([ordinal])=>ordinal===divider.ordinal)[1];
    for(const [ordinal,position] of list)if(position<at)earlier.add(ordinal);
   }
   return earlier;
  },
  cuts(block){
   while(indexed<state.boundaryOrder.length){const id=state.boundaryOrder[indexed++],owner=state.boundaries[id].block;if(!cuts.has(owner))cuts.set(owner,[]);cuts.get(owner).push(id);}
   return cuts.get(block)||[];
  },
  update(block){
   const next=state.replicas[state.nodes[block].text].pieces,affected=new Set((pieces.get(block)||[]).map(p=>p.run)),added=new Map();let offset=0;
   for(const p of next){affected.add(p.run);if(!added.has(p.run))added.set(p.run,[]);added.get(p.run).push({...p,block,offset});offset+=p.length;}
   for(const run of affected){const list=(ranges.get(run)||[]).filter(p=>p.block!==block).concat(added.get(run)||[]);checkRanges(list);if(list.length)ranges.set(run,list);else ranges.delete(run);}
   pieces.set(block,next);
  },
 };
}
