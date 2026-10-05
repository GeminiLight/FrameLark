import test from 'node:test';
import assert from 'node:assert/strict';
import {aspectKind,summarizeWorkspace} from '../../apps/studio/public/workspace-profile.js';

test('workspace profile counts actual photo subjects and aspect ratios', () => {
  const summary = summarizeWorkspace([
    {subject:'landscape',image:{naturalWidth:1600,naturalHeight:900}},
    {subject:'portrait',image:{naturalWidth:800,naturalHeight:1200}},
    {subject:'unknown-from-model',image:{naturalWidth:1000,naturalHeight:1000}}
  ]);
  assert.equal(summary.total,3);
  assert.equal(summary.subjects.landscape,1);
  assert.equal(summary.subjects.portrait,1);
  assert.equal(summary.subjects.unclassified,1);
  assert.deepEqual(summary.aspects,{landscape:1,portrait:1,square:1,unknown:0});
});

test('aspect classification has a square tolerance and treats missing dimensions honestly', () => {
  assert.equal(aspectKind(1080,1000),'square');
  assert.equal(aspectKind(1200,1000),'landscape');
  assert.equal(aspectKind(1000,1200),'portrait');
  assert.equal(aspectKind(0,1000),'unknown');
});
