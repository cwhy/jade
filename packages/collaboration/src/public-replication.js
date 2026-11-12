// SPDX-License-Identifier: MPL-2.0
// An authorized content replica needs accepted operations, but never another
// author's rejected draft. Authorization and recipient identity belong to the host.
import {immutable} from '@cwhy/jade-core/immutability';
import {replay} from './replay.js';
const fingerprint = value => JSON.stringify(value);
function header(op) {
  return {id:op.id,actor:op.actor,stream:op.stream,seq:op.seq};
}
function hidden(receipt) {
  return {outcome:'rejected',revision:receipt.revision,redacted:true};
}
export function publicRecord(record, actor) {
  if(typeof actor!=='string'||!actor)throw Error('Recipient required');
  const receipts={};
  for(const [id,receipt] of Object.entries(record.receipts)) {
    const op=JSON.parse(receipt.bytes);
    receipts[id]=receipt.outcome==='rejected'&&op.actor!==actor?hidden(receipt):receipt;
  }
  return {state:record.state,frontiers:record.frontiers,receipts};
}
export function publicEvent(event, actor) {
  if(typeof actor!=='string'||!actor)throw Error('Recipient required');
  return event.receipt.outcome==='rejected'&&event.op.actor!==actor
    ? {cursor:event.cursor,op:header(event.op),receipt:hidden(event.receipt)} : event;
}
function verifyDuplicate(record,event) {
  const previous=record.receipts[event.op.id];
  if(fingerprint(previous)!==fingerprint(event.receipt))throw Error('Duplicate event changed');
  if(previous?.redacted) validateMarker(event,record.state.revision,false);
  else if(previous?.bytes!==fingerprint(event.op))throw Error('Duplicate event changed');
}
function validateMarker(event,revision,current=true) {
  const {op,receipt}=event;
  if(fingerprint(op)!==fingerprint(header(op)) || typeof op.actor!=='string' || typeof op.stream!=='string' || !op.actor || !op.stream || !Number.isSafeInteger(op.seq) || op.seq<1 || op.id!==`${op.actor}:${op.stream}:${op.seq}` ||
    fingerprint(receipt)!==fingerprint(hidden(receipt)) || !Number.isSafeInteger(receipt.revision) || receipt.revision<0 || (current&&receipt.revision!==revision))
    throw Error('Invalid redacted decision');
}
function replayPublic(record,event) {
  if(!event.receipt.redacted)return replay(record,event);
  validateMarker(event,record.state.revision);
  if(record.receipts[event.op.id]){verifyDuplicate(record,event);return record;}
  const key=`${event.op.actor}:${event.op.stream}`;
  if(event.op.seq!==(record.frontiers[key]||0)+1)throw Error('Sequence gap');
  return immutable({state:record.state,receipts:{...record.receipts,[event.op.id]:event.receipt},frontiers:{...record.frontiers,[key]:event.op.seq}});
}
export const publicReplication={replay:replayPublic,verifyDuplicate};
