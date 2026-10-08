import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadRetouchPolicy,verifyPolicyProvenance} from '../skills/photo-retouch/scripts/retouch-policy.mjs';
import {runCLI} from '../skills/photo-retouch/scripts/cli.mjs';
import {prepareAdvisorRequest,finishAdvisorReply} from '../apps/studio/server/ai/advisor-policy.mjs';
import {createDocument,applyCommands,restoreTransaction} from '../apps/studio/public/edit-stack/commands.js';
import {documentHash,sha256} from '../apps/studio/public/edit-stack/identity.js';
import {compileRetouchPlan,withPreviewTuning} from '../apps/studio/public/edit-stack/planning.js';
import {retouchCapabilities} from '../apps/studio/public/edit-stack/capabilities.js';
import {normalizeDiagnosisContent,normalizeAuditContent} from '../apps/studio/public/edit-stack/review-protocol.js';
import {initProject,loadProject,projectDocument,createCandidate,acceptCandidate,saveResultAudit,setIntent,saveNote,publicProject,workspaceSupport} from '../skills/photo-retouch/scripts/project.mjs';
import {recordDiagnosis,configureWorkflow,prepareReview} from '../skills/photo-retouch/scripts/workflow.mjs';
import {previewPhoto} from '../skills/photo-retouch/scripts/render.mjs';
import {latestAudit} from '../skills/photo-retouch/scripts/workflow-state.mjs';
import {prepareRetouchPlan,createPlannedCandidate} from '../skills/photo-retouch/scripts/retouch-plan.mjs';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {prepareProjectReview,persistProjectReview} from '../apps/studio/server/ai/project-review.mjs';

const visual={goal:'让暗部更可读',benefit:'保留亮灯并显出阴影层次',tradeoff:'提亮后复看噪点',findingIds:[]};
const add={type:'AddStep',step:{id:'light',title:'提亮',tool:'exposure',toolVersion:2,parameters:{ev:.35},opacity:.7}};
const mask={type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.45,end:.8},reference:{kind:'live-input'}}};
const base=()=>createDocument({documentId:'fixture',source:{assetId:'image',contentHash:sha256('image'),width:640,height:427},base:{settings:{},locals:[]}});
const action=(document,commands,extra={})=>({kind:'document',label:'试片',goal:visual.goal,tradeoff:visual.tradeoff,proposal:{baseRevision:document.revision,baseHash:documentHash(document),items:[{id:'light-item',title:'明暗',visual:structuredClone(visual),commands,dependsOn:[]}],...extra}});
const reply=action=>({reply:'先比较暗部与灯头。',principle:'保留已有亮处。',clarification:{question:'',choices:[]},action});
const diagnosis={goal:visual.goal,preserve:['保留灯光与夜色'],checked:['完整预览，未看原尺寸导出'],findings:[],colorIntent:null};
const audit={decision:'ready',summary:'预览中的暗部与灯光关系已检查。',checked:['完整预览与亮暗过渡'],strengths:['灯光与背景分开'],issues:[],resolutions:[]};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'framelark-policy-')),folder=join(root,'photo');t.after(()=>rm(root,{recursive:true,force:true}));await initProject(new URL('./web/fixtures/quality/night.png',import.meta.url).pathname,folder,{intent:'保留夜色，暗处更可读'});return {root,folder};}
async function auditedCandidate(folder){const p=await loadProject(folder),d=projectDocument(p);const made=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,documentProposal:action(d,[add,mask]).proposal});const frame=await previewPhoto(folder,made.candidate.id,{maxSide:1400});const saved=await saveResultAudit(folder,{revision:made.project.revision,versionId:made.candidate.id,maxSide:1400,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,selectionHash:frame.selectionHash,...audit});return {...made,project:saved.project,audit:saved.audit};}

test('Web and CLI supply exactly the same versioned policy and task references',async()=>{
 const packet=await prepareAdvisorRequest({image:'data:image/png;base64,YQ==',question:'提亮',context:{document:base()}}),cli=await runCLI(['policy','--task','plan','--topics','light-color']);
 assert.deepEqual(packet.policy.provenance,cli.provenance);assert.equal(packet.policy.references.length,2);assert.ok(packet.payload.instructions.includes(cli.core));
 assert.match(packet.payload.instructions,/action.kind=document/);assert.doesNotMatch(packet.payload.instructions,/action.kind=tools|覆盖上面的旧工具/);
 const legacy=await prepareAdvisorRequest({image:'data:image/png;base64,YQ==',question:'提亮'});assert.match(legacy.payload.instructions,/action.kind=tools/);assert.doesNotMatch(legacy.payload.instructions,/action.kind=document/);
 const changed=structuredClone(cli.provenance);changed.references[0].hash='0'.repeat(64);await assert.rejects(verifyPolicyProvenance(changed),{code:'POLICY_INVALID'});
 await assert.rejects(loadRetouchPolicy({topics:['../../secrets']}),{code:'POLICY_INVALID'});
});
test('common planner preserves a scoped exposure identity, mask, strength and independent successor; undo restores the value',()=>{
 const before=applyCommands(base(),[add,mask,{type:'AddStep',step:{id:'color',title:'色彩',tool:'color',toolVersion:2,parameters:{warmth:2}}}]).next;
 const result=compileRetouchPlan(before,action(before,[{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.6}}]),{scopeStepId:'light'});
 assert.equal(result.document.steps.length,before.steps.length);assert.deepEqual(result.document.steps[0],{...before.steps[0],parameters:{...before.steps[0].parameters,ev:.6}});assert.deepEqual(result.document.steps[1],before.steps[1]);
 assert.deepEqual(restoreTransaction(result.document,result.transaction,'undo').steps,before.steps);
 assert.throws(()=>compileRetouchPlan(before,action(before,[{type:'SetStepOpacity',stepId:'color',opacity:.2}]),{scopeStepId:'light'}),{code:'PROPOSAL_SCOPE'});
});
test('visual choice units compile atomically and validate finding links and real resource dependencies',()=>{
 const d=base(),input=action(d,[add,mask]);input.proposal.items.push({id:'crop',title:'构图',visual:{...visual,goal:'减少边缘'},commands:[{type:'UpdateGeometry',geometry:{crop:{x:0,y:.1,width:1,height:.8}}}],dependsOn:[]});
 const selected=compileRetouchPlan(d,input,{selectedItemIds:['light-item']});assert.equal(selected.document.steps.length,1);assert.ok(selected.document.steps[0].maskRef);assert.equal(selected.document.geometry.crop,null);assert.equal(selected.transaction.commands.length,2);
 const bad=structuredClone(input);bad.proposal.items[0].visual.findingIds=['missing'];assert.throws(()=>compileRetouchPlan(d,bad),{code:'FINDING_REFERENCE_INVALID'});
 const fake=structuredClone(input);fake.proposal.items[1].dependsOn=['light-item'];assert.throws(()=>compileRetouchPlan(d,fake),{code:'RESOURCE_DEPENDENCY_INVALID'});
 const resource=structuredClone(input);resource.proposal.items[1].commands=[{type:'SetStepOpacity',stepId:'light',opacity:.5}];resource.proposal.items[1].dependsOn=['light-item'];assert.throws(()=>compileRetouchPlan(d,resource,{selectedItemIds:['crop']}),{code:'DEPENDENCY_REQUIRED'});assert.equal(d.steps.length,0);
});
test('preview tuning depends only on the item that creates its step, and retains visual goal metadata',()=>{
 const d=base(),proposal=action(d,[add,mask]).proposal;proposal.items.push({id:'crop',title:'构图',visual,commands:[{type:'UpdateGeometry',geometry:{crop:{x:0,y:.1,width:1,height:.8}}}],dependsOn:[]});
 const tuned=withPreviewTuning(d,proposal,['light-item','crop'],[{type:'SetStepOpacity',stepId:'light',opacity:.5}]);assert.deepEqual(tuned.items.at(-1).dependsOn,['light-item']);assert.ok(tuned.items.at(-1).visual);
 const result=compileRetouchPlan(d,{kind:'document',proposal:tuned},{selectedItemIds:['light-item','preview-tuning']});assert.equal(result.document.geometry.crop,null);assert.equal(result.document.steps[0].opacity,.5);
});
test('capabilities distinguish RAW master, proxy, semantic masks and external non-replayable editing',()=>{
 const raster=retouchCapabilities(),raw=retouchCapabilities({source:{raw:{}}});assert.deepEqual(raster.export.formats,['jpeg','png']);assert.ok(raw.export.formats.includes('tiff16'));assert.equal(raw.export.proxyIsMaster,false);assert.equal(raw.source.precision,'linear-float32-master');assert.equal(raw.masks.semanticSegmentation,false);assert.equal(raw.externalImageEdit.available,false);assert.equal(retouchCapabilities({externalImageEdit:true}).externalImageEdit.replayable,false);
});
test('shared review content rejects fabricated fields and a ready decision with blocking issues',()=>{
 assert.deepEqual(normalizeDiagnosisContent(diagnosis),diagnosis);assert.deepEqual(normalizeAuditContent(audit),audit);
 assert.throws(()=>normalizeDiagnosisContent({...diagnosis,score:100}),{code:'DIAGNOSIS_INVALID'});assert.throws(()=>normalizeAuditContent({...audit,issues:[{area:'灯头',observation:'有光晕',nextAction:'返修',severity:'blocking'}]}),{code:'AUDIT_NOT_READY'});
});
test('accepted audit becomes historical after goal or annotation changes, and viewing scope never expands',async t=>{
 const {folder}=await fixture(t),made=await auditedCandidate(folder);const saved=await acceptCandidate(folder,{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});
 assert.equal(publicProject(saved.project).currentAudit.id,made.audit.id);assert.equal(latestAudit(saved.project,saved.version,{maxSide:8192}),null);
 assert.equal(publicProject({...saved.project,source:{...saved.project.source,normalizedChecksum:'f'.repeat(64)}}).currentAudit,null);
 await setIntent(folder,{revision:saved.project.revision,intent:'改为低调画面'});let p=await loadProject(folder);assert.equal(publicProject(p).currentAudit,null);assert.equal(p.resultAudits.length,1);
 await setIntent(folder,{revision:p.revision,intent:saved.project.intent});p=await loadProject(folder);await saveNote(folder,{revision:p.revision,rect:{x:0,y:0,width:.2,height:.2},note:'保留天空'});p=await loadProject(folder);assert.equal(publicProject(p).currentAudit,null);assert.equal(p.resultAudits.length,1);
});
test('replacing a diagnosis goal invalidates the old audit even with unchanged pixels and project intent',async t=>{
 const {folder}=await fixture(t),made=await auditedCandidate(folder),p=made.project,frame=await previewPhoto(folder,p.currentId,{maxSide:1400});
 const next=await recordDiagnosis(folder,{revision:p.revision,versionId:p.currentId,maxSide:1400,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,actorId:'host',...diagnosis});
 assert.equal(latestAudit(next.project,made.candidate),null);
});
test('Web → common Skill plan → Web retains provenance and recipe while stale writes reject',async t=>{
 const {root,folder}=await fixture(t),bridge=new ProjectBridge({root});t.after(()=>bridge.close());let view=await bridge.register(folder);const packet=await prepareRetouchPlan(folder);
 const made=await createPlannedCandidate(folder,{revision:view.revision,baseVersion:view.currentId,policy:packet.policy.provenance,action:action(packet.document,[add,mask])});
 view=await bridge.get(view.id);assert.deepEqual(view.candidates[0].policy,packet.policy.provenance);assert.deepEqual(view.candidates[0].items[0].visual,visual);
 await assert.rejects(createPlannedCandidate(folder,{revision:packet.revision,baseVersion:packet.baseVersion,policy:packet.policy.provenance,action:action(packet.document,[add])}),{code:'STALE_REVISION'});
 view=await bridge.candidate(view.id,'accept',{revision:view.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});assert.equal(view.acceptedBy,'user');assert.equal(view.generatedBy.kind,'agent');assert.equal(view.document.steps[0].id,'light');
 const configured=await configureWorkflow(folder,{revision:view.revision,mode:'reviewed'});assert.equal(workspaceSupport(configured.project).supported,true);assert.equal(workspaceSupport({...configured.project,source:{...configured.project.source,raw:{}}}).fallback,'native');
});
test('project model adapter pins renderer identity, persists shared records, rejects stale and cancelled responses',async t=>{
 const {root,folder}=await fixture(t),bridge=new ProjectBridge({root});t.after(()=>bridge.close());let view=await bridge.register(folder);let renderCalls=0;const render=bridge.render.bind(bridge);bridge.render=(...args)=>{renderCalls++;return render(...args);};
 const packet=await prepareProjectReview(bridge,view.id,'diagnosis',{revision:view.revision});view=await persistProjectReview(bridge,packet,{value:diagnosis,provenance:{model:'deterministic-fixture'}});assert.equal(renderCalls,2,'model input and persistence recheck both use the bounded render pool');assert.equal(view.diagnosis.goal,diagnosis.goal);assert.deepEqual(view.diagnosis.policy,packet.policy.provenance);
 const stale=await prepareProjectReview(bridge,view.id,'audit',{revision:view.revision});await setIntent(folder,{revision:view.revision,intent:'目标变化'});await assert.rejects(persistProjectReview(bridge,stale,{value:audit}),{code:'STALE_REVISION'});
 view=await bridge.get(view.id);const cancelled=await prepareProjectReview(bridge,view.id,'audit',{revision:view.revision}),before=await readFile(join(folder,'project.json')),controller=new AbortController();controller.abort();await assert.rejects(persistProjectReview(bridge,cancelled,{value:audit},{signal:controller.signal}),{name:'AbortError'});assert.deepEqual(await readFile(join(folder,'project.json')),before);
});
test('Web advisor attaches the actual loaded policy and model to its compiled proposal',async()=>{
 const d=base(),packet=await prepareAdvisorRequest({image:'data:image/png;base64,YQ==',question:'整体提亮',context:{document:d}}),result=finishAdvisorReply(packet,{value:reply(action(d,[add,mask])),provenance:{model:'fixture'}});
 assert.deepEqual(result.action.proposal.provenance.policy,packet.policy.provenance);assert.equal(result.action.proposal.provenance.generatedBy.model,'fixture');
});

const finding=id=>({id,dimension:'light',area:'下沿',observation:'暗部层次较弱',impact:'画面关系不清楚',action:'比较提亮与保留',check:'复看夜色',tradeoff:'噪点风险',priority:'optional',confidence:'medium'});
async function diagnoseCurrent(folder,findings,goal='保留夜色'){
 const p=await loadProject(folder),frame=await previewPhoto(folder,p.currentId,{maxSide:1400});
 return recordDiagnosis(folder,{revision:p.revision,versionId:p.currentId,maxSide:1400,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,actorId:'host',...diagnosis,goal,findings});
}
test('Web diagnosis findings can be resolved by an audit of the unchanged saved photo',async t=>{
 const {root,folder}=await fixture(t),bridge=new ProjectBridge({root});t.after(()=>bridge.close());let view=await bridge.register(folder);
 const packet=await prepareProjectReview(bridge,view.id,'diagnosis',{revision:view.revision});
 view=await persistProjectReview(bridge,packet,{value:{...diagnosis,findings:[finding('dark')]}});
 const review=await prepareProjectReview(bridge,view.id,'audit',{revision:view.revision});
 assert.equal(JSON.parse(review.payload.input[0].content[0].text).diagnosis.id,view.diagnosis.id);
 const saved=await persistProjectReview(bridge,review,{value:{...audit,resolutions:[{findingId:'dark',status:'preserved',evidence:'夜色表达允许此处保持重量'}]}});
 assert.equal(saved.review.diagnosisId,view.diagnosis.id);assert.equal(saved.currentAudit.id,saved.review.id);
});
test('an accepted edition can be audited against a new diagnosis without borrowing its former findings',async t=>{
 const {root,folder}=await fixture(t),made=await auditedCandidate(folder);await acceptCandidate(folder,{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});
 const diagnosed=await diagnoseCurrent(folder,[finding('current dark')],'当前保存版保留暗部重量'),bridge=new ProjectBridge({root});t.after(()=>bridge.close());const view=await bridge.register(folder);
 const packet=await prepareProjectReview(bridge,view.id,'audit',{revision:view.revision});
 assert.equal(JSON.parse(packet.payload.input[0].content[0].text).diagnosis.id,diagnosed.diagnosis.id);
 const saved=await persistProjectReview(bridge,packet,{value:{...audit,resolutions:[{findingId:'current dark',status:'preserved',evidence:'当前目标允许保留此关系'}]}});
 assert.equal(saved.review.diagnosisId,diagnosed.diagnosis.id);assert.equal(saved.currentAudit.id,saved.review.id);
});
test('an independent packet from an older diagnosis cannot authorize a review after a replacement diagnosis',async t=>{
 const {folder}=await fixture(t);let p=await loadProject(folder);await configureWorkflow(folder,{revision:p.revision,mode:'reviewed',independent:true});await diagnoseCurrent(folder,[finding('dark')],'原目标');p=await loadProject(folder);
 const made=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,documentProposal:action(projectDocument(p),[add,mask]).proposal});
 const packet=await prepareReview(folder,{revision:made.project.revision,versionId:made.candidate.id,maxSide:1400});
 await diagnoseCurrent(folder,[finding('dark')],'替换后的新目标');p=await loadProject(folder);const frame=await previewPhoto(folder,made.candidate.id,{maxSide:1400});
 await assert.rejects(saveResultAudit(folder,{revision:p.revision,versionId:made.candidate.id,maxSide:1400,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,selectionHash:frame.selectionHash,...audit,resolutions:[{findingId:'dark',status:'resolved',evidence:'不能借旧任务包声明新目标通过'}],reviewer:{id:'other-host',mode:'independent',packetId:packet.packet.id}}),{code:'REVIEW_PACKET_STALE'});
 await assert.rejects(acceptCandidate(folder,{revision:p.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash,acceptedBy:'agent'}),{code:'DIAGNOSIS_REQUIRED'});
});
test('Chinese and spaced finding identifiers survive diagnosis to shared planning while resource IDs remain strict',async t=>{
 const {folder}=await fixture(t),findings=[finding('暗部层次'),finding('highlight boundary')];await diagnoseCurrent(folder,findings);
 let packet=await prepareRetouchPlan(folder),input=action(packet.document,[add]);input.proposal.items[0].visual.findingIds=findings.map(f=>f.id);
 const made=await createPlannedCandidate(folder,{revision:packet.revision,baseVersion:packet.baseVersion,policy:packet.policy.provenance,action:input});
 assert.deepEqual(made.candidate.items[0].visual.findingIds,findings.map(f=>f.id));
 packet=await prepareRetouchPlan(folder);const invalid=action(packet.document,[{...add,step:{...add.step,id:'不合法步骤'}}]);invalid.proposal.items[0].visual.findingIds=findings.map(f=>f.id);
 await assert.rejects(createPlannedCandidate(folder,{revision:packet.revision,baseVersion:packet.baseVersion,policy:packet.policy.provenance,action:invalid}),{code:'INVALID_DOCUMENT'});
 const missing=action(packet.document,[add]);missing.proposal.items[0].visual.findingIds=['不存在的诊断'];
 await assert.rejects(createPlannedCandidate(folder,{revision:packet.revision,baseVersion:packet.baseVersion,policy:packet.policy.provenance,action:missing}),{code:'FINDING_REFERENCE_INVALID'});
});
test('a legacy audit without a diagnosis remains compatible until a new applicable diagnosis is recorded',async t=>{
 const {folder}=await fixture(t),made=await auditedCandidate(folder);
 await acceptCandidate(folder,{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});
 const file=join(folder,'project.json'),legacy=JSON.parse(await readFile(file));delete legacy.resultAudits[0].targetHash;await writeFile(file,JSON.stringify(legacy));
 let p=await loadProject(folder);assert.equal(publicProject(p).currentAudit.id,made.audit.id);
 await diagnoseCurrent(folder,[finding('new finding')]);p=await loadProject(folder);
 assert.equal(publicProject(p).currentAudit,null);assert.equal(p.resultAudits.length,1);
 assert.notEqual(publicProject(p).workflowStatus.stage,'delivered');
});
test('a legacy audit bound to a former diagnosis becomes historical when the saved photo is diagnosed under a new goal',async t=>{
 const {folder}=await fixture(t);const diagnosed=await diagnoseCurrent(folder,[finding('dark')],'原目标');let p=await loadProject(folder);
 const made=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,documentProposal:action(projectDocument(p),[add,mask]).proposal}),frame=await previewPhoto(folder,made.candidate.id,{maxSide:1400});
 const reviewed=await saveResultAudit(folder,{revision:made.project.revision,versionId:made.candidate.id,maxSide:1400,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,selectionHash:frame.selectionHash,...audit,resolutions:[{findingId:'dark',status:'resolved',evidence:'原目标中的层次已检查'}]});
 await acceptCandidate(folder,{revision:reviewed.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});
 const file=join(folder,'project.json'),legacy=JSON.parse(await readFile(file));delete legacy.resultAudits[0].targetHash;await writeFile(file,JSON.stringify(legacy));
 p=await loadProject(folder);assert.equal(publicProject(p).currentAudit.diagnosisId,diagnosed.diagnosis.id);
 const changed=await diagnoseCurrent(folder,[finding('dark')],'替换后的新目标');
 assert.equal(publicProject(changed.project).currentAudit,null);assert.equal(changed.project.resultAudits.length,1);
});
