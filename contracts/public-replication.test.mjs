// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room} from '@cwhy/jade-collaboration/room';
import {Client} from '@cwhy/jade-collaboration/client';
import {publicRecord,publicEvent,publicReplication} from '@cwhy/jade-collaboration/public-replication';
import {tableFixture} from '@cwhy/jade-testkit/table-fixture';
import {planBoundaryParagraph} from '@cwhy/jade-core/commands';
import {captureTableBoundary} from '@cwhy/jade-core/table-selection';
import {gapAt} from '@cwhy/jade-core/model';
const op=(actor,seq,intent)=>({actor,stream:'s',seq,id:`${actor}:s:${seq}`,epoch:1,intent});
function fixture(){
 const room=new Room(tableFixture()),events=[];
 const accept=o=>{const receipt=room.accept(o);events.push({cursor:events.length+1,op:o,receipt});return receipt;};
 const create=op('A',1);create.intent=planBoundaryParagraph(room.record.state,captureTableBoundary(room.record.state,'table'),create,{text:'visible'}).intent;accept(create);
 const late=op('B',1,{kind:'insert',at:gapAt(room.record.state,'A:s:1:paragraph',2),text:'PRIVATE_REJECTED_DRAFT',marks:[]});
 accept(op('A',2,{kind:'undo',target:create.id}));assert.equal(accept(late).outcome,'rejected');
 return {room,events,late,accept};
}
test('foreign rejected payload and reason are omitted from checkpoint and event',()=>{
 const {room,events,late}=fixture();
 const publicJSON=JSON.stringify([publicRecord(room.record,'A'),publicEvent(events.at(-1),'A')]);assert.ok(!publicJSON.includes('PRIVATE_REJECTED_DRAFT'));assert.ok(!publicJSON.includes('reason'));assert.ok(publicJSON.includes('redacted'));
 assert.equal(publicRecord(room.record,'B').receipts[late.id].bytes,JSON.stringify(late));assert.deepEqual(publicEvent(events.at(-1),'B'),events.at(-1));
});
test('redacted decisions advance sequence before later accepted peer edits and replay exactly',()=>{
 const {room,events,accept}=fixture();const id=Object.values(room.record.state.nodes).find(n=>n.live&&n.type==='paragraph'&&n.id!=='A:s:1:paragraph').id;
 accept(op('B',2,{kind:'insert',at:gapAt(room.record.state,id,0),text:'next',marks:[]}));
 let replica=publicRecord(new Room(tableFixture()).record,'A');
 for(const event of events)replica=publicReplication.replay(replica,publicEvent(event,'A'));
 assert.deepEqual(replica,publicRecord(room.record,'A'));
 for(const event of events)publicReplication.verifyDuplicate(replica,publicEvent(event,'A'));
 const corrupt=structuredClone(publicEvent(events[2],'A'));corrupt.op.seq++;assert.throws(()=>publicReplication.verifyDuplicate(replica,corrupt));
});
test('own rejected receipt reconciles the exact immutable pending operation',()=>{
 const {room,late}=fixture(),base=publicRecord(room.record,'B');
 const client=new Client('B','s',base,{seq:1,pending:[late],base});client.receive(base);assert.equal(client.pending.length,0);assert.equal(client.recovery[0].id,late.id);
});
test('malformed redactions and sequence gaps fail closed',()=>{
 const {events}=fixture();let replica=publicRecord(new Room(tableFixture()).record,'A');for(const event of events.slice(0,2))replica=publicReplication.replay(replica,publicEvent(event,'A'));
 for(const mutate of [e=>e.op.actor=['B'],e=>e.op.intent={kind:'insert'},e=>e.receipt.reason='private',e=>e.receipt.revision++,e=>{e.op.seq=2;e.op.id='B:s:2';}]){const e=structuredClone(publicEvent(events[2],'A'));mutate(e);assert.throws(()=>publicReplication.replay(replica,e));}
});
