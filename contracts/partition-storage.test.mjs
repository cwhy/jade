// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seed,text,gapAt,anchorAt,resolveAnchor} from '@cwhy/jade-core/model';
import {apply,validate} from '@cwhy/jade-core/admission';
import {upgradeStorage} from '@cwhy/jade-core/storage';
import {immutable} from '@cwhy/jade-core/immutability';
import {captureRange} from '@cwhy/jade-core/selection';
import {planRichInsert} from '@cwhy/jade-core/commands';
import {Room} from '@cwhy/jade-collaboration/room';
import {Client} from '@cwhy/jade-collaboration/client';
import {replay} from '@cwhy/jade-collaboration/replay';
const op=(seq,intent,version=2)=>({id:`a:s:${seq}`,actor:'a',stream:'s',seq,epoch:1,modelVersion:version,intent});
const value=(s,b)=>text(s,b).map(a=>a.char).join('');
const fixture=()=>seed({doc:{id:'doc',type:'doc',live:true,children:['p']},p:{id:'p',type:'paragraph',live:true}},{p:[{text:'first second third',marks:['strong']} ]});
const legacy=JSON.parse(readFileSync(new URL('./fixtures/legacy-partitions.json',import.meta.url)));
const normalize=s=>({...s,storageCodec:49});
test('legacy event replay preserves original generations, gaps, effects and immutable receipts exactly',()=>{
 let record=legacy.initial;
 for(const event of legacy.events)record=replay(record,event);
 assert.deepEqual(record,{...legacy.expected,state:normalize(legacy.expected.state)});
 let resumed=legacy.checkpoint;
 for(const event of legacy.events.slice(1))resumed=replay(resumed,event);
 assert.deepEqual(resumed,record);
 assert.equal(record.state.defaultModelVersion,undefined);
});
test('legacy pending multi-operation queue survives reload and new edits explicitly use current partition rules',()=>{
 const checkpoint=structuredClone(legacy.checkpoint),pending=legacy.events.slice(1).map(e=>e.op),bytes=JSON.stringify(pending);
 const client=new Client('a','legacy',checkpoint,{base:checkpoint,seq:3,pending});
 assert.equal(JSON.stringify(client.pending),bytes);
 assert.deepEqual(client.state,normalize(legacy.expected.state));
 let record=checkpoint;for(const event of legacy.events.slice(1))record=replay(record,event);
 client.receive(record);assert.equal(client.pending.length,0);
 const first=client.state.nodes.p.text,last=client.state.nodes.doc.children.at(-1),anchor=anchorAt(client.state,'p',0,3);
 const next=client.prepare({kind:'proseEnter',at:gapAt(client.state,last,text(client.state,last).length)});
 assert.equal(next.modelVersion,2);assert.equal(client.state.nodes.p.text,first);assert.equal(resolveAnchor(client.state,anchor).status,'exact');
 const restored=new Client('a','legacy',record,JSON.parse(JSON.stringify(client.save())));
 assert.deepEqual(restored.state,client.state);assert.equal(restored.pending[0].modelVersion,2);
});
test('only unchanged nonadjacent partitions keep generation identity; boundary paragraphs rotate even with equal text',()=>{
 let s=fixture();s=apply(s,op(1,{kind:'proseEnter',at:gapAt(s,'p',6)}));
 const right=s.nodes.doc.children[1];s=apply(s,op(2,{kind:'proseEnter',at:gapAt(s,right,7)}));
 const stable=s.nodes.p.text,last=s.nodes.doc.children.at(-1),affected=s.nodes[last].text;
 s=apply(s,op(3,{kind:'proseEnter',at:gapAt(s,last,text(s,last).length)}));
 assert.equal(s.nodes.p.text,stable);assert.notEqual(s.nodes[last].text,affected);
 assert.equal(s.replicas[stable].retired,false);assert.equal(s.replicas[affected].retired,true);
 s=apply(s,op(4,{kind:'undo',target:'a:s:3'}));validate(s);assert.equal(s.nodes.p.text,stable);
 assert.equal(s.nodes.doc.children.map(b=>value(s,b)).join(''),'first second third');
 for(const version of [0,3,'2',null])assert.throws(()=>apply(s,op(5,{kind:'proseEnter',at:gapAt(s,last,0)},version)),/partition version/);
});
for(const direction of ['append','prepend'])test(`${direction}: 100,000 words grown by real paste operations retain a linear number of generations`,()=>{
 let s=immutable(seed({doc:{id:'doc',type:'doc',live:true,children:['p']},p:{id:'p',type:'paragraph',live:true}},{p:[]}));
 const paragraph=('Needle '+('word '.repeat(9))).repeat(10),sizes=[];
 for(let batch=0;batch<20;batch++){
  const block=direction==='append'?s.nodes.doc.children.at(-1):'p',point={block,offset:direction==='append'?text(s,block).length:0},range=captureRange(s,point,point);
  const blocks=Array.from({length:50},()=>({type:'paragraph',content:[{text:paragraph,marks:[]}]}));
  if(batch)blocks[direction==='append'?'unshift':'push']({type:'paragraph',content:[]});
  const header=op(batch+1),plan=planRichInsert(s,range,{version:1,edges:{start:'partial',end:'partial'},blocks},header);
  s=immutable(plan.state);assert.equal(s.nodes.doc.children.length,(batch+1)*50);
  // At most two existing neighbours can rotate per new cut. The bound is
  // structural, not a machine-dependent timing assertion.
  assert.ok(Object.keys(s.replicas).length<=3*s.nodes.doc.children.length);
  sizes.push(JSON.stringify(s).length);
 }
 assert.equal(s.nodes.doc.children.map(b=>value(s,b)).join(''),paragraph.repeat(1000));
 console.log(JSON.stringify({direction,replicas:Object.keys(s.replicas).length,bytes:sizes.at(-1),halfBytes:sizes[9],fields:Object.fromEntries(Object.entries(s).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,JSON.stringify(v).length]))}));
 assert.ok(sizes.at(-1)<10*1024*1024,`Stored ${sizes.at(-1)} bytes for 100k words`);
 assert.ok(sizes[19]<sizes[9]*2.5,'doubling content must not quadruple retained state');
 const lastBytes=JSON.stringify(s),again=upgradeStorage(JSON.parse(lastBytes));assert.deepEqual(again,s);validate(again);
 console.log(JSON.stringify({direction,words:100000,replicas:Object.keys(s.replicas).length,bytes:sizes.at(-1),halfBytes:sizes[9]}));
});

test('packed Undo identities preserve a peer insertion and cannot be submitted as public deletion',()=>{
 let s=fixture();const before=JSON.stringify(s),insert=op(1,{kind:'insert',at:gapAt(s,'p',3),text:'X'.repeat(1000),marks:['em']});
 s=apply(s,insert);const inverse=s.effects[insert.id].inverse;
 assert.equal(inverse.kind,'delete');assert.equal(inverse.ids,undefined);assert.equal(inverse.idSpans.reduce((n,p)=>n+p.length,0),1000);
 assert.throws(()=>apply(s,op(2,inverse)),/Admission|internal/);
 const peer={...op(1,{kind:'insert',at:gapAt(s,'p',500),text:'PEER',marks:['strong']}),actor:'b',stream:'s',id:'b:s:1'};
 s=apply(s,peer);s=apply(s,op(2,{kind:'undo',target:insert.id}));assert.equal(value(s,'p'),'firPEERst second third');
 s=apply(s,op(3,{kind:'undo',target:'a:s:2'}));assert.equal(value(s,'p'),'fir'+'X'.repeat(497)+'PEER'+'X'.repeat(503)+'st second third');
 assert.equal(JSON.stringify(fixture()),before);
 const malformed=structuredClone(s);malformed.effects[insert.id].inverse.idSpans[0].length=10000000;assert.throws(()=>upgradeStorage(malformed),/Undo identity span/);
});
