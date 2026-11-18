// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodedPort} from '../packages/collaboration/src/decoded-port.js';
test('decoded host envelopes require explicit bounded integer telemetry and object ownership',()=>{
 const message={type:'ready',cursor:0};assert.equal(decodedPort(message,0).value,message);
 for(const bytes of [undefined,-1,0.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>decodedPort(message,bytes),/Invalid decoded/);
 for(const payload of [null,[],true,42])assert.throws(()=>decodedPort(payload,1),/Invalid decoded/);
});
test('string ports keep UTF-8 byte measurement and reject malformed JSON',()=>{
 const raw=JSON.stringify({type:'notice',text:'你好🌍'}),parsed=decodedPort(raw);assert.deepEqual(parsed.value,JSON.parse(raw));assert.equal(parsed.bytes,new TextEncoder().encode(raw).length);assert.throws(()=>decodedPort('{invalid'));
});
