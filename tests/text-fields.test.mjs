import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,text,gapAt} from '../packages/document-core/src/model/engine.js';
import {apply,validateDocumentShape} from '../packages/document-core/src/model/admission.js';
import {captureRange,textOrder} from '../packages/document-core/src/selection/range.js';
const initial=()=>seed({doc:{id:'doc',type:'doc',live:true,children:['p']},p:{id:'p',type:'paragraph',live:true}},{p:[{text:'Draft body',marks:[]}]});
const op=(seq,intent,actor='a')=>({id:`${actor}:s:${seq}`,actor,stream:'s',seq,epoch:1,intent});
const str=(s,id)=>text(s,id).map(a=>a.char).join('');
function field(){return apply(initial(),op(1,{kind:'textFieldCreate',name:'title',text:'Draft title'}));}
test('field setup preserves body identity and supplies ordinary stable text ranges',()=>{
 const before=initial(),after=apply(before,op(1,{kind:'textFieldCreate',name:'title',text:'Draft title'})),id=after.nodes.doc.fields.title;
 assert.equal(str(before,'p'),'Draft body');assert.deepEqual(after.nodes.doc.children,['p']);assert.deepEqual(text(before,'p'),text(after,'p'));assert.deepEqual(textOrder(after),['p']);assert.equal(captureRange(after,{block:id,offset:0},{block:id,offset:5}).slices[0].type,'text_field');validateDocumentShape(after);
 assert.throws(()=>apply(after,op(2,{kind:'undo',target:'a:s:1'})),/setup/);
});
test('one batch replaces title and body; owned Undo keeps a teammate suffix in both',()=>{
 let state=field();const id=state.nodes.doc.fields.title,targets=[id,'p'];
 state=apply(state,op(2,{kind:'batch',intents:targets.flatMap(block=>[{kind:'delete',ids:text(state,block).slice(0,5).map(a=>a.id)},{kind:'insert',at:gapAt(state,block,0),text:'Final',marks:[]}])}));
 state=apply(state,op(1,{kind:'batch',intents:targets.map(block=>({kind:'insert',at:gapAt(state,block,text(state,block).length),text:' peer',marks:[]}))},'b'));
 state=apply(state,op(3,{kind:'undo',target:'a:s:2'}));assert.equal(str(state,id),'Draft title peer');assert.equal(str(state,'p'),'Draft body peer');
 state=apply(state,op(4,{kind:'undo',target:'a:s:3'}));assert.equal(str(state,id),'Final title peer');assert.equal(str(state,'p'),'Final body peer');
});
test('invalid field content rolls back the complete batch without changing the source',()=>{
 const state=field(),id=state.nodes.doc.fields.title,bytes=JSON.stringify(state);
 for(const value of [{text:'bad\nline',marks:[]},{text:'bold',marks:['strong']}])assert.throws(()=>apply(state,op(2,{kind:'batch',intents:[{kind:'insert',at:gapAt(state,'p',0),text:'not published ',marks:[]},{kind:'insert',at:gapAt(state,id,0),...value}]})),/single-line plain text/);
 assert.equal(JSON.stringify(state),bytes);assert.equal(str(state,'p'),'Draft body');
});
test('field schema rejects duplicate names, invalid names, and forged body placement',()=>{
 const state=field();for(const name of ['title','__proto__','constructor','invalid name',undefined,1]){
  assert.throws(()=>apply(state,op(2,{kind:'textFieldCreate',name,text:'x'})),/field/);
 }
 const invalid=structuredClone(state);invalid.nodes.doc.children.unshift(invalid.nodes.doc.fields.title);assert.throws(()=>validateDocumentShape(invalid));
});
