// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {DocumentSession} from '@cwhy/jade-collaboration/session';
import {Room} from '@cwhy/jade-collaboration/room';
import {restoreRecord} from '@cwhy/jade-collaboration/restore';
import {fixture} from '@cwhy/jade-testkit/browser-fixture';
import {gapAt} from '@cwhy/jade-core/model';
import {WIRE_VERSION} from '@cwhy/jade-protocol';
async function harness(initialSaved,options={}){
 const room=new Room(fixture()),trace=[],timers=new Map(),archives=[];let saved=structuredClone(initialSaved||{}),id=0,failReset=false,issuedEpoch=null,session;
 const socket={readyState:1,send:raw=>trace.push({kind:'send',message:JSON.parse(raw)}),close:()=>trace.push({kind:'close'})};
 const journal={read:async()=>structuredClone(saved),write:async(head,events,checkpoint)=>{saved={head:structuredClone(head),checkpoint:checkpoint?structuredClone(checkpoint):saved.checkpoint,events:checkpoint?[]:[...(saved.events||[]),...(events||[])]};trace.push({kind:'write',saved:structuredClone(saved)});},reset:async(head,checkpoint,boundary)=>{if(failReset)throw Error('Boundary journal failed');archives.push(structuredClone({saved,boundary}));saved={head:structuredClone(head),checkpoint:structuredClone(checkpoint),events:[]};trace.push({kind:'reset',boundary});return {recoveryCount:boundary.retired.filter(r=>r.decision!=='accepted').length};},close(){}};
 session=await DocumentSession.open('mock','A',()=>{}, {openJournal:async()=>journal,readCheckpoint:async()=>JSON.stringify({wire:WIRE_VERSION,record:room.snapshot(),cursor:0}),createStream:()=> 'old',connect:()=>socket,openState:1,now:()=>0,schedule:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},cancel:id=>timers.delete(id),checkpointEvery:32,
  beforeReset:async()=>{trace.push({kind:'before-reset'});assert.equal(session.client.paused,true);},
  createResetStream:async epoch=>{assert.throws(()=>session.client.prepare({kind:'insert',at:gapAt(session.client.state,'bp',0),text:'forbidden'}),/restore to finish/);trace.push({kind:'stream'});return {stream:'fresh-'+epoch,epoch:issuedEpoch??epoch,actor:'A'};},
  onDurable:value=>trace.push({kind:'durable',...value}),onRestore:value=>trace.push({kind:'restored',...value}),...options});
 const receive=m=>socket.onmessage({data:JSON.stringify(m)});
 async function drain(){for(let n=0;n<20;n++){for(const [id,timer]of [...timers])if(timer.ms===0){timers.delete(id);timer.fn();}await session.queue;if(![...timers.values()].some(t=>t.ms===0))return;}throw Error('Reset did not settle');}
 socket.onopen();receive({type:'ready',cursor:session.cursor});await drain();
 return {session,room,trace,archives,journal,receive,drain,get saved(){return structuredClone(saved);},failReset(){failReset=true;},issueEpoch(epoch){issuedEpoch=epoch;}};
}
const prepare=(s,value)=>s.client.prepare({kind:'insert',at:gapAt(s.client.state,'bp',0),text:value,marks:[]});
const checkpoint=(record,cursor)=>({wire:WIRE_VERSION,record,cursor});
async function reset(h,cp){h.receive({type:'reset',checkpoint:cp});h.receive({type:'ready',cursor:cp.cursor});await h.drain();}
test('restore journals unpersisted input, reconciles lost acknowledgements and retires unknown work before fresh editing',async()=>{
 const h=await harness(),s=h.session,target=h.room.snapshot().state,accepted=prepare(s,'accepted'),unknown=prepare(s,'offline');h.room.accept(accepted);
 const cp=checkpoint(restoreRecord(h.room.snapshot(),target,{id:'restore-one'}),2);await reset(h,cp);
 assert.equal(s.failed,undefined);assert.equal(s.ready,true);assert.equal(s.client.stream,'fresh-2');assert.deepEqual(s.client.pending,[]);assert.deepEqual(s.client.undoStack,[]);assert.equal(s.client.state.epoch,2);assert.equal(s.restored.recoveryCount,1);
 assert.deepEqual(h.archives[0].boundary.retired,[{op:accepted,decision:'accepted'},{op:unknown,decision:'not-recorded'}]);assert.deepEqual(h.archives[0].saved.head.pending,[accepted,unknown]);assert.ok(!h.trace.some(t=>t.kind==='send'&&t.message.type==='submit'));
 const index=h.trace.findIndex(t=>t.kind==='reset');assert.ok(h.trace.slice(0,index).some(t=>t.kind==='write'&&t.saved.head.pending.length===2));assert.ok(h.trace.slice(index+1).some(t=>t.kind==='durable'&&t.cursor===2));
 const next=prepare(s,'new');assert.equal(next.epoch,2);assert.equal(next.seq,1);assert.equal(next.stream,'fresh-2');s.close();
});
test('failed boundary transaction leaves the persisted old queue readable and never acknowledges the new cursor',async()=>{
 const h=await harness(),s=h.session,old=prepare(s,'retained'),cp=checkpoint(restoreRecord(h.room.snapshot(),h.room.snapshot().state,{id:'r'}),1);h.failReset();await reset(h,cp);
 assert.equal(s.failed,true);assert.deepEqual(h.saved.head.pending,[old]);assert.equal(h.saved.checkpoint.record.state.epoch,1);assert.equal(h.archives.length,0);assert.equal(s.client.state.epoch,1);assert.ok(!h.trace.some(t=>t.kind==='durable'&&t.cursor===1));s.close();
});
test('reload after the atomic boundary uses the fresh stream with no old Undo or replay queue',async()=>{
 const h=await harness();prepare(h.session,'retained');await reset(h,checkpoint(restoreRecord(h.room.snapshot(),h.room.snapshot().state,{id:'r'}),1));const saved=h.saved;h.session.close();
 const reopened=await harness(saved);assert.equal(reopened.session.client.state.epoch,2);assert.equal(reopened.session.client.stream,'fresh-2');assert.deepEqual(reopened.session.client.pending,[]);assert.deepEqual(reopened.session.client.undoStack,[]);assert.equal(reopened.session.cursor,1);reopened.session.close();
});
test('duplicate restore delivery does not discard new-epoch pending work or session Undo',async()=>{
 const h=await harness(),cp=checkpoint(restoreRecord(h.room.snapshot(),h.room.snapshot().state,{id:'r'}),1);await reset(h,cp);const next=prepare(h.session,'new');const undo=structuredClone(h.session.client.undoStack);await reset(h,cp);assert.deepEqual(h.session.client.pending,[next]);assert.deepEqual(h.session.client.undoStack,undo);assert.equal(h.archives.length,1);assert.equal(h.session.ready,true);h.session.close();
});
test('a newer restore during stream issuance reconnects without installing mismatched state or a recovery error',async()=>{
 const h=await harness(),target=h.room.snapshot().state,second=restoreRecord(h.room.snapshot(),target,{id:'r2'}),third=restoreRecord(second,target,{id:'r3'}),pending=prepare(h.session,'local');h.issueEpoch(3);await reset(h,checkpoint(second,1));assert.equal(h.session.failed,undefined);assert.equal(h.session.client.state.epoch,1);assert.equal(h.archives.length,0);assert.deepEqual(h.saved.head.pending,[pending]);h.receive({type:"ready",cursor:1});await h.drain();assert.equal(h.session.failed,undefined);
 await reset(h,checkpoint(third,2));assert.equal(h.session.client.state.epoch,3);assert.equal(h.session.client.stream,'fresh-3');assert.equal(h.session.resetting,false);assert.equal(h.session.ready,true);assert.equal(h.archives.length,1);h.session.close();
});
test('changed duplicate checkpoint and pending receipt payload fail without replacing the active journal',async()=>{
 const h=await harness(),cp=checkpoint(restoreRecord(h.room.snapshot(),h.room.snapshot().state,{id:'r'}),1);await reset(h,cp);const saved=h.saved,changed=structuredClone(cp);changed.record.frontiers.forged=1;await reset(h,changed);assert.equal(h.session.failed,true);assert.match(h.session.errors.at(-1),/Duplicate restore checkpoint changed/);assert.deepEqual(h.saved,saved);h.session.close();
 const other=await harness(),pending=prepare(other.session,'pending');other.room.accept(pending);const target=checkpoint(restoreRecord(other.room.snapshot(),fixture(),{id:'r'}),2);const bad=structuredClone(target);bad.record.receipts[pending.id].bytes='changed';await reset(other,bad);assert.equal(other.session.failed,true);assert.match(other.session.errors.at(-1),/pending payload/);assert.equal(other.saved.checkpoint.record.state.epoch,1);assert.deepEqual(other.saved.head.pending,[pending]);other.session.close();
});
