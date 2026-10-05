import test from 'node:test';
import assert from 'node:assert/strict';
import {toolStateFromSnapshot,toolRunCandidate} from '../../apps/studio/public/photo-tool-client.js';
import {normalizeToolPlan,compileToolPlan} from '../../apps/studio/public/photo-tools/registry.js';
import {snapshotSettings} from '../../apps/studio/public/batch-edits.js';
import {effectiveAnnotations} from '../../apps/studio/public/adjustment-layers.js';
import {renderPhotoPixels} from '../../apps/studio/public/photo-rendering.js';
import {neutralSettings,combineSettings} from '../../apps/studio/public/editor-engine.js';
import {presetById} from '../../apps/studio/public/presets.js';
const source={width:80,height:60},snapshot=()=>({manual:neutralSettings(),presetId:'daily-soft',presetAmount:50,advisorLayers:[{id:'old',label:'已应用的阴影',settings:{shadows:10},annotationId:null}],annotations:[{id:'note',note:'前景',rect:{x:.1,y:.2,width:.4,height:.5},localSettings:{exposure:.1},localAmount:50,maskType:'radial',feather:.2,localEnabled:true}],active:[],recommendations:[],crop:null});
const operation=(id,tool,target,parameters,dependsOn=[])=>({id,title:id,tool,version:1,target,parameters,dependsOn});
test('generic Web Adapter retains prior sources and matches native composed pixels',()=>{
 const before=snapshot(),state=toolStateFromSnapshot(before),raw=[operation('tone','tone',{kind:'image'},{mode:'delta',changes:[{key:'exposure',value:.2}]}),operation('color','color',{kind:'annotation',id:'note'},{mode:'delta',changes:[{key:'warmth',value:5}]})];
 const operations=normalizeToolPlan(raw,{state,source,notes:before.annotations}),run={...compileToolPlan(state,operations,{source,notes:before.annotations,namespace:'group'}),operations,namespace:'group'};
 const candidate=toolRunCandidate(before,run),pixels=new Uint8ClampedArray(80*60*4);for(let i=0;i<pixels.length;i+=4)pixels.set([90,100,110,255],i);
 const web=renderPhotoPixels({pixels,width:80,height:60,settings:snapshotSettings(candidate),annotations:effectiveAnnotations(candidate.annotations,candidate.advisorLayers)});
 const native=renderPhotoPixels({pixels,width:80,height:60,settings:combineSettings({settings:run.state.settings},{settings:presetById(run.state.style?.id)?.adjustments,amount:(run.state.style?.amount||0)/100}),annotations:run.state.locals});
 assert.deepEqual(web,native);assert.equal(candidate.advisorLayers[0].id,'old');assert.equal(candidate.annotations[0].localAmount,50);assert.equal(candidate.toolRuns[0].operations[1].tool,'color');assert.equal(before.manual.exposure,0);
});
test('tool geometry and style effects use the same Adapter without tool-specific branches',()=>{
 const before=snapshot(),state=toolStateFromSnapshot(before),operations=normalizeToolPlan([operation('style','style',{kind:'image'},{id:'blue-hour',amount:30}),operation('rotate','rotate',{kind:'image'},{angle:1})],{state,source});
 const run={...compileToolPlan(state,operations,{source,namespace:'x'}),operations,namespace:'x'},candidate=toolRunCandidate(before,run);
 assert.equal(candidate.presetId,'blue-hour');assert.equal(candidate.presetAmount,30);assert.equal(candidate.crop.angle,1);assert.deepEqual(candidate.annotations,before.annotations);
});
