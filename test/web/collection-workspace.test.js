import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionWorkspace} from '../../apps/studio/public/collection-workspace.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const collection=id=>({id,revision:1,snapshotHash:'pixels-'+id,folder:'/test/'+id,brief:{theme:'主题 '+id,purpose:'travel',sequence:'visual',targetCount:1,mustKeep:[],constraints:[]},photos:[{id:'P0001',name:id}],plan:null,jobs:[]});

function harness(t){
  const originals={document:globalThis.document,window:globalThis.window,EventSource:globalThis.EventSource,fetch:globalThis.fetch};
  t.after(()=>Object.assign(globalThis,originals));
  const nodes=new Map(),streams=[],notifications=[],requests=[],pending=new Map();
  function node(id){
    if(nodes.has(id))return nodes.get(id);
    const listeners=new Map(),value={id,dataset:{},disabled:false,hidden:false,open:false,value:'',innerHTML:'',textContent:'',before(){},append(){},insertAdjacentHTML(){},querySelectorAll(){return [];},
      addEventListener(name,handler){listeners.set(name,[...(listeners.get(name)||[]),handler]);},
      async dispatch(name,event={}){for(const handler of listeners.get(name)||[])await handler(event);},
      showModal(){this.open=true;},close(){this.open=false;this.dispatch('close');}};
    nodes.set(id,value);return value;
  }
  globalThis.document={head:node('head'),body:node('body'),createElement:tag=>node('created-'+tag),getElementById:node,querySelectorAll:()=>[]};
  globalThis.window={addEventListener(){}};
  globalThis.EventSource=class {constructor(url){this.url=url;this.closed=false;streams.push(this);}close(){this.closed=true;}};
  globalThis.fetch=async(path,options={})=>{
    requests.push({path,value:options.body&&JSON.parse(options.body)});
    let value;
    if(path==='/api/local-capabilities')value={local:true,projects:true};
    else if(path==='/api/collections/register')value=collection(JSON.parse(options.body).path);
    else if(pending.has(path)){const queued=pending.get(path);queued.started.resolve();value=await queued.gate.promise;}
    else if(/^\/api\/collections\/[AB]$/.test(path))value=collection(path.at(-1));
    else throw Error('Unexpected test request '+path);
    return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  };
  createCollectionWorkspace({onEdit:async()=>{},notify:message=>notifications.push(message)});
  return {node,streams,notifications,requests,
    async show(id){node('collection-picker').showModal();node('collection-source').value=id;await node('collection-load').dispatch('click');},
    hold(path){const queued={started:deferred(),gate:deferred()};pending.set(path,queued);return queued;}};
}

test('a late plan save remains on its initiating collection after closing and opening another',async t=>{
  const h=harness(t);await h.show('A');const held=h.hold('/api/collections/A/plan');
  const saving=h.node('collection-save-plan').dispatch('click');await held.started.promise;
  h.node('shared-collection-dialog').close();await h.show('B');
  held.gate.resolve({...collection('A'),revision:2,plan:{id:'saved-A',title:'已保存 A',order:['P0001'],decisions:[]}});await saving;
  assert.equal(h.node('collection-theme').value,'主题 B');
  assert.equal(h.node('shared-collection-title').textContent,'主题 B');
  assert.equal(h.node('collection-theme').disabled,false,'a background save cannot lock the newly opened collection');
  assert.doesNotMatch(h.node('collection-status').textContent,/选片与顺序已保存/,'A completion is not presented as a result for B');
});

test('a stale refresh response cannot clear the current collection save or overwrite its status',async t=>{
  const h=harness(t);await h.show('A');const oldRefresh=h.hold('/api/collections/A');
  h.streams[0].onmessage({data:JSON.stringify({revision:2,snapshotHash:'updated'})});await oldRefresh.started.promise;
  h.node('shared-collection-dialog').close();await h.show('B');
  const save=h.hold('/api/collections/B/plan'),saving=h.node('collection-save-plan').dispatch('click');await save.started.promise;
  oldRefresh.gate.resolve({...collection('A'),revision:2});await new Promise(r=>setImmediate(r));
  assert.equal(h.node('collection-theme').value,'主题 B');
  assert.equal(h.node('collection-theme').disabled,true,'B still owns its pending operation');
  save.gate.resolve({...collection('B'),revision:2});await saving;
  assert.equal(h.node('collection-theme').disabled,false);
});

test('queued events from a closed collection stream do not refresh or warn in a new collection',async t=>{
  const h=harness(t);await h.show('A');const old=h.streams[0];h.node('shared-collection-dialog').close();await h.show('B');
  const before=h.requests.length;old.onmessage({data:JSON.stringify({error:'旧组图已移走'})});old.onerror();
  assert.equal(h.node('collection-status').textContent,'');
  old.onmessage({data:JSON.stringify({revision:9,snapshotHash:'old-A'})});await new Promise(r=>setImmediate(r));
  assert.equal(h.requests.length,before,'a late A event cannot request a B refresh');
});

test('opening a slow recent collection cannot replace a more recently opened selection',async t=>{
  const h=harness(t),a=h.hold('/api/collections/A');h.node('collection-picker').showModal();
  const recent=id=>({target:{closest:()=>({dataset:{collectionRecent:id}})}});
  const opening=h.node('collection-picker').dispatch('click',recent('A'));await a.started.promise;
  await h.node('collection-picker').dispatch('click',recent('B'));
  a.gate.resolve(collection('A'));await opening;
  assert.equal(h.node('collection-theme').value,'主题 B');
});
