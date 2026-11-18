// SPDX-License-Identifier: MPL-2.0
// Capture the authored side of a coincident logical cut in the immutable gap.
// Neighbour IDs alone cannot distinguish the end of its left partition from
// the start of its right partition once Undo has joined those partitions.
// Only coincident cuts need this extra information; ordinary positions retain
// their existing atom-relative representation. This includes empty partitions.
// A scoped snapshot for several reads with no intervening text/topology writes.
// Callers discard it before mutating the model; no historical state is retained.
export function listGapAffinityReader(state) {
  const byBlock=new Map(),views=new Map();
  for(const family of Object.values(state.listFamilies))
    for(const block of family.layout.blocks)if(!byBlock.has(block))byBlock.set(block,family);
  return (block,offset)=>{
    const family=byBlock.get(block);if(!family)return {};
    let view=views.get(family);
    if(!view){
      const bases=new Map(),parts=new Map(),coincident=new Map();let total=0;
      family.layout.blocks.forEach((id,i)=>{bases.set(id,total);parts.set(id,i);total+=state.replicas[state.nodes[id].text].length;});
      const active=new Map(family.order.filter(id=>id!=='home'&&family.cuts[id].active).map((id,i)=>[id,i]));
      for(const cut of Object.values(family.cuts)){
        const marker=state.boundaries[cut.marker],position=bases.get(marker.block)+marker.offset;
        if(!coincident.has(position))coincident.set(position,[]);coincident.get(position).push(cut);
      }
      view={bases,parts,active,coincident};views.set(family,view);
    }
    const listAffinity={};
    for(const c of view.coincident.get(view.bases.get(block)+offset)||[])
      listAffinity[c.marker]=c.active
        ?view.parts.get(block)<=(view.active.get(c.id)??-1)?'left':'right'
        :offset===state.replicas[state.nodes[block].text].length&&offset>0?'left':'right';
    return Object.keys(listAffinity).length?{listAffinity}:{};
  };
}
export function listGapAffinities(state,block,offset){return listGapAffinityReader(state)(block,offset);}
