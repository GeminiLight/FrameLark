import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,readFile,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {requestCodex} from '../../codex-vision.mjs';
import {createVisionService} from '../../vision-service.mjs';
const schema={type:'object',properties:{finding:{type:'string'}},required:['finding'],additionalProperties:false};
const payload={instructions:'Review',input:[{role:'user',content:[{type:'input_text',text:'$(touch nope)'},{type:'input_image',image_url:'data:image/png;base64,YWJj'}]}],text:{format:{schema}}};

test('Codex uses private temporary images, stdin, schema and restricted CLI; cleans up',async()=>{
 let directory;
 const result=await requestCodex(payload,{model:'test-model',spawnImpl:(command,args,options)=>{
  assert.equal(command,'codex');directory=options.cwd;
  assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('read-only'));assert.ok(args.includes('shell_tool'));
  assert.equal(options.env.CODEX_API_KEY,undefined);assert.ok(!args.includes('$(touch nope)'));
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  let prompt='';child.stdin.on('data',chunk=>prompt+=chunk);
  child.stdin.on('finish',async()=>{
   assert.match(prompt,/touch nope/);
   assert.equal(await readFile(args[args.indexOf('--image')+1],'utf8'),'abc');
   assert.deepEqual(JSON.parse(await readFile(args[args.indexOf('--output-schema')+1],'utf8')),schema);
   await writeFile(args[args.indexOf('--output-last-message')+1],'{"finding":"ok"}');child.emit('close',0);
  });return child;
 }});
 assert.equal(result.output_text,'{"finding":"ok"}');await assert.rejects(access(directory));
});

test('Codex cancellation terminates subprocess and removes temporary files',async()=>{
 const controller=new AbortController();let directory,killed=false;
 const promise=requestCodex(payload,{model:'test',signal:controller.signal,spawnImpl:(_c,_a,o)=>{
  directory=o.cwd;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{killed=true;queueMicrotask(()=>child.emit('close',null));};child.stdin.on('finish',()=>controller.abort());return child;
 }});
 await assert.rejects(promise);assert.ok(killed);await assert.rejects(access(directory));
});

test('Codex probe persists no credentials, reloads and validates later output',async()=>{
 const root=await mkdtemp(join(tmpdir(),'frameyn-test-'));
 try {
  const codexRequest=async()=>({output_text:JSON.stringify({shape:'circle',foreground:'red',background:'blue'})});
  const vision=await createVisionService({root,env:{},codexRequest});
  const config=await vision.connect({provider:'codex',model:'test',remember:true});
  assert.equal(config.provider,'codex');assert.equal(config.hasKey,false);assert.equal(config.connectionStatus,'ready');
  assert.equal(JSON.parse(await readFile(join(root,'.guangjian/vision.json'),'utf8')).apiKey,'');
  const reloaded=await createVisionService({root,env:{},codexRequest});assert.ok(reloaded.isConfigured());
  await assert.rejects(reloaded.request(payload),e=>e.code==='INVALID_MODEL_RESPONSE');
  const cloud=await createVisionService({root,env:{VERCEL:'1'},codexRequest});
  await assert.rejects(cloud.connect({provider:'codex',model:'test'}),e=>e.code==='CODEX_LOCAL_ONLY');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('missing CLI, expired login and quota errors are safe and actionable',async()=>{
 for(const [message,code] of [['not logged in SECRET','CODEX_LOGIN_REQUIRED'],['usage limit SECRET','CODEX_LIMIT'],['other SECRET','CODEX_FAILED'],['ENOENT','CODEX_NOT_FOUND']]) {
  await assert.rejects(requestCodex(payload,{model:'test',spawnImpl:()=>{
   const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
   queueMicrotask(()=>{if(message==='ENOENT')child.emit('error',Object.assign(new Error(message),{code:'ENOENT'}));else{child.stderr.write(message);child.emit('close',1);}});return child;
  }}),e=>e.code===code && !e.message.includes('SECRET'));
 }
});
