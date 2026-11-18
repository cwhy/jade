// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,text,gapAt} from '@cwhy/jade-core/model';
import {Room} from '@cwhy/jade-collaboration/room';
import {reviewTextReplacement} from '@cwhy/jade-core/text-replacement';
import {literalMatches} from '@cwhy/jade-core/literal-search';
const op=(actor,seq,intent)=>({id:`${actor}:s:${seq}`,actor,stream:'s',seq,epoch:1,intent});
const value=(s,b)=>text(s,b).map(a=>a.char).join('');
function fixture(){
 const nodes={doc:{id:'doc',type:'doc',live:true,children:['p','table']},p:{id:'p',type:'paragraph',live:true},table:{id:'table',type:'table',live:true,children:['row']},row:{id:'row',type:'row',live:true,children:['cell']},cell:{id:'cell',type:'cell',live:true,children:['code']},code:{id:'code',type:'code',language:'unknown-language',live:true}};
 const r=new Room(seed(nodes,{p:[{text:'Draft body Draft',marks:['strong']}],code:[{text:'Draft() // Draft',marks:[]}]}));
 assert.equal(r.accept(op('host',1,{kind:'textFieldCreate',name:'title',text:'Draft title'})).outcome,'accepted');return r;
}
const review=r=>reviewTextReplacement(r.snapshot().state,{query:'Draft',replacement:'Final'});
test('reviewed title/prose/code batch preserves structure, runs once and has one owned Undo',()=>{
 const r=fixture(),before=r.snapshot().state,{intent,preview,changed}=review(r),id=before.nodes.doc.fields.title;
 assert.equal(changed,5);assert.equal(preview.length,5);assert.deepEqual(preview.filter(p=>p.type==='code').map(p=>p.marks),[[],[]]);
 assert.equal(r.accept(op('a',1,intent)).outcome,'accepted');let state=r.snapshot().state;
 assert.equal(value(state,id),'Final title');assert.equal(value(state,'p'),'Final body Final');assert.equal(value(state,'code'),'Final() // Final');assert.deepEqual(state.nodes,before.nodes);
 const peer=op('b',1,{kind:'insert',at:gapAt(state,'p',5),text:' peer',marks:[]});assert.equal(r.accept(peer).outcome,'accepted');
 assert.equal(r.accept(op('a',2,{kind:'undo',target:'a:s:1'})).outcome,'accepted');state=r.snapshot().state;
 assert.equal(value(state,'p'),'Draft peer body Draft');assert.equal(value(state,id),'Draft title');assert.equal(value(state,'code'),'Draft() // Draft');
 assert.equal(r.accept(op('a',3,{kind:'undo',target:'a:s:2'})).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'Final peer body Final');
});
for(const mode of ['inside','new-match','delete','format'])test(`changed ${mode} invalidates complete review without partial title/body writes`,()=>{
 const r=fixture(),before=r.snapshot().state,request=op('a',1,review(r).intent);
 const change=mode==='inside'?{kind:'insert',at:gapAt(before,'p',2),text:'X',marks:[]}:mode==='new-match'?{kind:'insert',at:gapAt(before,'p',text(before,'p').length),text:' Draft',marks:[]}:mode==='delete'?{kind:'delete',ids:[text(before,'p')[0].id]}:{kind:'format',ids:[text(before,'p')[0].id],property:'em',value:'em'};
 const received=r.accept(op('b',1,change));assert.equal(received.outcome,'accepted',JSON.stringify(received));const stable=JSON.stringify(r.snapshot().state);
 assert.equal(r.accept(request).outcome,'rejected');assert.equal(JSON.stringify(r.snapshot().state),stable);assert.equal(r.accept(request).outcome,'rejected');
});
test('unrelated text before a target maps by identity; lost acknowledgement and reload cannot repeat a batch',()=>{
 let r=fixture();const request=op('a',1,review(r).intent),before=r.snapshot().state;
 assert.equal(r.accept(op('b',1,{kind:'insert',at:gapAt(before,'p',0),text:'Unrelated ',marks:[]})).outcome,'accepted');assert.equal(r.accept(request).outcome,'accepted');
 const saved=JSON.parse(JSON.stringify(r.snapshot()));r=new Room(null,saved);assert.equal(r.accept(request).outcome,'accepted');assert.deepEqual(r.snapshot(),saved);assert.equal(value(r.snapshot().state,'p'),'Unrelated Final body Final');
});
test('Replace current revalidates its own match without requiring unrelated matches to remain unchanged',()=>{
 const r=fixture(),s=r.snapshot().state,request=op('a',1,reviewTextReplacement(s,{query:'Draft',replacement:'Draft Draft',scope:'one',target:{block:'p',first:text(s,'p')[0].id}}).intent);
 r.accept(op('b',1,{kind:'insert',at:gapAt(s,'code',0),text:'Draft ',marks:[]}));assert.equal(r.accept(request).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'Draft Draft body Draft');
});
test('identical replacement does not create a revision or Undo entry; deletion keeps empty field identity',()=>{
 const r=fixture(),before=r.snapshot().state,id=before.nodes.doc.fields.title;
 const same=reviewTextReplacement(before,{query:'Draft',replacement:'Draft'});assert.equal(same.changed,0);assert.equal(r.accept(op('a',1,same.intent)).outcome,'accepted');assert.equal(r.snapshot().state,before);assert.equal(before.effects['a:s:1'],undefined);
 const clear=reviewTextReplacement(before,{query:'Draft title',replacement:''});assert.equal(r.accept(op('a',2,clear.intent)).outcome,'accepted');assert.equal(value(r.snapshot().state,id),'');assert.equal(r.snapshot().state.nodes.doc.fields.title,id);
 r.accept(op('a',3,{kind:'undo',target:'a:s:2'}));assert.equal(value(r.snapshot().state,id),'Draft title');
});
test('mixed formatting keeps first marks but only a shared complete hyperlink',()=>{
 const link={type:'link',attrs:{href:'https://example.com/'}};
 for(const shared of [true,false]){
  const r=new Room(seed({doc:{id:'doc',type:'doc',live:true,children:['p']},p:{id:'p',type:'paragraph',live:true}},{p:[{text:'Dr',marks:['strong',link]},{text:'aft',marks:shared?[link]:['em']},{text:' kept',marks:['underline']}]}));
  const request=reviewTextReplacement(r.snapshot().state,{query:'Draft',replacement:'New'});assert.deepEqual(request.preview[0].marks,shared?['strong',link]:['strong']);r.accept(op('a',1,request.intent));
  assert.deepEqual(text(r.snapshot().state,'p').slice(0,3).map(a=>a.marks),Array.from({length:3},()=>shared?['strong',link]:['strong']));assert.deepEqual(text(r.snapshot().state,'p').at(-1).marks,['underline']);
 }
});
test('matching is literal, Unicode case-folded and cannot split graphemes',()=>{
 assert.deepEqual(literalMatches('Straße STRASSE','strasse'),[{from:0,to:6},{from:7,to:14}]);
 assert.deepEqual(literalMatches('👩‍💻 é','👩'),[]);assert.deepEqual(literalMatches('👩‍💻 é','e'),[]);
 assert.deepEqual(literalMatches('a.b aXb','a.b'),[{from:0,to:3}]);assert.deepEqual(literalMatches('Draft draft','draft',{matchCase:true}),[{from:6,to:11}]);
});
test('partial, duplicate, malformed and multiline reviews never admit an all-set replacement',()=>{
 for(const mutate of [i=>i.targets.pop(),i=>i.targets.push(i.targets[0]),i=>i.query='',i=>i.replacement='a\nb',i=>i.inject=true]){
  const r=fixture(),intent=structuredClone(review(r).intent);mutate(intent);const before=r.snapshot().state;assert.equal(r.accept(op('a',1,intent)).outcome,'rejected');assert.equal(r.snapshot().state,before);
 }
});

for(const peerText of ['X','peer contribution '.repeat(10)])for(const placement of ['before','inside','after'])for(const deliverAfterUndo of [false,true])test(`replacement peer ${placement} restores its source side; delivered after Undo=${deliverAfterUndo}, peer length=${peerText.length}`,()=>{
 let r=fixture();const initial=r.snapshot().state,request=reviewTextReplacement(initial,{query:'Draft',replacement:'Final',scope:'one',target:{block:'p',first:text(initial,'p')[0].id}});
 assert.equal(r.accept(op('a',1,request.intent)).outcome,'accepted');const replaced=r.snapshot().state;
 const offset={before:0,inside:2,after:5}[placement],peer=op('b',1,{kind:'insert',at:gapAt(replaced,'p',offset),text:peerText,marks:['underline']});
 if(!deliverAfterUndo)assert.equal(r.accept(peer).outcome,'accepted');
 assert.equal(r.accept(op('a',2,{kind:'undo',target:'a:s:1'})).outcome,'accepted');
 r=new Room(null,JSON.parse(JSON.stringify(r.snapshot())));
 if(deliverAfterUndo)assert.equal(r.accept(peer).outcome,'accepted');
 assert.equal(value(r.snapshot().state,'p'),placement==='before'?`${peerText}Draft body Draft`:`Draft${peerText} body Draft`);
 const accepted=JSON.parse(JSON.stringify(r.snapshot()));assert.equal(r.accept(peer).outcome,'accepted');assert.deepEqual(r.snapshot(),accepted);
 assert.equal(r.accept(op('a',3,{kind:'undo',target:'a:s:2'})).outcome,'accepted');
 assert.equal(value(r.snapshot().state,'p'),{before:`${peerText}Final body Draft`,inside:`Fi${peerText}nal body Draft`,after:`Final${peerText} body Draft`}[placement]);
 assert.equal(r.accept(op('b',2,{kind:'undo',target:'b:s:1'})).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'Final body Draft');
 assert.equal(r.accept(op('a',4,{kind:'undo',target:'a:s:3'})).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'Draft body Draft');
});
test('nested replacement sources retain peer affinity through both restorations and Redo',()=>{
 let r=fixture();const base=r.snapshot().state;
 r.accept(op('a',1,reviewTextReplacement(base,{query:'Draft',replacement:'Final',scope:'one',target:{block:'p',first:text(base,'p')[0].id}}).intent));
 let s=r.snapshot().state;r.accept(op('a',2,reviewTextReplacement(s,{query:'Final',replacement:'Ready'}).intent));s=r.snapshot().state;
 r.accept(op('b',1,{kind:'insert',at:gapAt(s,'p',2),text:'X',marks:[]}));
 assert.equal(r.accept(op('a',3,{kind:'undo',target:'a:s:2'})).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'FinalX body Draft');
 assert.equal(r.accept(op('a',4,{kind:'undo',target:'a:s:1'})).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'DraftX body Draft');
 r=new Room(null,JSON.parse(JSON.stringify(r.snapshot())));
 assert.equal(r.accept(op('a',5,{kind:'undo',target:'a:s:4'})).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'FinalX body Draft');
 assert.equal(r.accept(op('a',6,{kind:'undo',target:'a:s:3'})).outcome,'accepted');assert.equal(value(r.snapshot().state,'p'),'ReXady body Draft');
});

test('settled replacement rejection can return to review without a sequence gap; dependent edits remain protected',async()=>{
 const {Client}=await import('@cwhy/jade-collaboration/client');
 for(const dependent of [false,true]){
  const r=fixture(),c=new Client('a','s',r.snapshot()),request=c.prepare(reviewTextReplacement(c.state,{query:'Draft',replacement:'Final'}).intent);
  if(dependent)c.prepare({kind:'insert',at:gapAt(c.state,'p',2),text:'own dependent',marks:[]});
  r.accept(op('b',1,{kind:'insert',at:gapAt(r.snapshot().state,'p',1),text:'peer',marks:[]}));r.accept(request);c.receive(r.snapshot());
  assert.equal(c.recovery.length,1);assert.equal(c.acknowledgeRejection(request.id),!dependent);
  if(dependent){assert.equal(c.recovery.length,1);assert.equal(c.pending.length,1);}else{assert.equal(c.undoStack.length,0);const next=c.prepare({kind:'insert',at:gapAt(c.state,'p',0),text:'next ',marks:[]});assert.equal(next.seq,2);assert.equal(r.accept(next).outcome,'accepted');}
 }
});
test('a field limit rejects an overlong replacement atomically with its body edits',()=>{
 const s=seed({doc:{id:'doc',type:'doc',live:true,children:['p'],fields:{title:'t'}},p:{id:'p',type:'paragraph',live:true},t:{id:'t',type:'text_field',live:true,maxLength:6}},{p:[{text:'Draft',marks:[]}],t:[{text:'Draft',marks:[]}]}),r=new Room(s),before=r.snapshot().state;
 const review=reviewTextReplacement(before,{query:'Draft',replacement:'Overlong'});assert.equal(r.accept(op('a',1,review.intent)).outcome,'rejected');assert.equal(r.snapshot().state,before);
});

test('deferred large operations keep the visible state, durable queue and owned history consistent',async()=>{
 const {Client}=await import('@cwhy/jade-collaboration/client'),r=fixture(),initial=r.snapshot(),client=new Client('a','deferred',initial,undefined,{deferMutation:()=>true});
 const intent=reviewTextReplacement(client.state,{query:'Draft',replacement:'Final'}).intent,operation=client.prepare(intent);
 assert.equal(value(client.state,'p'),'Draft body Draft');assert.equal(client.awaitingDecision,true);assert.throws(()=>client.prepare({kind:'insert',at:gapAt(client.state,'p',0),text:'later'}),/pending/);
 const saved=client.save(),reloaded=new Client('a','deferred',null,saved,{deferMutation:()=>true});assert.equal(value(reloaded.state,'p'),'Draft body Draft');assert.equal(reloaded.awaitingDecision,true);
 assert.equal(r.accept(operation).outcome,'accepted');client.receive(r.snapshot());reloaded.receive(r.snapshot());assert.equal(value(client.state,'p'),'Final body Final');assert.equal(client.awaitingDecision,false);assert.equal(reloaded.pending.length,0);
 assert.equal(client.undo(),true);assert.equal(value(client.state,'p'),'Final body Final');const undo=client.pending[0];r.accept(undo);client.receive(r.snapshot());assert.equal(value(client.state,'p'),'Draft body Draft');
 assert.equal(client.redo(),true);r.accept(client.pending[0]);client.receive(r.snapshot());assert.equal(value(client.state,'p'),'Final body Final');
});
test('a rejected deferred batch settles without allocating a dependent sequence or changing content',async()=>{
 const {Client}=await import('@cwhy/jade-collaboration/client'),r=fixture(),c=new Client('a','deferred',r.snapshot(),undefined,{deferMutation:()=>true}),operation=c.prepare(reviewTextReplacement(c.state,{query:'Draft',replacement:'Final'}).intent);
 r.accept(op('peer',1,{kind:'insert',at:gapAt(r.snapshot().state,'p',2),text:'X',marks:[]}));c.receive(r.snapshot());assert.equal(c.awaitingDecision,true);assert.equal(value(c.state,'p'),'DrXaft body Draft');r.accept(operation);c.receive(r.snapshot());assert.equal(c.awaitingDecision,false);assert.equal(c.acknowledgeRejection(operation.id),true);assert.equal(c.undoStack.length,0);
 const next=c.prepare(reviewTextReplacement(c.state,{query:'Draft',replacement:'Final'}).intent);assert.equal(next.seq,2);assert.equal(r.accept(next).outcome,'accepted');
});

test('10,000 replacements retain one insertion-ownership claim through reload, Undo, peer input and Redo',()=>{
 const paragraph=('Needle '+('word '.repeat(9))).repeat(10),nodes={doc:{id:'doc',type:'doc',live:true,children:[]}},contents={};
 for(let i=0;i<1000;i++){const id='p'+i;nodes.doc.children.push(id);nodes[id]={id,type:'paragraph',live:true};contents[id]=[{text:paragraph,marks:['strong']}];}
 let r=new Room(seed(nodes,contents));const request=op('a',1,reviewTextReplacement(r.snapshot().state,{query:'Needle',replacement:'Final'}).intent);
 assert.equal(request.intent.targets.length,10000);assert.equal(r.accept(request).outcome,'accepted');
 const replaced=r.snapshot().state,peer=op('b',1,{kind:'insert',at:gapAt(replaced,'p500',2),text:'PEER',marks:['underline']});
 assert.equal(r.accept(peer).outcome,'accepted');r=new Room(null,JSON.parse(JSON.stringify(r.snapshot())));
 assert.equal(r.accept(op('a',2,{kind:'undo',target:request.id})).outcome,'accepted');
 const undone=r.snapshot().state;assert.ok(Object.keys(undone.textClaims).length<=2,'one Replace All and its Undo must not allocate a claim per match');
 for(let i=0;i<1000;i++)assert.equal(value(undone,'p'+i),i===500?paragraph.replace('Needle','NeedlePEER'):paragraph);
 assert.deepEqual(text(undone,'p500').slice(6,10).map(a=>a.marks),Array.from({length:4},()=>['underline']));
 assert.equal(r.accept(op('a',3,{kind:'undo',target:'a:s:2'})).outcome,'accepted');
 for(let i=0;i<1000;i++)assert.equal(value(r.snapshot().state,'p'+i),i===500?paragraph.replaceAll('Needle','Final').replace('Final','FiPEERnal'):paragraph.replaceAll('Needle','Final'));
 const final=JSON.parse(JSON.stringify(r.snapshot()));assert.equal(r.accept(peer).outcome,'accepted');assert.deepEqual(r.snapshot(),final);
});
