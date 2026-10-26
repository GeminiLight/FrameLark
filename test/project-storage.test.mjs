import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import http from 'node:http';
import {initProject,loadProject,projectDocument,saveWorkspaceSnapshot,createCandidate,acceptCandidate,currentVersion} from '../skills/photo-retouch/scripts/project.mjs';
import {applyCommands} from '../apps/studio/public/edit-stack/commands.js';
import {documentHash} from '../apps/studio/public/edit-stack/identity.js';
import {workspacePatch,snapshotFromProject} from '../apps/studio/public/project-snapshot.js';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {handleProjectRoutes} from '../apps/studio/server/projects/routes.mjs';
import {readBody} from '../apps/studio/server/app.mjs';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'framelark-storage-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const image=join(root,'source.png'),folder=join(root,'project');await writeFile(image,await sharp({create:{width:16,height:16,channels:4,background:'#789abc'}}).png().toBuffer());await initProject(image,folder);
 const p=await loadProject(folder),before=await readFile(join(folder,'project.json')),points=Array.from({length:600},(_,i)=>({x:(i+1)/601,y:((i*137)%600+1)/601})),commands=[];
 for(let i=0;i<8;i++)commands.push({type:'AddStep',step:{id:'brush'+i,title:'范围 '+i,tool:'exposure',toolVersion:2,parameters:{ev:.1}}},{type:'ReplaceStepMask',stepId:'brush'+i,mask:{expression:{kind:'drawn',mask:{shape:'brush',rect:{x:0,y:0,width:1,height:1},feather:.3,exclude:[],points,radius:.03}},reference:{kind:'live-input'}}});
 const document=applyCommands(projectDocument(p),commands).next,patch=workspacePatch({editDocument:document,manual:currentVersion(p).state.settings,active:[],advisorLayers:[],recommendations:[],annotations:[],crop:null,presetId:null});
 await saveWorkspaceSnapshot(folder,{...patch,revision:p.revision,baseVersion:p.currentId});return {root,folder,image,document,before};
}
test('a valid large recipe can be saved as a named version through the real HTTP adapter',async t=>{
 const f=await fixture(t),bridge=new ProjectBridge({root:f.root});t.after(()=>bridge.close());const view=await bridge.register(f.folder);
 const server=http.createServer((req,res)=>handleProjectRoutes(req,res,new URL(req.url,'http://localhost'),{bridge,readBody,allowed:()=>true,cloud:false}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const request={revision:view.revision,baseVersion:view.currentId,name:'中文命名版本',patch:workspacePatch(snapshotFromProject(view))},body=JSON.stringify(request);assert.ok(Buffer.byteLength(body)>200000);
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${view.id}/versions`,{method:'POST',body,headers:{'Content-Type':'application/json'}});assert.equal(response.status,200);
 assert.equal((await response.json()).versions.at(-1).name,request.name);assert.equal(documentHash(currentVersion(await loadProject(f.folder)).recipe),documentHash(f.document));
});
test('large document history reuses resources and remains editable with every saved version intact',async t=>{
 const f=await fixture(t),historical=structuredClone((await loadProject(f.folder)).versions),source=await readFile(f.image);
 for(let i=0;i<12;i++){
   const p=await loadProject(f.folder),base=projectDocument(p),requestId='edit-'+i;
   const made=await createCandidate(f.folder,{revision:p.revision,baseVersion:p.currentId,requestId,documentProposal:{baseRevision:base.revision,baseHash:documentHash(base),requestId,items:[{id:'opacity',title:'强度',commands:[{type:'SetStepOpacity',stepId:'brush0',opacity:.9-i*.01}]}]}});
   await acceptCandidate(f.folder,{id:made.candidate.id,revision:made.project.revision,selectionHash:made.candidate.selectionHash});
 }
 const p=await loadProject(f.folder);assert.equal(p.versions.length,historical.length+12);assert.equal(p.choices.length,12);assert.deepEqual(p.versions.slice(0,historical.length),historical);assert.deepEqual(await readFile(join(f.folder,'source/original.bin')),source);
 assert.ok((await stat(join(f.folder,'project.json'))).size<1024*1024,'saved history stores shared brush resources once');
});

test('storage upgrade preserves exact backups, independent history and relocated project pixels',async t=>{
 const {encodeProjectRecord,decodeProjectRecord,writeProjectRecord}=await import('../skills/photo-retouch/scripts/project-repository.mjs');
 const {previewPhoto}=await import('../skills/photo-retouch/scripts/render.mjs');const {rename,readdir}=await import('node:fs/promises');
 const f=await fixture(t),p=await loadProject(f.folder),raw=await readFile(join(f.folder,'project.json'));
 const priorSchema=JSON.parse(f.before).schema;assert.deepEqual(await readFile(join(f.folder,`project.schema-${priorSchema}.backup.json`)),f.before);
 const record=encodeProjectRecord(p);assert.deepEqual(decodeProjectRecord(record),p);
 const copies=encodeProjectRecord({...p,versions:[p.versions.at(-1),p.versions.at(-1)]}),decoded=decodeProjectRecord(copies);
 decoded.versions[0].recipe.masks[0].expression.mask.points[0].x=0;
 assert.notEqual(decoded.versions[0].recipe.masks[0].expression.mask.points[0].x,decoded.versions[1].recipe.masks[0].expression.mask.points[0].x);
 const first=await previewPhoto(f.folder,'current',{maxSide:512}),moved=join(f.root,'relocated');await rename(f.folder,moved);
 const second=await previewPhoto(moved,'current',{maxSide:512});assert.equal(second.pixelHash,first.pixelHash);assert.equal(second.frameSpecHash,first.frameSpecHash);
 await assert.rejects(writeProjectRecord(moved,{...p,intent:'x'.repeat(5*1024*1024)}),{code:'PROJECT_TOO_LARGE'});
 assert.deepEqual(await readFile(join(moved,'project.json')),raw);assert.equal((await readdir(moved)).some(f=>f.startsWith('.project-')),false);
});
test('normalized storage rejects changed resources, missing references and excessive expansion',async()=>{
 const {encodeProjectRecord,decodeProjectRecord}=await import('../skills/photo-retouch/scripts/project-repository.mjs');
 const document={masks:[{id:'a',version:1,expression:{kind:'constant',value:1}}],data:'x'.repeat(950000)},record=encodeProjectRecord({schema:3,versions:[{recipe:document}],candidates:[],choices:[]});
 const corrupt=structuredClone(record);Object.values(corrupt.masks)[0].version=2;assert.throws(()=>decodeProjectRecord(corrupt),{code:'PROJECT_STORAGE_INVALID'});
 const missing=structuredClone(record);missing.masks={};assert.throws(()=>decodeProjectRecord(missing),{code:'PROJECT_STORAGE_INVALID'});
 const lost=structuredClone(record);lost.documents={};assert.throws(()=>decodeProjectRecord(lost),{code:'PROJECT_STORAGE_INVALID'});
 record.project.versions=Array.from({length:145},()=>structuredClone(record.project.versions[0]));assert.throws(()=>decodeProjectRecord(record),{code:'PROJECT_TOO_LARGE'});
});
test('over-limit HTTP snapshots fail explicitly without altering the saved project',async t=>{
 const f=await fixture(t),bridge=new ProjectBridge({root:f.root});t.after(()=>bridge.close());const view=await bridge.register(f.folder),before=await readFile(join(f.folder,'project.json'));
 const server=http.createServer((req,res)=>handleProjectRoutes(req,res,new URL(req.url,'http://localhost'),{bridge,readBody,allowed:()=>true,cloud:false}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${view.id}/versions`,{method:'POST',body:JSON.stringify({name:'x'.repeat(4*1024*1024)}),headers:{'Content-Type':'application/json'}});
 assert.equal(response.status,413);assert.equal((await response.json()).error.code,'PROJECT_REQUEST_TOO_LARGE');assert.deepEqual(await readFile(join(f.folder,'project.json')),before);
});
