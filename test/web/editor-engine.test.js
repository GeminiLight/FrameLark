import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSettings, neutralSettings, renderPixels } from '../../apps/studio/public/editor-engine.js';
import { presetById } from '../../apps/studio/public/presets.js';
import { inspectPixels, metricLabels } from '../../apps/studio/public/diagnostics.js';

test('neutral rendering preserves original pixels and input buffer', () => {
  const source = new Uint8ClampedArray([33, 120, 210, 255, 230, 190, 110, 176]);
  const copy = new Uint8ClampedArray(source);
  const result = renderPixels(source, 2, 1, neutralSettings());
  assert.deepEqual(source, copy);
  assert.deepEqual(result, source);
});

test('tone controls alter the right tonal range while preserving alpha', () => {
  const source = new Uint8ClampedArray([38, 38, 38, 255, 220, 220, 220, 120]);
  const lighterShadows = renderPixels(source, 2, 1, {shadows:35});
  const lowerHighlights = renderPixels(source, 2, 1, {highlights:-35});
  assert.ok(lighterShadows[0] > source[0]);
  assert.ok(lowerHighlights[4] < source[4]);
  assert.equal(lighterShadows[7], 120);
  assert.equal(lowerHighlights[7], 120);
});

test('style strength stacks with basic corrections and remains reversible', () => {
  const sample = new Uint8ClampedArray([56, 113, 180, 255]);
  const preset = presetById('daily-soft');
  const base = {exposure:.1,highlights:-10};
  const baseSettings = combineSettings({settings:base});
  const zeroStrength = combineSettings({settings:base},{settings:preset.adjustments,amount:0});
  const fullStrength = combineSettings({settings:base},{settings:preset.adjustments,amount:1});
  assert.deepEqual(zeroStrength, baseSettings);
  assert.notDeepEqual(renderPixels(sample, 1, 1, fullStrength), renderPixels(sample, 1, 1, baseSettings));
  assert.deepEqual(renderPixels(sample, 1, 1, zeroStrength), renderPixels(sample, 1, 1, baseSettings));
});

test('black and white preset removes color without generating new image dimensions', () => {
  const source = new Uint8ClampedArray([235, 80, 35, 255, 20, 180, 210, 255]);
  const settings = combineSettings({settings:presetById('mono-story').adjustments});
  const result = renderPixels(source, 2, 1, settings);
  for (let i = 0; i < result.length; i += 4) {
    assert.equal(result[i], result[i + 1]);
    assert.equal(result[i + 1], result[i + 2]);
  }
  assert.equal(result.length, source.length);
});

test('curve, color mixer and detail controls change original pixels without changing their size', () => {
  const source = new Uint8ClampedArray([
    35, 35, 35, 255, 230, 160, 75, 255, 30, 80, 195, 255
  ]);
  const curved = renderPixels(source, 3, 1, {curveShadows:30,curveHighlights:-30});
  assert.ok(curved[0] > source[0]);
  assert.ok(curved[4] < source[4]);
  const mixed = renderPixels(source, 3, 1, {orangeLuminance:35,blueSaturation:-35});
  assert.ok(mixed[4] > source[4]);
  assert.ok(Math.abs(mixed[8]-mixed[10]) < Math.abs(source[8]-source[10]));
  const softEdge=new Uint8ClampedArray([35,70,125,180,200].flatMap(value=>[value,value,value,255]));
  const sharpened = renderPixels(softEdge, 5, 1, {sharpen:35});
  assert.ok(sharpened[4] < softEdge[4] && sharpened[12] > softEdge[12]);
  assert.equal(sharpened.length, softEdge.length);
});

test('six diagnostic dimensions and histogram are deterministic for the same pixels', () => {
  const source = new Uint8ClampedArray([
    0,0,0,255, 100,120,140,255, 255,255,255,255, 80,90,100,255
  ]);
  const first = inspectPixels(source, 2, 2);
  const second = inspectPixels(source, 2, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.metrics), Object.keys(metricLabels));
  assert.equal(first.histogram.reduce((sum,count) => sum + count,0), 4);
  assert.ok(Object.values(first.metrics).every(score => score >= 0 && score <= 100));
});
