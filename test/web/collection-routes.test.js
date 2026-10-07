import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';

async function route(path,{method='GET',cloud=false,allowed=true,value={}}={}){
  const module=await import('../../apps/studio/server/projects/collection-routes.mjs').catch(error=>{
    if(error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('collection-routes.mjs'))return {};throw error;
  });
  assert.equal(typeof module.handleCollectionRoutes,'function','The collection adapter must expose local routes');
  const calls=[],collections={list:async()=>[{id:'set-1'}],register:async path=>{calls.push(path);return {id:'set-1'};},get:async()=>({id:'set-1'})};
  const request=Readable.from([Buffer.from(JSON.stringify(value))]);request.method=method;
  const response=new EventEmitter();response.destroyed=false;response.writableEnded=false;
  response.writeHead=(status,headers)=>{response.status=status;response.headers=headers;};
  response.end=body=>{response.body=body;response.writableEnded=true;};
  const handled=await module.handleCollectionRoutes(request,response,new URL(path,'http://localhost'),{
    collections,readBody:async r=>{const parts=[];for await(const part of r)parts.push(part);return Buffer.concat(parts);},allowed:()=>allowed,cloud
  });
  return {handled,response,calls};
}
test('shared collection registration uses the explicit chosen directory',async()=>{
  const result=await route('/api/collections/register',{method:'POST',value:{path:'/chosen/collection'}});
  assert.equal(result.handled,true);assert.equal(result.response.status,200);assert.deepEqual(result.calls,['/chosen/collection']);
});
test('collection routes reject remote origins and cloud file access before reading folders',async()=>{
  for(const options of [{cloud:true},{allowed:false}]){
    const result=await route('/api/collections/register',{...options,method:'POST',value:{path:'/private'}});
    assert.equal(result.response.status,403);assert.deepEqual(result.calls,[]);
  }
});
test('unrelated routes are left to their existing application handlers',async()=>{
  assert.equal((await route('/api/projects')).handled,false);
});
