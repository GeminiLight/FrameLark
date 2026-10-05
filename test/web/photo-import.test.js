import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTaskQueue} from '../../apps/studio/public/task-queue.js';
import {inspectPhotoHeader,inspectPhotoFile,checkImportCapacity,validateDecodedPhoto,loadPhotoImage,runImportBatch,importProblem,PhotoImportError,importLimits} from '../../apps/studio/public/photo-import.js';
const fixture=name=>readFile(new URL(`fixtures/import/${name}`,import.meta.url));
const header=async name=>{const bytes=await fixture(name);return inspectPhotoHeader(bytes,{name,size:bytes.length});};
const code=(fn,wanted)=>assert.throws(fn,error=>error.code===wanted);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('real JPEG, PNG, lossy/lossless WebP and AVIF expose bounded dimensions',async()=>{
  for(const [name,format] of [['orientation-1.jpg','jpeg'],['portrait.png','png'],['portrait.webp','webp'],['portrait-lossless.webp','webp'],['portrait.avif','avif']]) {
    const metadata=await header(name);assert.equal(metadata.format,format);assert.equal(metadata.width,384);assert.equal(metadata.height,512);
  }
});
test('all eight real JPEG EXIF orientations describe the same upright portrait',async()=>{
  for(let orientation=1;orientation<=8;orientation++) {
    const metadata=await header(`orientation-${orientation}.jpg`);assert.equal(metadata.orientation,orientation);
    assert.deepEqual([metadata.displayWidth,metadata.displayHeight],[384,512]);
    assert.equal(validateDecodedPhoto({naturalWidth:384,naturalHeight:512},metadata).naturalHeight,512);
  }
  code(()=>validateDecodedPhoto({naturalWidth:512,naturalHeight:384},{format:'jpeg',displayWidth:384,displayHeight:512}),'ORIENTATION');
});
test('an additional XMP APP1 segment cannot reset the preceding EXIF orientation',async()=>{
  const original=await fixture('orientation-6.jpg');
  const exifStart=original.indexOf(Buffer.from('Exif\0\0')),afterExif=exifStart-2+original.readUInt16BE(exifStart-2);
  const xmp=Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>'),segment=Buffer.alloc(4+xmp.length);segment[0]=0xff;segment[1]=0xe1;segment.writeUInt16BE(xmp.length+2,2);xmp.copy(segment,4);
  const metadata=inspectPhotoHeader(Buffer.concat([original.subarray(0,afterExif),segment,original.subarray(afterExif)]));
  assert.equal(metadata.orientation,6);assert.deepEqual([metadata.displayWidth,metadata.displayHeight],[384,512]);
});
test('file bytes override missing or misleading MIME and extensions',async()=>{
  for(const [name,type] of [['misnamed.jpg','image/jpeg'],['unknown-mime.bin',''],['fake.heic','image/heic']]) {
    const bytes=await fixture('portrait.png'),file=new File([bytes],name,{type});
    assert.equal((await inspectPhotoFile(file)).mime,'image/png');
  }
  code(()=>inspectPhotoHeader(new TextEncoder().encode('<svg/>'),{name:'photo.png',type:'image/png'}),'FORMAT');
});
test('empty and over-limit files are rejected before reading bytes',async()=>{
  for(const [size,wanted] of [[0,'EMPTY'],[importLimits.bytes+1,'SIZE']]) {
    let reads=0;await assert.rejects(inspectPhotoFile({size,slice(){reads++;throw Error('must not read');}}),e=>e.code===wanted);assert.equal(reads,0);
  }
});
test('oversized dimensions reject a tiny header before image allocation',async()=>{
  const bytes=await fixture('too-many-pixels.png');code(()=>inspectPhotoHeader(bytes),'DIMENSIONS');
});
test('HEIC, RAW, damaged headers and animation have distinct actionable failures',async()=>{
  for(const [name,wanted] of [['phone.HEIC','HEIC'],['camera.dng','RAW'],['animated.png','ANIMATED'],['animated.webp','ANIMATED']]) {
    const b=await fixture(name);code(()=>inspectPhotoHeader(b,{name}),wanted);
    const problem=importProblem(new PhotoImportError(wanted));assert.ok(problem.reason.length>4);assert.ok(problem.action.length>15);assert.equal(problem.retryable,false);
  }
  const b=await fixture('orientation-1.jpg');code(()=>inspectPhotoHeader(b.subarray(0,100)),'HEADER');
  assert.equal(importProblem(Object.assign(new Error(),{name:'AbortError'})).code,'CANCELLED');
});
test('header read failures expose recovery instead of losing the batch',async()=>{
  await assert.rejects(inspectPhotoFile({size:10,name:'bad.jpg',slice:()=>({arrayBuffer:async()=>{throw Error('disk');}})}),e=>e.code==='READ');
});
test('truncated JPEG entropy and missing PNG end marker are rejected even with readable dimensions',async()=>{
  for(const name of ['broken.jpg','portrait.png']) {
    const bytes=await fixture(name),file=new File([name==='portrait.png' ? bytes.subarray(0,bytes.length-12):bytes],name);
    await assert.rejects(inspectPhotoFile(file),error=>error.code==='HEADER');
  }
});
test('a video ISO container is not incorrectly diagnosed as a HEIC photo',()=>{
  const b=Uint8Array.from([0,0,0,24,...new TextEncoder().encode('ftypisom'),0,0,0,0,...new TextEncoder().encode('isommp42')]);
  code(()=>inspectPhotoHeader(b),'FORMAT');
});
test('capacity is evaluated against current workspace for each successful image',()=>{
  checkImportCapacity({pixels:48_000_000},{count:1,pixels:1_000_000});
  code(()=>checkImportCapacity({pixels:1},{count:12,pixels:10}),'CAPACITY');
  code(()=>checkImportCapacity({pixels:48_000_000},{count:2,pixels:60_000_000}),'WORKSPACE_PIXELS');
});
test('mixed imports keep existing edits, continue after failure and never retry successful rows',async()=>{
  const workspace=[{id:'existing',settings:{exposure:.35},crop:{x:.1},notes:['keep sky']}],before=structuredClone(workspace[0]);
  const rows=['good','bad','good2'].map(name=>({file:{name},status:'queued'}));let commits=0;
  const options={capacity:()=>({count:workspace.length,pixels:0}),inspect:async file=>{if(file.name==='bad')throw new PhotoImportError('READ');return {pixels:1};},commit:async file=>{commits++;const photo={id:file.name};workspace.push(photo);return photo;}};
  await runImportBatch(rows,options);assert.deepEqual(rows.map(x=>x.status),['success','failed','success']);assert.equal(commits,2);assert.deepEqual(workspace[0],before);
  await runImportBatch(rows,{...options,inspect:async()=>({pixels:1})});assert.equal(commits,3);assert.equal(workspace.length,4);assert.deepEqual(workspace[0],before);
});
test('a decode failure consumes no capacity and a later valid photo still commits',async()=>{
  const rows=['bad','good'].map(name=>({file:{name},status:'queued'})),workspace=[];
  await runImportBatch(rows,{capacity:()=>({count:11+workspace.length,pixels:0}),inspect:async()=>({pixels:1}),commit:async file=>{if(file.name==='bad')throw new PhotoImportError('DECODE');workspace.push(file);return file;}});
  assert.deepEqual(rows.map(x=>x.status),['failed','success']);assert.equal(workspace.length,1);
});
test('cancel during header reading completes promptly, preserves success and prevents late commit',async()=>{
  const pending=deferred(),started=deferred(),controller=new AbortController(),workspace=[];
  const rows=['one','two','three'].map(name=>({file:{name},status:'queued'}));
  const task=runImportBatch(rows,{signal:controller.signal,capacity:()=>({count:workspace.length,pixels:0}),inspect:async file=>{if(file.name==='two'){started.resolve();return pending.promise;}return {pixels:1};},commit:async file=>{workspace.push(file.name);return file;}});
  await started.promise;controller.abort();await task;pending.resolve({pixels:1});await Promise.resolve();
  assert.deepEqual(workspace,['one']);assert.deepEqual(rows.map(x=>x.status),['success','failed','failed']);assert.equal(rows[1].problem.code,'CANCELLED');
});
test('image loader handles success, decode failure, abort and timeout with clean handlers',async()=>{
  for(const action of ['success','error','abort','timeout']) {
    const controller=new AbortController(),image={naturalWidth:384,naturalHeight:512,src:''};
    const pending=loadPhotoImage('blob:test',{createImage:()=>image,signal:controller.signal,timeoutMs:10});
    if(action==='success')image.onload();if(action==='error')image.onerror();if(action==='abort')controller.abort();
    if(action==='success')assert.equal(await pending,image);
    else await assert.rejects(pending,e=>e.code===({error:'DECODE',abort:'CANCELLED',timeout:'TIMEOUT'}[action]));
    assert.equal(image.onload,null);assert.equal(image.onerror,null);if(action!=='success')assert.equal(image.src,'');
  }
});
test('a malformed or excessively long JPEG header cannot cause an unbounded parser loop',()=>{
  for(const length of [3,100,importLimits.headerBytes]) {
    const bytes=new Uint8Array(length).fill(0xff);bytes[0]=0xff;bytes[1]=0xd8;
    code(()=>inspectPhotoHeader(bytes),'HEADER');
  }
});
test('removing a photo releases retained task sources and prevents stale retries without dropping downloads',async()=>{
  const tick=()=>new Promise(resolve=>setImmediate(resolve)),queue=createTaskQueue(),calls=[],gate=deferred();
  const completed=queue.add({key:'done',photoId:'large',run:async()=>({blob:'kept-download'})});await tick();
  const running=queue.add({key:'running',photoId:'large',run:async({signal})=>{calls.push('running');await gate.promise;signal.throwIfAborted();}});await tick();
  const queued=queue.add({key:'queued',photoId:'large',run:async()=>calls.push('must not start')});
  const other=queue.add({key:'other',photoId:'other',run:async()=>calls.push('other')});
  queue.releasePhoto('large');assert.deepEqual(completed.result,{blob:'kept-download'});
  for(const task of [completed,running,queued]){assert.equal(task.run,null);assert.equal(task.released,true);assert.equal(queue.retry(task.id),false);}
  assert.equal(other.status,'queued');gate.resolve();await tick();await tick();assert.deepEqual(calls,['running','other']);assert.equal(other.status,'done');
});
