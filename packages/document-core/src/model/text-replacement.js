// SPDX-License-Identifier: MPL-2.0
import {fieldEntries} from './text-fields.js';
import {literalMatches,validateQuery} from '../search/literal.js';
import {selectionStructure} from '../selection/structure.js';
import {slicePieces} from '../text/pieces.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const property=m=>typeof m==='string'?m:m.type;
export function validateTextReplacement(intent){
 if(!intent||Object.keys(intent).some(k=>!['kind','query','replacement','matchCase','scope','targets'].includes(k))||intent.kind!=='textReplace'||!['one','all'].includes(intent.scope)||typeof intent.matchCase!=='boolean'||typeof intent.replacement!=='string'||/[\r\n\u2028\u2029]/.test(intent.replacement)||!Array.isArray(intent.targets)||!intent.targets.length||(intent.scope==='one'&&intent.targets.length!==1))throw Error('Invalid text replacement review');
 validateQuery(intent.query);if(!intent.query)throw Error('Enter text to find.');
}
function witness(state,block,from,to,atoms){
 const n=state.nodes[block],marks=[];
 for(const a of atoms){const last=marks.at(-1);if(last&&same(last[1],a.marks))last[0]++;else marks.push([1,structuredClone(a.marks)]);}
 return {block,type:n.type,...(n.type==='code'?{language:n.language??null}:{}),pieces:slicePieces(state.replicas[n.text].pieces,from,to),marks};
}
export function textReplacementMatches(state,query,matchCase,read){
 const result=[];
 for(const block of [...fieldEntries(state).map(([,id])=>id),...selectionStructure(state).order]){
  const atoms=read(state,block),value=atoms.map(a=>a.char).join('');
  for(const {from,to} of literalMatches(value,query,{matchCase})){
   const selected=atoms.slice(from,to);
   result.push({block,from,to,first:selected[0].id,text:selected.map(a=>a.char).join(''),atoms:selected,witness:witness(state,block,from,to,selected)});
  }
 }
 return result;
}
export function replacementMarks(type,atoms){
 if(type==='code'||type==='text_field')return [];
 return structuredClone(atoms[0].marks.filter(mark=>property(mark)!=='link'||atoms.every(a=>a.marks.some(m=>property(m)==='link'&&same(m,mark)))));
}
export function prepareTextReplacement(state,intent,host){
 validateTextReplacement(intent);
 const matches=textReplacementMatches(state,intent.query,intent.matchCase,host.read),byWitness=new Map(matches.map(m=>[JSON.stringify(m.witness),m]));
 const keys=intent.targets.map(w=>JSON.stringify(w));
 if(new Set(keys).size!==keys.length||keys.some(key=>!byWitness.has(key))||(intent.scope==='all'&&keys.length!==matches.length))throw host.fail('Replacement matches changed; review the updated result');
 const selected=keys.map(key=>byWitness.get(key)).filter(m=>m.text!==intent.replacement),intents=[],origins=[];
 if(!selected.length)return null;
 // One semantic deletion claim owns the reviewed set. Its physical masks retain
 // separate cuts; creating a claim per match needlessly rescans all prior claims.

 // Captured atom identities survive unrelated insertions and block moves. Each
 // target is validated against the same pre-write state, before any deletion.
 for(const m of selected){

  if(intent.replacement){
   const start=host.gap(state,m.block,m.from),end=host.gap(state,m.block,m.to);
   origins.push({part:intents.length,start,end,length:[...intent.replacement].length});
   intents.push({kind:'insert',at:start,text:intent.replacement,marks:replacementMarks(state.nodes[m.block].type,m.atoms)});
  }
 }
 // Place new text against still-live reviewed identities, then delete the
 // source set. This avoids resolving every insertion through freshly erased
 // history. The staged transaction publishes only the final state.
 intents.push({kind:'delete',ids:selected.flatMap(m=>m.atoms.map(a=>a.id))});
 return {intent:{kind:'batch',intents},origins};
}
