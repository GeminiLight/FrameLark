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
