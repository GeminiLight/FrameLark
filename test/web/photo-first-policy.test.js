import test from 'node:test';
import assert from 'node:assert/strict';
import {onDemandReview,canPreviewAdvisorResult} from '../../public/photo-first-policy.js';
import {globalAdjustments} from '../../public/adjustment-layers.js';
import {neutralSettings} from '../../public/editor-engine.js';
import {inspectPixels} from '../../public/diagnostics.js';

test('a new photo has usable local context without inventing a visual review',()=>{
  const photo={originalInspection:inspectPixels(new Uint8ClampedArray([100,120,140,255]),1,1),isDemo:false};
  const review=onDemandReview(photo);assert.equal(review.observationSource,'statistics');assert.deepEqual(review.recommendations,[]);assert.equal(review.conclusion.kind,'uncertain');
});
test('changing goals invalidates old recommendations while preserving applied pixels',()=>{
  const recommendations=[{id:'applied',adjustments:{exposure:.2}},{id:'unapplied',adjustments:{warmth:20}}];
  const photo={originalInspection:inspectPixels(new Uint8ClampedArray([100,120,140,255]),1,1),analysis:{recommendations},active:new Set(['applied']),isDemo:false};
  const before=globalAdjustments({manual:neutralSettings(),recommendations,active:photo.active});
  const review=onDemandReview(photo,{keepApplied:true});
  assert.deepEqual(review.recommendations.map(r=>r.id),['applied']);assert.equal(review.recommendations[0].retained,true);
  assert.deepEqual(globalAdjustments({manual:neutralSettings(),recommendations:review.recommendations,active:photo.active}),before);
});
test('automatic comparison never steals a different photo, a changed edit, or an unfinished next message',()=>{
  const valid={source:'ai',action:{kind:'crop'},photoId:'one',currentPhotoId:'one',baseSignature:'same',currentSignature:'same',baseIntent:'natural',currentIntent:'natural'};
  assert.equal(canPreviewAdvisorResult(valid),true);
  for(const change of [{source:'local'},{action:{kind:'none'}},{currentPhotoId:'two'},{currentSignature:'changed'},{currentIntent:'changed'},{notesChanged:true},{dialogOpen:true},{draft:'正在输入下一条'},{tab:'adjust'}])assert.equal(canPreviewAdvisorResult({...valid,...change}),false);
});
