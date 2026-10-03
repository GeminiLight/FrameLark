import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';

process.env.VERCEL='1';
process.env.OPENAI_API_KEY='';
const {handleRequest,readBody}=await import('../../server.mjs');

function response(){
  const res=new EventEmitter();
  res.writeHead=(status,headers)=>{res.status=status;res.headers=headers;};
  res.end=body=>{res.payload=JSON.parse(body);res.writableEnded=true;};
  return res;
}

test('cloud status stays honest and visitors cannot change the shared model configuration',async()=>{
  const headers={host:'guangjian.example',origin:'https://guangjian.example','content-type':'application/json'};
  const status=response();await handleRequest({method:'GET',url:'/api/status',headers},status);
  assert.equal(status.status,200);assert.equal(status.payload.aiAvailable,false);assert.equal(status.payload.configurationEditable,false);
  const config=response();await handleRequest({method:'GET',url:'/api/vision-config',headers},config);
  assert.equal(config.payload.configurationEditable,false);assert.equal(config.payload.hasKey,false);
  // Even spoofing the local host/origin cannot open the configuration route in a cloud deployment.
  const blocked=response();await handleRequest({method:'POST',url:'/api/vision-config',headers:{...headers,host:'localhost:3177',origin:'http://localhost:3177'}},blocked);
  assert.equal(blocked.status,403);assert.equal(blocked.payload.error.code,'FORBIDDEN_ORIGIN');
  const analyze=response();await handleRequest({method:'POST',url:'/api/analyze',headers},analyze);
  assert.equal(analyze.status,503);assert.equal(analyze.payload.error.code,'AI_NOT_CONFIGURED');
});

test('function request bodies support parsed platform input and retain the size guard',async()=>{
  const request={headers:{'content-type':'application/json'},body:{image:'data:image/png;base64,aGVsbG8='},async *[Symbol.asyncIterator](){throw new Error('The platform has already consumed this body');}};
  const bytes=await readBody(request,200);
  assert.deepEqual(JSON.parse(bytes.toString()),request.body);
  await assert.rejects(()=>readBody(request,5),error=>error.status===413);
  const raw={...request,body:Buffer.from('{"a":1}')};assert.equal((await readBody(raw,100)).toString(),'{"a":1}');
  const streamed={headers:{},async *[Symbol.asyncIterator](){yield Buffer.from('ab');yield Buffer.from('cd');}};
  assert.equal((await readBody(streamed,4)).toString(),'abcd');
  await assert.rejects(()=>readBody(streamed,3),error=>error.status===413);
});
