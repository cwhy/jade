// SPDX-License-Identifier: MPL-2.0
// Hosts may decode their negotiated framing directly into an owned object.
// Avoid forcing large snapshots through a second stringify/parse allocation.
// Engine payload validation is unchanged; byteLength is transport telemetry.
export function decodedPort(data,byteLength){
 if(typeof data==='string')return {value:JSON.parse(data),bytes:new TextEncoder().encode(data).length};
 if(!data||typeof data!=='object'||Array.isArray(data)||!Number.isSafeInteger(byteLength)||byteLength<0)throw Error('Invalid decoded host payload');
 return {value:data,bytes:byteLength};
}
