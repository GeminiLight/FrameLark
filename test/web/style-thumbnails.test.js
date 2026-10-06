import test from 'node:test';
import assert from 'node:assert/strict';
import {createStyleThumbnails,renderPresetTrial} from '../../apps/studio/public/style-thumbnails.js';
import {presetTrial} from '../../apps/studio/public/edit-stack/styles.js';
import {createDocument} from '../../apps/studio/public/edit-stack/document.js';
import {applyCommands} from '../../apps/studio/public/edit-stack/commands.js';
import {renderPhotoPixels} from '../../apps/studio/public/photo-rendering.js';

test('a complete 64-step recipe can preview styles without extending or mutating the saved document',async()=>{
 let d=createDocument({documentId:'d',source:{assetId:'a',contentHash:'a'.repeat(64),width:2,height:2},base:{settings:{},locals:[]}});
 for(let i=0;i<64;i+=16)d=applyCommands(d,Array.from({length:16},(_,n)=>({type:'AddStep',step:{id:'s'+(i+n),title:'步骤',tool:'exposure',toolVersion:2,parameters:{ev:i+n===0?.2:0}}}))).next;
 const before=structuredClone(d),trial=presetTrial(d,'daily-soft',75,{groupId:'trial'}),pixels=new Uint8ClampedArray(16).fill(100);for(let i=3;i<16;i+=4)pixels[i]=255;
 assert.equal(trial.canApply,false);assert.ok(trial.document.steps.length<64);assert.deepEqual(d,before);
 const renderer={render:async job=>renderPhotoPixels(job)},job={pixels,width:2,height:2};
 const expected=renderPhotoPixels({...job,pixels:renderPhotoPixels({...job,document:d}),document:trial.document});
 assert.deepEqual(await renderPresetTrial(renderer,job,trial),expected);
});

test('late thumbnail results cannot publish after switching photos and the same request is coalesced',async()=>{
 const releases=[],ready=[],calls=[];let current='a';
 const builder=createStyleThumbnails({renderer:{cancel(){},dispose(){},render:job=>{calls.push(job.name);return new Promise(resolve=>releases.push(()=>resolve(new Uint8ClampedArray([1]))));}},encode:()=> 'preview',isCurrent:r=>r.signature===current,onReady:(result,r)=>ready.push(r.signature)});
 const request=id=>({signature:id,items:[{id,job:{name:id,width:1,height:1}}]});
 const a=builder.build(request('a'));assert.equal(builder.build(request('a')),a);current='b';const b=builder.build(request('b'));
 releases[0]();await a;assert.deepEqual(ready,[]);releases[1]();await b;assert.deepEqual(ready,['b']);assert.deepEqual(calls,['a','b']);assert.equal(builder.completedSignature,'b');
});

test('a failed thumbnail leaves successful previews visible and permits a real retry',async()=>{
 let failed=true,ready;const builder=createStyleThumbnails({renderer:{cancel(){},dispose(){},render:async job=>{if(job.id==='bad'&&failed)throw Error('worker failed');return new Uint8ClampedArray([1]);}},encode:()=> 'preview',isCurrent:()=>true,onReady:result=>ready=result});
 const request={signature:'a',items:['good','bad'].map(id=>({id,job:{id,width:1,height:1}}))};
 assert.equal(await builder.build(request),false);assert.deepEqual(Object.keys(ready),['good']);assert.equal(builder.completedSignature,null);
 failed=false;assert.equal(await builder.build(request),true);assert.deepEqual(Object.keys(ready),['good','bad']);assert.equal(builder.completedSignature,'a');
});

test('leaving without another build does not permanently cache an unfinished request',async()=>{
 let release,current=false,count=0;
 const renderer={cancel(){},dispose(){},render:async()=>{count++;if(count===1)await new Promise(resolve=>release=resolve);return new Uint8ClampedArray([1]);}};
 const builder=createStyleThumbnails({renderer,encode:()=> 'preview',isCurrent:()=>current,onReady(){}}),request={signature:'a',items:[{id:'a',job:{width:1,height:1}}]};
 current=true;const first=builder.build(request);current=false;release();assert.equal(await first,false);
 current=true;assert.equal(await builder.build(request),true);assert.equal(count,2);
});
