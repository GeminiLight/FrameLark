import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftAutosave} from '../../apps/studio/public/draft-autosave.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const timers={setTimer:()=>1,clearTimer:()=>{}};

test('all flush callers wait for in-flight writes and newer edits before switching workspaces',async()=>{
  const first=deferred(),second=deferred(),writes=[];let exposure=.2;
  const autosave=createDraftAutosave({...timers,capture:()=>({exposure,savedAt:String(exposure)}),save:snapshot=>{writes.push(snapshot);return writes.length===1?first.promise:second.promise;}});
  autosave.request();const saving=autosave.flush();await Promise.resolve();
  exposure=.5;autosave.request();const barrier=autosave.flush();assert.equal(saving,barrier);
  let completed=false;barrier.then(()=>completed=true);await Promise.resolve();assert.equal(completed,false);
  assert.throws(()=>autosave.reset('other workspace'),/等待/);
  first.resolve();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(writes.map(s=>s.exposure),[.2,.5]);assert.equal(completed,false);
  second.resolve();assert.equal(await barrier,true);
  assert.deepEqual(autosave.status,{dirty:false,failed:false,savedAt:'0.5',saving:false});
  autosave.reset('restored');assert.equal(autosave.status.savedAt,'restored');
});

test('a failed write blocks transition, preserves dirty state and can be retried',async()=>{
  let attempts=0,exposure=.2;
  const autosave=createDraftAutosave({...timers,capture:()=>({exposure,savedAt:String(exposure)}),save:async snapshot=>{if(++attempts===1)throw Error('QuotaExceededError');assert.equal(snapshot.exposure,.5);}});
  autosave.request();assert.equal(await autosave.flush(),false);
  assert.equal(autosave.status.failed,true);assert.equal(autosave.status.dirty,true);assert.equal(autosave.status.saving,false);
  exposure=.5;assert.equal(await autosave.flush(),true);assert.equal(autosave.status.failed,false);assert.equal(autosave.status.savedAt,'0.5');
});

test('capture errors release the barrier; restoring a clean workspace does not create a write',async()=>{
  let broken=true,writes=0;
  const autosave=createDraftAutosave({...timers,capture:()=>{if(broken)throw Error('bad snapshot');return {savedAt:'saved'};},save:async()=>writes++});
  autosave.request();assert.equal(await autosave.flush(),false);broken=false;assert.equal(await autosave.flush(),true);
  assert.equal(writes,1);autosave.reset('restored');assert.equal(await autosave.flush(),true);assert.equal(writes,1);
});
