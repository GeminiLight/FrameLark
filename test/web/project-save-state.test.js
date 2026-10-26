import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSaveState} from '../../apps/studio/public/project-save-state.js';
import {collaborationCandidates} from '../../apps/studio/public/project-collaboration.js';
const photo={projectId:'p',projectRevision:3};
test('unsaved input, retries and conflicts remain pending even outside a network write',()=>{
  for(const [state,link] of [[{...photo,projectNativePending:true},{}],[{...photo,editRetry:{}},{}],[photo,{conflict:true}],[photo,{dirty:true}],[{...photo,editSaving:true},{}]])assert.equal(projectSaveState(state,link).pending,true);
  assert.equal(projectSaveState(photo,{}).pending,false);
  assert.equal(projectSaveState(null).pending,false);
});
test('notification reconnect does not imply a failed write and cannot hide one',()=>{
  const disconnected={connectionError:'connection lost'};
  assert.equal(projectSaveState(photo,disconnected).pending,false);
  assert.match(projectSaveState(photo,disconnected).label,/已保存/);
  const failed={...disconnected,error:'disk full'};
  assert.equal(projectSaveState(photo,failed).message,'disk full');
  assert.equal(projectSaveState(photo,{...failed,connectionError:null}).pending,true);
});
test('automatic browser save candidates do not masquerade as Agent proposals',()=>{
  const candidates=[{id:'save',actorId:'workspace-user'},{id:'agent',actorId:'agent'},{id:'legacy'},{id:'stale',stale:true}];
  assert.deepEqual(collaborationCandidates({candidates}).map(c=>c.id),['agent','legacy']);
  assert.equal(candidates.length,4,'filtering the collaboration display does not discard project records');
});
