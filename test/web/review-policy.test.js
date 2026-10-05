import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateReviewDecision,reviewPresentation,buildBasicReview} from '../../apps/studio/public/review-policy.js';
import {inspectPixels} from '../../apps/studio/public/diagnostics.js';
import {neutralSettings,renderPixels} from '../../apps/studio/public/editor-engine.js';
import {localDesignReply} from '../../apps/studio/public/design-agent.js';
const original = JSON.parse(await readFile(new URL('./fixtures/vision-retention.json',import.meta.url),'utf8'));
const adjustment = JSON.parse(await readFile(new URL('./fixtures/vision-review.json',import.meta.url),'utf8'));

const clientReview = raw => ({...raw,cropRecommendation:raw.crop.needed ? {reason:raw.crop.reason,rect:raw.crop} : null});

test('a supported retention conclusion has zero edits, retains all four relations, and preserves pixels',() => {
  const review = structuredClone(original);
  // Retention cannot depend on mechanically improving a technical score.
  review.metrics = {light:32,highlights:52,shadows:33,color:45,contrast:42,detail:61};
  assert.equal(validateReviewDecision(review).kind,'keep');
  const presentation = reviewPresentation(clientReview(review));
  assert.equal(presentation.title,'建议保留原片');
  assert.equal(presentation.count,0);
  assert.deepEqual(presentation.preserved.map(item => item.key),['subject','background','light','composition']);
  assert.equal(review.recommendedStyle,'none');
  const pixels = new Uint8ClampedArray([20,30,50,255,120,132,145,255,230,226,201,255]);
  assert.deepEqual(renderPixels(pixels,3,1,neutralSettings()),pixels);
});

test('one issue produces one recommendation and cropping is evaluated independently',() => {
  const review = structuredClone(adjustment);
  review.crop = {...original.crop};
  assert.equal(validateReviewDecision(review).kind,'adjust');
  assert.equal(reviewPresentation(clientReview(review)).count,1);
  assert.equal(reviewPresentation(clientReview(review)).title,'1 处可改善');
  const cropOnly = {...adjustment,recommendations:[]};
  assert.equal(validateReviewDecision(cropOnly).kind,'adjust');
  assert.equal(reviewPresentation(clientReview(cropOnly)).title,'只建议调整构图');
});

test('multiple distinct supported recommendations remain optional, without a fixed minimum',() => {
  const review = structuredClone(adjustment);
  review.recommendations.push({...review.recommendations[0],title:'轻提人物暗部',observationIds:['subject'],adjustments:{...review.recommendations[0].adjustments,highlights:0,whites:0,shadows:12}});
  assert.equal(validateReviewDecision(review).kind,'adjust');
  assert.equal(reviewPresentation(clientReview(review)).count,3); // Two global suggestions and one independent crop.
});

test('contradictory retention, invented problems and zero-change recipes fail validation',() => {
  const withChanges = {...adjustment,conclusion:original.conclusion};
  assert.throws(() => validateReviewDecision(withChanges),/不一致/);
  const uncertain = structuredClone(original);
  uncertain.observations.light.verdict = 'uncertain';
  assert.throws(() => validateReviewDecision(uncertain),/完整依据/);
  const unsupported = structuredClone(adjustment);
  unsupported.recommendations[0].observationIds = ['background'];
  assert.throws(() => validateReviewDecision(unsupported),/改善依据/);
  const noop = structuredClone(adjustment);
  noop.recommendations[0].adjustments = Object.fromEntries(Object.keys(noop.recommendations[0].adjustments).map(key => [key,0]));
  assert.throws(() => validateReviewDecision(noop),/改善依据/);
  const unnecessaryCrop = structuredClone(adjustment);
  unnecessaryCrop.observations.composition.verdict = 'keep';
  assert.throws(() => validateReviewDecision(unnecessaryCrop),/构图依据/);
});

test('uncertainty is an honest zero-action state, rather than a false retention claim',() => {
  const review = structuredClone(original);
  review.conclusion = {kind:'uncertain',reason:'主体处在暗部，预览不足以确认轮廓是否清晰，请放大原片检查。'};
  review.observations.subject.verdict = 'uncertain';
  review.observations.subject.confidence = 'low';
  assert.equal(validateReviewDecision(review).kind,'uncertain');
  assert.equal(reviewPresentation(clientReview(review)).title,'暂不自动调整');
  assert.equal(reviewPresentation(clientReview(review)).count,0);
});

test('local statistics do not automatically brighten low-key scenes, add color, or trim a composition',() => {
  const scenes = [
    new Uint8ClampedArray([5,8,12,255,18,25,38,255,35,48,65,255]),
    new Uint8ClampedArray([235,237,240,255,248,248,249,255,255,255,255,255]),
    new Uint8ClampedArray([110,115,120,255,128,130,131,255,150,150,150,255]),
    new Uint8ClampedArray([210,20,40,255,20,180,80,255,20,80,210,255])
  ];
  for (const pixels of scenes) {
    const review = buildBasicReview(inspectPixels(pixels,3,1));
    assert.equal(review.conclusion.kind,'uncertain');
    assert.equal(review.recommendations.length,0);
    assert.equal(review.cropRecommendation,null);
    assert.equal(review.recommendedStyle,null);
    assert.equal(review.observations,null);
  }
});

test('an accepted retention verdict does not force advisor actions, while explicit style exploration works',() => {
  const analysis = clientReview(original);
  for (const question of ['这张照片最值得先调整哪里？','这张照片值得裁剪吗？','光色需要优化吗？','可以保留原片吗？','我想保留原片']) {
    const answer = localDesignReply(question,{analysis,source:'ai',subject:'landscape'});
    assert.match(answer.reply,/保留原片/);
    assert.equal(answer.action.kind,'none');
  }
  const explored = localDesignReply('我想试试黑白方向',{analysis,source:'ai',subject:'landscape'});
  assert.equal(explored.action.kind,'style');
  assert.equal(localDesignReply('我想要更安静的风格',{analysis,source:'ai',subject:'landscape'}).action.kind,'style');
});

test('an otherwise valid AI crop cannot silently cut through its own subject or key-light evidence',()=>{
 const review=structuredClone(adjustment);review.crop={...review.crop,x:.35,y:0,width:.65,height:.8};
 assert.throws(()=>validateReviewDecision(review),/切到主体/);
});
