import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {initProject,loadProject,createCandidate,acceptCandidate,saveResultAudit,setIntent,saveNote,changeGuards,saveFeedback} from '../skills/photo-retouch/scripts/project.mjs';
import {configureWorkflow,recordDiagnosis,prepareReview,rebuildEdits,editSources} from '../skills/photo-retouch/scripts/workflow.mjs';
import {workflowStatus} from '../skills/photo-retouch/scripts/workflow-state.mjs';
import {previewPhoto,renderFrame} from '../skills/photo-retouch/scripts/render.mjs';
import {initProfile,learnProfile,inspectProfile,editProfile} from '../skills/photo-retouch/scripts/profile.mjs';
import {probeControl} from '../skills/photo-retouch/scripts/probe.mjs';
import {exportExchange,importExchange} from '../skills/photo-retouch/scripts/exchange.mjs';
import {exchangeSnapshot,validateExchange,restoreWebExchange} from '../public/project-exchange.js';
import {renderPhotoPixels} from '../public/photo-rendering.js';
import {combineSettings} from '../public/editor-engine.js';
import {presetById} from '../public/presets.js';
import {runCLI} from '../skills/photo-retouch/scripts/cli.mjs';
async function fixture(t,name='portrait.png'){const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-flow-'));t.after(()=>rm(root,{recursive:true,force:true}));const folder=path.join(root,'photo');await initProject(fileURLToPath(new URL('./web/fixtures/quality/'+name,import.meta.url)),folder,{intent:'肤色真实，保留光线'});return {root,folder};}
const finding={id:'skin',dimension:'color',area:'脸部',rect:{x:.3,y:.1,width:.3,height:.4},observation:'肤色需要与环境光协调',impact:'影响真实感',action:'轻调白平衡',check:'脸与衣服的关系',tradeoff:'不漂白肤色',priority:'blocking',confidence:'medium'};
async function diagnose(folder,findings=[finding]){const p=await loadProject(folder),v=await previewPhoto(folder,'current',{maxSide:800});return recordDiagnosis(folder,{revision:p.revision,versionId:p.currentId,maxSide:800,pixelHash:v.pixelHash,frameSpecHash:v.frameSpecHash,actorId:'editor-a',goal:'肤色真实',preserve:['暖光与皮肤质感'],checked:['完整画面、脸部与领口'],findings});}
async function candidate(folder,extra={}){const p=await loadProject(folder);return createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,name:'自然试片',settings:{warmth:-5},...extra});}
async function audit(folder,c,extra={}){const p=await loadProject(folder),v=await previewPhoto(folder,c.id,{maxSide:800});return saveResultAudit(folder,{revision:p.revision,versionId:c.id,maxSide:800,pixelHash:v.pixelHash,frameSpecHash:v.frameSpecHash,selectionHash:v.selectionHash,decision:'ready',summary:'实际检查目标和边缘',checked:['整图、脸、领口'],strengths:['保留材质'],issues:[],...extra});}
test('reviewed delivery requires current diagnosis, addressed findings and the declared separate reviewer',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder);await configureWorkflow(folder,{revision:p.revision,mode:'reviewed',independent:true});
 await assert.rejects(candidate(folder),{code:'DIAGNOSIS_REQUIRED'});await diagnose(folder);const {candidate:c}=await candidate(folder);p=await loadProject(folder);
 const packet=await prepareReview(folder,{revision:p.revision,versionId:c.id,maxSide:800});
 assert.equal(packet.packet.creatorId,'editor-a');assert.equal(packet.packet.previousAudit,undefined);assert.equal(packet.packet.parameters,undefined);
 await assert.rejects(audit(folder,c,{reviewer:{id:'editor-a',mode:'independent',packetId:packet.packet.id}}),{code:'REVIEWER_NOT_INDEPENDENT'});
 await audit(folder,c,{reviewer:{id:'editor-b',mode:'independent',packetId:packet.packet.id}});p=await loadProject(folder);
 assert.equal(workflowStatus(p).stage,'review');
 await assert.rejects(acceptCandidate(folder,{id:c.id,revision:p.revision,acceptedBy:'agent'}),{code:'DIAGNOSIS_UNRESOLVED'});
 const reviewed=await audit(folder,c,{reviewer:{id:'editor-b',mode:'independent',packetId:packet.packet.id},resolutions:[{findingId:'skin',status:'resolved',evidence:'脸部综合色调与衣服关系自然'}]});
 const result=await acceptCandidate(folder,{id:c.id,revision:reviewed.project.revision,acceptedBy:'agent'});assert.equal(result.project.choices.length,0);assert.equal(workflowStatus(result.project).stage,'delivered');
});
test('changed intention invalidates diagnosis and review packets; empty findings preserve the photo',async t=>{
 const {folder}=await fixture(t);const d=await diagnose(folder,[]);assert.equal(workflowStatus(d.project).stage,'preserve');
 const {candidate:c}=await candidate(folder);let p=await loadProject(folder);const packet=await prepareReview(folder,{revision:p.revision,versionId:c.id,maxSide:800});
 assert.equal(workflowStatus(await loadProject(folder)).stage,'review');
 await setIntent(folder,{intent:'浓烈胶片色'});assert.equal(workflowStatus(await loadProject(folder)).stage,'diagnosis');
 await assert.rejects(audit(folder,c,{reviewer:{id:'editor-b',mode:'independent',packetId:packet.packet.id}}),{code:'STALE_CANDIDATE'});
});
test('explicit local rebuild removes inherited colors, retains other locals/crop and obeys parameter locks',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder);
 const a=await saveNote(folder,{revision:p.revision,rect:{x:.2,y:.2,width:.3,height:.3},note:'脸'}),b=await saveNote(folder,{revision:a.project.revision,rect:{x:.6,y:.6,width:.2,height:.2},note:'衣服'});
 const r=await candidate(folder,{locals:[{annotationId:a.note.id,settings:{warmth:30,exposure:.3}},{annotationId:b.note.id,settings:{contrast:8}}],crop:{x:0,y:0,width:.9,height:.9}});
 await acceptCandidate(folder,{id:r.candidate.id});p=await loadProject(folder);
 const rebuilt=await rebuildEdits(folder,{revision:p.revision,baseVersion:p.currentId,reset:{manual:false,style:false,localIds:[a.note.id]},locals:[{annotationId:a.note.id,settings:{exposure:.1}}]});
 const layer=rebuilt.candidate.state.locals.find(l=>l.id===a.note.id);assert.equal(layer.localSettings.warmth,0);assert.equal(layer.localSettings.exposure,.1);assert.equal(rebuilt.candidate.state.locals.find(l=>l.id===b.note.id).localSettings.contrast,8);assert.deepEqual(rebuilt.candidate.state.crop,p.versions.at(-1).state.crop);
 const sources=await editSources(folder,rebuilt.candidate.id);assert.equal(sources.locals.length,2);
 p=await loadProject(folder);await changeGuards(folder,{revision:p.revision,operation:'lock',parameters:['warmth'],localIds:[]});p=await loadProject(folder);
 await assert.rejects(rebuildEdits(folder,{revision:p.revision,baseVersion:p.currentId,reset:{manual:true,style:true,localIds:[]}}),e=>e.code.includes('LOCK')||e.code.includes('GUARD'));
});
test('portable preference evidence excludes Agent trials, supersedes accepted preferences on rejection and is removable',async t=>{
 const {folder,root}=await fixture(t),file=path.join(root,'taste.json');await initProfile(file);let r=await candidate(folder);await acceptCandidate(folder,{id:r.candidate.id,acceptedBy:'agent'});let p=await loadProject(folder);
 const input={revision:p.revision,versionId:p.currentId,subject:'portrait',lighting:'daylight',reason:'肤色自然'};
 await assert.rejects(learnProfile(folder,file,input),{code:'USER_PREFERENCE_REQUIRED'});
 await saveFeedback(folder,{revision:p.revision,versionId:p.currentId,verdict:'prefer',reason:'喜欢自然肤色'});p=await loadProject(folder);
 await learnProfile(folder,file,{...input,revision:p.revision});assert.equal((await inspectProfile(file,{subject:'portrait'})).matches.length,1);
 await saveFeedback(folder,{revision:p.revision,versionId:p.currentId,verdict:'reject',reason:'重新看觉得太黄'});p=await loadProject(folder);
 const learned=await learnProfile(folder,file,{...input,revision:p.revision,reason:'太黄'});assert.equal(learned.profile.entries.length,1);assert.equal(learned.entry.signal,'reject');
 await saveFeedback(folder,{revision:p.revision,versionId:p.currentId,verdict:'neutral',reason:'仅留作试片，不作为偏好'});p=await loadProject(folder);
 const withdrawn=await learnProfile(folder,file,{...input,revision:p.revision});assert.equal(withdrawn.removed,1);assert.equal(withdrawn.profile.entries.length,0);
 await saveFeedback(folder,{revision:p.revision,versionId:p.currentId,verdict:'prefer',reason:'明确喜欢这次肤色'});p=await loadProject(folder);
 const preferred=await learnProfile(folder,file,{...input,revision:p.revision});
 await editProfile(file,{id:preferred.entry.id,remove:true});assert.equal((await inspectProfile(file)).profile.entries.length,0);
});
test('project exchange round trips source, saved pixel effects and notes without creating preferences or replacing work',async t=>{
 const {folder,root}=await fixture(t);let p=await loadProject(folder);const note=await saveNote(folder,{revision:p.revision,rect:{x:.34,y:.1,width:.2,height:.3},note:'保留脸部'});
 const r=await candidate(folder,{locals:[{annotationId:note.note.id,settings:{exposure:.15},maskType:'radial',feather:.5}],style:{id:'daily-soft',amount:20}});
 await acceptCandidate(folder,{id:r.candidate.id});const before=await renderFrame(folder,'current',{maxSide:800}),file=path.join(root,'photo.frameyn.json');await exportExchange(folder,file);
 const pack=JSON.parse(await readFile(file,'utf8')),target=path.join(root,'imported');await importExchange(target,pack);
 const after=await renderFrame(target,'current',{maxSide:800});assert.equal(after.pixelHash,before.pixelHash);const imported=await loadProject(target);assert.equal(imported.notes[0].note,'保留脸部');assert.equal(imported.choices.length,0);
 await assert.rejects(importExchange(target,pack),{code:'PROJECT_EXISTS'});assert.equal((await renderFrame(target,'current',{maxSide:800})).pixelHash,before.pixelHash);
 const sourceBefore=await loadProject(folder),single=path.join(root,'single.frameyn.json');await exportExchange(folder,single,{version:'original'});
 const subset=JSON.parse(await readFile(single,'utf8'));assert.equal(subset.versions.length,1);assert.equal(subset.currentId,sourceBefore.versions[0].id);assert.deepEqual(await loadProject(folder),sourceBefore);
 const trial=await candidate(folder,{settings:{warmth:-9}});await assert.rejects(exportExchange(folder,path.join(root,'unaccepted.json'),{version:trial.candidate.id}),{code:'UNACCEPTED_EXPORT'});
 pack.source.data='damaged';await assert.rejects(importExchange(path.join(root,'broken'),pack),{code:'EXCHANGE_SOURCE_MISMATCH'});
});
test('web snapshots retain local compositing order and reject unsupported brush/text/guards without approximation',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder);const a=await saveNote(folder,{revision:p.revision,rect:{x:.3,y:.1,width:.2,height:.2},note:'1'}),b=await saveNote(folder,{revision:a.project.revision,rect:{x:.3,y:.1,width:.2,height:.2},note:'2'});
 const r=await candidate(folder,{locals:[{annotationId:b.note.id,settings:{exposure:.2}},{annotationId:a.note.id,settings:{warmth:-8}}]});
 const snap=exchangeSnapshot(r.candidate,p.notes);
 const original=await renderFrame(folder,'original',{maxSide:800}),expected=await renderFrame(folder,r.candidate.id,{maxSide:800});
 const pixels=renderPhotoPixels({pixels:original.pixels,width:original.width,height:original.height,settings:combineSettings({settings:snap.manual},{settings:presetById(snap.presetId)?.adjustments,amount:snap.presetAmount/100}),annotations:snap.annotations,crop:snap.crop,frame:{fullWidth:p.source.width,fullHeight:p.source.height,sourceRect:original.sourceRect,angle:0}});assert.deepEqual(Buffer.from(pixels),Buffer.from(expected.pixels));assert.deepEqual(snap.annotations.map(n=>n.id),[b.note.id,a.note.id]);
 for(const patch of [{textOverlays:[{text:'字'}]},{guards:{regions:[{}]}},{locals:[{...r.candidate.state.locals[0],maskType:'brush'}]}])assert.throws(()=>exchangeSnapshot({state:{...r.candidate.state,...patch}},[]));
});
test('parameter strips preserve project history and reproduce the unchanged target; CLI exposes workflow and exchange operations',async t=>{
 const {folder,root}=await fixture(t),p=await loadProject(folder),base=await renderFrame(folder,'current',{maxSide:800});
 const report=await probeControl(folder,{revision:p.revision,versionId:p.currentId,parameter:'warmth',values:[0,-20,20],maxSide:800});
 assert.equal(report.frames[0].pixelHash,base.pixelHash);assert.notEqual(report.frames[1].pixelHash,base.pixelHash);assert.deepEqual(await loadProject(folder),p);
 const status=await runCLI(['workflow','--project',folder]);assert.equal(status.workflow.stage,'diagnosis');
 const output=path.join(root,'exchange.json');await runCLI(['project-export','--project',folder,'--output',output]);const imported=await runCLI(['project-import','--project',path.join(root,'from-cli'),'--input',output]);assert.ok(imported.preview.path);
});


test('web import initializes a truthful basic review and retains named current versions before activation',async t=>{
 const {folder,root}=await fixture(t),file=path.join(root,'photo.frameyn.json');const r=await candidate(folder);await acceptCandidate(folder,{id:r.candidate.id,acceptedBy:'agent'});await exportExchange(folder,file);
 const pack=validateExchange(JSON.parse(await readFile(file,'utf8'))),restored=restoreWebExchange(pack,{recommendations:[],summary:'基础测光'});
 assert.deepEqual(restored.analysis.recommendations,[]);assert.deepEqual(restored.originalRecommendations,[]);assert.equal(restored.analysisSource,'local');assert.equal(restored.analysisProvenance,null);assert.equal(restored.versions.at(-1).label,'自然试片');
 assert.throws(()=>restoreWebExchange(pack,null));
});


test('independent review cannot reuse a packet for a different rendered frame, and new comments require fresh diagnosis',async t=>{
 const {folder}=await fixture(t,'night.png');await diagnose(folder);const {candidate:c}=await candidate(folder);let p=await loadProject(folder);const {packet}=await prepareReview(folder,{revision:p.revision,versionId:c.id,maxSide:800});
 const other=await previewPhoto(folder,c.id,{maxSide:513});
 await assert.rejects(audit(folder,c,{maxSide:513,pixelHash:other.pixelHash,frameSpecHash:other.frameSpecHash,reviewer:{id:'editor-b',mode:'independent',packetId:packet.id}}),{code:'REVIEW_PACKET_STALE'});
 p=await loadProject(folder);await saveNote(folder,{revision:p.revision,rect:{x:.2,y:.2,width:.3,height:.3},note:'最新批注'});assert.equal(workflowStatus(await loadProject(folder)).stage,'diagnosis');
});
