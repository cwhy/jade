// SPDX-License-Identifier: MPL-2.0
import {text} from '../model/engine.js';
import {textReplacementMatches,replacementMarks,validateTextReplacement} from '../model/text-replacement.js';
export function reviewTextReplacement(state,{query,replacement,matchCase=false,scope='all',target}={}){
 const matches=textReplacementMatches(state,query,matchCase,text),selected=scope==='one'?matches.filter(m=>m.block===target?.block&&m.first===target?.first):matches;
 if(!selected.length)return null;
 const intent={kind:'textReplace',query,replacement,matchCase,scope,targets:selected.map(m=>m.witness)};validateTextReplacement(intent);
 return {intent,changed:selected.filter(m=>m.text!==replacement).length,preview:selected.map(m=>({block:m.block,type:state.nodes[m.block].type,from:m.from,to:m.to,before:m.text,after:replacement,marks:replacementMarks(state.nodes[m.block].type,m.atoms)}))};
}
