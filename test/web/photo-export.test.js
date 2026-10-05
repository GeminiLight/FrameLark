import test from 'node:test';
import assert from 'node:assert/strict';
import {readExportDownload,remainingExportBytes,createPhotoExporter} from '../../apps/studio/public/photo-export.js';
import {exportLimits} from '../../apps/studio/public/export-settings.js';

test('a bounded download preserves its file type and exact bytes',async()=>{
  const bytes=Uint8Array.of(1,2,3),blob=await readExportDownload(new Response(bytes,{headers:{'Content-Type':'image/png'}}),{maxBytes:3});
  assert.equal(blob.type,'image/png');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);
});

test('an over-budget streaming download is cancelled instead of retained',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(1,2));controller.enqueue(Uint8Array.of(3,4));},cancel(){cancelled=true;}}));
  await assert.rejects(readExportDownload(response,{maxBytes:3}),{code:'EXPORT_CACHE_LIMIT'});assert.equal(cancelled,true);
});

test('an oversized declared download is rejected before consumption',async()=>{
  let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Length':'100'}});
  await assert.rejects(readExportDownload(response,{maxBytes:3}),{code:'EXPORT_CACHE_LIMIT'});assert.equal(cancelled,true);
});

test('cancelling export interrupts a stream whose next chunk never arrives',async()=>{
  let cancelled=false;const controller=new AbortController(),response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
  const pending=readExportDownload(response,{maxBytes:3,signal:controller.signal});controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);
});

test('a full cache blocks both export sources before starting expensive work',async()=>{
  let invoked=0;const exporter=createPhotoExporter({getRetainedBytes:()=>exportLimits.archiveBytes,exportVersion:()=>{invoked++;}});
  for(const version of [null,'saved-version'])await assert.rejects(exporter({},null,{}, {signal:new AbortController().signal,progress(){}},version),{code:'EXPORT_CACHE_LIMIT'});
  assert.equal(invoked,0);assert.equal(remainingExportBytes(exportLimits.archiveBytes-3),3);
});

test('file-project exports enforce the remaining browser cache budget',async t=>{
  const previous=globalThis.fetch;let cancelled=false;
  globalThis.fetch=async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Length':'10'}});
  t.after(()=>{globalThis.fetch=previous;});
  const exporter=createPhotoExporter({getRetainedBytes:()=>exportLimits.archiveBytes-3,exportVersion:async()=>({download:'/test.png',width:10,height:10})});
  await assert.rejects(exporter({},null,{}, {signal:new AbortController().signal,progress(){}},'saved-version'),{code:'EXPORT_CACHE_LIMIT'});
  assert.equal(cancelled,true);
});
