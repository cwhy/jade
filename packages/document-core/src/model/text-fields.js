// SPDX-License-Identifier: MPL-2.0
import {isImmutable} from './immutable.js';
const checkedContent=new WeakMap();
const validName=name=>typeof name==='string'&&/^[_a-zA-Z][_a-zA-Z0-9-]{0,63}$/.test(name)&&!Object.hasOwn(Object.prototype,name);
// Named, single-line document text is content. It shares character identities and
// owned Undo with the body, but is not a body block or an authorization setting.
export function fieldEntries(state) {
  const fields=state.nodes[state.root]?.fields;
  if(fields===undefined)return [];
  if(!fields||typeof fields!=='object'||Array.isArray(fields))throw Error('Invalid document text fields');
  const entries=Object.entries(fields);
  if(entries.length>16||entries.some(([name,id])=>!validName(name)||typeof id!=='string'||!id)||new Set(entries.map(([,id])=>id)).size!==entries.length)throw Error('Invalid document text fields');
  return entries;
}
export function validateTextFields(state,readText){
  const entries=fieldEntries(state);
  for(const [,id] of entries){
    const node=state.nodes[id];
    if(!node?.live||node.type!=='text_field'||!node.text||node.children!==undefined)throw Error('Invalid document text field');
    const limit=node.maxLength===undefined?100000:node.maxLength;
    if(!Number.isSafeInteger(limit)||limit<1||limit>100000)throw Error('Invalid document text field limit');
    const replica=state.replicas[node.text],formats=state.formats;
    const stable=isImmutable(replica)&&isImmutable(formats);
    if(stable&&checkedContent.get(replica)?.get(formats)===limit)continue;
    const atoms=readText(state,id);
    if(atoms.reduce((n,a)=>n+a.char.length,0)>limit)throw Error('Document text field exceeds its length limit');
    if(atoms.some(a=>/[\r\n\u2028\u2029]/.test(a.char)||a.marks?.length))throw Error('Document text fields contain single-line plain text');
    if(stable){let seen=checkedContent.get(replica);if(!seen){seen=new WeakMap();checkedContent.set(replica,seen);}seen.set(formats,limit);}
  }
}
export function validateFieldTransition(before,after,intent){
  const prior=fieldEntries(before),next=new Map(fieldEntries(after));
  for(const [name,id] of prior)if(next.get(name)!==id||(after.nodes[id]?.text!==before.nodes[id].text||after.nodes[id]?.maxLength!==before.nodes[id].maxLength))throw Error('Document text field structure is fixed');
  if(intent.kind!=='textFieldCreate'&&next.size!==prior.length)throw Error('Document text field structure is fixed');
}
export function validateFieldCreate(state,intent){
  if(Object.keys(intent).some(k=>!['kind','name','text','maxLength'].includes(k))||!validName(intent.name)||typeof intent.text!=='string'||intent.text.length>100000||/[\r\n\u2028\u2029]/.test(intent.text))throw Error('Invalid document text field creation');
  if(intent.maxLength!==undefined&&(!Number.isSafeInteger(intent.maxLength)||intent.maxLength<1||intent.maxLength>100000||intent.text.length>intent.maxLength))throw Error('Invalid document text field limit');
  const entries=fieldEntries(state);
  if(entries.length>=16||entries.some(([name])=>name===intent.name))throw Error('Document text field already exists or limit reached');
}
export function executeFieldCreate(state,intent,action,host){
  validateFieldCreate(state,intent);
  const id=action+':field',replica=action+':text';
  if(Object.hasOwn(state.nodes,id)||Object.hasOwn(state.replicas,replica))throw host.fail('Document text field identity reused');
  host.write('nodes')[id]={id,type:'text_field',live:true,text:replica,...(intent.maxLength!==undefined?{maxLength:intent.maxLength}:{})};
  const root=state.nodes[state.root];host.write('nodes')[state.root]={...root,fields:{...root.fields,[intent.name]:id}};
  host.write('replicas')[replica]=host.replica(replica,id);
  host.boundary(replica+':empty',id);
  if(intent.text)host.execute({kind:'insert',at:host.gap(id),text:intent.text,marks:[]},action+':value');
  return {kind:'textFieldSetup'}; // Setup is host-only and has no personal Undo.
}
