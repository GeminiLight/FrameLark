import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createProjectRenderPool} from '../../apps/studio/server/projects/render-pool.mjs';

class WorkerFixture extends EventEmitter {
  constructor(){super();this.stops=0;}
  postMessage(message){this.message=message;}
  async terminate(){this.stops++;this.emit('exit',0);}
  complete(result){this.emit('message',{result});}
}
function fixture(t,options={}){
  const created=[];
  const pool=createProjectRenderPool({concurrency:1,maxQueued:2,...options,createWorker:()=>{const worker=new WorkerFixture();created.push(worker);return worker;}});
  t.after(()=>pool.close());
  const run=(id,signal)=>{const pending=pool.run({id},{signal});pending.catch(()=>{});return pending;};
  return {pool,created,run};
}

test('admission bounds actual workers and waiting jobs, then drains in order',async t=>{
  const {pool,created,run}=fixture(t,{concurrency:2});
  const a=run(1),b=run(2),c=run(3),d=run(4);
  await assert.rejects(run(5),{code:'RENDER_BUSY'});
  assert.equal(created.length,2);assert.equal(pool.status.queued,2);
  created[0].complete('one');assert.equal(await a,'one');assert.equal(created[2].message.id,3);
  created[1].complete('two');assert.equal(await b,'two');assert.equal(created[3].message.id,4);
  created[2].complete('three');created[3].complete('four');
  assert.deepEqual(await Promise.all([c,d]),['three','four']);assert.equal(pool.workers.size,0);
});

test('cancelling a waiting preview never starts a worker for it',async t=>{
  const {pool,created,run}=fixture(t),controller=new AbortController();
  const first=run(1),cancelled=run(2,controller.signal),last=run(3);
  controller.abort();await assert.rejects(cancelled,{code:'CANCELLED'});assert.equal(pool.status.queued,1);
  created[0].complete(1);await first;assert.equal(created[1].message.id,3);
  created[1].complete(3);await last;assert.equal(created.length,2);
});

test('a cancelling worker keeps its slot until termination completes',async t=>{
  const {pool,created,run}=fixture(t),controller=new AbortController();
  const first=run(1,controller.signal),next=run(2);let stopped;
  created[0].terminate=()=>new Promise(resolve=>{stopped=resolve;});
  controller.abort();await Promise.resolve();assert.equal(created.length,1);assert.equal(pool.status.active,1);
  stopped();await assert.rejects(first,{code:'CANCELLED'});assert.equal(created.length,2);
  created[1].complete(2);await next;
});

test('failed input transfer releases its worker and does not block a later request',async t=>{
  const created=[];
  const pool=createProjectRenderPool({concurrency:1,createWorker:()=>{const worker=new WorkerFixture();if(!created.length)worker.postMessage=()=>{throw Error('transfer failed');};created.push(worker);return worker;}});
  t.after(()=>pool.close());
  await assert.rejects(pool.run({id:1}),/transfer failed/);assert.equal(created[0].stops,1);
  const next=pool.run({id:2});created[1].complete(2);assert.equal(await next,2);assert.equal(pool.workers.size,0);
});

test('a worker failure and a deadline both release their slot',async t=>{
  const {pool,created,run}=fixture(t,{timeoutMs:30});
  const failed=run(1);created[0].emit('error',Error('worker stopped'));await assert.rejects(failed,/worker stopped/);
  await assert.rejects(run(2),{code:'RENDER_TIMEOUT'});assert.equal(pool.workers.size,0);
  const next=run(3);created[2].complete(3);assert.equal(await next,3);
});

test('closing settles active and waiting work, rejects new requests and ignores late output',async t=>{
  const {pool,created,run}=fixture(t),a=run(1),b=run(2);
  const rejectedA=assert.rejects(a,{code:'RENDER_UNAVAILABLE'}),rejectedB=assert.rejects(b,{code:'RENDER_UNAVAILABLE'});
  await pool.close();await Promise.all([rejectedA,rejectedB]);
  created[0].complete('late');assert.equal(pool.status.active,0);assert.equal(pool.status.queued,0);assert.equal(pool.workers.size,0);
  await assert.rejects(run(3),{code:'RENDER_UNAVAILABLE'});
});

test('an unconfirmed worker stop rejects waiting jobs and disables new admission',async t=>{
  const {pool,created,run}=fixture(t),first=run(1),waiting=run(2);
  created[0].terminate=async()=>{throw Error('termination failed');};created[0].complete(1);
  await assert.rejects(first,{code:'RENDER_UNAVAILABLE'});await assert.rejects(waiting,{code:'RENDER_UNAVAILABLE'});
  await assert.rejects(run(3),{code:'RENDER_UNAVAILABLE'});assert.equal(created.length,1);assert.equal(pool.status.closed,true);
});
