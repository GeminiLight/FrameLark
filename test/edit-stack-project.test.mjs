import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {initProject,loadProject,createCandidate,acceptCandidate,selectCandidateItems,discardCandidate,changeGuards,projectDocument,currentVersion} from '../skills/photo-retouch/scripts/project.mjs';
import {renderFrame,exportPhoto} from '../skills/photo-retouch/scripts/render.mjs';
import {exportExchange,importExchange} from '../skills/photo-retouch/scripts/exchange.mjs';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {snapshotFromProject,workspacePatch} from '../apps/studio/public/project-snapshot.js';
import {documentHash} from '../apps/studio/public/edit-stack/identity.js';
import {createHash} from 'node:crypto';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'framelark-document-'));t.after(()=>rm(root,{recursive:true,force:true}));const pixels=Buffer.alloc(128*96*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=pixels[i+1]=pixels[i+2]=70;pixels[i+3]=255;}for(let y=5;y<25;y++)for(let x=5;x<25;x++){const at=(y*128+x)*4;pixels[at]=pixels[at+1]=pixels[at+2]=240;}const bytes=await sharp(pixels,{raw:{width:128,height:96,channels:4}}).png().toBuffer(),image=join(root,'image.png'),folder=join(root,'project');await writeFile(image,bytes);await initProject(image,folder);return {folder,bytes};}
function proposal(p,commands,requestId='request'){const base=projectDocument(p);return {revision:p.revision,baseVersion:p.currentId,requestId,name:'Editable trial',documentProposal:{baseRevision:base.revision,baseHash:documentHash(base),requestId,items:[{id:'item',title:'亮度',commands}]}};}
const add={type:'AddStep',step:{id:'light',title:'暗处轻抬',tool:'exposure',toolVersion:2,parameters:{ev:.6}}};
test('a native preview receipt binds pixels to the exact document and selection',async t=>{
 const {folder}=await fixture(t),root=await mkdtemp(join(tmpdir(),'framelark-receipt-')),bridge=new ProjectBridge({root});t.after(async()=>{bridge.close();await rm(root,{recursive:true,force:true});});
 const view=await bridge.register(folder),p=await loadProject(folder),made=await bridge.proposeDocument(view.id,{revision:view.revision,baseVersion:view.currentId,proposal:proposal(p,[add]).documentProposal}),candidate=made.candidates.find(c=>c.id===made.candidateId);
 const packet=await bridge.previewPacket(view.id,candidate.id,made.revision);
 assert.equal(packet.headers['X-Document-Hash'],documentHash(candidate.document));assert.equal(packet.headers['X-Selection-Hash'],candidate.selectionHash);assert.equal(packet.headers['X-Version-Id'],candidate.id);assert.equal(packet.headers['X-Project-Revision'],String(made.revision));assert.equal(packet.headers['X-Png-Hash'],createHash('sha256').update(packet.bytes).digest('hex'));assert.match(packet.headers['X-Frame-Spec'],/^[a-f0-9]{64}$/);
 await bridge.candidate(view.id,'discard',{id:candidate.id,revision:made.revision});await assert.rejects(bridge.previewPacket(view.id,candidate.id,made.revision),{code:'STALE_REVISION'});
});
async function accept(folder,made){return acceptCandidate(folder,{id:made.candidate.id,revision:made.project.revision,selectionHash:made.candidate.selectionHash});}
test('schema 2 read is byte-preserving; first stack write backs it up and leaves original versions unchanged',async t=>{
 const {folder,bytes}=await fixture(t),file=join(folder,'project.json'),before=await readFile(file),old=JSON.parse(before),p=await loadProject(folder),baseline=await renderFrame(folder);assert.deepEqual(await readFile(file),before);
 const made=await createCandidate(folder,proposal(p,[add]));assert.equal(made.project.schema,3);assert.deepEqual(await readFile(join(folder,'project.schema-2.backup.json')),before);assert.deepEqual(made.project.versions,old.versions);assert.equal(made.project.currentId,p.currentId);assert.equal((await renderFrame(folder)).pixelHash,baseline.pixelHash);
 await discardCandidate(folder,{id:made.candidate.id,revision:made.project.revision});assert.deepEqual(await readFile(join(folder,'source/original.bin')),bytes);
});
test('schema 1 upgrade retains the old raw state shape and a byte-exact backup',async t=>{
 const {folder}=await fixture(t),file=join(folder,'project.json'),raw=JSON.parse(await readFile(file));raw.schema=1;delete raw.versions[0].state.guards;delete raw.versions[0].state.textOverlays;await writeFile(file,JSON.stringify(raw));const before=await readFile(file),p=await loadProject(folder);
 const made=await createCandidate(folder,proposal(p,[add]));assert.deepEqual(await readFile(join(folder,'project.schema-1.backup.json')),before);assert.deepEqual(made.project.versions[0].state,raw.versions[0].state);const loaded=await loadProject(folder);assert.deepEqual(loaded.versions[0].state,raw.versions[0].state);assert.ok((await renderFrame(folder,made.candidate.id)).png.length);
});
test('accepted nodes remain editable after reopen and a partial selection recompiles from the same base',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder),made=await createCandidate(folder,proposal(p,[add]));await accept(folder,made);p=await loadProject(folder);const before=currentVersion(p),baseline=await renderFrame(folder);
 const base=projectDocument(p),plan={revision:p.revision,baseVersion:p.currentId,requestId:'next',documentProposal:{baseRevision:base.revision,baseHash:documentHash(base),items:[{id:'weaken',title:'弱一点',commands:[{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.2}}]},{id:'warm',title:'稍暖',commands:[{type:'AddStep',step:{id:'color',title:'色彩',tool:'color',toolVersion:2,parameters:{warmth:8}}}]}]}};
 made=await createCandidate(folder,plan);const selected=await selectCandidateItems(folder,{id:made.candidate.id,revision:made.project.revision,selectionHash:made.candidate.selectionHash,selectedItemIds:['weaken']});assert.equal(selected.candidate.recipe.steps.length,1);assert.equal(selected.candidate.recipe.steps[0].id,'light');assert.equal(selected.candidate.recipe.steps[0].parameters.ev,.2);
 await accept(folder,selected);p=await loadProject(folder);assert.equal(currentVersion(p).recipe.steps[0].parameters.ev,.2);assert.deepEqual(p.versions.find(v=>v.id===before.id).recipe,before.recipe);assert.notEqual((await renderFrame(folder)).pixelHash,baseline.pixelHash);
 const exported=await exportPhoto(folder,'current',{format:'png'});assert.equal(exported.pixelHash,(await renderFrame(folder,'current',{maxSide:8192})).pixelHash);
});
test('stale, unknown and legacy aggregate writes cannot replace an active document',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder);const first=proposal(p,[add]);let made=await createCandidate(folder,first);await accept(folder,made);p=await loadProject(folder);const file=await readFile(join(folder,'project.json'));
 await assert.rejects(createCandidate(folder,first),{code:'STALE_REVISION'});
 await assert.rejects(createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,settings:{exposure:.1}}),{code:'DOCUMENT_COMMAND_REQUIRED'});
 await assert.rejects(createCandidate(folder,proposal(p,[{type:'UpdateStepParameters',stepId:'missing',parameters:{ev:.1}}],'bad')),{code:'STEP_MISSING'});assert.deepEqual(await readFile(join(folder,'project.json')),file);
});
test('old locks block stack bypass; explicit unlocking preserves the recipe and allows later editing',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder),made=await createCandidate(folder,proposal(p,[add]));await accept(folder,made);p=await loadProject(folder);
 await changeGuards(folder,{revision:p.revision,operation:'lock',parameters:['exposure'],localIds:[]});p=await loadProject(folder);assert.ok(currentVersion(p).recipe);
 await assert.rejects(createCandidate(folder,proposal(p,[{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.2}}],'blocked')),{code:'LOCK_CONFLICT'});
 made=await changeGuards(folder,{revision:p.revision,operation:'unlock',parameterKeys:['exposure'],localIds:[],regionIds:[]});await accept(folder,made);p=await loadProject(folder);assert.equal(currentVersion(p).recipe.steps[0].id,'light');made=await createCandidate(folder,proposal(p,[{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.2}}],'unlocked'));await accept(folder,made);
});
test('final protected pixels retain their reference after later stack edits and preserve old reference identities',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder);await changeGuards(folder,{revision:p.revision,operation:'protect',rect:{x:.1,y:.1,width:.3,height:.3},coordinateSpace:'original',maskType:'rectangle',feather:0});p=await loadProject(folder);const reference=structuredClone(currentVersion(p).state.guards.regions[0]),before=await renderFrame(folder);
 let made=await createCandidate(folder,proposal(p,[add]));await accept(folder,made);const after=await renderFrame(folder);assert.deepEqual((await loadProject(folder)).versions.find(v=>v.id===p.currentId).state.guards.regions[0],reference);
 const at=(20*128+20)*4;assert.deepEqual(after.pixels.slice(at,at+4),before.pixels.slice(at,at+4));assert.notEqual(after.pixels[(70*128+70)*4],before.pixels[(70*128+70)*4]);
 p=await loadProject(folder);await changeGuards(folder,{revision:p.revision,operation:'protect',rect:{x:.6,y:.6,width:.2,height:.2},coordinateSpace:'original',maskType:'rectangle',feather:0});p=await loadProject(folder);assert.ok(currentVersion(p).state.guards.regions.at(-1).pipeline.includes('edit-stack'));
 made=await createCandidate(folder,proposal(p,[{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.1}}],'later'));await accept(folder,made);assert.ok((await renderFrame(folder)).png.length);
});
test('Web snapshot and named versions preserve recipes; legacy snapshots cannot silently erase them',async t=>{
 const {folder}=await fixture(t),root=await mkdtemp(join(tmpdir(),'framelark-view-')),bridge=new ProjectBridge({root});t.after(async()=>{bridge.close();await rm(root,{recursive:true,force:true});});let view=await bridge.register(folder);
 const p=await loadProject(folder),made=await bridge.proposeDocument(view.id,{revision:view.revision,baseVersion:view.currentId,proposal:proposal(p,[add]).documentProposal});view=await bridge.candidate(view.id,'accept',{id:made.candidateId,revision:made.revision,selectionHash:made.candidates.find(c=>c.id===made.candidateId).selectionHash});
 const snapshot=snapshotFromProject(view),beforeHash=documentHash(snapshot.editDocument);view=await bridge.save(view.id,{...workspacePatch(snapshot,{conversation:[{role:'user',text:'keep steps'}]}),revision:view.revision,baseVersion:view.currentId});assert.equal(documentHash(view.document),beforeHash);
 view=await bridge.edition(view.id,{revision:view.revision,baseVersion:view.currentId,name:'Editable version',patch:workspacePatch(snapshot)});assert.equal(view.versions.at(-1).document.steps[0].id,'light');
 const legacy=workspacePatch({...snapshot,editDocument:null});await assert.rejects(bridge.save(view.id,{...legacy,revision:view.revision,baseVersion:view.currentId}),{code:'DOCUMENT_COMMAND_REQUIRED'});
});
test('a named snapshot can copy an already accepted historical recipe while later editing continues',async t=>{
 const {folder}=await fixture(t),root=await mkdtemp(join(tmpdir(),'framelark-edition-')),bridge=new ProjectBridge({root});t.after(async()=>{bridge.close();await rm(root,{recursive:true,force:true});});let p=await loadProject(folder),made=await createCandidate(folder,proposal(p,[add]));await accept(folder,made);let view=await bridge.register(folder),snapshot=snapshotFromProject(view);
 p=await loadProject(folder);made=await createCandidate(folder,proposal(p,[{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.2}}],'later'));await accept(folder,made);view=await bridge.get(view.id);const currentId=view.currentId;
 view=await bridge.edition(view.id,{revision:view.revision,baseVersion:view.currentId,name:'导出时的版本',patch:workspacePatch(snapshot)});assert.equal(view.currentId,currentId);assert.equal(view.document.steps[0].parameters.ev,.2);assert.equal(view.versions.at(-1).document.steps[0].parameters.ev,.6);
 const invented=structuredClone(snapshot);invented.editDocument.steps[0].parameters.ev=.4;await assert.rejects(bridge.edition(view.id,{revision:view.revision,baseVersion:view.currentId,name:'任意覆盖',patch:workspacePatch(invented)}),{code:'DOCUMENT_COMMAND_REQUIRED'});
});
test('portable exchange carries editable documents and rejects mismatched sources before touching a destination',async t=>{
 const {folder,bytes}=await fixture(t);let p=await loadProject(folder),made=await createCandidate(folder,proposal(p,[add]));await accept(folder,made);p=await loadProject(folder);const file=join(folder,'export.frameyn.json');await exportExchange(folder,file);const pack=JSON.parse(await readFile(file));assert.equal(pack.schema,'framelark-photo-exchange/2');
 const root=await mkdtemp(join(tmpdir(),'framelark-exchange-'));t.after(()=>rm(root,{recursive:true,force:true}));const imported=await importExchange(join(root,'new'),pack);assert.equal(currentVersion(imported.project).recipe.steps[0].id,'light');assert.equal((await renderFrame(imported.folder)).pixelHash,(await renderFrame(folder)).pixelHash);assert.deepEqual(await readFile(join(imported.folder,'source/original.bin')),bytes);
 const bad=structuredClone(pack);bad.versions.at(-1).recipe.source.contentHash='0'.repeat(64);await assert.rejects(importExchange(join(root,'bad'),bad),/原片/);
});
