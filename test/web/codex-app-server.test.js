import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {CodexAppServer} from '../../codex-app-server.mjs';
import {defaultModelTiers,normalizeModelTiers,routeModel} from '../../public/model-routing.js';
import {partialReply,readVisionStream} from '../../public/vision-stream.js';
const fixture=fileURLToPath(new URL('./fixtures/mock-codex-app-server.mjs',import.meta.url));
const schema={type:'object',properties:{reply:{type:'string'}},required:['reply'],additionalProperties:false};
const payload=(text='photo')=>({instructions:'Reply about this photo.',input:[{role:'user',content:[{type:'input_text',text},{type:'input_image',image_url:'data:image/png;base64,YWJj'}]}],text:{format:{schema}}});
async function setup(t){const root=await mkdtemp(join(tmpdir(),'frameyn-rpc-')),log=join(root,'rpc.log');let clients=[];t.after(async()=>{clients.forEach(c=>c.stop());await rm(root,{recursive:true,force:true});});return {root,log,client(){const c=new CodexAppServer({root,command:process.execPath,args:[fixture,log],rpcTimeout:1000});clients.push(c);return c;}};}

test('App Server streams, reuses a photo thread, resumes after restart, and isolates photos',async t=>{
  const env=await setup(t);let app=env.client();const events=[];
  const info=await app.info();assert.equal(info.authenticated,true);assert.ok(!JSON.stringify(info).includes('private@example'));
  const a=await app.request(payload(),{model:'gpt-6.1-sol',sessionKey:'photo-a',onEvent:event=>events.push(event)});
  const b=await app.request(payload('follow-up'),{model:'gpt-6-astra',effort:'high',sessionKey:'photo-a'});
  const other=await app.request(payload(),{model:'gpt-6.1-sol',sessionKey:'photo-b'});
  assert.equal(a.threadId,b.threadId);assert.notEqual(a.threadId,other.threadId);assert.equal(b.model,'gpt-6-astra');
  assert.ok(events.filter(e=>e.type==='delta').length===2);assert.equal(JSON.parse(a.output_text).reply,'人物在左边，可以保留原片。');
  app.stop();app=env.client();const resumed=await app.request(payload(),{model:'gpt-6.1-sol',sessionKey:'photo-a'});assert.equal(resumed.threadId,a.threadId);
  const calls=(await readFile(env.log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(calls.some(c=>c.method==='thread/resume'&&c.params.threadId===a.threadId));
  const started=calls.find(c=>c.method==='thread/start');assert.equal(started.params.sandbox,'read-only');assert.equal(started.params.config['mcp_servers.unrelated.enabled'],false);
  assert.deepEqual(calls.find(c=>c.method==='turn/start').params.outputSchema,schema);
  const saved=await readFile(join(env.root,'.guangjian/codex-sessions.json'),'utf8');assert.ok(!saved.includes('photo-a'));assert.ok(!saved.includes('base64'));
});

test('cancellation interrupts the actual turn and does not deliver a partial result',async t=>{
  const env=await setup(t),app=env.client(),controller=new AbortController();
  const request=app.request(payload('slow-fixture'),{model:'gpt-6.1-sol',sessionKey:'photo-a',signal:controller.signal,onEvent:e=>{if(e.stage==='analyzing')setTimeout(()=>controller.abort(),10);}});
  await assert.rejects(request,e=>e.code==='CANCELLED');
  assert.equal(app.active.size,0);
  assert.match(await readFile(env.log,'utf8'),/turn\/interrupt/);
  assert.equal(JSON.parse((await app.request(payload(),{model:'gpt-6.1-sol',sessionKey:'photo-a'})).output_text).reply,'人物在左边，可以保留原片。');
});

test('same-photo concurrent turns are rejected and upstream errors are sanitized',async t=>{
  const env=await setup(t),app=env.client(),controller=new AbortController();
  const first=app.request(payload('slow-fixture'),{model:'gpt-6.1-sol',sessionKey:'photo-a',signal:controller.signal});
  const rejection=assert.rejects(first,e=>e.code==='CANCELLED');
  await assert.rejects(app.request(payload(),{model:'gpt-6.1-sol',sessionKey:'photo-a'}),e=>e.code==='CODEX_BUSY');
  controller.abort();await rejection;
  await assert.rejects(app.request(payload('quota-fixture'),{model:'gpt-6.1-sol'}),e=>e.code==='CODEX_LIMIT'&&!e.message.includes('SECRET'));
});

test('missing CLI and process crashes become actionable failures',async t=>{
  const env=await setup(t),missing=new CodexAppServer({root:env.root,command:join(env.root,'missing-codex'),rpcTimeout:1000});
  t.after(()=>missing.stop());await assert.rejects(missing.info(),e=>e.code==='CODEX_NOT_FOUND');
  const app=env.client();await assert.rejects(app.request(payload('crash-fixture'),{model:'gpt-6.1-sol'}),e=>e.code==='CODEX_FAILED');
});

test('oversized output is interrupted without leaving a timer that stops other photos',async t=>{
  const env=await setup(t),app=env.client();
  await assert.rejects(app.request(payload('oversize-fixture'),{model:'gpt-6.1-sol',sessionKey:'large-photo'}),e=>e.code==='INVALID_MODEL_RESPONSE');
  assert.equal(app.active.size,0);
  const next=await app.request(payload(),{model:'gpt-6.1-sol',sessionKey:'other-photo'});
  assert.equal(JSON.parse(next.output_text).reply,'人物在左边，可以保留原片。');
});

test('model tiers preserve explicit settings, choose Sol by default, and never promote a retry',()=>{
  const tiers=defaultModelTiers();assert.equal(routeModel(tiers).model,'gpt-6.1-sol');assert.equal(routeModel(tiers,{task:'probe'}).tier,'fast');
  assert.equal(routeModel(tiers,{task:'series'}).model,'gpt-6-astra');assert.equal(routeModel(tiers,{tier:'deep'}).model,'gpt-6-astra');
  assert.equal(normalizeModelTiers(null,'custom-model').deep.model,'custom-model');
  assert.throws(()=>normalizeModelTiers({...tiers,fast:{model:'bad name',effort:'low'}}));assert.throws(()=>routeModel(tiers,{tier:'unknown'}));
});

test('stream renders reply text only and requires a validated final result',async()=>{
  assert.equal(partialReply('{"action":{"kind":"crop"},"reply":"你好\\n世'),'你好\n世');
  assert.equal(partialReply('{"action":{"kind":"crop"}}'),'');
  const events=[{type:'delta',delta:'{"reply":"你好'},{type:'result',value:{answer:{reply:'你好',action:{kind:'none'}}}}];
  const response=new Response(events.map(JSON.stringify).join('\n')+'\n',{headers:{'Content-Type':'application/x-ndjson'}});
  const seen=[];assert.equal((await readVisionStream(response,e=>seen.push(e))).answer.reply,'你好');assert.equal(seen.length,1);
  await assert.rejects(readVisionStream(new Response('{"type":"delta","delta":"text"}\n',{headers:{'Content-Type':'application/x-ndjson'}})),/回复中断/);
});
