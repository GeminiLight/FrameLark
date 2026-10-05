import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVisionService} from '../../apps/studio/server/ai/vision.mjs';
import {defaultModelTiers} from '../../apps/studio/public/model-routing.js';
const schema={type:'object',properties:{finding:{type:'string'}},required:['finding'],additionalProperties:false};
const payload={instructions:'Review',input:[{role:'user',content:[{type:'input_text',text:'Review this photo.'}]}],text:{format:{schema}}};

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

test('service routes each task using saved tiers and reports the actual model',async()=>{
 const root=await mkdtemp(join(tmpdir(),'frameyn-tiers-'));const calls=[];
 try{
  const codexRequest=async(p,o)=>{calls.push(o);return {model:o.model,threadId:'thread-test',output_text:JSON.stringify(p.text.format.name==='vision_connection_probe'?{shape:'circle',foreground:'red',background:'blue'}:{finding:'ok'})};};
  const vision=await createVisionService({root,env:{},codexRequest});
  await vision.connect({provider:'codex',tiers:defaultModelTiers(),remember:true});
  assert.equal(calls.at(-1).model,'gpt-6.1-sol');assert.equal(calls.at(-1).effort,'low');
  const normal=await vision.request(payload,{sessionKey:'photo-a'});assert.equal(normal.provenance.tier,'standard');assert.equal(normal.provenance.threadId,'thread-test');
  const deep=await vision.request(payload,{tier:'deep',sessionKey:'photo-a'});assert.equal(deep.provenance.model,'gpt-6-astra');assert.equal(calls.at(-1).sessionKey,'photo-a');
  const retry=await vision.request(payload);assert.equal(retry.provenance.model,'gpt-6.1-sol');
 }finally{await rm(root,{recursive:true,force:true});}
});
