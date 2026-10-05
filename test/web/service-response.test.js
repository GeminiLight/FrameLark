import test from 'node:test';
import assert from 'node:assert/strict';
import {readServiceJSON,requestFailure} from '../../apps/studio/public/service-response.js';
test('session, oversized uploads and timeouts retain actionable failure reasons',async()=>{
  for(const [status,code] of [[401,'SESSION_REQUIRED'],[403,'SESSION_REQUIRED'],[413,'REQUEST_TOO_LARGE'],[504,'MODEL_TIMEOUT']]){
    await assert.rejects(readServiceJSON(new Response('{"error":"opaque"}',{status})),e=>e.code===code&&e.visionFailure.message.includes('保留'));
  }
  const controller=new AbortController();controller.abort('timeout');assert.equal(requestFailure(new Error('aborted'),controller.signal).code,'MODEL_TIMEOUT');
});
test('HTML login redirects cannot masquerade as model feedback; structured provider errors survive',async()=>{
  await assert.rejects(readServiceJSON({status:200,redirected:true,url:'https://vercel.com/sso-api',json:async()=>{throw Error('HTML');}}),{code:'SESSION_REQUIRED'});
  const error={error:{code:'INVALID_MODEL_RESPONSE',message:'缺少依据',retryable:true}};
  assert.deepEqual(await readServiceJSON(new Response(JSON.stringify(error),{status:502})),error);
  await assert.rejects(readServiceJSON(new Response('<html>unavailable</html>',{status:502})),{code:'SERVICE_RESPONSE_UNAVAILABLE'});
});
