import test from 'node:test';
import assert from 'node:assert/strict';
import {neutralSettings} from '../../public/editor-engine.js';
import {planSync,planStyle,photoSnapshot,snapshotSettings,exposureOffset} from '../../public/batch-edits.js';
import {createPhotoRenderer} from '../../public/photo-rendering.js';
import {createTaskQueue} from '../../public/task-queue.js';
import {outputGeometry,safeFilename} from '../../public/export-settings.js';
const snapshot=()=>({manual:neutralSettings(),active:[],advisorLayers:[],recommendations:[],presetId:null,presetAmount:75,crop:null,annotations:[]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const histogram=index=>Array.from({length:64},(_,i)=>i===index ? 100:0);
test('sync matches effective targets without accumulating recommendations, styles, or advisor compensation',()=>{
  const source=snapshot(),target=snapshot();source.manual.exposure=.25;source.manual.saturation=-8;
  target.presetId='daily-soft';target.active=['a'];target.recommendations=[{id:'a',adjustments:{exposure:.5,saturation:10}}];target.advisorLayers=[{id:'b',settings:{exposure:.2}}];target.manual.warmth=14;
  const first=planSync(source,target,{keys:['exposure','saturation']}).snapshot;
  const second=planSync(source,first,{keys:['exposure','saturation']}).snapshot;
  assert.ok(Math.abs(snapshotSettings(first).exposure-.25)<1e-9);assert.equal(snapshotSettings(first).saturation,-8);
  assert.deepEqual(first,second);assert.equal(first.manual.warmth,14);assert.deepEqual(first.active,['a']);assert.equal(target.manual.exposure,0);
});
test('sync correctly compensates unclamped layers whose sum exceeds renderer bounds',()=>{
  const source=snapshot(),target=snapshot();source.manual.exposure=.4;target.active=['a'];target.recommendations=[{id:'a',adjustments:{exposure:1.4}}];target.advisorLayers=[{settings:{exposure:1.4}}];
  assert.ok(Math.abs(snapshotSettings(planSync(source,target,{keys:['exposure']}).snapshot).exposure-.4)<1e-9);
});
test('crop and local masks are opt-in; copied local effects include advisor layers once',()=>{
  const a=snapshot(),b=snapshot();a.crop={x:.1,y:.1,width:.8,height:.8};a.annotations=[{id:'face',note:'保留肤色',rect:a.crop,localSettings:{exposure:.1},maskType:'radial',feather:.5}];a.advisorLayers=[{annotationId:'face',settings:{exposure:.2}}];b.annotations=[{id:'other',note:'背景',localSettings:{shadows:5}}];
  const plain=planSync(a,b,{keys:['warmth']}).snapshot;assert.equal(plain.crop,null);assert.deepEqual(plain.annotations,b.annotations);
  const copied=planSync(a,b,{crop:true,local:true}).snapshot;assert.deepEqual(copied.crop,a.crop);assert.ok(Math.abs(copied.annotations[0].localSettings.exposure-.3)<1e-9);assert.equal(copied.annotations[0].maskType,'radial');assert.equal(copied.annotations[0].feather,.5);assert.notEqual(copied.annotations[0].id,'face');
});
test('exposure adaptation is per photo, bounded and skips near-black medians',()=>{
  assert.equal(exposureOffset(histogram(40),histogram(20)).ev,.65);assert.equal(exposureOffset(histogram(40),histogram(20)).limited,true);
  assert.equal(exposureOffset(histogram(20),histogram(40)).ev,-.65);assert.equal(exposureOffset(histogram(0),histogram(30)).ev,0);
  const a=snapshot(),b=snapshot();const plan=planSync(a,b,{keys:['exposure'],matchExposure:true,sourceHistogram:histogram(35),targetHistogram:histogram(30)});
  assert.ok(snapshotSettings(plan.snapshot).exposure>0);assert.equal(planSync(a,b,{keys:['saturation'],matchExposure:true}).exposure,null);
});
test('batch style replaces only the style layer, leaving crop, masks and manual edits intact',()=>{
  const before=snapshot();before.manual.exposure=.3;before.presetId='quiet-film';before.crop={x:0,y:0,width:.8,height:1};const after=planStyle(before,'daily-soft',35);
  assert.equal(after.presetAmount,35);assert.equal(after.manual.exposure,.3);assert.deepEqual(after.crop,before.crop);assert.equal(before.presetId,'quiet-film');assert.throws(()=>planStyle(before,'nonexistent'));
});
test('queue continues after failure and retries exactly the failed photo',async()=>{
  const queue=createTaskQueue(),calls=[];let attempts=0;
  const a=queue.add({key:'a',photoId:'a',run:async()=>{calls.push('a');if(++attempts===1)throw new Error('network');return 1;}});
  const b=queue.add({key:'b',photoId:'b',run:async()=>{calls.push('b');return 2;}});
  await tick();assert.equal(a.status,'failed');assert.equal(b.status,'done');assert.deepEqual(calls,['a','b']);assert.equal(queue.retry(a.id),true);await tick();assert.equal(a.status,'done');assert.deepEqual(calls,['a','b','a']);assert.equal(b.attempt,1);
});
test('running cancellation holds its concurrency slot until cleanup; queued cancellation never executes',async()=>{
  const queue=createTaskQueue();let release;const gate=new Promise(resolve=>release=resolve),calls=[];
  const a=queue.add({key:'a',run:async({signal})=>{calls.push('a');await gate;signal.throwIfAborted();}});
  const b=queue.add({key:'b',run:async()=>calls.push('b')});await tick();queue.cancel(a.id);assert.equal(queue.retry(a.id),false);queue.cancel(b.id);release();await tick();assert.deepEqual(calls,['a']);assert.equal(a.status,'cancelled');assert.equal(b.status,'cancelled');assert.equal(queue.retry(b.id),true);await tick();assert.deepEqual(calls,['a','b']);
});
test('two analysis jobs run independently and duplicate pending requests do not double bill',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),queue=createTaskQueue({concurrency:2});const a=queue.add({key:'photo-a',run:()=>gate});const b=queue.add({key:'photo-b',run:()=>gate});const c=queue.add({key:'photo-c',run:async()=>3});
  assert.equal(a.status,'running');assert.equal(b.status,'running');assert.equal(c.status,'queued');assert.equal(queue.add({key:'photo-a',run:async()=>99}),a);release();await tick();assert.equal(c.status,'done');
});
test('original output obeys both pixel and side budgets, retains crop, and never upscales',()=>{
  assert.deepEqual(outputGeometry(null,800,600,2048),{rect:{x:0,y:0,width:800,height:600},width:800,height:600,limited:false,original:true});
  const huge=outputGeometry(null,12000,8000,8192);assert.ok(huge.width*huge.height<=16_000_000);assert.ok(huge.width<=8192);assert.equal(huge.original,false);
  const crop=outputGeometry({x:.25,y:0,width:.5,height:1},6000,4000,8192);assert.equal(crop.width,3000);assert.equal(crop.height,4000);assert.equal(crop.original,true);
  const panorama=outputGeometry(null,30000,1000,8192);assert.equal(panorama.width,8192);assert.ok(panorama.height<=274);
});
test('export names preserve readable Unicode and cannot create archive paths',()=>{
  assert.equal(safeFilename('../人物:夜景.png','jpg','01'),'.._人物_夜景-01-帧好.jpg');assert.ok(!safeFilename('a\\b.jpg','png').includes('\\'));
});
test('queued export snapshots remain immutable when the photo continues to be edited',()=>{
  const photo={...snapshot(),active:new Set(['a']),analysis:{recommendations:[{id:'a',adjustments:{exposure:.2}}]}};
  photo.crop={x:0,y:0,width:.9,height:.9};photo.annotations=[{id:'face',rect:{x:0,y:0,width:.2,height:.2},note:'脸部',localSettings:{exposure:.1}}];
  const queued=photoSnapshot(photo);photo.manual.exposure=.7;photo.crop.width=.8;photo.annotations[0].localSettings.exposure=.4;photo.analysis.recommendations[0].adjustments.exposure=.5;
  assert.equal(queued.manual.exposure,0);assert.equal(queued.crop.width,.9);assert.equal(queued.annotations[0].localSettings.exposure,.1);assert.equal(snapshotSettings(queued).exposure,.2);
});
test('cancelling an export terminates its worker and cannot fall back to uncancellable main-thread rendering',async()=>{
  const original=globalThis.Worker;let terminated=0;
  globalThis.Worker=class {postMessage(){} terminate(){terminated++;}};
  try {const renderer=createPhotoRenderer(),work=renderer.render({pixels:Uint8ClampedArray.of(1),width:2,height:2,settings:{}});renderer.dispose();await assert.rejects(work,{name:'AbortError'});await assert.rejects(()=>renderer.render({}),{name:'AbortError'});assert.equal(terminated,1);}
  finally {if(original===undefined)delete globalThis.Worker;else globalThis.Worker=original;}
});
