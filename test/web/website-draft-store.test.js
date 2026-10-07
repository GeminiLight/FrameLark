import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore as websiteStore} from '../../apps/website/public/draft-store.js';
import {createDraftStore as studioStore} from '../../apps/studio/public/draft-store.js';

// Only the browser-owned IndexedDB adapter is simulated here. Store reads,
// revision checks, transaction aborts and client ownership use product code.
function indexedDBFixture(t,initial=[]){
  const previous=globalThis.indexedDB,records=new Map(initial.map(value=>[value.id,structuredClone(value)]));
  const db={close(){},objectStoreNames:{contains:()=>true},transaction(){
    const local=new Map(records);let pending=0,aborted=false;
    const tx={abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return {
      get:id=>request(()=>structuredClone(local.get(id))),getAll:()=>request(()=>[...local.values()].map(value=>structuredClone(value))),
      put:value=>request(()=>{local.set(value.id,structuredClone(value));return value.id;}),delete:id=>request(()=>local.delete(id))
    };}};
    function request(action){const value={};pending++;queueMicrotask(()=>{
      if(aborted)return;value.result=action();value.onsuccess?.();pending--;
      if(!pending&&!aborted){records.clear();for(const [id,record] of local)records.set(id,record);tx.oncomplete?.();}
    });return value;}return tx;
  }};
  globalThis.indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
  t.after(()=>{globalThis.indexedDB=previous;});return records;
}

for(const [label,createStore] of [['website',websiteStore],['studio',studioStore]]){
  test(`${label} rejects a stale client instead of overwriting a newer saved edit`,async t=>{
    const records=indexedDBFixture(t,[{id:'shared',version:1,value:'baseline',photos:[{originalBlob:new Blob(['original'])}]}]);
    const a=createStore(),b=createStore(),baseA=await a.get('shared'),baseB=await b.get('shared');
    a.adopt?.(baseA);b.adopt?.(baseB);
    await a.save({...baseA,value:'newest from A'});
    await assert.rejects(b.save({...baseB,value:'stale from B'}),{code:'STALE_DRAFT'});
    assert.equal(records.get('shared').value,'newest from A');
    assert.equal(await records.get('shared').photos[0].originalBlob.text(),'original');
  });
  test(`${label} keeps old draft data when adopting a legacy revision and saving again`,async t=>{
    const records=indexedDBFixture(t,[{id:'legacy',version:1,photos:[{originalBlob:new Blob(['preserved original'])}],deletedAt:null}]);
    const store=createStore(),saved=await store.get('legacy');store.adopt?.(saved);
    await store.save({...saved,value:'continued'});await store.save({...saved,value:'continued again'});
    assert.equal(records.get('legacy').storageRevision,2);
    assert.equal(records.get('legacy').version,1);assert.equal(await records.get('legacy').photos[0].originalBlob.text(),'preserved original');
  });
  test(`${label} cleanup changes the revision so a stale page cannot resurrect a cleaned draft`,async t=>{
    const records=indexedDBFixture(t,[{id:'cleaned',version:1,deletedAt:null}]);
    const editor=createStore(),manager=createStore(),saved=await editor.get('cleaned');editor.adopt?.(saved);
    await manager.setDeleted('cleaned',true);
    await assert.rejects(editor.save({...saved,value:'stale autosave'}),{code:'STALE_DRAFT'});
    assert.ok(records.get('cleaned').deletedAt);
  });
  test(`${label} a claimed legacy zero revision cannot recreate a permanently deleted draft`,async t=>{
    const records=indexedDBFixture(t,[{id:'purged-legacy',version:1,deletedAt:null}]);
    const editor=createStore(),manager=createStore(),saved=await editor.get('purged-legacy');editor.adopt(saved);
    await manager.setDeleted('purged-legacy',true);await manager.purge('purged-legacy');assert.equal(records.has('purged-legacy'),false);
    await assert.rejects(editor.save({...saved,value:'stale edit'}),{code:'STALE_DRAFT'});assert.equal(records.has('purged-legacy'),false);
    await editor.save({id:'new-workspace',version:1,value:'new edit'});assert.equal(records.get('new-workspace').value,'new edit');
  });
}
