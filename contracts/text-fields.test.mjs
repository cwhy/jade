// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,text,gapAt} from '@cwhy/jade-core/model';
import {validate} from '@cwhy/jade-core/admission';
import {captureRange,textOrder} from '@cwhy/jade-core/selection';
import {planReplace} from '@cwhy/jade-core/replace';
import {Room} from '@cwhy/jade-collaboration/room';
const op=(actor,seq,intent)=>({id:`${actor}:s:${seq}`,actor,stream:'s',seq,epoch:1,intent});
const str=(state,id)=>text(state,id).map(a=>a.char).join('');
function room(){const r=new Room(seed({doc:{id:'doc',type:'doc',live:true,children:['p']},p:{id:'p',type:'paragraph',live:true}},{p:[{text:'Draft body',marks:['strong']}]}));assert.equal(r.accept(op('host',1,{kind:'textFieldCreate',name:'title',text:'Draft title'})).outcome,'accepted');return r;}
for(const peerFirst of [true,false])test(`named fields use immutable room persistence, retry and owned Undo; peerFirst=${peerFirst}`,()=>{
 let r=room();const base=r.snapshot().state,id=base.nodes.doc.fields.title;
 const range=captureRange(base,{block:id,offset:0},{block:id,offset:5});
 const a=op('a',1),planned=planReplace(base,range,{version:1,blocks:[{type:'paragraph',content:[{text:'Final',marks:[]}]}]},a,{strict:true});
 a.intent={kind:'batch',intents:[...planned.intent.intents,{kind:'delete',ids:text(base,'p').slice(0,5).map(a=>a.id)},{kind:'insert',at:gapAt(base,'p',0),text:'Final',marks:['strong']}]};
 const peer=op('b',1,{kind:'batch',intents:[id,'p'].map(block=>({kind:'insert',at:gapAt(base,block,text(base,block).length),text:' peer',marks:[]}))});
 for(const edit of peerFirst?[peer,a]:[a,peer])assert.equal(r.accept(edit).outcome,'accepted');
 const saved=JSON.parse(JSON.stringify(r.snapshot()));r=new Room(null,saved);const retry=r.accept(a);assert.equal(retry.outcome,'accepted');assert.deepEqual(r.snapshot(),saved);
 assert.equal(str(r.snapshot().state,id),'Final title peer');assert.equal(str(r.snapshot().state,'p'),'Final body peer');
 assert.equal(r.accept(op('a',2,{kind:'undo',target:a.id})).outcome,'accepted');
 assert.equal(str(r.snapshot().state,id),'Draft title peer');assert.equal(str(r.snapshot().state,'p'),'Draft body peer');
 assert.deepEqual(text(r.snapshot().state,'p').slice(0,5).map(a=>a.marks),Array.from({length:5},()=>['strong']));
 assert.equal(r.accept(op('a',3,{kind:'undo',target:'a:s:2'})).outcome,'accepted');validate(r.snapshot().state);
});
test('field structural edits, styles and line breaks reject durably without consuming a body edit',()=>{
 const r=room(),id=r.snapshot().state.nodes.doc.fields.title;
 const invalid=[{kind:'split',at:gapAt(r.snapshot().state,id,5),tail:'tail'},{kind:'insert',at:gapAt(r.snapshot().state,id,0),text:'bad\nline',marks:[]},{kind:'insert',at:gapAt(r.snapshot().state,id,0),text:'styled',marks:['strong']},{kind:'undo',target:'host:s:1'}];
 for(const [i,intent]of invalid.entries()){
  const before=JSON.stringify(r.snapshot().state),entry=op('a',i+1,intent);assert.equal(r.accept(entry).outcome,'rejected');assert.equal(JSON.stringify(r.snapshot().state),before);assert.equal(r.accept(entry).outcome,'rejected');
 }
 assert.equal(r.accept(op('a',5,{kind:'insert',at:gapAt(r.snapshot().state,id,0),text:'Valid ',marks:[]})).outcome,'accepted');
});

test('title selection is separate from body navigation and whole-body copy',()=>{
 const r=room(),s=r.snapshot().state,id=s.nodes.doc.fields.title;assert.deepEqual(textOrder(s),['p']);
 assert.throws(()=>captureRange(s,{block:id,offset:0},{block:'p',offset:1}),/separate selections/);
 assert.equal(captureRange(s,{block:id,offset:0},{block:id,offset:5}).slices[0].block,id);
});
