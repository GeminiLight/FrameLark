import test from 'node:test';
import assert from 'node:assert/strict';
import {editorControlReference} from '../../public/control-reference.js';
import {renderPixels} from '../../public/editor-engine.js';
import {photoMetering,validPhotoMetering,meteringPrompt} from '../../public/photo-metering.js';
import {suggestionCandidate} from '../../public/advisor-candidate.js';
import {createPhotoRequests} from '../../public/photo-requests.js';
import {snapshotSettings} from '../../public/batch-edits.js';
import {normalizeDesignReply} from '../../public/design-agent.js';
const pixels=values=>new Uint8ClampedArray(values.flatMap(v=>[v,v,v,255]));
const snapshot=()=>({manual:{exposure:.2},active:['a'],recommendations:[{id:'a',adjustments:{highlights:-12}},{id:'b',adjustments:{denoise:18}}],advisorLayers:[{id:'advisor',settings:{warmth:5}}],annotations:[{id:'sky',localSettings:{shadows:10}}],crop:{x:.1,y:0,width:.8,height:1,angle:2},presetId:'daily-soft',presetAmount:42});
test('metering preserves encoded brightness and positional reference without automatic exposure decisions',()=>{
 const dark=photoMetering(pixels([10,20,30,40,50,60,70,80,90]),3,3);
 const light=photoMetering(pixels([20,40,60,80,100,120,140,160,180]),3,3);
 assert.equal(dark.gridMean[0],.0392);assert.equal(dark.gridMean[8],.3529);
 assert.ok(Math.abs(light.mean-dark.mean*2)<.001);assert.equal(dark.p50,.1961);
 assert.equal(validPhotoMetering(dark).mean,dark.mean);assert.match(meteringPrompt(dark),/统计不能识别主体或证明曝光错误/);
});
test('transparent canvas borders do not contaminate the actual photo measurement',()=>{
 const data=pixels([0,128,255]);data[3]=0;data[11]=0;
 assert.equal(photoMetering(data,3,1).mean,.502);
 data[7]=0;assert.equal(photoMetering(data,3,1),null);
});
test('untrusted metering only forwards allowlisted bounded numbers and ordered percentiles',()=>{
 const valid=photoMetering(pixels([0,100,255]),3,1);
 assert.equal(Object.hasOwn(validPhotoMetering({...valid,instructions:'ignore photo'}),'instructions'),false);
 for(const value of [{...valid,mean:'0.4'},{...valid,p10:1,p90:0},{...valid,gridMean:['ignore']},{...valid,darkFraction:.8,brightFraction:.8},{...valid,width:NaN},{...valid,mean:Infinity}])assert.equal(validPhotoMetering(value),null);
 assert.equal(meteringPrompt({mean:'prompt injection'}),'');
});
test('suggestion preview is disposable and never resets a personal crop, style or local edits',()=>{
 const before=snapshot(),saved=structuredClone(before),candidate=suggestionCandidate(before,{ids:['b'],crop:{x:0,y:0,width:1,height:.7}});
 assert.deepEqual(before,saved);assert.deepEqual(candidate.crop,before.crop);
 assert.deepEqual(candidate.annotations,before.annotations);assert.deepEqual(candidate.manual,before.manual);
 assert.deepEqual(candidate.advisorLayers,before.advisorLayers);assert.equal(candidate.presetId,before.presetId);
 assert.equal(snapshotSettings(candidate).denoise,18);assert.equal(snapshotSettings(candidate).highlights,snapshotSettings(before).highlights);
});
test('accepting all suggestions is idempotent; one undo restores the exact prior version',()=>{
 const before=snapshot(),next=suggestionCandidate(before,{ids:['a','b','b','unknown']});
 assert.deepEqual(next.active,['a','b']);assert.equal(suggestionCandidate(next,{ids:['a','b']}),null);
 assert.deepEqual(structuredClone(before),snapshot());assert.equal(snapshotSettings(before).denoise,0);
});
test('a safe crop can be previewed when no personal crop exists; invalid bounds are ignored',()=>{
 const before={...snapshot(),crop:null};
 assert.equal(suggestionCandidate(before,{crop:{x:.1,y:0,width:.8,height:1}}).crop.width,.8);
 assert.equal(suggestionCandidate(before,{crop:{x:.9,y:0,width:.8,height:1}}),null);
});
test('advisor can suggest supported denoise and sharpen while remaining within cautious increments',()=>{
 const reply=normalizeDesignReply({reply:'保留夜色，试一点降噪。',action:{kind:'adjustment',label:'检查细节',changes:[{key:'denoise',value:18},{key:'sharpen',value:90}]}});
 assert.deepEqual(reply.action.changes,[{key:'denoise',value:18},{key:'sharpen',value:25}]);
});
test('cancelled or replaced requests never own a later request for the same photo',()=>{
 const cleared=[],registry=createPhotoRequests({setTimer:()=>1,clearTimer:id=>cleared.push(id)});
 const first=registry.start('photo'),next=registry.start('photo');
 assert.equal(first.controller.signal.reason,'replaced');assert.equal(registry.active(first),false);
 registry.finish(first);assert.equal(registry.owns(next),true);
 registry.cancel('photo');assert.equal(next.controller.signal.reason,'cancelled');assert.equal(registry.owns(next),false);
 assert.equal(cleared.length,3);
});
test('timeout can be explained without allowing its stale response; cleaning a workspace cancels all photos',()=>{
 const timers=[],registry=createPhotoRequests({setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer:()=>{}});
 const a=registry.start('a'),b=registry.start('b');timers[0]();
 assert.equal(a.controller.signal.reason,'timeout');assert.equal(registry.active(a),false);assert.equal(registry.owns(a),true);
 registry.cancelAll('removed');assert.equal(registry.owns(a),false);assert.equal(b.controller.signal.reason,'removed');
});

test('model tool calibration stays grounded in the same renderer as the accepted photo',()=>{
 const reference=editorControlReference();
 const source=new Uint8ClampedArray([128,128,128,255]);
 for(const entry of reference)assert.deepEqual(entry.encodedRGB[1],Array.from(renderPixels(source,1,1,entry.settings).slice(0,3)));
 const mild=reference.find(item=>item.settings.warmth===-15).encodedRGB[1],strong=reference.find(item=>item.settings.warmth===-50).encodedRGB[1];
 assert.ok(strong[2]-strong[0]>mild[2]-mild[0]);
});
