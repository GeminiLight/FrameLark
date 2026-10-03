import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {initProject,loadProject,createCandidate,selectCandidateItems,acceptCandidate,saveResultAudit,setIntent} from '../skills/guangjian-retouch/scripts/project.mjs';
import {previewPhoto,renderFrame} from '../skills/guangjian-retouch/scripts/render.mjs';
import {runCLI} from '../skills/guangjian-retouch/scripts/cli.mjs';
const sharp=createRequire(new URL('../skills/guangjian-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-audit-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=path.join(root,'source.png');await sharp({create:{width:800,height:500,channels:4,background:'#84937b'}}).png().toFile(source);const folder=path.join(root,'photo');await initProject(source,folder);const p=await loadProject(folder);const r=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,items:[{id:'tone',title:'明暗',patch:{settings:{contrast:12}}},{id:'color',title:'色彩',patch:{settings:{warmth:8}}}]});return {folder,c:r.candidate};}
async function input(folder,c,extra={}){const p=await loadProject(folder),preview=await previewPhoto(folder,c.id,{maxSide:1400});return {revision:p.revision,versionId:c.id,maxSide:1400,pixelHash:preview.pixelHash,frameSpecHash:preview.frameSpecHash,selectionHash:preview.selectionHash,decision:'ready',summary:'当前目标下的光色关系成立，主体与边缘经过实际查看。',checked:['完整画面与高反差边缘'],strengths:['主体与环境有明暗分离'],issues:[],...extra};}
const issue={area:'天空',observation:'天光被压成灰块',nextAction:'降低天空曝光压缩后重新看图',severity:'blocking'};
test('optional delivery gate requires the latest ready audit of the exact candidate',async t=>{
 const {folder,c}=await fixture(t);let p=await loadProject(folder);
 const accept=()=>acceptCandidate(folder,{id:c.id,revision:p.revision,selectionHash:c.selectionHash,acceptedBy:'agent',requireAudit:true});
 await assert.rejects(accept(),{code:'RESULT_AUDIT_REQUIRED'});
 await saveResultAudit(folder,await input(folder,c,{decision:'revise',issues:[issue]}));p=await loadProject(folder);await assert.rejects(accept(),{code:'RESULT_AUDIT_REQUIRED'});
 await saveResultAudit(folder,await input(folder,c));p=await loadProject(folder);
 // A newer reject supersedes the earlier ready result.
 await saveResultAudit(folder,await input(folder,c,{decision:'reject',issues:[issue]}));p=await loadProject(folder);await assert.rejects(accept(),{code:'RESULT_AUDIT_REQUIRED'});
 await saveResultAudit(folder,await input(folder,c));p=await loadProject(folder);const r=await accept();assert.equal(r.version.acceptedBy,'agent');assert.equal(r.project.choices.length,0);
});
test('audit records preserve pixels and current version; they do not constitute a user preference',async t=>{
 const {folder,c}=await fixture(t),before=await renderFrame(folder,c.id),p=await loadProject(folder),audit=await saveResultAudit(folder,await input(folder,c));
 assert.equal(audit.project.currentId,p.currentId);assert.deepEqual(audit.project.choices,p.choices);assert.equal((await renderFrame(folder,c.id)).pixelHash,before.pixelHash);assert.equal(audit.audit.source,'host-agent-result-audit');assert.equal(audit.audit.frameSpec.width,before.frameSpec.width);
});
test('changed selections cannot reuse an earlier ready audit',async t=>{
 const {folder,c}=await fixture(t);await saveResultAudit(folder,await input(folder,c));let p=await loadProject(folder);
 const selected=await selectCandidateItems(folder,{revision:p.revision,id:c.id,selectionHash:c.selectionHash,selectedItemIds:['tone']});p=await loadProject(folder);
 await assert.rejects(acceptCandidate(folder,{id:c.id,revision:p.revision,selectionHash:selected.candidate.selectionHash,acceptedBy:'agent',requireAudit:true}),{code:'RESULT_AUDIT_REQUIRED'});
 await saveResultAudit(folder,await input(folder,selected.candidate));p=await loadProject(folder);assert.ok((await acceptCandidate(folder,{id:c.id,revision:p.revision,selectionHash:selected.candidate.selectionHash,acceptedBy:'agent',requireAudit:true})).version);
});
test('stale, mismatched, contradictory and missing preview audit inputs are rejected',async t=>{
 const {folder,c}=await fixture(t),valid=await input(folder,c);
 for(const patch of [{pixelHash:'wrong'},{frameSpecHash:'wrong'},{selectionHash:null},{maxSide:513}])await assert.rejects(saveResultAudit(folder,{...valid,...patch}),{code:'AUDIT_PREVIEW_MISMATCH'});
 await assert.rejects(saveResultAudit(folder,{...valid,decision:'ready',issues:[issue]}),{code:'AUDIT_NOT_READY'});
 for(const patch of [{maxSide:0},{checked:[]},{decision:'revise'},{summary:''},{unknown:'untrusted'},{issues:[{...issue,severity:'unknown'}]}])await assert.rejects(saveResultAudit(folder,{...valid,...patch}),{code:'AUDIT_INVALID'});
 await assert.rejects(saveResultAudit(folder,{...valid,revision:valid.revision-1}),{code:'STALE_REVISION'});
 await setIntent(folder,{intent:'不同目标'});const p=await loadProject(folder);await assert.rejects(saveResultAudit(folder,{...valid,revision:p.revision}),{code:'STALE_CANDIDATE'});
});
test('source corruption prevents audit; CLI exposes audit records and gates Agent delivery',async t=>{
 const {folder,c}=await fixture(t),value=await input(folder,c),file=path.join(folder,'audit.json');await writeFile(file,JSON.stringify(value));
 const audit=await runCLI(['result-audit','--project',folder,'--input',file]);assert.equal(audit.audit.decision,'ready');
 await assert.rejects(runCLI(['accept','--project',folder,'--id',c.id,'--require-audit','yes']),{code:'AUDIT_INVALID'});
 const saved=await runCLI(['accept','--project',folder,'--id',c.id,'--revision',String(audit.project.revision),'--selection-hash',c.selectionHash,'--by','agent','--require-audit','true']);assert.equal(saved.version.id,c.id);
 const p=await loadProject(folder);await writeFile(path.join(folder,'source','original.bin'),'changed');await assert.rejects(saveResultAudit(folder,{...value,revision:p.revision}),{code:'SOURCE_CHANGED'});
});
test('the audit gate rechecks actual source bytes before accepting a previously audited candidate',async t=>{
 const {folder,c}=await fixture(t),audit=await saveResultAudit(folder,await input(folder,c));
 await writeFile(path.join(folder,'source','original.bin'),'changed after review');
 await assert.rejects(acceptCandidate(folder,{id:c.id,revision:audit.project.revision,selectionHash:c.selectionHash,acceptedBy:'agent',requireAudit:true}),{code:'SOURCE_CHANGED'});
 const p=await loadProject(folder);assert.equal(p.currentId,audit.project.currentId);assert.equal(p.candidates[0].id,c.id);
});
