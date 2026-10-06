import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {validateStructured, createVisionService, invalidStructuredPaths } from '../../apps/studio/server/ai/vision.mjs';
test('integer schema revisions accept whole numbers and reject fractional or non-finite revisions',()=>{
 const schema={type:'integer',minimum:0,maximum:64};assert.equal(validateStructured(8,schema),true);for(const value of [-1,8.5,65,NaN,Infinity,'8'])assert.equal(validateStructured(value,schema),false);assert.deepEqual(invalidStructuredPaths(8,schema),[]);
});

const schema = {type:'object',additionalProperties:false,properties:{finding:{type:'string',minLength:1}},required:['finding']};
const payload = {input:[],text:{format:{schema}}};
const configured = {OPENAI_API_KEY:'private-test-key',OPENAI_MODEL:'test-vision',OPENAI_API_URL:'http://127.0.0.1:3999/v1/responses'};
const completed = value => new Response(JSON.stringify({id:'response-test',status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(),'guangjian-vision-test-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  return root;
}

test('vision requests validate structured output and expose provenance without credentials',async t => {
  const root = await temporary(t);
  let body;
  const vision = await createVisionService({root,env:configured,fetchImpl:async (url,options) => {
    assert.equal(url,configured.OPENAI_API_URL);
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer private-test-key');
    body = JSON.parse(options.body);
    return completed({finding:'右侧天空较亮'});
  }});
  const result = await vision.request(payload);
  assert.equal(body.store,false);
  assert.equal(body.model,'test-vision');
  assert.equal(result.provenance.source,'vision');
  assert.equal(result.provenance.responseId,'response-test');
  assert.equal(vision.status().connectionStatus,'ready');
  assert.doesNotMatch(JSON.stringify({result,config:vision.publicConfiguration()}),/private-test-key/);
});

test('vision failures are actionable and never reflect upstream details',async t => {
  const root = await temporary(t);
  const cases = [
    [401,'invalid_api_key','INVALID_API_KEY',false],
    [403,'','MODEL_ACCESS_DENIED',false],
    [404,'','MODEL_NOT_FOUND',false],
    [429,'insufficient_quota','QUOTA_EXCEEDED',false],
    [429,'rate_limit_exceeded','RATE_LIMITED',true],
    [422,'','MODEL_INPUT_UNSUPPORTED',false],
    [503,'','PROVIDER_UNAVAILABLE',true]
  ];
  for (const [status,code,expected,retryable] of cases) {
    const vision = await createVisionService({root,env:configured,fetchImpl:async () => new Response(JSON.stringify({error:{code,message:'upstream private-test-key details'}}),{status,headers:{'Retry-After':'120'}})});
    await assert.rejects(vision.request(payload),error => {
      assert.equal(error.code,expected);
      assert.equal(error.retryable,retryable);
      assert.doesNotMatch(JSON.stringify(error.toJSON()),/upstream|private-test-key/);
      if (expected === 'RATE_LIMITED') assert.equal(error.retryAfterSeconds,60);
      return true;
    });
    assert.equal(vision.status().lastError.code,expected);
  }
});

test('refusal, partial responses and missing evidence do not become successful vision results',async t => {
  const root = await temporary(t);
  const cases = [
    [{output:[{content:[{type:'refusal',refusal:'private provider explanation'}]}]},'MODEL_REFUSED'],
    [{status:'incomplete',output:[]},'INCOMPLETE_MODEL_RESPONSE'],
    [{output:{invalid:true}},'INVALID_MODEL_RESPONSE'],
    [{status:'completed',output_text:'not JSON'},'INVALID_MODEL_RESPONSE'],
    [{status:'completed',output_text:JSON.stringify({finding:''})},'INVALID_MODEL_RESPONSE'],
    [{status:'completed',output_text:JSON.stringify({finding:'test',extra:true})},'INVALID_MODEL_RESPONSE']
  ];
  for (const [body,code] of cases) {
    const vision = await createVisionService({root,env:configured,fetchImpl:async () => new Response(JSON.stringify(body),{status:200})});
    await assert.rejects(vision.request(payload),error => error.code === code);
    assert.equal(vision.status().verifiedAt,null);
  }
});

test('connection verifies the actual image input before committing or privately remembering config',async t => {
  const root = await temporary(t);
  let recognized = false;
  const vision = await createVisionService({root,env:{},fetchImpl:async (url,options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.text.format.name,'vision_connection_probe');
    assert.match(body.input[0].content[1].image_url,/^data:image\/png;base64,/);
    assert.equal(body.store,false);
    return completed({shape:recognized ? 'circle' : 'square',foreground:'red',background:'blue'});
  }});
  const config = {apiKey:'new-test-key',model:'test-vision',endpoint:configured.OPENAI_API_URL,remember:true};
  await assert.rejects(vision.connect(config),error => error.code === 'VISION_CHECK_FAILED');
  assert.equal(vision.isConfigured(),false);
  await assert.rejects(readFile(join(root,'.guangjian','vision.json')),{code:'ENOENT'});
  recognized = true;
  const result = await vision.connect(config);
  assert.equal(result.connectionStatus,'ready');
  assert.equal(result.hasKey,true);
  assert.doesNotMatch(JSON.stringify(result),/new-test-key/);
  assert.equal((await stat(join(root,'.guangjian','vision.json'))).mode & 0o777,0o600);
  assert.equal((await stat(join(root,'.guangjian'))).mode & 0o777,0o700);
  const loaded = await createVisionService({root,env:{},fetchImpl:async () => completed({finding:'test'})});
  assert.equal(loaded.isConfigured(),true);
  assert.equal(loaded.status().connectionStatus,'configured'); // A restart needs a new live verification.
  assert.equal(loaded.publicConfiguration().model,'test-vision');
});

test('cancelled connection cannot install config and a cancelled review is not a provider outage',async t => {
  const root = await temporary(t);
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const vision = await createVisionService({root,env:{},fetchImpl:async (url,{signal}) => {
    started();
    return new Promise((resolve,reject) => signal.addEventListener('abort',() => reject(new DOMException('Aborted','AbortError')),{once:true}));
  }});
  const controller = new AbortController();
  const connection = vision.connect({apiKey:'cancelled-test-key',endpoint:configured.OPENAI_API_URL,remember:true},{signal:controller.signal});
  await pending;
  controller.abort();
  await assert.rejects(connection,error => error.code === 'CANCELLED');
  assert.equal(vision.isConfigured(),false);
  assert.equal(vision.status().lastError,null);
  await assert.rejects(readFile(join(root,'.guangjian','vision.json')),{code:'ENOENT'});
});

test('invalid URLs and changing provider without a key fail before transmission',async t => {
  const root = await temporary(t);
  let calls = 0;
  const vision = await createVisionService({root,env:configured,fetchImpl:async () => { calls++; return completed({}); }});
  for (const endpoint of ['not a url','http://example.com/v1/responses','https://user:password@example.com/v1/responses','https://example.com/v1/responses?key=test']) {
    await assert.rejects(vision.connect({endpoint}),error => error.code === 'INVALID_ENDPOINT');
  }
  await assert.rejects(vision.connect({endpoint:'https://example.com/v1/responses'}),error => error.code === 'API_KEY_REQUIRED');
  assert.equal(calls,0);
  assert.equal(vision.publicConfiguration().endpoint,configured.OPENAI_API_URL);
});

test('timeouts become a retryable failure instead of an indefinite review',async t => {
  const root = await temporary(t);
  const vision = await createVisionService({root,env:configured,timeoutMs:15,fetchImpl:async (url,{signal}) => new Promise((resolve,reject) => signal.addEventListener('abort',() => reject(new DOMException('Aborted','AbortError')),{once:true}))});
  await assert.rejects(vision.request(payload),error => error.code === 'MODEL_TIMEOUT' && error.retryable);
});

const chatCompleted = (value, extra = {}) => new Response(JSON.stringify({id:'chat-test',model:'k3',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value),reasoning_content:'private reasoning'}}],...extra}),{status:200});

test('Kimi base URL translates image, intent and schema to Chat Completions without Responses fields',async t => {
  const root = await temporary(t);
  const vision = await createVisionService({root,env:{OPENAI_API_KEY:'private-kimi-test',OPENAI_MODEL:'k3',OPENAI_API_URL:'https://api.kimi.com/coding/v1/'},fetchImpl:async (url,options) => {
    assert.equal(url,'https://api.kimi.com/coding/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer private-kimi-test');
    assert.equal(options.headers['User-Agent'],'GuangjianPhotoStudio/0.1');
    assert.equal(options.redirect,'error');
    const body = JSON.parse(options.body);
    assert.equal(body.model,'k3');
    assert.equal(body.reasoning_effort,'high');
    assert.equal(body.max_tokens,1400+4096);
    assert.deepEqual(body.response_format,{type:'json_object'});
    assert.match(body.messages[0].content,/保留肤色/);
    assert.match(body.messages[0].content,/finding/);
    assert.deepEqual(body.messages[1].content,[{type:'text',text:'当前意图：自然人像'},{type:'image_url',image_url:{url:'data:image/png;base64,aGVsbG8=',detail:'high'}}]);
    for(const name of ['input','instructions','reasoning','text','store','max_output_tokens']) assert.equal(Object.hasOwn(body,name),false);
    return chatCompleted({finding:'右侧背景光较亮'});
  }});
  const result = await vision.request({instructions:'保留肤色',reasoning:{effort:'medium'},max_output_tokens:1400,input:[{role:'user',content:[{type:'input_text',text:'当前意图：自然人像'},{type:'input_image',image_url:'data:image/png;base64,aGVsbG8=',detail:'high'}]}],text:{format:{schema}}});
  assert.deepEqual(result.value,{finding:'右侧背景光较亮'});
  assert.equal(result.provenance.provider,'Kimi');
  assert.equal(result.provenance.model,'k3');
  assert.equal(result.provenance.responseId,'chat-test');
  assert.equal(vision.status().connectionStatus,'ready');
  assert.doesNotMatch(JSON.stringify({result,configuration:vision.publicConfiguration()}),/private-kimi-test|private reasoning/);
});

test('Chat Completions keeps both comparison images in their original order',async t => {
  const root = await temporary(t);
  const vision = await createVisionService({root,env:{...configured,OPENAI_API_URL:'http://127.0.0.1:3999/v1/chat/completions'},fetchImpl:async (url,options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.reasoning_effort,'medium');
    assert.equal(body.max_tokens,5500);
    assert.deepEqual(body.messages[1].content,[{type:'text',text:'原片'},{type:'image_url',image_url:{url:'original'}},{type:'text',text:'当前效果'},{type:'image_url',image_url:{url:'edited'}}]);
    return chatCompleted({finding:'高光层次保留'});
  }});
  await vision.request({...payload,max_output_tokens:5500,reasoning:{effort:'medium'},input:[{role:'user',content:[{type:'input_text',text:'原片'},{type:'input_image',image_url:'original'},{type:'input_text',text:'当前效果'},{type:'input_image',image_url:'edited'}]}]});
});

test('Kimi vision connection requires correct image recognition before saving configuration',async t => {
  const root = await temporary(t);
  let correct = false;
  const vision = await createVisionService({root,env:{},fetchImpl:async (url,options) => {
    const body = JSON.parse(options.body);
    assert.match(url,/chat\/completions$/);
    assert.match(body.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);
    assert.match(body.messages[0].content,/circle/);
    assert.equal(body.reasoning_effort,'low');
    return chatCompleted({shape:correct ? 'circle':'square',foreground:'red',background:'blue'});
  }});
  const candidate = {apiKey:'private-kimi-connect',model:'k3',endpoint:'https://api.kimi.com/coding/v1',remember:true};
  await assert.rejects(vision.connect(candidate),error=>error.code==='VISION_CHECK_FAILED');
  assert.equal(vision.isConfigured(),false);
  correct = true;
  const result = await vision.connect(candidate);
  assert.equal(result.endpoint,'https://api.kimi.com/coding/v1/chat/completions');
  assert.equal(result.connectionStatus,'ready');
  assert.equal((await stat(join(root,'.guangjian','vision.json'))).mode & 0o777,0o600);
  assert.doesNotMatch(JSON.stringify(result),/private-kimi-connect/);
});

test('partial, refused, malformed and schema-invalid chat output never becomes a visual review',async t => {
  const root = await temporary(t);
  const cases = [
    [{choices:[]},'INVALID_MODEL_RESPONSE'],
    [{choices:[{finish_reason:'length',message:{content:'{"finding":"unfinished"}'}}]},'INCOMPLETE_MODEL_RESPONSE'],
    [{choices:[{finish_reason:'content_filter',message:{content:null}}]},'MODEL_REFUSED'],
    [{choices:[{finish_reason:'stop',message:{refusal:'private refusal',content:null}}]},'MODEL_REFUSED'],
    [{choices:[{finish_reason:'stop',message:{content:null,reasoning_content:'{"finding":"guess"}'}}]},'INVALID_MODEL_RESPONSE'],
    [{choices:[{finish_reason:'stop',message:{content:'```json\n{"finding":"wrapped"}\n```'}}]},'INVALID_MODEL_RESPONSE'],
    [{choices:[{finish_reason:'stop',message:{content:'{"finding":""}'}}]},'INVALID_MODEL_RESPONSE']
  ];
  for(const [result,expected] of cases){
    const vision = await createVisionService({root,env:{...configured,OPENAI_API_URL:'http://127.0.0.1:3999/v1/chat/completions'},fetchImpl:async()=>new Response(JSON.stringify(result),{status:200})});
    await assert.rejects(vision.request(payload),error=>error.code===expected);
    assert.equal(vision.status().verifiedAt,null);
    assert.doesNotMatch(JSON.stringify(vision.status()),/private refusal|guess/);
  }
});

test('chat provider errors and cancellation preserve the same safe recovery contract',async t => {
  const root = await temporary(t);
  const env = {...configured,OPENAI_API_URL:'http://127.0.0.1:3999/v1/chat/completions'};
  const failed = await createVisionService({root,env,fetchImpl:async()=>new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'private-test-key upstream details'}}),{status:429,headers:{'Retry-After':'4'}})});
  await assert.rejects(failed.request(payload),error=>error.code==='RATE_LIMITED' && error.retryAfterSeconds===4);
  assert.doesNotMatch(JSON.stringify(failed.status()),/private-test-key|upstream details/);
  let started;
  const pending = new Promise(resolve=>{started=resolve;});
  const cancelled = await createVisionService({root,env,fetchImpl:async (url,{signal})=>{
    started();
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  }});
  const controller = new AbortController();
  const request = cancelled.request(payload,{signal:controller.signal});
  await pending;
  controller.abort();
  await assert.rejects(request,error=>error.code==='CANCELLED');
  assert.equal(cancelled.status().lastError,null);
});

test('schema mismatch diagnostics identify missing fields without reflecting model text or unknown keys',()=>{
 const schema={type:'object',additionalProperties:false,required:['finding','score'],properties:{finding:{type:'string',minLength:1},score:{type:'number',minimum:0,maximum:100}}};
 const paths=invalidStructuredPaths({finding:'',score:101,'secret-user-text':'credential'},schema);
 assert.deepEqual(paths,['$.finding','$.score','$.unexpectedField']);
 assert.doesNotMatch(JSON.stringify(paths),/secret-user-text|credential/);
 assert.deepEqual(invalidStructuredPaths({finding:'evidence'},schema),['$.score']);
});


test('structured validation resolves shared local definitions without accepting unknown references',()=>{
 const schema={type:'object',properties:{target:{$ref:'#/$defs/target'}},required:['target'],additionalProperties:false,$defs:{target:{type:'object',properties:{x:{type:'number',minimum:0,maximum:1}},required:['x'],additionalProperties:false}}};
 assert.equal(validateStructured({target:{x:.4}},schema),true);assert.equal(validateStructured({target:{x:2}},schema),false);assert.equal(validateStructured({target:{x:.4,command:'bad'}},schema),false);
 assert.equal(validateStructured({target:{}},{...schema,properties:{target:{$ref:'#/$defs/missing'}}}),false);
});
