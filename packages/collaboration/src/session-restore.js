// SPDX-License-Identifier: MPL-2.0
import {Client} from './client.js';
import {upgradeRecord} from './storage.js';
import {WIRE_VERSION} from '@cwhy/jade-protocol';

// Runs only on the session's ordered receive queue. The host atomically archives
// eligible old input and replaces the active journal through journal.reset.
export async function restoreSessionBoundary(session,message,previousReady){
 const checkpoint=message.checkpoint;
 if(checkpoint?.wire!==WIRE_VERSION||!Number.isSafeInteger(checkpoint.cursor)||checkpoint.cursor<0)throw Error('Invalid restore checkpoint');
 const record=upgradeRecord(checkpoint.record),old=session.client;
 if(record.state.epoch<=old.base.state.epoch){
  if(record.state.epoch===old.base.state.epoch&&checkpoint.cursor===session.cursor&&JSON.stringify(record)!==JSON.stringify(old.base))throw Error('Duplicate restore checkpoint changed');
  if(checkpoint.cursor>session.cursor)throw Error('Restore checkpoint did not advance epoch');
  session.resetting=false;old.paused=false;session.ready=previousReady;
  session.ports.onDurable?.({cursor:session.durableCursor,seq:session.durableSeq});session.onChange?.();return true;
 }
 if(record.state.root!==old.base.state.root||record.state.revision<=old.base.state.revision||checkpoint.cursor<=session.cursor)throw Error('Invalid restore clock');
 if(typeof session.ports.createResetStream!=='function'||typeof session.journal.reset!=='function')throw Error('Host restore ports required; original journal retained');
 session.clearFlight();
 await session.ports.beforeReset?.({fromEpoch:old.base.state.epoch,toEpoch:record.state.epoch});
 if(session.closed)return false;
 // Includes input prepared immediately before the reset notice, even if its
 // normal coalesced write had not run. No new mutation is allowed while paused.
 await session.save(session.head());
 let issued;
 try{issued=await session.ports.createResetStream(record.state.epoch);}catch(error){if(error.code==='RESTORE_CHANGED'){session.socket?.close();return false;}throw error;}
 if(session.closed)return false;
 if(issued?.epoch!==record.state.epoch){session.socket?.close();return false;}
 if(typeof issued.stream!=='string'||!/^[-\w]{1,80}$/.test(issued.stream)||issued.stream===old.stream||(issued.actor!==undefined&&issued.actor!==session.actor))throw Error('Invalid restored stream');
 const retired=old.pending.map(op=>{
  const receipt=record.receipts[op.id];
  if(receipt&&(receipt.redacted||receipt.bytes!==JSON.stringify(op)))throw Error('Restore reconciliation changed pending payload');
  return {op:structuredClone(op),decision:receipt?.outcome??'not-recorded'};
 });
 const client=new Client(session.actor,issued.stream,record,undefined,{deferMutation:session.ports.deferMutation});
 const head={stream:client.stream,seq:0,pending:[],cursor:checkpoint.cursor};
 const boundary={fromEpoch:old.base.state.epoch,toEpoch:record.state.epoch,retired};
 const result=await session.journal.reset(head,{wire:WIRE_VERSION,record,cursor:checkpoint.cursor},boundary);
 if(session.closed)return false;
 const caret=session.onBeforeChange?.();
 session.client=client;session.cursor=checkpoint.cursor;session.durableCursor=checkpoint.cursor;session.durableSeq=0;
 session.persistedIds.clear();session.sentAt.clear();session.lastOp=null;session.resetting=false;session.ready=false;
 session.restored={fromEpoch:boundary.fromEpoch,epoch:boundary.toEpoch,recoveryCount:result?.recoveryCount??retired.filter(r=>r.decision!=='accepted').length};
 session.ports.onDurable?.({cursor:session.durableCursor,seq:session.durableSeq});
 session.ports.onRestore?.(session.restored);session.onChange?.(caret);return true;
}
