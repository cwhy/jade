import {tableFixture} from '@cwhy/jade-testkit/table-fixture';
import {planEnter} from '@cwhy/jade-core/commands';
// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,gapAt,text} from '@cwhy/jade-core/model';
import {validate} from '@cwhy/jade-core/admission';
import {captureRange} from '@cwhy/jade-core/selection';
import {planInsertBlock} from '@cwhy/jade-core/commands';
import {Room,decide} from '@cwhy/jade-collaboration/room';
import {restoreRecord} from '@cwhy/jade-collaboration/restore';
import {publicRecord} from '@cwhy/jade-collaboration/public-replication';
const initial=()=>seed({doc:{id:'doc',type:'doc',live:true,children:['p']},p:{id:'p',type:'paragraph',live:true}},{p:[{text:'Original',marks:[]}]});
const op=(actor,seq,epoch,intent)=>({id:`${actor}:s:${seq}`,actor,stream:'s',seq,epoch,modelVersion:2,intent});
const insert=(state,actor,seq,value)=>op(actor,seq,state.epoch,{kind:'insert',at:gapAt(state,'p',text(state,'p').length),text:value,marks:[{type:'strong'}]});
const value=state=>text(state,'p').map(a=>a.char).join('');
function fixture(){const room=new Room(initial()),first=insert(room.snapshot().state,'A',1,' first');assert.equal(room.accept(first).outcome,"accepted");const target=room.snapshot();assert.equal(room.accept(insert(target.state,'B',1,' later')).outcome,"accepted");return {room,first,target};}
test('restore preserves exact target content/identities and current decisions while advancing both clocks',()=>{
 const {room,target}=fixture(),current=room.snapshot(),original=structuredClone(current),historical=structuredClone(target);
 const restored=restoreRecord(current,target.state,{id:'restore-one'});assert.equal(restored.state.epoch,current.state.epoch+1);assert.equal(restored.state.revision,current.state.revision+1);assert.deepEqual(text(restored.state,'p'),text(target.state,'p'));assert.deepEqual(restored.state.nodes,target.state.nodes);assert.deepEqual(restored.receipts,current.receipts);assert.deepEqual(restored.frontiers,current.frontiers);assert.deepEqual(current,original);assert.deepEqual(target,historical);validate(restored.state);
});
test('old Undo cannot revive pre-restore changes; new edits retain owned Undo and Redo',()=>{
 const {room,target,first}=fixture();let record=restoreRecord(room.snapshot(),target.state,{id:'restore-one'});
 const oldUndo=op('A',2,record.state.epoch,{kind:'undo',target:first.id}),rejected=decide(record,oldUndo);assert.equal(rejected.receipt.outcome,'rejected');assert.match(rejected.receipt.reason,/predates document restore/);record=rejected.record;
 const next=insert(record.state,'A',3,' new');record=decide(record,next).record;const withNew=value(record.state);const undo=op('A',4,record.state.epoch,{kind:'undo',target:next.id});record=decide(record,undo).record;assert.equal(value(record.state),value(target.state));record=decide(record,op('A',5,record.state.epoch,{kind:'undo',target:undo.id})).record;assert.equal(value(record.state),withNew);
});
test('lost old acknowledgements reconcile to original receipts; stale unaccepted work is fenced',()=>{
 const {room,target,first}=fixture(),restored=restoreRecord(room.snapshot(),target.state,{id:'restore-one'}),duplicate=decide(restored,first);assert.deepEqual(duplicate.receipt,room.snapshot().receipts[first.id]);assert.equal(duplicate.record,restored);
 const stale=insert(target.state,'A',2,' offline'),decision=decide(restored,stale);assert.equal(decision.receipt.outcome,'rejected');assert.match(decision.receipt.reason,/epoch changed/);assert.equal(value(decision.record.state),value(target.state));assert.equal(decide(decision.record,stale).record,decision.record);
});
test('repeated restores and JSON reload retain the boundary instead of reactivating old Undo',()=>{
 const {room,target,first}=fixture(),once=restoreRecord(room.snapshot(),target.state,{id:'restore-one'}),twice=restoreRecord(JSON.parse(JSON.stringify(once)),target.state,{id:'restore-two'}),loaded=new Room(null,JSON.parse(JSON.stringify(twice))).snapshot();assert.equal(loaded.state.epoch,3);assert.equal(loaded.state.revision,room.snapshot().state.revision+2);assert.deepEqual(text(loaded.state,'p'),text(target.state,'p'));assert.equal(decide(loaded,op('A',2,3,{kind:'undo',target:first.id})).receipt.outcome,'rejected');
});
test('unresolved historical media receives a fresh completion generation on every restore',()=>{
 const room=new Room(initial()),state=room.snapshot().state,header=op('A',1,1),point={block:'p',offset:8};header.intent=planInsertBlock(state,captureRange(state,point,point),header,{type:'image',slot:'mock-slot-00000001',width:80,height:40}).intent;room.accept(header);const target=room.snapshot(),image=Object.keys(target.state.pendingMedia)[0],oldGeneration=target.state.pendingMedia[image].generation;
 const restored=restoreRecord(target,target.state,{id:'restore-one'});assert.notEqual(restored.state.pendingMedia[image].generation,oldGeneration);
 const complete=op('system',1,restored.state.epoch,{kind:'imageComplete',image,generation:oldGeneration,asset:'a'.repeat(64),mime:'image/png',bytes:100,width:80,height:40});assert.equal(decide(restored,complete).receipt.outcome,'rejected');assert.deepEqual(restored.state.nodes,target.state.nodes);assert.equal(target.state.pendingMedia[image].generation,oldGeneration);
});
test('restore retains redacted decisions without disclosing another actor’s rejected drafts',()=>{
 const {room,target}=fixture();room.accept({...insert(room.snapshot().state,'B',2,'private'),epoch:999});const visible=publicRecord(room.snapshot(),'A'),restored=restoreRecord(visible,target.state,{id:'restore-one'});assert.deepEqual(restored.receipts['B:s:2'],visible.receipts['B:s:2']);assert.equal(restored.receipts['B:s:2'].redacted,true);assert.equal(JSON.stringify(restored.receipts['B:s:2']).includes('private'),false);
});
test('invalid target clocks, restore identity and retired Undo markers fail closed',()=>{
 const {room,target}=fixture(),current=room.snapshot();assert.throws(()=>restoreRecord(current,target.state),/identity/);assert.throws(()=>restoreRecord(current,{...target.state,epoch:999},{id:'r'}),/target/);assert.throws(()=>restoreRecord(current,{...target.state,revision:999},{id:'r'}),/target/);const state=structuredClone(target.state);Object.values(state.effects)[0].retiredByRestore=999;assert.throws(()=>validate(state),/retired Undo/);
});

test('restored rich cells preserve list/code/image structure and accept a new list Enter with owned Undo',()=>{
 const room=new Room(tableFixture()),target=room.snapshot();const before=target.state,header=op('A',1,1,{kind:'insert',at:gapAt(before,'first',0),text:'later ',marks:[]});assert.equal(room.accept(header).outcome,'accepted');let record=restoreRecord(room.snapshot(),target.state,{id:'restore-rich'});assert.deepEqual(record.state.nodes,target.state.nodes);for(const id of ['first','list-text','code','empty','image-text','last'])assert.deepEqual(text(record.state,id),text(target.state,id));
 const point={block:'list-text',offset:4},enter=op('A',2,record.state.epoch);enter.intent=planEnter(record.state,captureRange(record.state,point,point),enter).intent;let d=decide(record,enter);assert.equal(d.receipt.outcome,'accepted');record=d.record;d=decide(record,op('A',3,record.state.epoch,{kind:'undo',target:enter.id}));assert.equal(d.receipt.outcome,'accepted');assert.equal(text(d.record.state,'list-text').map(a=>a.char).join(''),'List cell text');for(const id of ['first','code','empty','image-text','last'])assert.deepEqual(text(d.record.state,id),text(target.state,id));
});
