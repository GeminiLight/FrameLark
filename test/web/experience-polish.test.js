import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reviewContext,reviewContextPrompt,reviewBaseline,anchoredAssessment} from '../../public/review-context.js';
import {exposureTrials,photoToolTrials,validReviewTrials,trialPrompt} from '../../public/review-calibration.js';
import {photoMetering,meteringPrompt} from '../../public/photo-metering.js';
import {createTaskQueue,latestReviewTask,elapsedReview,unresolvedFailure} from '../../public/task-queue.js';
import {retryReview} from '../../public/review-retry.js';
import {suggestionCandidate,scalePreview,scalablePreview} from '../../public/advisor-candidate.js';
import {snapshotSettings} from '../../public/batch-edits.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/vision-review.json',import.meta.url),'utf8'));

test('reassessment uses validated operation facts without allowing client text into the parameter log',()=>{
  const context=reviewContext({settings:{exposure:.9,saturation:0,instructions:'FAKE_INJECTION',warmth:'bad',shadows:999},crop:{x:.1,y:.1,width:.8,height:.8},localCount:0});
  assert.equal(context.settings.exposure,.9);assert.equal(context.settings.saturation,0);assert.equal(context.settings.shadows,75);
  assert.equal(context.settings.warmth,0);assert.equal(context.localCount,0);
  assert.doesNotMatch(reviewContextPrompt(context),/FAKE_INJECTION/);assert.match(reviewContextPrompt(context),/没有饱和度/);
  assert.equal(reviewContext({crop:{x:.8,y:0,width:.9,height:1}}).crop,null);
});
test('original baseline is stable while new scores can decline without artificial gains',()=>{
  const baseline={metrics:fixture.metrics,evidence:fixture.metricEvidence};
  const result=anchoredAssessment({before:{light:95},after:{light:12},beforeEvidence:{}},baseline);
  assert.deepEqual(result.before,fixture.metrics);assert.deepEqual(result.beforeEvidence,fixture.metricEvidence);assert.equal(result.after.light,12);assert.equal(result.baselineSource,'original-review');
  result.before.light=99;assert.notEqual(fixture.metrics.light,99);
  assert.equal(reviewBaseline({...baseline,metrics:{...baseline.metrics,light:Infinity}}),null);
  assert.equal(anchoredAssessment({before:{light:12}},null).baselineSource,'paired-review');
});
test('calibration renders real, disposable exposure hypotheses rather than auto edits or semantic decisions',()=>{
  const data=new Uint8ClampedArray([50,45,40,255,90,80,70,255,40,35,30,255]);
  const original=Array.from(data),trials=exposureTrials(data,3,1);
  assert.equal(trials.length,2);assert.deepEqual(Array.from(data),original);
  assert.ok(photoMetering(trials[1].pixels,3,1).mean>photoMetering(trials[0].pixels,3,1).mean);
  assert.match(trialPrompt({settings:{exposure:1.3}},0),/不能|不要/);
  assert.match(trialPrompt({settings:{exposure:1.3}},0),/夜景、剪影、低调/);
  assert.equal(exposureTrials(new Uint8ClampedArray([240,240,240,255]),1,1).length,0);
  const safe=validReviewTrials([{image:'data:image/png;base64,aGVsbG8=',settings:{exposure:.7,instructions:'INJECTION'},instructions:'INJECTION'},{image:'data:text/html;base64,YQ==',settings:{exposure:1.3}}]);
  assert.equal(safe.length,1);assert.deepEqual(safe[0].settings,{exposure:.7});assert.doesNotMatch(trialPrompt(safe[0],0),/INJECTION/);
});
test('metering cannot be presented as face measurements or maximum brightness',()=>{
  const text=meteringPrompt(photoMetering(new Uint8ClampedArray([60,60,60,255]),1,1));
  assert.match(text,/不是最大亮度/);assert.match(text,/不是脸部/);assert.match(text,/不得据此编造/);
});
test('warm-channel trials show two actual white-balance responses without deciding the intended color',()=>{
  const warm=new Uint8ClampedArray([200,160,60,255,190,150,70,255]);const copy=Array.from(warm);
  const trials=photoToolTrials(warm,2,1);assert.equal(trials.length,2);
  assert.deepEqual(trials.map(item=>item.settings),[{warmth:-35,tint:8},{warmth:-65,tint:14}]);
  assert.deepEqual(Array.from(warm),copy);assert.ok(trials[1].pixels[2]>trials[0].pixels[2]);
  const valid=validReviewTrials([{image:'data:image/png;base64,aGVsbG8=',settings:{warmth:-65,tint:14,other:'injection'}}]);
  assert.deepEqual(valid[0].settings,{warmth:-65,tint:14});assert.match(trialPrompt(valid[0],1),/朝霞、暖色照明/);assert.match(trialPrompt(valid[0],1),/不得.*强制改色/);
  assert.equal(photoToolTrials(new Uint8ClampedArray([25,50,180,255]),1,1).some(item=>item.settings.warmth!==undefined),false);
});
test('a superseded review finishing late cannot own the newer intent or its pending status',async()=>{
  let finishOld;const emissions=[];
  const queue=createTaskQueue({concurrency:2,onChange:task=>{if(task)emissions.push({id:task.id,owner:latestReviewTask(queue.tasks,'p')?.id});}});
  const first=queue.add({kind:'analysis',key:'p',photoId:'p',run:()=>new Promise(resolve=>finishOld=resolve)});
  await Promise.resolve();queue.cancel(first.id,'superseded');
  let finishNext;const next=queue.add({kind:'analysis',key:'p',photoId:'p',run:()=>new Promise(resolve=>finishNext=resolve)});
  await Promise.resolve();finishOld({mode:'stale'});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(latestReviewTask(queue.tasks,'p'),next);assert.equal(next.status,'running');
  assert.equal(emissions.findLast(item=>item.id===first.id).owner,next.id);
  assert.equal(elapsedReview({...next,startedAt:1000},4500),'已等待 3 秒');assert.equal(elapsedReview({status:'queued'},4500),'');
  finishNext({mode:'vision'});await new Promise(resolve=>setImmediate(resolve));assert.ok(next.finishedAt>=next.startedAt);
});
test('preview strength changes only new sources, leaves cancel exact, and accepts a reversible candidate',()=>{
  const before={manual:{exposure:.1},active:['old'],recommendations:[{id:'old',adjustments:{warmth:10}},{id:'new',adjustments:{exposure:1,shadows:12}}],advisorLayers:[{id:'old-advisor',settings:{highlights:-12}}],annotations:[],crop:null,presetId:null,presetAmount:75};
  const copy=structuredClone(before),candidate=suggestionCandidate(before,{ids:['new']});
  assert.equal(scalablePreview(before,candidate),true);
  const half=scalePreview(before,candidate,50),strong=scalePreview(before,candidate,150);
  assert.deepEqual(before,copy);assert.equal(snapshotSettings(half).exposure,.6);assert.equal(snapshotSettings(strong).exposure,1.5);
  assert.deepEqual(half.advisorLayers,before.advisorLayers);assert.equal(snapshotSettings(half).warmth,10);assert.equal(snapshotSettings(half).shadows,6);
  assert.equal(snapshotSettings(candidate).exposure,1.1);assert.equal(scalablePreview(before,{...candidate,crop:{x:0,y:0,width:.8,height:1}}),false);
});
test('automatic review recovery is bounded and never repeats cancellations, timeouts or provider outages',()=>{
  const failure={code:'INCONSISTENT_REVIEW',retryable:true};
  assert.equal(retryReview(failure,{elapsedMs:45000}),true);
  for(const context of [{attempt:1},{elapsedMs:81000},{aborted:true}])assert.equal(retryReview(failure,context),false);
  for(const code of ['CANCELLED','MODEL_TIMEOUT','NETWORK_ERROR','PROVIDER_UNAVAILABLE'])assert.equal(retryReview({code,retryable:true}),false);
  assert.equal(retryReview({...failure,retryable:false}),false);
});
test('a recovered photo no longer carries an unresolved failed task while its history remains available',async()=>{
  const queue=createTaskQueue();
  const first=queue.add({kind:'analysis',key:'p',photoId:'p',run:()=>{throw Error('incomplete feedback');}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(unresolvedFailure(first),true);
  const next=queue.add({kind:'analysis',key:'p',photoId:'p',run:()=>({mode:'vision'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(unresolvedFailure(first),false);assert.equal(first.error,'incomplete feedback');assert.equal(first.supersededBy,next.id);assert.equal(latestReviewTask(queue.tasks,'p'),next);
});
