import test from 'node:test';
import assert from 'node:assert/strict';
import {auditionSnapshot,createStyleAudition} from '../../apps/studio/public/style-audition.js';
import {shortcutAction,photoNavigationIndex,pinchTransform,readerPosition} from '../../apps/studio/public/editor-navigation.js';
import {globalAdjustments,effectiveAnnotations} from '../../apps/studio/public/adjustment-layers.js';
import {neutralSettings} from '../../apps/studio/public/editor-engine.js';
import {presetById} from '../../apps/studio/public/presets.js';
import {renderPhotoPixels} from '../../apps/studio/public/photo-rendering.js';

const snapshot=()=>({presetId:'golden-hour',presetAmount:50,manual:{...neutralSettings(),exposure:.12},active:['a'],recommendations:[{id:'a',adjustments:{shadows:7}}],crop:{x:.05,y:.1,width:.8,height:.7,angle:2},advisorLayers:[{id:'guide',settings:{highlights:-8}}],annotations:[{id:'mask',rect:{x:.1,y:.1,width:.2,height:.2},localSettings:{exposure:-.1}}]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('audition replaces only style and preserves all official edit layers by value',()=>{
  const original=snapshot(),saved=structuredClone(original),candidate=auditionSnapshot(original,'open-road',65);
  assert.equal(candidate.presetId,'open-road');assert.equal(candidate.presetAmount,65);
  const {presetId,presetAmount,...rest}=candidate,{presetId:a,presetAmount:b,...sourceRest}=original;
  assert.deepEqual(rest,sourceRest);candidate.manual.exposure=1;candidate.annotations[0].rect.x=.8;
  assert.deepEqual(original,saved);assert.equal(auditionSnapshot(original,'unknown'),null);
  assert.equal(auditionSnapshot(original,'open-road',150).presetAmount,100);
});
test('style audition uses the same pixel pipeline with retained manual, suggestion and local effects',()=>{
  const original=snapshot(),candidate=auditionSnapshot(original,'open-road',65),pixels=new Uint8ClampedArray(Array.from({length:16},(_,i)=>i%4===3 ? 255:70+i*8));
  function settings(s){return globalAdjustments({...s,preset:presetById(s.presetId),amount:s.presetAmount});}
  const base=renderPhotoPixels({pixels,width:2,height:2,settings:settings(original),annotations:effectiveAnnotations(original.annotations,original.advisorLayers),crop:original.crop});
  const after=renderPhotoPixels({pixels,width:2,height:2,settings:settings(candidate),annotations:effectiveAnnotations(candidate.annotations,candidate.advisorLayers),crop:candidate.crop});
  assert.notDeepEqual(after,base);assert.equal(original.presetId,'golden-hour');assert.equal(original.manual.exposure,.12);
});
test('ending before rendering completes never replaces the restored official frame',async()=>{
  const job=deferred(),states=[],source={photoId:'one',signature:'s',snapshot:snapshot()};
  const audition=createStyleAudition({context:()=>source,render:()=>job.promise,onState:x=>states.push(x)});
  const pending=audition.start('open-road',65);await Promise.resolve();audition.end();job.resolve('pixels');
  assert.equal(await pending,false);assert.deepEqual(states.map(x=>x.phase),['loading','idle']);assert.equal(audition.active,null);
});
test('fast style changes skip intermediate pixel jobs and display only the newest frame',async()=>{
  const first=deferred(),second=deferred(),states=[],jobs=[];
  const audition=createStyleAudition({context:()=>({photoId:'one',signature:'s',snapshot:snapshot()}),render:c=>{jobs.push(c.presetId);return c.presetId==='open-road' ? first.promise:second.promise;},onState:x=>states.push(x)});
  const a=audition.start('open-road',65);await Promise.resolve();
  const intermediate=audition.start('golden-hour',60),b=audition.start('misty-air',40,'tap');first.resolve('first');assert.equal(await a,false);assert.equal(await intermediate,false);
  second.resolve('second');assert.equal(await b,true);assert.deepEqual(jobs,['open-road','misty-air']);
  assert.deepEqual(states.filter(x=>x.phase==='ready').map(x=>x.output),['second']);assert.equal(audition.active.mode,'tap');
});
test('another photo or changed official effect invalidates a pending audition',async()=>{
  for(const change of [{photoId:'two'},{signature:'edited'}]) {
    let source={photoId:'one',signature:'s',snapshot:snapshot()};const job=deferred(),states=[];
    const audition=createStyleAudition({context:()=>source,render:()=>job.promise,onState:x=>states.push(x.phase)});
    const pending=audition.start('open-road',65);await Promise.resolve();source={...source,...change};job.resolve('stale');assert.equal(await pending,false);assert.deepEqual(states,['loading','idle']);
  }
});
test('a failed audition preserves the official snapshot and a new attempt can succeed',async()=>{
  const source={photoId:'one',signature:'s',snapshot:snapshot()},before=structuredClone(source.snapshot),states=[];let fails=true;
  const audition=createStyleAudition({context:()=>source,render:async()=>{if(fails)throw Error('unavailable');return 'ready';},onState:x=>states.push(x.phase)});
  assert.equal(await audition.start('open-road',65),false);assert.deepEqual(source.snapshot,before);fails=false;assert.equal(await audition.start('open-road',65),true);assert.deepEqual(states,['loading','failed','loading','ready']);
});
const key=(key,rest={})=>({key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...rest});
test('typing, native sliders, composition, dialogs and loading keep their own keys',()=>{
  for(const ctx of [{typing:true},{dialog:true},{loading:true}])for(const value of ['1','z',']','['])assert.equal(shortcutAction(key(value),ctx),null);
  assert.equal(shortcutAction(key('1',{isComposing:true})),null);assert.equal(shortcutAction(key('z',{altKey:true})),null);
  assert.equal(shortcutAction(key('2'),{learning:true}),null);
  assert.equal(shortcutAction(key('z',{metaKey:true}),{typing:true,range:true}),'undo');
  assert.equal(shortcutAction(key('2'),{typing:true,range:true}),null);
  assert.equal(shortcutAction(key('z',{metaKey:true}),{typing:true,range:true,dialog:true}),null);
});
test('editor shortcuts are distinct from viewer magnification and browser shortcuts',()=>{
  assert.equal(shortcutAction(key('1')),'diagnosis');assert.equal(shortcutAction(key('2')),'adjust');assert.equal(shortcutAction(key('3')),'presets');assert.equal(shortcutAction(key('1'),{viewer:true}),'actual');
  assert.equal(shortcutAction(key('+'),{viewer:true}),'zoom-in');assert.equal(shortcutAction(key('-'),{viewer:true}),'zoom-out');assert.equal(shortcutAction(key('0'),{viewer:true}),'fit');
  assert.equal(shortcutAction(key('+',{metaKey:true}),{viewer:true}),null);assert.equal(shortcutAction(key('z',{metaKey:true})),'undo');assert.equal(shortcutAction(key('z',{ctrlKey:true,shiftKey:true})),'redo');
  assert.equal(shortcutAction(key('4')),'agent');assert.equal(shortcutAction(key('Z')),'viewer');assert.equal(shortcutAction(key('?')),'help');
});
test('photo arrow navigation wraps and Home/End keep selection and focus predictable',()=>{
  assert.equal(photoNavigationIndex('ArrowLeft',0,3),2);assert.equal(photoNavigationIndex('next-photo',2,3),0);
  assert.equal(photoNavigationIndex('Home',2,3),0);assert.equal(photoNavigationIndex('End',0,3),2);
  assert.equal(photoNavigationIndex('End',0,0),-1);assert.equal(photoNavigationIndex('Tab',1,3),-1);
});
test('reading an older reply keeps its offset when new content arrives',()=>{
  assert.deepEqual(readerPosition({visible:true,offset:120,remaining:400}),{offset:120,follow:false});
  assert.equal(readerPosition({visible:true,offset:500,remaining:10}).follow,true);
});
test('a hidden advisor pane and another photo cannot erase its saved reading position',()=>{
  const saved={offset:120,follow:false};
  assert.deepEqual(readerPosition({visible:false,offset:0,remaining:0,saved}),saved);
  assert.deepEqual(readerPosition({visible:true,samePhoto:false,offset:900,remaining:0,saved}),saved);
});
test('sending a new question deliberately follows its latest reply',()=>{
  assert.equal(readerPosition({visible:false,saved:{offset:120,follow:false},forceFollow:true}).follow,true);
});
test('pinch preserves the source point under a moving midpoint while changing scale',()=>{
  const input={startZoom:1,fitZoom:.5,startDistance:100,distance:200,startMidpoint:{x:150,y:100},midpoint:{x:180,y:100},anchor:{x:.5,y:.5},width:200,height:200,sourceWidth:1000,sourceHeight:800};
  const next=pinchTransform(input);assert.equal(next.zoom,2);
  const before=input.anchor.x+(input.startMidpoint.x-input.width/2)/input.startZoom/input.sourceWidth;
  const after=next.point.x+(input.midpoint.x-input.width/2)/next.zoom/input.sourceWidth;
  assert.ok(Math.abs(before-after)<1e-12);assert.equal(next.point.y,.5);
});
test('pinch zoom is bounded without moving the midpoint anchor at its limits',()=>{
  const input={startZoom:1,fitZoom:.3,startDistance:100,distance:10000,startMidpoint:{x:100,y:100},midpoint:{x:100,y:100},anchor:{x:.4,y:.6},width:200,height:200,sourceWidth:1000,sourceHeight:1000};
  assert.equal(pinchTransform(input).zoom,4);assert.deepEqual(pinchTransform(input).point,input.anchor);
  assert.equal(pinchTransform({...input,distance:0}).zoom,.05);
});
