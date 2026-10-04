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

test('malformed page URLs return a safe error and the next request still works',async()=>{
  for(const request of [
    {method:'GET',url:'/%E0%A4%A',headers:{host:'guangjian.example'}},
    {method:'GET',url:'/',headers:{host:'['}}
  ]){
    const failed=response();await handleRequest(request,failed);
    assert.equal(failed.status,400);assert.equal(failed.payload.error.code,'INVALID_REQUEST_URL');
    assert.doesNotMatch(JSON.stringify(failed.payload),/URIError|ERR_INVALID_URL|node:|server\.mjs|\/Users\//);
    const ready=response();await handleRequest({method:'GET',url:'/api/status',headers:{host:'guangjian.example'}},ready);
    assert.equal(ready.status,200);
  }
});

test('a request error after headers closes its own response without writing a second header',async()=>{
  const failed=response();failed.headersSent=true;failed.destroy=()=>{failed.destroyed=true;};
  await handleRequest({method:'GET',url:'/%E0%A4%A',headers:{host:'guangjian.example'}},failed);
  assert.equal(failed.destroyed,true);assert.equal(failed.status,undefined);
});
