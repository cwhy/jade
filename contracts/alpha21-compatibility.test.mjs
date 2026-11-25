// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Room} from '@cwhy/jade-collaboration/room';import {Client} from '@cwhy/jade-collaboration/client';import {DocumentSession} from '@cwhy/jade-collaboration/session';import {upgradeStorage,STORAGE_CODEC} from '@cwhy/jade-core/storage';import {resolveAnchor,text} from '@cwhy/jade-core/model';import {WIRE_VERSION,requireWireVersion} from '@cwhy/jade-protocol';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/alpha21-checkpoint.json',import.meta.url)));const clone=x=>structuredClone(x);const legacyShape=s=>({...s,storageCodec:52});
test('actual alpha21 checkpoint preserves source identities, anchors and receipts',()=>{
 const bytes=JSON.stringify(fixture),room=new Room(null,fixture.checkpoint);assert.deepEqual(legacyShape(room.snapshot().state),fixture.checkpoint.state);assert.deepEqual(room.snapshot().receipts,fixture.checkpoint.receipts);assert.deepEqual(room.snapshot().frontiers,fixture.checkpoint.frontiers);assert.equal(resolveAnchor(room.snapshot().state,fixture.anchor).status,'exact');assert.equal(JSON.stringify(fixture),bytes);
});
for(const acknowledged of [false,true])test(`actual alpha21 pending edit and lost acknowledgement replay exactly, saved=${acknowledged}`,()=>{
 const room=new Room(null,acknowledged?fixture.lostAcknowledgement:fixture.checkpoint),client=new Client('writer','legacy',null,fixture.saved);assert.deepEqual(client.pending,[fixture.pending]);assert.deepEqual(legacyShape(client.state),fixture.expected);
 const receipt=room.accept(fixture.pending);assert.equal(receipt.outcome,'accepted');assert.deepEqual(legacyShape(room.snapshot().state),fixture.expected);client.receive(room.snapshot());assert.equal(client.pending.length,0);assert.equal(client.recovery.length,0);const stable=room.snapshot();assert.deepEqual(room.accept(fixture.pending),receipt);assert.deepEqual(room.snapshot(),stable);
 const undo={actor:'writer',stream:'legacy',seq:4,id:'writer:legacy:4',epoch:1,modelVersion:2,intent:{kind:'undo',target:fixture.firstOwnedEdit.id}};assert.equal(room.accept(undo).outcome,'accepted');assert.equal(text(room.snapshot().state,'task').map(a=>a.char).join(''),'Check the example');assert.equal(text(room.snapshot().state,'code').map(a=>a.char).join(''),'print(2 + 1)');
});
for(const failWrite of [false,true])test(`actual wire58 journal keeps pending bytes and persists before connection; write failure=${failWrite}`,async()=>{
 const saved={checkpoint:{wire:58,record:fixture.checkpoint,cursor:2},events:[],head:{stream:'legacy',seq:fixture.saved.seq,pending:fixture.saved.pending,cursor:2}},bytes=JSON.stringify(saved),trace=[];let opened;
 const ports={openJournal:async()=>({read:async()=>clone(saved),write:async(head,events,checkpoint)=>{trace.push({kind:'write',head,checkpoint});if(failWrite)throw Error('mock write failure');},close:()=>trace.push({kind:'close'})}),readCheckpoint:async()=>{throw Error('unexpected fetch');},connect:()=>{trace.push({kind:'connect'});return{readyState:0,send:()=>{},close:()=>{}};},createStream:()=>{throw Error('lost original stream');},now:()=>0,schedule:()=>0,cancel:()=>{},openState:1,checkpointEvery:100};
 if(failWrite){await assert.rejects(()=>DocumentSession.open('mock','writer',()=>{},ports),/mock write failure/);assert.equal(trace.some(x=>x.kind==='connect'),false);}else{opened=await DocumentSession.open('mock','writer',()=>{},ports);assert.deepEqual(opened.client.pending,fixture.saved.pending);assert.equal(trace[0].kind,'write');assert.equal(trace[0].checkpoint.wire,WIRE_VERSION);assert.equal(trace[0].checkpoint.record.state.storageCodec,STORAGE_CODEC);assert.deepEqual(legacyShape(opened.client.state),fixture.expected);opened.close();}assert.equal(JSON.stringify(saved),bytes);
});
test('old live peers and experimental saved schemas remain fenced; corruption leaves input intact',()=>{
 for(const wire of [58,59])assert.throws(()=>requireWireVersion(wire),/mismatch/);
 const experiment={...fixture.checkpoint.state,storageCodec:53};assert.throws(()=>upgradeStorage(experiment),/source retained/);
 const corrupt=clone(fixture.checkpoint.state);delete corrupt.replicas;const bytes=JSON.stringify(corrupt);assert.throws(()=>upgradeStorage(corrupt));assert.equal(JSON.stringify(corrupt),bytes);
});
