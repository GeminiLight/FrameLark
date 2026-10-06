import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {preparePhotoFile} from '../../apps/studio/public/import-conversion.js';
import {runImportBatch,rawImportLimits} from '../../apps/studio/public/photo-import.js';
import {handleProjectRoutes} from '../../apps/studio/server/projects/routes.mjs';
import {openStudioProject} from '../../skills/photo-retouch/scripts/studio.mjs';

test('HEIC preparation preserves the original for a shared project and imports converted pixels',async()=>{
  const original=new File(['heic-test'],'photo.heic',{type:'image/heic'}),png=await readFile(new URL('../../apps/studio/public/assets/vision-probe.png',import.meta.url));let sent;
  const rows=[{file:original,status:'waiting'}];
  await runImportBatch(rows,{prepare:(file,signal)=>preparePhotoFile(file,{signal,fetchImpl:async(url,options)=>{assert.equal(url,'/api/photos/convert');sent=options.body;return new Response(png,{headers:{'Content-Type':'image/png'}});}}),capacity:()=>({count:0,pixels:0}),commit:async(file,metadata,_signal,source)=>{assert.equal(source,original);assert.notEqual(file,original);assert.equal(metadata.format,'png');return {width:metadata.width,height:metadata.height};}});
  assert.equal(sent,original);assert.equal(rows[0].status,'success');assert.equal(rows[0].metadata.convertedFrom,'HEIC');
});

test('conversion failure stays a clear import failure rather than corrupting an existing workspace',async()=>{
  const original=new File(['heic-test'],'photo.heic');let committed=false;
  const rows=[{file:original,status:'waiting'}];await runImportBatch(rows,{prepare:file=>preparePhotoFile(file,{fetchImpl:async()=>new Response(JSON.stringify({error:{message:'当前系统不支持 HEIC 转换。'}}),{status:422})}),capacity:()=>({count:1,pixels:100}),commit:async()=>{committed=true;}});
  assert.equal(committed,false);assert.equal(rows[0].problem.code,'HEIC');assert.match(rows[0].problem.detail,/不支持/);
});

test('actual PNG content is not sent to HEIC conversion just because of its filename',async()=>{
  const png=await readFile(new URL('../../apps/studio/public/assets/vision-probe.png',import.meta.url));
  const file=new File([png],'incorrect-extension.heic',{type:'image/heic'});
  assert.equal(await preparePhotoFile(file,{fetchImpl:()=>{throw new Error('must not convert a PNG');}}),file);
});

test('local file routes reject cloud and foreign-origin requests before filesystem access',async()=>{
  for(const cloud of [false,true]){
    const response=new EventEmitter();response.writeHead=status=>{response.status=status;};response.end=value=>{response.value=JSON.parse(value);};
    const handled=await handleProjectRoutes({method:'POST',headers:{}},response,new URL('http://localhost/api/projects/register'),{bridge:{register(){throw new Error('must not execute');}},readBody(){throw new Error('must not execute');},allowed:()=>false,cloud});
    assert.equal(handled,true);assert.equal(response.status,403);
  }
});

test('Skill studio command registers only with a loopback workspace and returns a project URL',async()=>{
  let called=false;const options={fetchImpl:async(url,init)=>{called=true;assert.equal(url.pathname,'/api/projects/register');assert.equal(init.headers.Origin,'http://127.0.0.1:3177');return new Response(JSON.stringify({id:'test-project'}));}};
  const result=await openStudioProject('/tmp/example',options);assert.equal(new URL(result.url).searchParams.get('project'),'test-project');assert.equal(called,true);
  called=false;await assert.rejects(openStudioProject('/tmp/example',{...options,url:'https://example.com'}),{code:'STUDIO_URL'});assert.equal(called,false);
});


test('RAW import sends original bytes locally and returns only a PNG proxy to the browser',async()=>{
 const file=new File(['RAW-original'],'camera.NEF'),png=await readFile(new URL('../../apps/studio/public/assets/vision-probe.png',import.meta.url));let calls=0;
 const result=await preparePhotoFile(file,{fetchImpl:async(url,options)=>{calls++;if(calls===1){assert.equal(url,'/api/projects/create');assert.equal(options.body,file);assert.equal(options.headers['X-Photo-Name'],'camera.NEF');return Response.json({id:'raw-project',source:{raw:{backend:'apple'}}});}assert.equal(url,'/api/projects/raw-project/source');return new Response(png,{headers:{'Content-Type':'image/png'}});}});
 assert.equal(result.type,'image/png');assert.equal(result.rawProject.id,'raw-project');assert.equal(calls,2);assert.deepEqual(Buffer.from(await result.arrayBuffer()),png);
});
test('RAW decode failure keeps existing photos and reports the backend error',async()=>{
 let committed=false;const rows=[{file:new File(['unsupported'],'camera.CR3'),status:'waiting'}];
 await runImportBatch(rows,{prepare:file=>preparePhotoFile(file,{fetchImpl:async()=>Response.json({error:{message:'此 RAW 压缩方式未能解码。'}},{status:422})}),capacity:()=>({count:1,pixels:100}),commit:async()=>{committed=true;}});
 assert.equal(committed,false);assert.equal(rows[0].problem.code,'RAW');assert.match(rows[0].problem.detail,/压缩方式/);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('RAW preparation can finish beyond the ordinary 30-second header deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const png=await readFile(new URL('../../apps/studio/public/assets/vision-probe.png',import.meta.url));
  const gate=deferred(),started=deferred(),rows=[{file:new File(['RAW-original'],'camera.NEF'),status:'waiting'}];let committed=false;
  const task=runImportBatch(rows,{prepare:(file,signal)=>preparePhotoFile(file,{signal,fetchImpl:async(url,options)=>{
    if(url==='/api/projects/create'){started.resolve();await gate.promise;return Response.json({id:'slow-raw',source:{raw:{backend:'apple'}}});}
    return new Response(png,{headers:{'Content-Type':'image/png'}});
  }}),capacity:()=>({count:0,pixels:0}),commit:async()=>{committed=true;return {};}});
  await started.promise;t.mock.timers.tick(30001);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rows[0].status,'reading');assert.equal(committed,false);
  gate.resolve();await task;assert.equal(rows[0].status,'success');assert.equal(committed,true);
});
test('preparation timeout aborts the request and continues with the remaining photos',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const started=deferred(),late=deferred(),rows=['slow.jpg','ready.jpg'].map(name=>({file:new File(['source'],name),status:'waiting'}));
  let requestSignal;const accepted=[];
  const task=runImportBatch(rows,{prepare:async(file,signal)=>{
    if(file.name==='slow.jpg'){requestSignal=signal;started.resolve();await late.promise;}
    return file;
  },inspect:async()=>({pixels:1}),capacity:()=>({count:0,pixels:0}),commit:async file=>{accepted.push(file.name);return {};}});
  await started.promise;t.mock.timers.tick(30001);await task;
  assert.equal(requestSignal?.aborted,true);assert.equal(rows[0].problem.code,'TIMEOUT');assert.deepEqual(accepted,['ready.jpg']);
  late.resolve();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(accepted,['ready.jpg']);
});
test('RAW size errors state the RAW limit and a recovery action',async()=>{
  const rows=[{file:{name:'large.NEF',size:512*1024*1024+1},status:'waiting'}];
  await runImportBatch(rows,{prepare:file=>preparePhotoFile(file,{fetchImpl:()=>{throw Error('must reject before upload');}}),capacity:()=>({count:0,pixels:0}),commit:()=>{throw Error('must not commit');}});
  assert.match(rows[0].problem.reason,/512/);assert.match(rows[0].problem.action,/RAW/);assert.doesNotMatch(rows[0].problem.reason,/30 MB/);
});

test('RAW deadline aborts its actual preparation fetch and leaves later photos usable',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const started=deferred(),rows=[{file:new File(['raw'],'slow.NEF'),status:'waiting'},{file:new File(['ready'],'ready.jpg'),status:'waiting'}];
  let fetchSignal;const accepted=[];
  const task=runImportBatch(rows,{prepare:(file,signal)=>preparePhotoFile(file,{signal,fetchImpl:async(_url,options)=>{
    fetchSignal=options.signal;started.resolve();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));
  }}),inspect:async()=>({pixels:1}),capacity:()=>({count:0,pixels:0}),commit:async file=>{accepted.push(file.name);return {};}});
  await started.promise;t.mock.timers.tick(rawImportLimits.timeoutMs+1);await task;
  assert.equal(fetchSignal.aborted,true);assert.equal(rows[0].problem.code,'RAW_TIMEOUT');assert.equal(rows[0].problem.retryable,true);assert.equal(rows[1].status,'success');assert.deepEqual(accepted,['ready.jpg']);
});
test('user cancellation reaches a RAW fetch immediately and prevents a late import',async()=>{
  const started=deferred(),controller=new AbortController(),rows=[{file:new File(['raw'],'camera.NEF'),status:'waiting'}];let fetchSignal,commits=0;
  const task=runImportBatch(rows,{signal:controller.signal,prepare:(file,signal)=>preparePhotoFile(file,{signal,fetchImpl:async(_url,options)=>{
    fetchSignal=options.signal;started.resolve();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));
  }}),capacity:()=>({count:0,pixels:0}),commit:()=>{commits++;}});
  await started.promise;controller.abort();await task;
  assert.equal(fetchSignal.aborted,true);assert.equal(rows[0].problem.code,'CANCELLED');assert.equal(commits,0);
});
