import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('accepting a version keeps the clicked photo summary when an asynchronous save outlives a photo switch',async()=>{
  const source=await readFile(new URL('../../public/app.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('async function acceptCurrentVersion()'),source.indexOf('\nfunction showEmptyWorkspace()'));
  let release,ready;
  const waiting=new Promise(resolve=>{ready=resolve;});
  const a={id:'A',subject:'landscape'},b={id:'B',subject:'portrait'};
  const initial={previewData:true,originalInspection:{stats:'A original'},presetId:'A style',presetAmount:50,crop:null,active:new Set(),pixels:'A pixels'};
  let activePhoto=a;
  const noop=()=>{};
  const context={state:initial,tasteRecords:[],crypto:{randomUUID:()=> 'accepted-A'},endStyleAudition:noop,finishRangeEdit:noop,finishAnnotationNote:noop,
    currentPhoto:()=>activePhoto,currentAcceptanceSignature:()=>activePhoto.id+' signature',
    currentPreviewPixels:()=>({data:context.state.pixels,width:1,height:1}),renderCurrentPixels:value=>value,inspectPixels:stats=>({stats}),
    getAdjustments:()=>({}),renderedAnnotations:()=>[],createAcceptedRecord:value=>structuredClone(value),persistTasteRecords:()=>true,
    scheduleDraftSave:noop,renderPresets:noop,renderPersonalProfile:noop,refreshActions:noop,
    captureVersion:()=>new Promise(resolve=>{release=()=>resolve(true);ready();})};
  runInNewContext(fn+'\nglobalThis.acceptVersion=acceptCurrentVersion;',context);
  const result=context.acceptVersion();await waiting;
  activePhoto=b;context.state={...initial,originalInspection:{stats:'B original'},presetId:'B style',pixels:'B pixels'};
  release();await result;
  assert.equal(context.tasteRecords[0].originalStats,'A original');assert.equal(context.tasteRecords[0].finalStats,'A pixels');assert.equal(context.tasteRecords[0].presetId,'A style');
  assert.equal(a.acceptedSignature,'A signature');assert.equal(b.acceptedSignature,undefined);
});
