import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {initProject,loadProject,createCandidate,acceptCandidate,saveFeedback,publicProject,setIntent} from '../skills/guangjian-retouch/scripts/project.mjs';
import {renderLookSheet} from '../skills/guangjian-retouch/scripts/look-sheet.mjs';
import {renderFrame} from '../skills/guangjian-retouch/scripts/render.mjs';
import {runCLI} from '../skills/guangjian-retouch/scripts/cli.mjs';
import {dispatchHostTool,hostToolContract} from '../skills/guangjian-retouch/scripts/tool-contract.mjs';
const sharp=createRequire(new URL('../skills/guangjian-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-looks-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'source.png');await sharp({create:{width:160,height:100,channels:4,background:'#7b9c84'}}).png().toFile(file);const folder=path.join(root,'photo');await initProject(file,folder);return folder;}
async function trial(folder,settings,extra={}){const p=await loadProject(folder);return createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,name:'试片',settings,...extra});}

test('look sheets pin one revision, preserve individual crops, and never accept or change editing history',async t=>{
 const folder=await fixture(t),a=await trial(folder,{warmth:15}),b=await trial(folder,{warmth:-15},{crop:{x:.1,y:.1,width:.8,height:.7}}),p=await loadProject(folder),bytes=await readFile(path.join(folder,'project.json'));
 const sheet=await renderLookSheet(folder,{revision:p.revision,versions:['original',a.candidate.id,b.candidate.id],mode:'composition'});
 assert.equal(sheet.previews.length,3);assert.equal(sheet.complete,true);assert.notDeepEqual(sheet.previews[0].frameSpec.sourceRect,sheet.previews[2].frameSpec.sourceRect);
 assert.equal(sheet.previews[1].pixelHash,(await renderFrame(folder,a.candidate.id)).pixelHash);
 assert.equal(sheet.previews[2].retainedArea,.56);assert.ok((await sharp(sheet.path).metadata()).width>0);
 assert.deepEqual(await readFile(path.join(folder,'project.json')),bytes);
});
test('color comparison shares the reference crop and actual output grid',async t=>{
 const folder=await fixture(t),a=await trial(folder,{greenHue:12},{crop:{x:.1,y:.1,width:.8,height:.7}}),p=await loadProject(folder);
 const sheet=await renderLookSheet(folder,{revision:p.revision,versions:['original',a.candidate.id],mode:'color',referenceVersion:a.candidate.id});
 assert.deepEqual(sheet.previews[0].frameSpec,sheet.previews[1].frameSpec);assert.notEqual(sheet.previews[0].pixelHash,sheet.previews[1].pixelHash);
});
test('the host comparison tool is allowlisted and returns read-only pinned previews',async t=>{
 const folder=await fixture(t),a=await trial(folder,{warmth:12}),p=await loadProject(folder),bytes=await readFile(path.join(folder,'project.json'));
 assert.ok(hostToolContract().tools.some(t=>t.function.name==='frameyn_compare_looks'));
 const sheet=await dispatchHostTool(folder,{name:'frameyn_compare_looks',arguments:{revision:p.revision,versions:['original',a.candidate.id],mode:'color',referenceVersion:'original'}});assert.equal(sheet.complete,true);assert.deepEqual(await readFile(path.join(folder,'project.json')),bytes);
});
test('stale revisions, stale candidates, duplicate aliases, unknown versions and unbounded sheets are rejected',async t=>{
 const folder=await fixture(t),a=await trial(folder,{contrast:12}),p=await loadProject(folder);
 await assert.rejects(renderLookSheet(folder,{revision:p.revision-1,versions:['original',a.candidate.id]}),{code:'STALE_REVISION'});
 for(const versions of [['original','current'],['original','missing'],Array(7).fill('original')])await assert.rejects(renderLookSheet(folder,{revision:p.revision,versions}));
 await setIntent(folder,{intent:'新的目标'});const next=await loadProject(folder);
 await assert.rejects(renderLookSheet(folder,{revision:next.revision,versions:['original',a.candidate.id]}),{code:'STALE_CANDIDATE'});
});
test('failed previews are visibly incomplete and preserve the project',async t=>{
 const folder=await fixture(t),a=await trial(folder,{contrast:12}),p=await loadProject(folder);await writeFile(path.join(folder,'source','original.bin'),'changed');
 const sheet=await renderLookSheet(folder,{revision:p.revision,versions:['original',a.candidate.id]});assert.equal(sheet.complete,false);assert.ok(sheet.previews.every(v=>v.error.code==='SOURCE_CHANGED'));assert.equal((await loadProject(folder)).revision,p.revision);
});
test('Agent trial saves can export without being counted as user preferences',async t=>{
 const folder=await fixture(t),a=await trial(folder,{warmth:12});
 await assert.rejects(acceptCandidate(folder,{id:a.candidate.id,revision:a.project.revision,acceptedBy:null}),{code:'ACCEPT_SOURCE'});
 const saved=await acceptCandidate(folder,{id:a.candidate.id,revision:a.project.revision,acceptedBy:'agent'});assert.equal(saved.version.acceptedBy,'agent');assert.equal(saved.project.choices.length,0);
 const b=await trial(folder,{warmth:4});const user=await acceptCandidate(folder,{id:b.candidate.id,revision:b.project.revision});assert.equal(user.version.acceptedBy,'user');assert.equal(publicProject(user.project).preferenceChoices.length,1);
 const preferred=await saveFeedback(folder,{revision:user.project.revision,versionId:a.candidate.id,verdict:'prefer',reason:'用户比较后明确更喜欢之前的暖色试片'});assert.equal(publicProject(preferred.project).preferenceChoices.length,2);
});
test('explicit rejection removes a version from preference evidence without deleting its history or pixels',async t=>{
 const folder=await fixture(t),a=await trial(folder,{warmth:12}),saved=await acceptCandidate(folder,{id:a.candidate.id,revision:a.project.revision});const before=await renderFrame(folder);
 const rejected=await saveFeedback(folder,{revision:saved.project.revision,versionId:a.candidate.id,verdict:'reject',reason:'绿色太脏，构图裁得过多'});
 assert.equal(rejected.project.choices.length,1);assert.equal(publicProject(rejected.project).preferenceChoices.length,0);assert.equal((await renderFrame(folder)).pixelHash,before.pixelHash);
 const neutral=await saveFeedback(folder,{revision:rejected.project.revision,versionId:a.candidate.id,verdict:'neutral',reason:'只作为试片保留'});assert.equal(publicProject(neutral.project).preferenceChoices.length,0);
 const prefer=await saveFeedback(folder,{revision:neutral.project.revision,versionId:a.candidate.id,verdict:'prefer',reason:'比较后更喜欢这一版'});assert.equal(publicProject(prefer.project).preferenceChoices.length,1);
});
test('feedback validates the saved version, verdict and current revision; CLI forwards trial provenance',async t=>{
 const folder=await fixture(t),p=await loadProject(folder);
 await assert.rejects(saveFeedback(folder,{revision:p.revision,versionId:'missing',verdict:'reject',reason:'不喜欢'}),{code:'VERSION_NOT_FOUND'});
 await assert.rejects(saveFeedback(folder,{revision:p.revision,versionId:p.currentId,verdict:'bad',reason:'不喜欢'}),{code:'FEEDBACK_INVALID'});
 await assert.rejects(saveFeedback(folder,{revision:p.revision-1,versionId:p.currentId,verdict:'reject',reason:'不喜欢'}),{code:'STALE_REVISION'});
 const a=await trial(folder,{warmth:6});const saved=await runCLI(['accept','--project',folder,'--id',a.candidate.id,'--revision',String(a.project.revision),'--by','agent']);assert.equal(saved.version.acceptedBy,'agent');
 const sheetInput=path.join(folder,'sheet.json');await writeFile(sheetInput,JSON.stringify({revision:saved.project.revision,versions:['original','current']}));assert.equal((await runCLI(['look-sheet','--project',folder,'--input',sheetInput])).complete,true);
});
