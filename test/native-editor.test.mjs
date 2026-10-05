import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {handleProjectRoutes} from '../apps/studio/server/projects/routes.mjs';
import {configureWorkflow} from '../skills/photo-retouch/scripts/workflow.mjs';
import {changeGuards,loadProject} from '../skills/photo-retouch/scripts/project.mjs';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'frameyn-native-editor-')),bridge=new ProjectBridge({root});
  const bytes=await sharp({create:{width:128,height:96,channels:4,background:'#657884'}}).png().toBuffer(),data=await bridge.create(bytes,'sample.png');
  const readBody=async(req,limit)=>{let result=Buffer.alloc(0);for await(const chunk of req){result=Buffer.concat([result,chunk]);if(result.length>limit)throw Error('too large');}return result;};
  const server=http.createServer(async(req,res)=>{if(!await handleProjectRoutes(req,res,new URL(req.url,'http://localhost'),{bridge,readBody,allowed:()=>true,cloud:false})){res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));bridge.close();await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/projects/${data.id}/editor/`;
  const post=async(operation,value)=>fetch(base+'api/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
  return {bridge,data,base,post};
}

test('the full studio serves a reviewed editor on the same origin without weakening snapshot guards',async t=>{
  const {bridge,data,base,post}=await fixture(t);
  await configureWorkflow(data.path,{revision:data.revision,mode:'reviewed'});
  assert.equal((await bridge.get(data.id)).supported,false);
  const html=await fetch(base);assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.match(await html.text(),/src="\.\/app.js"/);
  for(const asset of ['app.js','style.css','engine/photo-geometry.js','engine/crop-utils.js'])assert.equal((await fetch(base+asset)).status,200,asset);
  let p=await(await fetch(base+'api/project')).json();assert.equal(p.workflowStatus.mode,'reviewed');
  const saved=await post('note',{revision:p.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'完整工作台里的新批注'});assert.equal(saved.status,200);
  p=await(await fetch(base+'api/project')).json();assert.equal(p.notes[0].note,'完整工作台里的新批注');
  const preview=await fetch(base+`api/image?version=current&revision=${p.revision}&size=512`);assert.equal(preview.status,200);assert.equal(preview.headers.get('x-project-revision'),String(p.revision));
  const candidate=await post('candidate',{revision:p.revision,baseVersion:p.currentId,name:'跳过诊断',settings:{exposure:.1}});
  assert.equal(candidate.status,400);assert.equal((await candidate.json()).error.code,'DIAGNOSIS_REQUIRED');
  assert.equal((await loadProject(data.path)).workflow.mode,'reviewed');
});

test('protected projects render in the integrated editor and reject edits against a lock',async t=>{
  const {data,base,post}=await fixture(t);
  await changeGuards(data.path,{revision:data.revision,operation:'lock',parameters:['exposure']});
  const p=await(await fetch(base+'api/project')).json();assert.equal(p.versions.at(-1).state.guards.parameters[0].key,'exposure');
  const result=await post('candidate',{revision:p.revision,baseVersion:p.currentId,name:'不能越过保护',settings:{exposure:.4}});
  assert.equal(result.status,400);assert.equal((await result.json()).error.code,'LOCK_CONFLICT');
  assert.equal((await(await fetch(base+'api/image?version=current')).arrayBuffer()).byteLength>0,true);
  assert.equal((await fetch(base+'../../../../etc/passwd')).status,404);
});
