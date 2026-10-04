import test from 'node:test';
import assert from 'node:assert/strict';
import {modelEffortChoices,normalizeModelTiers} from '../../public/model-routing.js';

const models=[{id:'limited',efforts:['low','medium']},{id:'complete',efforts:['none','minimal','low','medium','high','xhigh','max','ultra']}];
test('Codex model choices match the discovered model and retain extended supported efforts',()=>{
  assert.deepEqual(modelEffortChoices('codex','limited',models),['low','medium']);
  const efforts=modelEffortChoices('codex','complete',models);
  for(const effort of ['none','minimal','ultra']){
    assert.ok(efforts.includes(effort));
    const tiers=Object.fromEntries(['fast','standard','deep'].map(tier=>[tier,{model:'complete',effort}]));
    assert.equal(normalizeModelTiers(tiers).standard.effort,effort);
  }
});
test('switching to API restores its editable effort choices regardless of the last Codex model',()=>{
  assert.deepEqual(modelEffortChoices('api','limited',models),['low','medium','high','xhigh','max']);
  assert.throws(()=>normalizeModelTiers({standard:{model:'complete',effort:'unsupported'}}));
});
