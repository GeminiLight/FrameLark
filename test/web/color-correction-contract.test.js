import test from 'node:test';import assert from 'node:assert/strict';
import {renderPixels} from '../../apps/studio/public/editor-engine.js';
import {assertTintCorrectionDirection,editorControlReference,controlReferencePrompt} from '../../apps/studio/public/control-reference.js';
import {validateReviewDecision} from '../../apps/studio/public/review-policy.js';
import {normalizeDesignReply} from '../../apps/studio/public/design-agent.js';
import {readFile} from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('./fixtures/vision-review.json',import.meta.url),'utf8'));
test('actual tint response reduces green in the positive direction and magenta in the negative direction',()=>{
  const input=new Uint8ClampedArray([100,132,100,255]),excess=p=>p[1]-(p[0]+p[2])/2;
  assert.ok(excess(renderPixels(input,1,1,{tint:8}))<excess(input));
  assert.ok(excess(renderPixels(input,1,1,{tint:-8}))>excess(input));
  const ref=editorControlReference();const negative=ref.find(x=>x.settings.tint===-25),positive=ref.find(x=>x.settings.tint===25);assert.ok(negative.encodedRGB[1][1]>positive.encodedRGB[1][1]);assert.match(controlReferencePrompt(),/tint 正值减绿/);
});
test('contradictory correction goals are rejected in both visual review and advisor action',()=>{
  const raw=structuredClone(fixture);raw.crop.needed=false;raw.recommendations[0].title='温和提亮并校正轻微绿偏';raw.recommendations[0].goal='修正肤色绿偏';raw.recommendations[0].adjustments.tint=-8;
  assert.throws(()=>validateReviewDecision(raw),/方向/);raw.recommendations[0].adjustments.tint=8;assert.equal(validateReviewDecision(raw).kind,'adjust');
  assert.throws(()=>normalizeDesignReply({reply:'只减轻这处偏绿',action:{kind:'region',label:'校正绿偏',goal:'肤色自然',changes:[{key:'tint',value:-8}]}}),/方向/);
});
test('deliberate green styles, negated correction requests, and zero tint remain allowed',()=>{
  assert.doesNotThrow(()=>assertTintCorrectionDirection('保留绿色背景，增加偏绿的胶片气氛',-8));
  assert.doesNotThrow(()=>assertTintCorrectionDirection('不必校正轻微绿偏',-8));
  assert.doesNotThrow(()=>assertTintCorrectionDirection('校正绿偏',0));
  assert.throws(()=>assertTintCorrectionDirection('减轻轻微洋红偏',8),/方向/);
});
