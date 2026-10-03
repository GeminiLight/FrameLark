import test from 'node:test';
import assert from 'node:assert/strict';
import { presets } from '../../public/presets.js';
import { rankStyles, filterStyles } from '../../public/style-matcher.js';
import { createAcceptedRecord } from '../../public/taste-memory.js';

const brightPhoto = {stats:{mean:.62,deviation:.19,saturation:.27,brightClip:.02,darkClip:.01}};

test('style recommendations respond to photo light and the chosen mood', () => {
  const automatic = rankStyles({inspection:brightPhoto});
  const monochrome = rankStyles({inspection:brightPhoto,preference:'mono'});
  assert.equal(new Set(presets.map(item => item.id)).size, presets.length);
  assert.equal(presets.length, 14);
  assert.equal(automatic.slice(0,3).some(item => item.preset.groups.includes('night')), false);
  assert.equal(monochrome.slice(0,3).every(item => item.preset.feels.includes('mono')), true);
  assert.ok(automatic[0].reason.includes('原片'));
});

test('final accepted looks provide a bounded personal ranking signal', () => {
  const record = createAcceptedRecord({
    id:'chosen',subject:'landscape',originalStats:brightPhoto.stats,
    finalStats:{...brightPhoto.stats,saturation:.2,deviation:.16},presetId:'misty-air',presetAmount:52,
    adjustments:{contrast:-17,highlights:-14,saturation:-15},crop:null
  });
  const baseline = rankStyles({inspection:brightPhoto,subject:'landscape'});
  const personal = rankStyles({inspection:brightPhoto,subject:'landscape',tasteRecords:[record]});
  const score = (items,id) => items.find(item => item.preset.id === id).score;
  assert.ok(score(personal,'misty-air') > score(baseline,'misty-air'));
  assert.ok(score(personal,'misty-air')-score(baseline,'misty-air') <= 16);
  assert.equal(personal.find(item => item.preset.id === 'misty-air').source,'personal');
});

test('visual matches add image-specific reasons while favorites remain a separate filter', () => {
  const ranked = rankStyles({inspection:brightPhoto,aiMatches:[{id:'daily-soft',reason:'可见的暖光和人物适合轻柔层次。'}]});
  assert.equal(ranked[0].preset.id, 'daily-soft');
  assert.equal(ranked[0].source, 'ai');
  assert.match(ranked[0].reason,/暖光和人物/);
  assert.deepEqual(filterStyles('favorites',['street-grain','daily-soft']).map(item => item.id), ['daily-soft','street-grain']);
  assert.ok(filterStyles('night').every(item => item.groups.includes('night')));
});
