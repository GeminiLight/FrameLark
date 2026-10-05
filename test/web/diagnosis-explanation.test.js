import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {normalizeMetricEvidence,normalizeAssessment,buildStatisticalAssessment} from '../../apps/studio/public/diagnosis-explanation.js';
import {normalizeObservations} from '../../apps/studio/public/vision-review.js';import {inspectPixels} from '../../apps/studio/public/diagnostics.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/vision-review.json',import.meta.url)));
test('visual interpretation requires evidence and applicability for subjective dimensions and every score',()=>{
 const observations=normalizeObservations(fixture.observations);assert.ok(observations.order.condition);assert.ok(observations.emotion.condition);
 const value=structuredClone(fixture.metricEvidence);delete value.detail.condition;assert.throws(()=>normalizeMetricEvidence(value));
 const subjective=structuredClone(fixture.observations);subjective.emotion.condition=' ';assert.throws(()=>normalizeObservations(subjective));
});
test('reassessment accepts no improvement and falling scores, with specific costs and preservation',()=>{
 const value={before:fixture.metrics,after:{...fixture.metrics,detail:30},beforeEvidence:fixture.metricEvidence,afterEvidence:fixture.metricEvidence,summary:'细节表现变弱。',observation:'检查头发。',improvements:[],tradeoffs:[{finding:'细节变柔。',evidence:'左侧头发的边缘变弱。',condition:'只有希望柔和时才适合。'}],preserved:[]};
 assert.equal(normalizeAssessment(value).improvements.length,0);assert.equal(normalizeAssessment(value).after.detail,30);
 delete value.before.highlights;assert.throws(()=>normalizeAssessment(value));
});
test('fallback compares the same local scale, and cannot invent subject recognition or aesthetic gains',()=>{
 const before=inspectPixels(new Uint8ClampedArray([10,20,30,255,100,100,100,255]),2,1),after=inspectPixels(new Uint8ClampedArray([30,40,50,255,150,150,150,255]),2,1);
 const result=buildStatisticalAssessment(before,after,{failed:true,crop:{x:.05,y:0,width:.9,height:1}});
 assert.deepEqual(result.before,before.metrics);assert.deepEqual(result.after,after.metrics);assert.equal(result.source,'local');assert.deepEqual(result.improvements,[]);assert.match(result.summary,/降|未完成/);assert.match(result.beforeEvidence.detail.condition,/噪点/);
});
