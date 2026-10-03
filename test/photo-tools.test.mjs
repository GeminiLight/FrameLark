import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {photoTools,createPhotoToolRegistry,normalizeToolPlan,compileToolPlan} from '../public/photo-tools/registry.js';
import {neutralSettings} from '../public/editor-engine.js';
import {runPhotoToolPlan,PhotoToolExecutor} from '../skills/photo-retouch/scripts/photo-tool-runtime.mjs';
import {initProject,loadProject,currentVersion,selectCandidateItems,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {createToolCandidate} from '../skills/photo-retouch/scripts/tool-candidates.mjs';
const source={width:128,height:96},state=()=>({settings:neutralSettings(),style:null,crop:null,locals:[]});
const op=(id,tool='tone',target={kind:'image'},parameters={mode:'delta',changes:[{key:'exposure',value:.2}]},dependsOn=[])=>({id,title:id,tool,version:1,target,parameters,dependsOn});
const region={kind:'object',name:'路灯',source:'vision',confidence:'medium',coordinateSpace:'view',mask:{shape:'radial',rect:{x:.1,y:.1,width:.3,height:.3},feather:.2,exclude:[]}};
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
function compile(operations,selected){const base=state(),normalized=normalizeToolPlan(operations,{state:base,source});return compileToolPlan(base,normalized,{source,namespace:'test',selected});}
test('a registry extension is discovered and executed without adding action-kind branches',()=>{
 const custom={id:'custom',title:'Custom',description:'Example extension',version:1,targets:['image'],parameters:{type:'object',properties:{},required:[],additionalProperties:false},execute(){return {effect:{settings:{warmth:8}}};}};
 const registry=createPhotoToolRegistry([custom]),base=state();
 assert.equal(registry.describe()[0].id,'custom');
 const operations=normalizeToolPlan([op('a','custom',{kind:'image'},{})],{state:base,source},{registry});
 assert.equal(compileToolPlan(base,operations,{source,registry}).state.settings.warmth,8);
});
test('tools compose ordered parameter changes and recompile selection from the pinned base',()=>{
 const a=op('a'),b=op('b','tone',{kind:'image'},{mode:'delta',changes:[{key:'exposure',value:-.1}]},['a']);
 assert.equal(compile([b,a]).state.settings.exposure,.1);
 assert.equal(compile([b,a],['a']).state.settings.exposure,.2);
 assert.throws(()=>compile([a,{...b,dependsOn:[]}]),{code:'PATCH_CONFLICT'});
 assert.throws(()=>compile([a,b],['b']),{code:'DEPENDENCY_REQUIRED'});
 assert.throws(()=>compile([{...a,dependsOn:['b']},b]),{code:'DEPENDENCY_CYCLE'});
});
test('mask output targets carry object geometry and are required by dependent tools',()=>{
 const select=op('lamp','mask',region,{}),light=op('light','tone',{kind:'output',operationId:'lamp'});
 const result=compile([select,light]);assert.equal(result.records.length,2);assert.equal(result.state.locals[0].target.name,'路灯');
 assert.equal(result.state.settings.exposure,0);assert.equal(result.state.locals[0].localSettings.exposure,.2);
 assert.throws(()=>compile([select,light],['light']),{code:'DEPENDENCY_REQUIRED'});
 assert.throws(()=>compile([op('bad','tone',{kind:'object',name:'路灯'})]),{code:'TOOL_INPUT_INVALID'});
});
test('tool targets are captured before geometry changes and invalid/unknown inputs fail before effects',()=>{
 const base=state();base.crop={x:.25,y:.25,width:.5,height:.5};
 const ops=normalizeToolPlan([op('mask','mask',region,{}),op('rotate','rotate',{kind:'image'},{angle:2})],{state:base,source});
 assert.equal(ops[0].target.mask.rect.x,.3);assert.ok(Math.abs(ops[0].target.mask.rect.width-.15)<1e-12);
 assert.equal(base.crop.angle,undefined);
 assert.throws(()=>compile([op('unknown','shell',{kind:'image'},{command:'touch /tmp/unsafe'})]),{code:'TOOL_INPUT_INVALID'});
 assert.throws(()=>compile([op('nan','tone',{kind:'image'},{mode:'delta',changes:[{key:'exposure',value:NaN}]})]),{code:'TOOL_INPUT_INVALID'});
});
test('registered tool runs in an actual separate process and renders an image checkpoint',async()=>{
 const image='data:image/png;base64,'+(await sharp({create:{...source,channels:4,background:'#566778'}}).png().toBuffer()).toString('base64');
 const events=[],result=await runPhotoToolPlan({state:state(),source,namespace:'run-test',operations:[op('light')],preview:{image}},{onEvent:e=>events.push(e)});
 assert.notEqual(result.records[0].execution.pid,process.pid);assert.equal(result.records[0].execution.adapter,'subprocess');
 assert.match(result.records[0].preview.pixelHash,/^[a-f0-9]{64}$/);assert.ok(result.records[0].preview.image.startsWith('data:image/png;base64,'));
 assert.deepEqual(events.map(e=>e.stage),['running','completed']);
});
test('cancellation terminates the actual tool process and leaves no active process',async()=>{
 const controller=new AbortController(),executor=new PhotoToolExecutor(),events=[];
 const request=runPhotoToolPlan({state:state(),source,namespace:'cancel',operations:[op('a')]},{executor,signal:controller.signal,onEvent:e=>{events.push(e);if(e.stage==='running')controller.abort();}});
 await assert.rejects(request,{code:'CANCELLED'});assert.equal(executor.active.size,0);assert.equal(events.length,1);
});
test('native tool candidates retain tool versions, select independently, and preserve source bytes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'frameyn-tool-project-'));t.after(()=>rm(root,{recursive:true,force:true}));const bytes=await sharp({create:{...source,channels:4,background:'#566778'}}).png().toBuffer(),image=join(root,'source.png');await writeFile(image,bytes);
 const folder=join(root,'project'),created=await initProject(image,folder),p=created.project;
 const made=await createToolCandidate(folder,{revision:p.revision,baseVersion:p.currentId,operations:[op('light'),op('rotate','rotate',{kind:'image'},{angle:1})]});
 assert.equal(currentVersion(made.project).state.settings.exposure,0);assert.equal(made.candidate.items[0].operation.tool,'tone');assert.notEqual(made.candidate.items[0].execution.pid,process.pid);
 const chosen=await selectCandidateItems(folder,{id:made.candidate.id,revision:made.project.revision,selectionHash:made.candidate.selectionHash,selectedItemIds:['light']});
 assert.equal(chosen.candidate.state.crop,null);assert.equal(chosen.candidate.state.settings.exposure,.2);
 const accepted=await acceptCandidate(folder,{id:made.candidate.id,revision:chosen.project.revision,selectionHash:chosen.candidate.selectionHash});
 assert.equal(currentVersion(accepted.project).items[0].operation.version,1);assert.deepEqual(await readFile(join(folder,'source/original.bin')),bytes);
 assert.equal(currentVersion(await loadProject(folder)).state.settings.exposure,.2);
});
