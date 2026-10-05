import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initProject,loadProject,setIntent,createCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {handoffProject,waitForProject} from '../skills/photo-retouch/scripts/handoff.mjs';
import {handoffView} from '../skills/photo-retouch/scripts/handoff-state.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'frameyn-handoff-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const folder=join(root,'photo'),{project}=await initProject(fileURLToPath(new URL('./web/fixtures/quality/portrait.png',import.meta.url)),folder);
  return {folder,project};
}

test('a human request is claimed once, reports real progress and links only current candidates',async t=>{
  const {folder,project}=await fixture(t);
  const queued=await handoffProject(folder,{action:'request',revision:project.revision,requestId:'human-1',message:'保留肤色，先给我试片'});
  assert.equal(handoffView(queued.project).status,'queued');
  const claimed=await handoffProject(folder,{action:'claim',id:queued.request.id,revision:queued.project.revision,actorId:'agent-a'});
  await assert.rejects(handoffProject(folder,{action:'claim',id:queued.request.id,revision:claimed.project.revision,actorId:'agent-b'}),{code:'HANDOFF_CLAIMED'});
  await assert.rejects(handoffProject(folder,{action:'progress',id:queued.request.id,revision:claimed.project.revision,actorId:'agent-b',summary:'读取中'}),{code:'HANDOFF_OWNER'});
  const progress=await handoffProject(folder,{action:'progress',id:queued.request.id,revision:claimed.project.revision,actorId:'agent-a',summary:'已看原片，正在准备试片'});
  const made=await createCandidate(folder,{revision:progress.project.revision,baseVersion:project.currentId,handoffId:queued.request.id,actorId:'agent-a',name:'自然版',items:[{id:'light',title:'轻调',patch:{settings:{exposure:.1}}}]});
  await assert.rejects(handoffProject(folder,{action:'complete',id:queued.request.id,revision:made.project.revision,actorId:'agent-a',summary:'完成',candidateIds:['missing']}),{code:'HANDOFF_RESULT'});
  const done=await handoffProject(folder,{action:'complete',id:queued.request.id,revision:made.project.revision,actorId:'agent-a',summary:'请比较这一版',candidateIds:[made.candidate.id]});
  assert.equal(handoffView(done.project).status,'completed');assert.equal(done.project.currentId,project.currentId);
  assert.deepEqual(handoffView(done.project).request.candidateIds,[made.candidate.id]);
});

test('a new human edit invalidates old work without changing the edit or silently completing it',async t=>{
  const {folder,project}=await fixture(t);
  const queued=await handoffProject(folder,{action:'request',revision:project.revision,message:'准备试片'});
  const claimed=await handoffProject(folder,{action:'claim',id:queued.request.id,revision:queued.project.revision,actorId:'agent-a'});
  const changed=await setIntent(folder,{revision:claimed.project.revision,intent:'保留夜晚的暗部'});
  assert.equal(handoffView(changed.project).status,'stale');
  await assert.rejects(handoffProject(folder,{action:'complete',id:queued.request.id,revision:changed.project.revision,actorId:'agent-a',summary:'完成'}),{code:'HANDOFF_STALE'});
  assert.equal((await loadProject(folder)).intent,'保留夜晚的暗部');
  const next=await handoffProject(folder,{action:'request',revision:changed.project.revision,message:'按最新意图重看'});
  assert.equal(handoffView(next.project).status,'queued');assert.notEqual(next.request.id,queued.request.id);
});

test('retries do not duplicate requests, and cancellation prevents a late agent result',async t=>{
  const {folder,project}=await fixture(t);
  const first=await handoffProject(folder,{action:'request',requestId:'stable',revision:project.revision,message:'试片'});
  const retry=await handoffProject(folder,{action:'request',requestId:'stable',revision:first.project.revision,message:'试片'});
  assert.equal(retry.request.id,first.request.id);assert.equal(retry.project.handoffs.length,1);
  const claimed=await handoffProject(folder,{action:'claim',id:first.request.id,revision:retry.project.revision,actorId:'agent-a'});
  const cancelled=await handoffProject(folder,{action:'cancel',id:first.request.id,revision:claimed.project.revision});
  assert.equal(handoffView(cancelled.project).status,'cancelled');
  await assert.rejects(createCandidate(folder,{revision:cancelled.project.revision,baseVersion:project.currentId,handoffId:first.request.id,actorId:'agent-a',settings:{exposure:.1}}),{code:'HANDOFF_CLOSED'});
  await assert.rejects(handoffProject(folder,{action:'complete',id:first.request.id,revision:cancelled.project.revision,actorId:'agent-a',summary:'晚到的结果'}),{code:'HANDOFF_CLOSED'});
});

test('CLI waiting receives a new request and cleans up on timeout and cancellation',async t=>{
  const {folder,project}=await fixture(t);
  const controller=new AbortController();
  const waiting=waitForProject(folder,{afterRevision:project.revision,timeoutMs:2000,signal:controller.signal});
  await handoffProject(folder,{action:'request',revision:project.revision,message:'新批注，请继续'});
  const event=await waiting;assert.equal(event.type,'handoff');assert.equal(event.collaboration.request.message,'新批注，请继续');
  const p=await loadProject(folder);await handoffProject(folder,{action:'cancel',revision:p.revision,id:p.handoffs[0].id});
  const timeout=await waitForProject(folder,{timeoutMs:30});assert.equal(timeout.type,'timeout');
  const pending=waitForProject(folder,{timeoutMs:2000,signal:controller.signal});controller.abort();
  await assert.rejects(pending,{code:'CANCELLED'});
});
