import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {preparePhotoFile} from '../../public/import-conversion.js';
import {runImportBatch} from '../../public/photo-import.js';
import {handleProjectRoutes} from '../../project-routes.mjs';
import {openStudioProject} from '../../skills/photo-retouch/scripts/studio.mjs';

test('HEIC preparation preserves the original for a shared project and imports converted pixels',async()=>{
  const original=new File(['heic-test'],'photo.heic',{type:'image/heic'}),png=await readFile(new URL('../../public/assets/vision-probe.png',import.meta.url));let sent;
  const rows=[{file:original,status:'waiting'}];
  await runImportBatch(rows,{prepare:(file,signal)=>preparePhotoFile(file,{signal,fetchImpl:async(url,options)=>{assert.equal(url,'/api/photos/convert');sent=options.body;return new Response(png,{headers:{'Content-Type':'image/png'}});}}),capacity:()=>({count:0,pixels:0}),commit:async(file,metadata,_signal,source)=>{assert.equal(source,original);assert.notEqual(file,original);assert.equal(metadata.format,'png');return {width:metadata.width,height:metadata.height};}});
  assert.equal(sent,original);assert.equal(rows[0].status,'success');assert.equal(rows[0].metadata.convertedFrom,'HEIC');
});

test('conversion failure stays a clear import failure rather than corrupting an existing workspace',async()=>{
  const original=new File(['heic-test'],'photo.heic');let committed=false;
  const rows=[{file:original,status:'waiting'}];await runImportBatch(rows,{prepare:file=>preparePhotoFile(file,{fetchImpl:async()=>new Response(JSON.stringify({error:{message:'当前系统不支持 HEIC 转换。'}}),{status:422})}),capacity:()=>({count:1,pixels:100}),commit:async()=>{committed=true;}});
  assert.equal(committed,false);assert.equal(rows[0].problem.code,'HEIC');assert.match(rows[0].problem.detail,/不支持/);
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
