// SPDX-License-Identifier: MPL-2.0
import {upgradeRecord} from './storage.js';
import {upgradeStorage} from '@cwhy/jade-core/storage';
import {validate} from '@cwhy/jade-core/admission';
import {immutable} from '@cwhy/jade-core/immutability';

// A host-authorized document boundary, never an ordinary user mutation. The host
// owns review, same-document provenance, durable control receipts and broadcasts.
// Retain current decisions/frontiers even when their visible effects disappear.
export function restoreRecord(record,target,{id}={}){
 if(typeof id!=='string'||!/^[-\w:]{1,160}$/.test(id))throw Error('Restore identity required');
 const current=upgradeRecord(record),state=upgradeStorage(target);
 if(state.root!==current.state.root||!Number.isSafeInteger(state.revision)||state.revision<0||!Number.isSafeInteger(state.epoch)||state.epoch<1||!Number.isSafeInteger(current.state.epoch)||current.state.epoch<1||!Number.isSafeInteger(current.state.revision)||current.state.revision<0||state.revision>current.state.revision||state.epoch>current.state.epoch)throw Error('Invalid historical restore target');
 const epoch=current.state.epoch+1,revision=current.state.revision+1;
 if(!Number.isSafeInteger(epoch)||!Number.isSafeInteger(revision))throw Error('Document clock exhausted');
 state.epoch=epoch;state.revision=revision;
 // Effects remain necessary to interpret ownership, marks and structural
 // lifecycles. Retiring their Undo eligibility must not erase that lineage.
 for(const effect of Object.values(state.effects))effect.retiredByRestore=epoch;
 for(const [node,entry]of Object.entries(state.pendingMedia||{}))entry.generation=state.nodes[node].live?`${id}:epoch:${epoch}`:null;
 validate(state);
 return immutable({state,receipts:current.receipts,frontiers:current.frontiers});
}
