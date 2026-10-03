import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { normalizeObservations, retainAppliedRecommendations, reviewSourceLabel } from '../../public/vision-review.js';
import { combineSettings, renderPixels } from '../../public/editor-engine.js';
const reviewFixture = JSON.parse(await readFile(new URL('./fixtures/vision-review.json',import.meta.url),'utf8'));

test('four review dimensions require specific evidence and safe approximate locations',() => {
  const observations = normalizeObservations(reviewFixture.observations);
  assert.equal(observations.light.location,'右上方天空');
  const broken = structuredClone(reviewFixture.observations);
  delete broken.background;
  assert.throws(() => normalizeObservations(broken));
  broken.background = {...reviewFixture.observations.background,evidence:'   '};
  assert.throws(() => normalizeObservations(broken));
  broken.background.evidence = '中央远山形成层次。';
  broken.light.region.x = .9;
  assert.equal(normalizeObservations(broken).light.region,null);
});

test('retry retains applied edits and the same rendered pixels without auto-applying new advice',() => {
  const old = {...reviewFixture,recommendations:[{id:'previous-light',adjustments:{highlights:-18}},{id:'unused',adjustments:{exposure:.8}}]};
  const fresh = {...reviewFixture,recommendations:[{id:'fresh-light',adjustments:{highlights:-12}}]};
  const active = new Set(['previous-light']);
  const manual = {shadows:14};
  const style = {warmth:10};
  const settings = analysis => combineSettings({settings:manual},{settings:style,amount:.6},...analysis.recommendations.filter(item => active.has(item.id)).map(item => ({settings:item.adjustments})));
  const pixels = new Uint8ClampedArray([245,231,192,255,65,63,53,255]);
  const updated = retainAppliedRecommendations(old,fresh,active);
  assert.deepEqual(renderPixels(pixels,2,1,settings(updated)),renderPixels(pixels,2,1,settings(old)));
  assert.equal(updated.recommendations[0].retained,true);
  assert.equal(updated.recommendations.some(item => item.id === 'unused'),false);
  assert.equal(active.has('fresh-light'),false);
  assert.equal(retainAppliedRecommendations(old,{...fresh,recommendations:[{id:'duplicate',adjustments:{highlights:-18,exposure:0}}]},active).recommendations.length,1);
  assert.equal(retainAppliedRecommendations(old,{...fresh,recommendations:[]},new Set()).recommendations.length,0);
});

test('fallback and example analysis cannot masquerade as a current visual review',() => {
  assert.equal(reviewSourceLabel({analysisSource:'local',isDemo:false,analysisStatus:'fallback'}),'基础光色');
  assert.equal(reviewSourceLabel({analysisSource:'local',isDemo:true}),'示例 · 光色分析');
  assert.equal(reviewSourceLabel({analysisSource:'ai',analysisStatus:'fallback'}),'上次视觉审片');
  assert.equal(reviewSourceLabel({analysisSource:'ai',analysisStatus:'unconfigured'}),'上次视觉审片');
  assert.equal(reviewSourceLabel({analysisSource:'ai',analysisStatus:'ready'}),'视觉审片');
});

test('re-reviewing an original rebases overlapping correction targets instead of adding them twice',()=>{
  const previous={recommendations:[{id:'old',title:'曝光',adjustments:{exposure:.2,saturation:8}}]};
  const next={recommendations:[{id:'new',title:'新曝光判断',adjustments:{exposure:.3,saturation:10}}]};
  const review=retainAppliedRecommendations(previous,next,new Set(['old']));
  assert.equal(review.recommendations[0].adjustments.exposure,.2);
  assert.ok(Math.abs(review.recommendations[1].adjustments.exposure-.1)<1e-10);
  assert.equal(review.recommendations[1].adjustments.saturation,2);
});

test('whole-frame mood accepts a null location while factual observations still require one',()=>{
  const raw=structuredClone(reviewFixture.observations);raw.emotion.location=null;
  assert.equal(normalizeObservations(raw).emotion.location,'整幅画面 · 整体氛围');
  raw.emotion.location='';assert.equal(normalizeObservations(raw).emotion.region,reviewFixture.observations.emotion.region);
  raw.subject.location='';assert.throws(()=>normalizeObservations(raw));
  raw.subject.location=reviewFixture.observations.subject.location;raw.emotion.location=42;assert.throws(()=>normalizeObservations(raw));
});
