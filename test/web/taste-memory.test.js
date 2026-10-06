import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcceptedRecord,sanitizeTasteRecords,summarizeTaste,tasteAffinity,rememberedStyleAmount } from '../../apps/studio/public/taste-memory.js';
import { presetById } from '../../apps/studio/public/presets.js';

const base = {mean:.48,deviation:.21,saturation:.25,warmth:.04,brightClip:.01,darkClip:.01};
const accepted = (id,override = {}) => createAcceptedRecord({
  id,subject:'landscape',originalStats:base,finalStats:{...base,mean:.52,saturation:.19,deviation:.18},
  presetId:'misty-air',adjustments:{exposure:.1,contrast:-17,highlights:-14,saturation:-15},
  crop:{width:.8,height:.9},localCount:1,...override
});

test('accepted record stores bounded edit summaries and no image or filename', () => {
  const record = accepted('one');
  assert.equal(record.cropCoverage,.72);
  assert.ok(record.moods.includes('airy'));
  assert.equal(record.original.mean,.48);
  assert.equal(record.final.saturation,.19);
  assert.equal(JSON.stringify(record).includes('data:image'),false);
  assert.equal(JSON.stringify(record).includes('filename'),false);
  assert.equal(sanitizeTasteRecords([record,record]).length,1);
});

test('taste signals reflect accepted choices, not trialed styles', () => {
  const records = [accepted('one'),accepted('two'),accepted('three')];
  const summary = summarizeTaste(records);
  assert.equal(summary.count,3);
  assert.equal(summary.practices.composition,3);
  assert.equal(summary.practices.light,3);
  assert.equal(summary.practices.color,3);
  assert.equal(summary.practices.focus,3);
  assert.equal(summary.leadingMood,'airy');
  const inspection = {stats:base};
  const related = tasteAffinity({records,preset:presetById('misty-air'),inspection,subject:'landscape'});
  const unrelated = tasteAffinity({records,preset:presetById('street-grain'),inspection,subject:'landscape'});
  assert.ok(related.boost > unrelated.boost);
  assert.match(related.reason,/定稿/);
  assert.equal(tasteAffinity({records:[],preset:presetById('misty-air'),inspection,subject:'landscape'}).boost,0);
  assert.equal(rememberedStyleAmount([accepted('soft',{presetAmount:58})],'misty-air','landscape'),58);
});

test('accepted recipes retain style and actual operations, including masked choices, through storage',async()=>{
 const {createDocument}=await import('../../apps/studio/public/edit-stack/document.js');
 const {applyCommands}=await import('../../apps/studio/public/edit-stack/commands.js');
 const {presetCommands}=await import('../../apps/studio/public/edit-stack/styles.js');
 let document=createDocument({documentId:'d',source:{assetId:'a',contentHash:'a'.repeat(64),width:8,height:8},base:{settings:{},locals:[]}});
 document=applyCommands(document,presetCommands('daily-soft',75,{groupId:'soft'})).next;
 document=applyCommands(document,[{type:'AddStep',step:{id:'local',title:'私密批注不进入档案',tool:'exposure',toolVersion:2,parameters:{ev:.4}}},{type:'ReplaceStepMask',stepId:'local',mask:{expression:{kind:'constant',value:.5},reference:{kind:'live-input'}}}]).next;
 const record=accepted('recipe',{editDocument:document,presetId:null,adjustments:{}}),restored=sanitizeTasteRecords([record])[0];
 assert.equal(restored.presetId,'daily-soft');assert.equal(restored.presetAmount,75);assert.equal(restored.recipe.styles[0].modified,false);assert.equal(restored.localCount,1);assert.equal(restored.recipe.operations.at(-1).parameters.ev,.4);
 assert.equal(JSON.stringify(restored).includes('私密批注'),false);assert.equal(JSON.stringify(restored).includes('contentHash'),false);assert.equal(summarizeTaste([restored]).practices.light,1);assert.equal(rememberedStyleAmount([restored],'daily-soft','landscape'),75);
 const changed=applyCommands(document,[{type:'SetStepOpacity',stepId:document.steps[0].id,opacity:.4}]).next;
 const modified=accepted('modified',{editDocument:changed});assert.equal(modified.recipe.styles[0].modified,true);assert.equal(rememberedStyleAmount([modified],'daily-soft','landscape'),null);
});
