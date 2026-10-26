import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewPipeline,createPreviewSampler} from '../../apps/studio/public/preview-pipeline.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const jobs=[],frames=[],states=[],timers=new Map();let cancellations=0,clock=0,nextTimer=0;
  const renderer={render(job){return new Promise((resolve,reject)=>jobs.push({job,resolve:()=>{clock+=80;resolve(job.pixels);},reject}));},cancel(){cancellations++;},dispose(){}};
  const pipeline=createPreviewPipeline({renderer,resize:(job,side)=>({...job,width:side,height:side*3/4}),onFrame:frame=>frames.push(frame),onState:(state,meta,error)=>states.push({state,meta,error}),now:()=>clock,setTimer:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimer:id=>timers.delete(id)});
  const pixels=new Uint8ClampedArray(4);
  const request=(key,{context='photo-a',interactive=true}={})=>pipeline.request({pixels,width:1400,height:1050,settings:{key}},{key,context,meta:{key,context},interactive});
  return {pipeline,request,jobs,frames,states,timers,get cancellations(){return cancellations;}};
}
test('continuous input keeps one quick render, coalesces changes, and finishes with the latest full frame',async()=>{
  const f=fixture();f.request('first');await tick();
  for(let i=0;i<50;i++)f.request('change-'+i);
  assert.equal(f.jobs.length,1);assert.equal(f.cancellations,0);
  f.jobs[0].resolve();await tick();
  assert.equal(f.jobs.length,2);assert.equal(f.jobs[1].job.settings.key,'change-49');
  assert.equal(f.frames[0].quality,'quick');assert.ok(!f.states.some(x=>x.state==='ready'));
  f.pipeline.finish();f.jobs[1].resolve();await tick();
  assert.equal(f.jobs.length,3);assert.equal(f.jobs[2].job.width,1400);
  f.jobs[2].resolve();await tick();
  assert.equal(f.states.at(-1).state,'ready');assert.equal(f.frames.at(-1).meta.key,'change-49');assert.equal(f.frames.at(-1).quality,'full');
});
test('idle input refines once and an unchanged saved recipe does not render twice',async()=>{
  const f=fixture();f.request('a');await tick();f.jobs[0].resolve();await tick();
  [...f.timers.values()][0]();await tick();assert.equal(f.jobs[1].job.width,1400);
  f.jobs[1].resolve();await tick();f.request('a',{interactive:false});await tick();
  assert.equal(f.jobs.length,2);assert.equal(f.states.filter(x=>x.state==='ready').length,1);
});
test('new gestures abandon an expensive full frame without publishing its late completion',async()=>{
  const f=fixture();f.request('a',{interactive:false});await tick();f.request('b');await tick();
  assert.equal(f.cancellations,1);assert.equal(f.jobs[1].job.width,420);
  f.jobs[0].resolve();await tick();assert.equal(f.frames.length,0);
  f.jobs[1].resolve();await tick();assert.equal(f.frames[0].meta.key,'b');f.pipeline.dispose();
});
test('switching photo or crop rejects even a quick frame for the old context',async()=>{
  const f=fixture();f.request('a');await tick();f.request('b',{context:'photo-b'});await tick();
  f.jobs[0].resolve();await tick();assert.equal(f.frames.length,0);
  f.jobs[1].resolve();await tick();assert.equal(f.frames[0].meta.context,'photo-b');f.pipeline.dispose();
});
test('failure keeps the final-frame gate closed and a retry can complete',async()=>{
  const f=fixture();f.request('a',{interactive:false});await tick();f.jobs[0].reject(Error('render failed'));await tick();
  assert.equal(f.states.at(-1).state,'failed');assert.equal(f.frames.length,0);
  f.request('a',{interactive:false});await tick();f.jobs[1].resolve();await tick();assert.equal(f.states.at(-1).state,'ready');
});
test('cancel and dispose remove queued work and ignore late results',async()=>{
  for(const action of ['cancel','dispose']){
    const f=fixture();f.request('a');await tick();f.request('b');f.pipeline[action]();f.jobs[0].resolve();await tick();
    assert.equal(f.frames.length,0);assert.equal(f.jobs.length,1);assert.equal(f.timers.size,0);
  }
});
test('quick sampling preserves original-space geometry and never replaces the full input',()=>{
  const originalImageData=globalThis.ImageData;let writes=0,reads=0;
  globalThis.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
  try{
    const sampler=createPreviewSampler({createCanvas:()=>({width:0,height:0,getContext:()=>({putImageData(){writes++;},drawImage(){},getImageData(x,y,width,height){reads++;return {width,height,data:new Uint8ClampedArray(width*height*4)};}})})});
    const frame={fullWidth:6000,fullHeight:4000,sourceRect:{x:900,y:500,width:4000,height:3000},angle:12};
    const job={pixels:new Uint8ClampedArray(1400*1050*4),width:1400,height:1050,frame,document:{id:'recipe'}};
    const quick=sampler.resize(job,420),again=sampler.resize(job,420);
    assert.equal(quick.width,420);assert.equal(quick.height,315);
    assert.equal(quick.frame,frame);assert.equal(quick.document,job.document);
    assert.notEqual(quick.pixels,job.pixels);assert.equal(again.pixels,quick.pixels);
    assert.equal(writes,1);assert.equal(reads,1);assert.equal(sampler.resize(job,1400),job);
    sampler.resize({...job,pixels:job.pixels.slice()},420);assert.equal(writes,2);assert.equal(reads,2);
    sampler.clear();sampler.resize(job,420);assert.equal(writes,3);
  }finally{if(originalImageData===undefined)delete globalThis.ImageData;else globalThis.ImageData=originalImageData;}
});
