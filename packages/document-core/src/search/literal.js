// SPDX-License-Identifier: MPL-2.0
import {CASE_FOLD} from './case-fold.js';
const segmenter=new Intl.Segmenter('und',{granularity:'grapheme'});
export const fold=value=>[...value].map(c=>CASE_FOLD[c]??c).join('');
export function validateQuery(query){
  if(typeof query!=='string')throw Error('Enter text to find.');
  if(/[\r\n\u2028\u2029]/.test(query))throw Error('Use a single line of text to find.');
}
// Generators share exact matching semantics between cooperative browser search
// and synchronous authority admission. Offsets are Unicode code points.
export function* prepareLiteral(value,matchCase=false){
 const boundaries=new Map([[0,0]]),parts=[];let length=0,points=0,tick=0;
 for(const {segment} of segmenter.segment(value)){
  const part=matchCase?segment:fold(segment);parts.push(part);length+=part.length;points+=[...segment].length;boundaries.set(length,points);
  if(++tick%256===0)yield;
 }
 return {haystack:parts.join(''),boundaries};
}
export function* scanLiteral(source,needle){
 const {haystack,boundaries}=source,matches=[];let at=0,tick=0;
 if(!needle)return matches;
 while(at<=haystack.length){
  const from=haystack.indexOf(needle,at);if(from<0)break;const to=from+needle.length;
  if(boundaries.has(from)&&boundaries.has(to)){matches.push({from:boundaries.get(from),to:boundaries.get(to)});at=to;}else at=from+1;
  if(++tick%256===0)yield;
 }
 return matches;
}
export function drain(iterator){let step;do{step=iterator.next();}while(!step.done);return step.value;}
export async function drainAsync(iterator,pause){let step;while(!(step=iterator.next()).done)await pause();return step.value;}
export function literalMatches(value,query,{matchCase=false}={}){
 validateQuery(query);if(!query)return [];
 return drain(scanLiteral(drain(prepareLiteral(value,matchCase)),matchCase?query:fold(query)));
}
