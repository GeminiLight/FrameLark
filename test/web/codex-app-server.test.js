import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
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
  assert.deepEqual(started.params.environments,[]);
  for(const call of calls.filter(c=>c.method==='turn/start'))assert.deepEqual(call.params.environments,[]);
  assert.deepEqual(calls.find(c=>c.method==='turn/start').params.outputSchema,schema);
  const saved=await readFile(join(env.root,'.guangjian/codex-sessions.json'),'utf8');assert.ok(!saved.includes('photo-a'));assert.ok(!saved.includes('base64'));
});

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function protocolFixture(t,handle){
  const root=await mkdtemp(join(tmpdir(),'frameyn-protocol-')),children=[],calls=[];
  const app=new CodexAppServer({root,rpcTimeout:40,spawnImpl:(_command,args)=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.index=children.length;child.args=args;children.push(child);
    child.send=value=>child.stdout.write(JSON.stringify(value)+'\n');
    child.kill=signal=>{child.killedWith=signal;queueMicrotask(()=>child.emit('close'));return true;};
    child.stdin.on('data',bytes=>{
      for(const line of bytes.toString().trim().split('\n')){
        const message=JSON.parse(line);calls.push({child:child.index,...message});
        const respond=value=>child.send({id:message.id,result:value});
        if(handle({child,message,respond,app})===true)continue;
        if(message.method==='initialize')respond({});
        if(message.method==='config/read')respond({config:{mcp_servers:{}}});
        if(message.method==='thread/start'||message.method==='thread/resume')respond({thread:{id:message.params.threadId||'photo-thread'}});
      }
    });return child;
  }});
  t.after(async()=>{app.stop();await app.closing;await rm(root,{recursive:true,force:true});});
  return {app,children,calls};
}
function complete(child,threadId,id,reply){child.send({method:'turn/completed',params:{threadId,turn:{id,status:'completed',items:[{type:'agentMessage',phase:'final_answer',text:JSON.stringify({reply})}]}}});}

test('photo requests disable local image and environment tools, including resumed turns',async t=>{
  const {app,children}=await protocolFixture(t,({child,message,respond})=>{
    if(message.method!=='turn/start')return;
    respond({turn:{id:'safe-turn'}});complete(child,message.params.threadId,'safe-turn','safe');return true;
  });
  await app.request(payload(),{model:'test',sessionKey:'photo'});
  const args=children[0].args;
  for(const name of ['view_image','shell_tool','sleep_tool','tool_suggest'])assert.ok(args.some((v,i)=>v==='--disable'&&args[i+1]===name));
});

test('an unknown start timeout retires its transport before retry; old messages cannot complete it',async t=>{
  const {app,children}=await protocolFixture(t,({child,message,respond})=>{
    if(message.method!=='turn/start')return;
    if(child.index===0)return true; // Upstream starts, but no acknowledgement arrives.
    children[0].send({method:'turn/completed',params:{threadId:'photo-thread',turn:{id:'old-turn',status:'completed',items:[{type:'agentMessage',text:'OLD'}]}}});
    children[0].send({id:999,method:'item/commandExecution/requestApproval',params:{threadId:'photo-thread'}});
    children[0].emit('error',new Error('late old process error'));
    respond({turn:{id:'new-turn'}});complete(child,'photo-thread','new-turn','NEW');return true;
  });
  await assert.rejects(app.request(payload('old'),{model:'test',sessionKey:'photo'}),{code:'CODEX_TIMEOUT'});
  assert.equal(app.active.size,0);assert.equal(children[0].killedWith,'SIGTERM');
  const retry=await app.request(payload('new'),{model:'test',sessionKey:'photo'});
  assert.equal(JSON.parse(retry.output_text).reply,'NEW');assert.equal(children.length,2);
});

test('cancel before start acknowledgement retires immediately and permits a clean retry',async t=>{
  const waiting=deferred(),controller=new AbortController();
  const {app,children}=await protocolFixture(t,({child,message,respond})=>{
    if(message.method!=='turn/start')return;
    if(child.index===0){waiting.resolve();return true;}
    respond({turn:{id:'retry'}});complete(child,'photo-thread','retry','fresh');return true;
  });
  app.rpcTimeout=5000;
  const pending=app.request(payload(),{model:'test',sessionKey:'photo',signal:controller.signal});
  const cancelled=assert.rejects(pending,{code:'CANCELLED'});await waiting.promise;controller.abort();await cancelled;
  assert.equal(children[0].killedWith,'SIGTERM');assert.equal(app.active.size,0);assert.equal(app.busySessions.size,0);
  assert.equal(JSON.parse((await app.request(payload(),{model:'test',sessionKey:'photo'})).output_text).reply,'fresh');
});

test('a known start timeout keeps its photo busy until interrupt settles, without stopping other photos',async t=>{
  const interrupted=deferred(),settle=deferred();
  const {app,children}=await protocolFixture(t,({child,message,respond})=>{
    if(message.method==='turn/start'){
      const slow=message.params.input.some(i=>i.text==='known slow');
      if(slow){child.send({method:'turn/started',params:{threadId:'photo-thread',turn:{id:'known-turn',status:'inProgress'}}});return true;}
      respond({turn:{id:'other-turn'}});complete(child,message.params.threadId,'other-turn','OTHER');return true;
    }
    if(message.method==='turn/interrupt'){
      interrupted.resolve();respond({});
      settle.promise.then(()=>child.send({method:'turn/completed',params:{threadId:'photo-thread',turn:{id:'known-turn',status:'interrupted',items:[]}}}));return true;
    }
    if(message.method==='thread/start'){respond({thread:{id:message.params.ephemeral?'other-thread':'photo-thread'}});return true;}
  });
  const first=app.request(payload('known slow'),{model:'test',sessionKey:'photo'}),rejected=assert.rejects(first,{code:'CODEX_TIMEOUT'});
  await interrupted.promise;
  await assert.rejects(app.request(payload(),{model:'test',sessionKey:'photo'}),{code:'CODEX_BUSY'});
  assert.equal(JSON.parse((await app.request(payload(),{model:'test'})).output_text).reply,'OTHER');
  settle.resolve();await rejected;assert.equal(app.active.size,0);assert.equal(children[0].killedWith,undefined);
});

test('a retired startup cannot clear or stop the next generation',async t=>{
  const waiting=deferred();
  const {app,children}=await protocolFixture(t,({child,message})=>{if(child.index===0&&message.method==='config/read'){waiting.resolve();return true;}});
  const first=app.start(),rejected=assert.rejects(first,{code:'CODEX_OFFLINE'});await waiting.promise;
  app.stop();const second=app.start();await rejected;await second;await app.start();
  assert.equal(children.length,2);assert.equal(app.child,children[1]);assert.ok(app.starting);
});

test('a request paused while saving its session cannot send a turn on a replacement transport',async t=>{
  const saving=deferred(),release=deferred();
  const {app,calls}=await protocolFixture(t,({child,message,respond})=>{if(message.method==='turn/start'){respond({turn:{id:'fresh'}});complete(child,'photo-thread','fresh','NEW');return true;}});
  app.persistSessions=async()=>{saving.resolve();await release.promise;};
  const first=app.request(payload(),{model:'test',sessionKey:'photo'}),rejected=assert.rejects(first,{code:'CODEX_OFFLINE'});
  await saving.promise;app.stop();await app.start();release.resolve();await rejected;
  assert.equal(calls.filter(c=>c.method==='turn/start').length,0);
  await app.request(payload(),{model:'test',sessionKey:'photo'});
  assert.equal(calls.filter(c=>c.method==='turn/start').length,1);
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
