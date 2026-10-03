import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDesignReply} from '../../public/design-agent.js';
import {advisorCandidate} from '../../public/advisor-candidate.js';
import {effectiveAnnotations} from '../../public/adjustment-layers.js';
import {renderPhotoPixels} from '../../public/photo-rendering.js';
import {neutralSettings} from '../../public/editor-engine.js';
const full={x:0,y:0,width:1,height:1};
const excluded={x:.2,y:.2,width:.2,height:.2};
const snapshot=()=>({manual:neutralSettings(),annotations:[],advisorLayers:[],active:[],recommendations:[],crop:null,presetId:null,presetAmount:75});
const plan=()=>normalizeDesignReply({reply:'扶正后提亮，保留灯光。',action:{kind:'plan',label:'扶正与保护灯光',steps:[{kind:'rotate',angle:1.2,label:'扶正'},{kind:'masked',rect:full,exclude:[excluded],feather:0,label:'提亮并排除灯光',changes:[{key:'exposure',value:.2}]}]}}).action;
test('compound plans keep rotation and masked light separate and preserve their input',()=>{
 const before=snapshot(),message={id:'reply',action:plan()};
 const result=advisorCandidate(before,message,{width:400,height:300});
 assert.equal(result.crop.angle,1.2);assert.equal(result.annotations.length,1);assert.deepEqual(result.annotations[0].exclude,[excluded]);assert.equal(before.crop,null);assert.equal(before.annotations.length,0);
 const partial=advisorCandidate(before,message,{selectedSteps:[1],width:400,height:300});assert.equal(partial.crop,null);assert.equal(partial.advisorLayers.length,1);
 const rotation=advisorCandidate(before,message,{selectedSteps:[0]});assert.equal(rotation.annotations.length,0);assert.equal(rotation.crop.angle,1.2);
});
test('masked light preserves excluded core pixels exactly and brightens the surrounding image',()=>{
 const before=snapshot(),after=advisorCandidate(before,{id:'reply',action:plan()},{selectedSteps:[1]}),pixels=new Uint8ClampedArray(100*100*4);
 for(let i=0;i<pixels.length;i+=4)pixels.set([80,90,100,255],i);
 const output=renderPhotoPixels({pixels,width:100,height:100,settings:neutralSettings(),annotations:effectiveAnnotations(after.annotations,after.advisorLayers)});
 const core=(30*100+30)*4,outer=(70*100+70)*4;
 assert.deepEqual(output.slice(core,core+4),pixels.slice(core,core+4));assert.ok(output[outer]>pixels[outer]);
});
test('plans reject an invalid sub-edit instead of silently applying only global light',()=>{
 const action=normalizeDesignReply({action:{kind:'plan',steps:[{kind:'adjustment',changes:[{key:'exposure',value:.2}]},{kind:'masked',rect:full,exclude:[{...excluded,x:2}],changes:[{key:'shadows',value:10}]}]}}).action;
 assert.equal(action.kind,'none');
});
