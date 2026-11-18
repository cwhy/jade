// SPDX-License-Identifier: MPL-2.0
// A private Undo payload names immutable backing characters, not visible offsets.
// Consecutive identities can share one descriptor without changing ownership.
import {identities} from '../text/pieces.js';
export function compactUndo(intent) {
  if(intent.kind==='batch')return {...intent,intents:intent.intents.map(compactUndo)};
  if(intent.kind!=='delete'||!Array.isArray(intent.ids)||intent.ids.length<16)return intent;
  const spans=[];
  for(const id of intent.ids){
    const colon=id.lastIndexOf(':'),run=id.slice(0,colon),from=Number(id.slice(colon+1));
    if(colon<1||!Number.isSafeInteger(from)||from<0||String(from)!==id.slice(colon+1))return intent;
    const last=spans.at(-1);
    if(last?.run===run&&last.from+last.length===from)last.length++;
    else spans.push({run,from,length:1});
  }
  if(JSON.stringify(spans).length>=JSON.stringify(intent.ids).length)return intent;
  const {ids,...rest}=intent;return {...rest,idSpans:spans};
}
export function expandUndo(intent){
  if(intent.kind!=='delete'||!intent.idSpans)return intent;
  const {idSpans,...rest}=intent;return {...rest,ids:[...identities(idSpans)]};
}
export function validateUndoStorage(state){
  function check(i){
    if(!i||typeof i!=='object')return;
    if(i.kind==='batch'){i.intents.forEach(check);return;}
    if(i.idSpans===undefined)return;
    if(i.kind!=='delete'||i.ids!==undefined||!Array.isArray(i.idSpans)||!i.idSpans.length)throw Error('Invalid stored Undo identities');
    for(const p of i.idSpans)if(!p||Object.keys(p).sort().join(',')!=='from,length,run'||!Number.isSafeInteger(p.from)||p.from<0||!Number.isSafeInteger(p.length)||p.length<1||!state.runs[p.run]||p.from+p.length>state.runs[p.run].chars.length)throw Error('Invalid stored Undo identity span');
  }
  for(const effect of Object.values(state.effects))check(effect.inverse);
}

// Replace All is one owned text contribution. Its inserted runs can be removed
// by one semantic claim; executing one separate claim per match repeatedly
// rebuilds the same visibility ledger. Preserve origin-bearing inverses intact.
export function replacementUndo(intent){
 if(intent.kind!=='batch')return intent;
 const output=[];
 for(const part of intent.intents){
  const previous=output.at(-1);
  const plain=i=>i?.kind==='delete'&&Array.isArray(i.ids)&&Object.keys(i).every(k=>k==='kind'||k==='ids');
  if(plain(part)&&plain(previous))previous.ids.push(...part.ids);
  else output.push(plain(part)?{kind:'delete',ids:[...part.ids]}:part);
 }
 return {...intent,intents:output};
}
