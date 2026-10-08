import {normalizeAuditContent} from './engine/edit-stack/review-protocol.js';
import {retouchCapabilities,negotiateWorkspace} from './engine/edit-stack/capabilities.js';
import {verifyPolicyProvenance} from './retouch-policy.mjs';
import {rawExtensions,rawLimits} from './raw/contract.mjs';
import {createRawAssets} from './raw/source.mjs';
import {createDocument} from './engine/edit-stack/document.js';
import {cleanToolRuns,versionToolRuns} from './engine/photo-tools/history.js';
import {readFile,writeFile,mkdir,rename,rm,stat,open} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {adjustmentKeys,neutralSettings} from './engine/editor-engine.js';
import {presets,presetById} from './engine/presets.js';
import {validCrop} from './engine/crop-utils.js';
import {cleanTextOverlays,validateTextComposition,letteringCapabilities} from './text-overlays.mjs';
import {outputGeometry} from './engine/export-settings.js';
import {PhotoError,fail,cleanSettings,cleanRect,settingsBounds,object,equal,bounded,ids} from './engine/edit-values.js';
import {heicKind,convertHeic} from './heic.mjs';
import {hash,legacyHash,pipelineVersion,selectionIdentity,versionPipeline,versionStateHash} from './engine/edit-identity.js';
import {projectDocument,validateProjectDocument,compileProjectProposal,documentSnapshot} from './document-state.mjs';
import {documentHash,contentHash,renderHash} from './engine/edit-stack/identity.js';
import {validateDocument} from './engine/edit-stack/document.js';
import {normalizeDocumentProposal} from './engine/edit-stack/proposals.js';
import {planKeys,normalizePlan,compileSelection,checkProtectedCrop,snapshotItem} from './engine/edit-plan.js';
import {emptyGuards,guardsOf,assertGuards,lockState,unlockState,validateGuards,geometryOf,mergeRestoreGuards} from './engine/edit-guards.js';
import {validateReferences,verifyReferences,protectionLimits} from './reference-store.mjs';
export {PhotoError,fail,cleanSettings,cleanRect,settingsBounds,hash,projectDocument,retouchCapabilities};
const text=(v,max=300)=>String(v??'').trim().slice(0,max),id=()=>randomUUID(),now=()=>new Date().toISOString();
import {contextHash,activeDiagnosis,workflowStatus,assertWorkflowDelivery,latestAudit,auditTargetHash} from './workflow-state.mjs';
import {handoffView} from './handoff-state.mjs';
const fingerprint=contextHash;
export const currentVersion=p=>p.versions.find(v=>v.id===p.currentId);
export function localFailure(error){
  const messages={ENOENT:'文件未找到。请检查照片或项目路径，恢复文件后重试；已有编辑保留。',EACCES:'无法读取或保存这个位置。请选择有读写权限的目录，已有编辑保留。',EPERM:'这个位置没有读写权限。请选择可用目录后重试，已有编辑保留。',ENOSPC:'磁盘空间不足。腾出空间后重试；已保存的版本仍保留。',EIO:'文件读取或保存暂时失败。请检查磁盘后重试，已有编辑保留。'};
  const message=messages[error?.code];
  if(message)return {code:error.code,message};
  if(!error?.code||/^E[A-Z0-9]+$/.test(error.code))return {code:'LOCAL_OPERATION_FAILED',message:'操作未完成。请检查文件与保存位置后重试，已有编辑保留。'};
  return {code:error.code,message:error.message,...(error.details?{details:error.details}:{})};
}
export function findVersion(p,key='current') {
  if(key==='current')return currentVersion(p);
  if(key==='original')return p.versions[0];
  const value=p.versions.find(v=>v.id===key)||p.candidates.find(v=>v.id===key);
  if(!value)fail('VERSION_NOT_FOUND','找不到这份版本。请读取最新项目后再试。');return value;
}
export async function loadProject(folder) {
  const file=path.join(path.resolve(folder),'project.json');let p;
  try{const info=await stat(file);if(info.size>4*1024*1024)fail('PROJECT_TOO_LARGE','项目记录过大，无法安全读取。');p=JSON.parse(await readFile(file,'utf8'));}
  catch(error){if(error instanceof PhotoError)throw error;fail('PROJECT_UNAVAILABLE','项目无法读取。请使用含 project.json 的工作目录；已有源图与记录未改动。');}
  if(![1,2,3].includes(p.schema) || !Number.isInteger(p.revision)||!Array.isArray(p.versions)||!p.versions.length || !Array.isArray(p.notes)||!Array.isArray(p.candidates)||!currentVersion(p)||!Number.isInteger(p.source?.width)||!Number.isInteger(p.source?.height)||p.source.width<1||p.source.height<1||p.source.width*p.source.height>(p.source.raw?rawLimits.pixels:50_000_000))fail('INVALID_PROJECT','项目记录不完整。请保留目录，使用备份恢复。');
  if(p.schema===1) migrateLegacy(p);
  if(!Array.isArray(p.exports)||p.exports.some(e=>!e||typeof e.path!=='string'||!Number.isSafeInteger(e.width)||!Number.isSafeInteger(e.height)||e.width<1||e.height<1))fail('INVALID_PROJECT','导出尺寸记录无效。请保留项目目录，使用备份恢复记录。');
  if(new Set([...p.versions,...p.candidates].map(v=>v.id)).size!==p.versions.length+p.candidates.length)fail('INVALID_PROJECT','版本编号重复。');
  for(const v of [...p.versions,...p.candidates]){
    if(v.recipe){if(p.schema!==3)fail('INVALID_PROJECT','可编辑配方需要 schema 3 项目，旧程序不得覆盖保存。');validateProjectDocument(p,v);}
    cleanSettings(v.state?.settings);cleanTextOverlays(v.state?.textOverlays);
    if(v.state?.style && (!presetById(v.state.style.id)||!Number.isFinite(v.state.style.amount)||v.state.style.amount<0||v.state.style.amount>100))fail('INVALID_PROJECT','版本风格记录无效。');
    if(v.state?.crop && (!validCrop(v.state.crop)||v.state.crop.angle!==undefined&&(!Number.isFinite(v.state.crop.angle)||Math.abs(v.state.crop.angle)>15)))fail('INVALID_PROJECT','版本裁剪记录无效。');
    if(!Array.isArray(v.state?.locals)||v.state.locals.length>8)fail('INVALID_PROJECT','版本局部记录无效。');
    for(const l of v.state.locals){cleanRect(l.rect);cleanSettings(l.localSettings);}
    if(v.workspaceNotes!==undefined){
      if(!Array.isArray(v.workspaceNotes)||v.workspaceNotes.length>8)fail('INVALID_PROJECT','历史批注记录无效。');
      ids(v.workspaceNotes.map(n=>n.id),'INVALID_PROJECT');
      for(const n of v.workspaceNotes){cleanRect(n.rect);if(typeof n.note!=='string'||n.note.length>600||typeof n.protect!=='boolean'||!Number.isInteger(n.number)||n.number<1)fail('INVALID_PROJECT','历史批注记录无效。');}
    }
    validateGuards(v.state.guards);
    // References are also checked on candidate creation, acceptance and rendering.
    const owner=p.versions.indexOf(v);validateReferences(p,v.state,owner<0?p.versions.length:owner,{checkPipeline:false});
  }
  return p;
}
function migrateLegacy(p) {
  const oldFingerprint=legacyHash({current:p.currentId,intent:p.intent,notes:p.notes});
  for(const v of [...p.versions,...p.candidates]){v.state.guards=emptyGuards();v.state.textOverlays??=[];}
  for(const c of p.candidates){
    const base=p.versions.find(v=>v.id===c.parentId);
    if(!base)fail('INVALID_PROJECT','候选基础版本丢失。');
    c.items=[snapshotItem(base.state,c.state,c.name||'整组调整')];
    c.selectedItemIds=['whole-plan'];c.legacy=true;c.baseRevision=p.revision;
    c.baseFingerprint=c.baseFingerprint===oldFingerprint?fingerprint(p):'legacy-stale';
    c.selectionHash=selectionIdentity(base,c);c.noChange=equal(c.state,base.state);
  }
  p.schema=2;
}
async function atomicWrite(folder,p) {
  const serialized=JSON.stringify(p,null,2);
  if(Buffer.byteLength(serialized,'utf8')>4*1024*1024)fail('PROJECT_TOO_LARGE','项目记录接近上限，请另存为新项目后继续。');
  const temp=path.join(folder,`.project-${id()}.tmp`),file=path.join(folder,'project.json');
  const previous=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(previous&&JSON.parse(previous).schema===1)await writeFile(path.join(folder,'project.schema-1.backup.json'),previous,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  if(previous&&p.schema===3&&[1,2].includes(JSON.parse(previous).schema)){
    const oldSchema=JSON.parse(previous).schema,file=path.join(folder,`project.schema-${oldSchema}.backup.json`);
    try{await writeFile(file,previous,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;if(hash(await readFile(file))!==hash(previous))await writeFile(path.join(folder,`project.schema-${oldSchema}-${hash(previous).slice(0,16)}.backup.json`),previous,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});}
  }
  const handle=await open(temp,'wx',0o600);try{await handle.writeFile(serialized);await handle.sync();}finally{await handle.close();}
  try{await rename(temp,file);}catch(error){await rm(temp,{force:true});throw error;}
}
async function locked(folder,fn) {
  folder=path.resolve(folder);const lock=path.join(folder,'.edit-lock');let acquired=false;
  for(let i=0;i<45&&!acquired;i++) {
    try{await mkdir(lock);await writeFile(path.join(lock,'owner'),String(process.pid));acquired=true;}
    catch(error){if(error.code!=='EEXIST')throw error;
      try{const pid=Number(await readFile(path.join(lock,'owner'),'utf8'));if(pid>0){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')await rm(lock,{recursive:true,force:true});}}}catch(e){if(e.code==='ENOENT'){const info=await stat(lock).catch(()=>null);if(info&&Date.now()-info.mtimeMs>5000)await rm(lock,{recursive:true,force:true});}}
      await new Promise(r=>setTimeout(r,70));
    }
  }
  if(!acquired)fail('PROJECT_BUSY','另一项编辑正在保存，请稍后再试。');
  try{return await fn(folder);}finally{await rm(lock,{recursive:true,force:true});}
}
const expect=(p,revision)=>{if(revision!==undefined && revision!==p.revision)fail('STALE_REVISION','照片或批注已更新。请重新读取上下文，再基于最新版本操作。');};
export async function mutateProject(folder,revision,fn) {
  return locked(folder,async root=>{const p=await loadProject(root);expect(p,revision);const result=await fn(p,root);p.revision++;p.updatedAt=now();await atomicWrite(root,p);return {project:p,...result};});
}
export async function initProject(image,folder,{intent='',signal,rawBackend='auto'}={}) {
  if(rawExtensions.test(image)){
    folder=path.resolve(folder);const cleanIntent=text(intent);signal?.throwIfAborted();const source=await createRawAssets(path.resolve(image),folder,{signal,backend:rawBackend});try{const state={settings:neutralSettings(),style:null,crop:null,locals:[],textOverlays:[],guards:emptyGuards()},projectId=id(),original={id:id(),name:'原片',parentId:null,createdAt:now(),state};
    original.recipe=createDocument({documentId:'doc-'+projectId,source:{assetId:projectId,contentHash:source.checksum,normalizedHash:source.normalizedChecksum,width:source.width,height:source.height},base:state});
    const project={schema:3,id:projectId,revision:1,createdAt:now(),updatedAt:now(),source,intent:cleanIntent,notes:[],versions:[original],currentId:original.id,acceptedId:null,candidates:[],reviews:[],exports:[],choices:[]};signal?.throwIfAborted();await atomicWrite(folder,project);return {folder,project};}catch(error){await rm(folder,{recursive:true,force:true});throw error;}
  }
  folder=path.resolve(folder);const bytes=await readFile(path.resolve(image));
  if(bytes.length>30*1024*1024 || !bytes.length)fail('IMAGE_SIZE','照片为空或超过 30 MB，请转换成较小的 JPEG/PNG 后重新加入。');
  let metadata,normalized,info;
  const heic=heicKind(bytes),input=heic?await convertHeic(bytes):bytes;
  try{metadata=await sharp(input,{limitInputPixels:50_000_000}).metadata();
    if(!['jpeg','png','webp','avif','heif'].includes(metadata.format) || (metadata.pages||1)>1)fail('IMAGE_FORMAT','本版支持静态 JPEG、PNG、WebP、AVIF；HEIC、RAW、TIFF 请先转成 JPEG/PNG。');
    if(metadata.format==='heif' && metadata.compression!=='av1')fail('IMAGE_FORMAT','HEIC 请先转成 JPEG/PNG。');
    if(Math.max(metadata.width,metadata.height)>16384)fail('IMAGE_SIZE','最长边超过 16384 像素，请先缩小照片。');
    normalized=await sharp(input,{limitInputPixels:50_000_000}).rotate().toColourspace('srgb').ensureAlpha().png().toBuffer();info=await sharp(normalized).metadata();
    if(heic)metadata.format='heic';
  }catch(error){if(error instanceof PhotoError)throw error;fail('IMAGE_DECODE','这张照片无法解码。请重新导出静态 JPEG/PNG；已有工作不会被清空。');}
  try{await mkdir(folder,{recursive:false,mode:0o700});}catch(error){if(error.code==='EEXIST')fail('PROJECT_EXISTS','这个目录已经存在。请选择新的项目目录，避免覆盖已有工作。');throw error;}
  try{await mkdir(path.join(folder,'source'),{mode:0o700});await mkdir(path.join(folder,'previews'));await mkdir(path.join(folder,'exports'));
    await writeFile(path.join(folder,'source','original.bin'),bytes,{mode:0o600});await writeFile(path.join(folder,'source','normalized.png'),normalized,{mode:0o600});
    const original={id:id(),name:'原片',parentId:null,createdAt:now(),state:{settings:neutralSettings(),style:null,crop:null,locals:[],textOverlays:[],guards:emptyGuards()}};
    const p={schema:2,id:id(),revision:1,createdAt:now(),updatedAt:now(),source:{name:path.basename(image),checksum:hash(bytes),normalizedChecksum:hash(normalized),width:info.width,height:info.height,format:metadata.format,bytes:bytes.length},intent:text(intent),notes:[],versions:[original],currentId:original.id,acceptedId:null,candidates:[],reviews:[],exports:[],choices:[]};
    await atomicWrite(folder,p);return {folder,project:p};
  }catch(error){throw error;}
}
function validateCandidateState(p,state,allowProtectedCrop=false) {
  assertGuards(currentVersion(p).state,state);
  if(state.textOverlays?.length)validateTextComposition(state.textOverlays,outputGeometry(state.crop,p.source.width,p.source.height,8192).rect);
  validateReferences(p,state);
  return checkProtectedCrop(state,p.notes,p.source,allowProtectedCrop);
}
function compileCandidate(p,c,selected=c.selectedItemIds) {
  const base=p.versions.find(v=>v.id===c.parentId);
  if(!base||c.parentId!==p.currentId||c.baseFingerprint!==fingerprint(p))fail('STALE_CANDIDATE','候选生成后照片、意图或批注已改变。请重新读取并试片。');
  if(c.guardOperation){
    const state=unlockState(base.state,c.guardOperation);
    return {...c,state,selectionHash:selectionIdentity(base,{...c,state})};
  }
  if(c.documentProposal){const compiled=compileProjectProposal(p,c,selected),warnings=validateCandidateState(p,compiled.state,c.allowProtectedCrop);const next={...c,...compiled,warnings};next.selectionHash=selectionIdentity(base,next);return next;}
  const compiled=compileSelection(base.state,c.items,selected,{source:p.source,notes:p.notes,toolNamespace:c.toolNamespace}),warnings=validateCandidateState(p,compiled.state,c.allowProtectedCrop);
  const toolRuns=c.items.some(i=>i.operation)?[...(c.inheritedToolRuns||[]),{namespace:c.toolNamespace,label:c.name,operations:c.items.map(i=>i.operation),selectedItemIds:compiled.selectedItemIds,records:c.items.map(i=>({id:i.id,execution:i.execution}))}].slice(-24):c.toolRuns;
  return {...c,...compiled,...(toolRuns?{toolRuns}:{}),warnings,selectionHash:selectionIdentity(base,{...c,...compiled})};
}
export async function createCandidate(folder,plan,{toolExecution,toolNamespace,signal}={}) {
  if(!plan || typeof plan!=='object' || Array.isArray(plan))fail('INVALID_PLAN','请提供候选方案 JSON。');
  return locked(folder,async root=>{
    const p=await loadProject(root),prior=p.candidates.find(c=>plan.requestId&&c.requestId===plan.requestId),planHash=hash(plan);
    if(prior){if(prior.planHash!==planHash&&!(prior.legacy&&prior.planHash===legacyHash(plan)))fail('REQUEST_CONFLICT','同一请求编号对应不同方案，请使用新编号。');return {project:p,candidate:prior,reused:true};}
    if(!Number.isInteger(plan.revision)||plan.baseVersion!==p.currentId)fail('STALE_REVISION','方案需填写 inspect 返回的 revision 和 currentId。');expect(p,plan.revision);
    if(p.candidates.length>=8)fail('CANDIDATE_LIMIT','最多保留 8 个候选。请接受或取消一个后继续。');
    object(plan,[...planKeys,'actorId','diagnosisId','handoffId','documentProposal','policy','scopeStepId','generatedBy']);
    const policyInput=plan.policy||plan.documentProposal?.provenance?.policy;
    const policy=policyInput?await verifyPolicyProvenance(policyInput):null;
    if(plan.policy&&plan.documentProposal?.provenance?.policy&&!equal(plan.policy,plan.documentProposal.provenance.policy))fail('POLICY_INVALID','方案的策略记录互相冲突。');
    if(plan.scopeStepId&&plan.documentProposal?.scopeStepId&&plan.scopeStepId!==plan.documentProposal.scopeStepId)fail('PROPOSAL_SCOPE','方案的指定步骤互相冲突。');
    plan={...plan,generatedBy:plan.generatedBy||plan.documentProposal?.provenance?.generatedBy};
    if(plan.generatedBy!==undefined){object(plan.generatedBy,['kind','model','effort']);if(!['user','agent'].includes(plan.generatedBy.kind)||['model','effort'].some(k=>plan.generatedBy[k]!==undefined&&(typeof plan.generatedBy[k]!=='string'||plan.generatedBy[k].length>120)))fail('INVALID_PLAN','方案来源无效。');}
    if(plan.handoffId!==undefined){
      const request=p.handoffs?.find(r=>r.id===plan.handoffId);
      if(!request||request.status!=='running')fail('HANDOFF_CLOSED','接续请求尚未接手或已结束，不再生成新结果。');
      if(request.actorId!==plan.actorId)fail('HANDOFF_OWNER','候选需由接手此请求的 Agent 提交。');
      if(request.contextHash!==fingerprint(p))fail('HANDOFF_STALE','接续上下文已更新，请重新读取后接手。');
    }
    const diagnosis=activeDiagnosis(p);
    if(plan.actorId!==undefined&&(typeof plan.actorId!=='string'||!plan.actorId.trim()||plan.actorId.length>80))fail('INVALID_PLAN','actorId 需有效宿主身份。');
    if(plan.diagnosisId!==undefined&&plan.diagnosisId!==diagnosis?.id)fail('DIAGNOSIS_STALE','方案的诊断已过期。');
    if(p.workflow?.mode==='reviewed'&&plan.mode!=='lettering'&&!diagnosis)fail('DIAGNOSIS_REQUIRED','先看当前照片并记录结构化诊断。');
    const base=currentVersion(p);let source=base;
    if(base.recipe&&!plan.documentProposal&&plan.mode!=='lettering')fail('DOCUMENT_COMMAND_REQUIRED','当前照片使用可编辑步骤，请提交文档命令，不要覆盖最终参数。');
    if(plan.documentProposal){
      if(['items','operations','settings','style','crop','locals','textOverlays','fromCandidate'].some(key=>Object.hasOwn(plan,key)))fail('AMBIGUOUS_PLAN','文档命令不能与旧参数方案混用。');
      const raw=JSON.parse(await readFile(path.join(root,'project.json'),'utf8'));
      if(raw.schema===1){if(raw.candidates.length)fail('MIGRATION_PENDING_CANDIDATES','请先接受或取消旧版候选，再启用可编辑栈。');for(const version of p.versions){const original=raw.versions.find(v=>v.id===version.id);if(original)version.state=structuredClone(original.state);}}
      const pinned=currentVersion(p),draft={policy,scopeStepId:plan.scopeStepId||plan.documentProposal?.scopeStepId||null,generatedBy:plan.generatedBy||{kind:plan.actorId==='workspace-user'?'user':'agent'},id:id(),name:text(plan.name,40)||'编辑步骤候选',mode:'retouch',parentId:pinned.id,baseRevision:p.revision,baseFingerprint:fingerprint(p),createdAt:now(),actorId:plan.actorId||diagnosis?.actorId||'host-agent',diagnosisId:diagnosis?.id||null,handoffId:plan.handoffId||null,requestId:text(plan.requestId,80),planHash,goal:text(plan.goal),tradeoff:text(plan.tradeoff),allowProtectedCrop:plan.allowProtectedCrop===true,legacy:false,baseDocument:structuredClone(projectDocument(p,pinned)),documentProposal:structuredClone(plan.documentProposal),selectedItemIds:plan.selectedItemIds||plan.documentProposal.selectedItemIds};
      const candidate=compileCandidate(p,draft);await verifyReferences(root,p,candidate.state);if(signal?.aborted)fail('CANCELLED','文档提案已取消。');p.schema=3;p.candidates.push(candidate);p.revision++;p.updatedAt=now();await atomicWrite(root,p);return {project:p,candidate};
    }
    if(plan.fromCandidate!==undefined){
      if(typeof plan.fromCandidate!=='string'||!plan.fromCandidate)fail('INVALID_PLAN','fromCandidate 必须是候选编号。');
      if(plan.items!==undefined||plan.operations!==undefined)fail('AMBIGUOUS_PLAN','fromCandidate 用于整组精调；逐项计划请直接基于已保存版本提供完整 items。');
      source=p.candidates.find(c=>c.id===plan.fromCandidate);
      if(!source)fail('CANDIDATE_NOT_FOUND','精调所依据的试片已接受或取消，请读取最新版本。');
      source=compileCandidate(p,source);
      if(source.guardOperation)fail('GUARD_SELECTION','解除保护试片需单独预览并接受，不能继续叠加精调。');
    }
    const executable={...plan};delete executable.actorId;delete executable.diagnosisId;delete executable.handoffId;delete executable.policy;delete executable.scopeStepId;delete executable.generatedBy;
    const namespace=toolNamespace||id();
    const normalized=normalizePlan(executable,{base:source.state,notes:p.notes,source:p.source,toolNamespace:namespace,cleanText:cleanTextOverlays});
    if(toolExecution)for(const item of normalized.items){const receipt=toolExecution.find(r=>r.id===item.id);if(receipt)item.execution={...structuredClone(receipt.execution),preview:receipt.preview?Object.fromEntries(['path','width','height','pixelHash','frameSpecHash'].map(k=>[k,receipt.preview[k]])):undefined};}
    if(plan.fromCandidate!==undefined){
      const result=compileSelection(source.state,normalized.items,normalized.selectedItemIds);
      if(result.noChange)fail('NO_CHANGE','这份方案与所选效果一致，可以保留这版，不必重复试片。');
      normalized.items=[snapshotItem(base.state,result.state,plan.name||'整组精调')];
      normalized.selectedItemIds=['whole-plan'];
    }
    const draft={policy,generatedBy:plan.generatedBy||{kind:plan.actorId==='workspace-user'?'user':'agent'},id:id(),handoffId:plan.handoffId||null,name:text(plan.name,40)||'精调候选',mode:plan.mode==='lettering'?'lettering':'retouch',parentId:base.id,...(base.recipe?{recipe:structuredClone(base.recipe)}:{}),...(plan.fromCandidate?{refinedFrom:plan.fromCandidate}:{}),baseRevision:plan.revision,createdAt:now(),...(plan.operations?{toolNamespace:namespace,inheritedToolRuns:versionToolRuns(base)}:{toolRuns:versionToolRuns(base)}),baseFingerprint:fingerprint(p),actorId:plan.actorId||diagnosis?.actorId||'host-agent',diagnosisId:diagnosis?.id||null,goal:text(plan.goal),tradeoff:text(plan.tradeoff),requestId:text(plan.requestId,80),planHash,allowProtectedCrop:plan.allowProtectedCrop===true,...normalized};
    const candidate=compileCandidate(p,draft);
    if(candidate.legacy&&candidate.noChange)fail('NO_CHANGE','这份方案与当前效果一致，可以保留当前版本。');
    await verifyReferences(root,p,candidate.state);
    if(signal?.aborted)fail('CANCELLED','工具方案已取消。');
    p.candidates.push(candidate);p.revision++;p.updatedAt=now();await atomicWrite(root,p);return {project:p,candidate};
  });
}
export const selectCandidateItems=(folder,value)=>mutateProject(folder,value.revision,async(p,root)=>{
  object(value,['id','revision','selectionHash','selectedItemIds']);
  if(!Number.isInteger(value.revision))fail('STALE_REVISION','选择项目需填写最新 revision。');
  const index=p.candidates.findIndex(c=>c.id===value.id),old=p.candidates[index];
  if(!old)fail('CANDIDATE_NOT_FOUND','候选已接受或取消。');
  if(value.selectionHash!==old.selectionHash)fail('STALE_SELECTION','勾选结果已改变。请重新读取候选。');
  if(old.guardOperation)fail('GUARD_SELECTION','解除保护候选必须作为整组预览并接受。');
  const candidate=compileCandidate(p,old,value.selectedItemIds);await verifyReferences(root,p,candidate.state);
  p.candidates[index]=candidate;return {candidate};
});

// Lock/protect creates a no-pixel-change accepted version. Unlock is always a
// candidate because removing a final composite can reveal previously hidden edits.
function validateGuardChange(value) {
  const fields={lock:['parameters','localIds'],unlock:['parameterKeys','localIds','regionIds'],protect:['rect','coordinateSpace','maskType','feather']};
  if(!value||!Object.hasOwn(fields,value.operation))fail('INVALID_GUARD_OPERATION','保护操作支持 lock、protect、unlock。');
  object(value,['revision','operation','name',...fields[value.operation]]);
  if(value.name!==undefined&&typeof value.name!=='string')fail('INVALID_PLAN','保护名称必须是字符串。');
  if(!Number.isInteger(value.revision))fail('STALE_REVISION','保护操作需填写最新 revision。');
}
export async function changeGuards(folder,value,{prepare}={}) {
  validateGuardChange(value);
  if(value.operation==='protect'){
    const {prepareProtection}=await import('./protection-preparation.mjs');
    const prepared=await (prepare||prepareProtection)(folder,value);
    return commitProtection(folder,value,prepared);
  }
  return mutateProject(folder,value.revision,async(p,root)=>{
  const base=currentVersion(p);let state;
  if(value.operation==='lock') state=lockState(base.state,value);
  else if(value.operation==='unlock'){
    state=unlockState(base.state,value);
    if(p.candidates.length>=8)fail('CANDIDATE_LIMIT','请先接受或取消一个候选。');
    const candidate={id:id(),name:text(value.name,40)||'解除保护预览',mode:'guards',parentId:base.id,...(base.recipe?{recipe:structuredClone(base.recipe)}:{}),baseRevision:p.revision,createdAt:now(),toolRuns:versionToolRuns(base),baseFingerprint:fingerprint(p),state,items:[{id:'unlock',title:'解除所选保护',dependsOn:[],writePaths:['guards']}],selectedItemIds:['unlock'],guardOperation:{parameterKeys:value.parameterKeys||[],localIds:value.localIds||[],regionIds:value.regionIds||[]},legacy:false,noChange:false,warnings:['解除区域保护可能显露此前被覆盖的效果，请检查预览。']};
    candidate.selectionHash=selectionIdentity(base,candidate);await verifyReferences(root,p,state);p.candidates.push(candidate);return {candidate};
  }else fail('INVALID_GUARD_OPERATION','保护操作支持 lock、protect、unlock。');
  if(equal(state,base.state))fail('NO_CHANGE','所选保护已经生效。');
  await verifyReferences(root,p,state);
  const version={id:id(),name:text(value.name,40)||(value.operation==='protect'?'保留画面效果':'锁定参数'),mode:'guards',parentId:base.id,...(base.recipe?{recipe:structuredClone(base.recipe)}:{}),createdAt:now(),acceptedAt:now(),state};
  p.versions.push(version);p.currentId=version.id;return {version};
});
}
export async function commitProtection(folder,value,prepared) {
  const {verifyPreparedProtection,discardPreparedProtection}=await import('./protection-preparation.mjs');
  try {
    return await mutateProject(folder,value.revision,async(p,root)=>{
      if(prepared.revision!==p.revision||prepared.baseId!==p.currentId||prepared.projectHash!==hash(p))fail('STALE_REVISION','保护准备期间项目已更新，请重新读取后再保护。');
      validateReferences(p,prepared.state);
      await verifyPreparedProtection(root,prepared);
      const version={id:id(),name:text(value.name,40)||'保留画面效果',mode:'guards',parentId:p.currentId,...(currentVersion(p).recipe?{recipe:structuredClone(currentVersion(p).recipe)}:{}),createdAt:now(),acceptedAt:now(),state:prepared.state};
      p.versions.push(version);p.currentId=version.id;return {version};
    });
  } catch(error) {
    // A duplicate commit or an uncertain write outcome may already have made
    // these files live. Recheck ownership under the same lock before cleanup.
    await locked(folder,async root=>{
      const p=await loadProject(root),referencedPaths=new Set();
      for(const v of [...p.versions,...p.candidates])for(const r of guardsOf(v.state).regions)for(const snapshot of [r.snapshot,r.cleanSnapshot])referencedPaths.add(snapshot.path);
      await discardPreparedProtection(root,prepared,referencedPaths);
    }).catch(()=>{}); // On an unreadable project, retain files rather than risk data loss.
    throw error;
  }
}

export async function saveNote(folder,value) {
  return mutateProject(folder,value.revision,p=>{let note=p.notes.find(n=>n.id===value.id);if(value.id&&!note)fail('NOTE_NOT_FOUND','这处批注已经删除。请读取最新批注。');
    if(!note){if(p.notes.length>=8)fail('NOTE_LIMIT','最多标记 8 处。请先整理已有批注。');const number=Math.max(p.nextNoteNumber||1,p.notes.reduce((n,x)=>Math.max(n,x.number),0)+1);p.nextNoteNumber=number+1;note={id:id(),number,rect:cleanRect(value.rect),note:'',protect:false};p.notes.push(note);}
    if(value.rect)note.rect=cleanRect(value.rect);if(value.note!==undefined)note.note=text(value.note,600);if(value.protect!==undefined)note.protect=Boolean(value.protect);note.updatedAt=now();return {note};
  });
}
export const deleteNote=(folder,value)=>mutateProject(folder,value.revision,p=>{if(!p.notes.some(n=>n.id===value.id))fail('NOTE_NOT_FOUND','标记已删除。');p.notes=p.notes.filter(n=>n.id!==value.id);return {};});
export const setIntent=(folder,value)=>mutateProject(folder,value.revision,p=>{p.intent=text(value.intent);return {};});

export function workspaceSupport(p,state=currentVersion(p).state,notes=p.notes,capabilities=retouchCapabilities({surface:'studio',source:p.source})){
  const covered=Boolean(p.versions.find(v=>v.state===state)?.recipe);
  return negotiateWorkspace(p,state,notes,{...capabilities,workflow:{...capabilities.workflow,reviewed:capabilities.workflow.reviewed&&covered}});
}
export function workspaceLimitations(p,state=currentVersion(p).state,notes=p.notes){return workspaceSupport(p,state,notes).reasons.map(r=>r.message).join(' ');}
function assertWorkspace(p) {
  const limitations=workspaceLimitations(p);
  if(limitations)fail(p.workflow?.mode==='reviewed'?'WORKSPACE_REVIEWED':'WORKSPACE_UNSUPPORTED',limitations);
}
function workspaceSnapshot(p,value,baseState=currentVersion(p).state,{allowImport=false}={}) {
    if(!Array.isArray(value.annotations)||value.annotations.length>8)fail('INVALID_LOCAL','最多保留 8 个标记或局部范围。');
    ids(value.annotations.map(a=>a.id),'INVALID_LOCAL');
    const point=point=>{object(point,['x','y'],'INVALID_MASK');return {x:bounded(point.x,0,1,'INVALID_MASK'),y:bounded(point.y,0,1,'INVALID_MASK')};};
    const notes=[],locals=[];let nextNoteNumber=p.nextNoteNumber||1;
    for(const raw of value.annotations) {
      const rect=cleanRect(raw.rect),old=p.notes.find(n=>n.id===raw.id),note=text(raw.note,600);
      if(raw.hasNote!==false){
        if(raw.number!==undefined&&(!Number.isSafeInteger(raw.number)||raw.number<1))fail('INVALID_LOCAL','批注编号无效。');
        if(raw.protect!==undefined&&typeof raw.protect!=='boolean')fail('INVALID_LOCAL','批注保护设置无效。');
        if(raw.updatedAt!==undefined&&(typeof raw.updatedAt!=='string'||!Number.isFinite(Date.parse(raw.updatedAt))))fail('INVALID_LOCAL','批注时间无效。');
        const number=old?.number || raw.number || Math.max(nextNoteNumber,...p.notes.map(n=>n.number+1));nextNoteNumber=Math.max(nextNoteNumber,number+1);
        const unchanged=old&&equal(old.rect,rect)&&old.note===note;
        notes.push({id:raw.id,number,rect,note,protect:old?old.protect:Boolean(raw.protect),updatedAt:unchanged?old.updatedAt:!old&&raw.updatedAt?raw.updatedAt:now()});
      }
      const settings=cleanSettings(raw.localSettings || {});
      if(Object.values(settings).some(Boolean)||raw.hasLocal){
        const maskType=raw.maskType || 'rectangle';if(!['rectangle','radial','linear','brush'].includes(maskType))fail('INVALID_MASK','不支持的局部范围。');
        const layer={id:raw.id,rect,note,maskType,feather:bounded(raw.feather??.36,0,1,'INVALID_MASK'),localAmount:bounded(raw.localAmount??100,0,150,'INVALID_LOCAL'),localEnabled:raw.localEnabled!==false,localSettings:settings};
        if(raw.target!==undefined){object(raw.target,['kind','name','source','confidence'],'TOOL_TARGET_INVALID');if(raw.target.kind!=='object'||typeof raw.target.name!=='string'||!raw.target.name.trim()||raw.target.name.length>100||!['vision','user'].includes(raw.target.source)||!['high','medium','low'].includes(raw.target.confidence))fail('TOOL_TARGET_INVALID','对象记录无效。');layer.target=structuredClone(raw.target);}
        if(raw.exclude!==undefined){if(!Array.isArray(raw.exclude)||raw.exclude.length>8)fail('INVALID_MASK','排除范围无效。');layer.exclude=raw.exclude.map(r=>cleanRect(r));}
        if(maskType==='linear'){layer.start=point(raw.start);layer.end=point(raw.end);}
        if(maskType==='brush'){if(!Array.isArray(raw.points)||!raw.points.length||raw.points.length>600)fail('INVALID_MASK','画笔范围无效。');layer.points=raw.points.map(point);layer.brushRadius=bounded(raw.brushRadius,.001,.15,'INVALID_MASK');}
        const previous=baseState.locals.find(l=>l.id===raw.id);
        const unchanged=previous&&adjustmentKeys.every(k=>(previous.localSettings?.[k]||0)===(settings[k]||0))&&equal(previous.rect,rect)&&previous.note===note&&(previous.maskType||'rectangle')===maskType&&(previous.feather??.36)===layer.feather&&(previous.localAmount??100)===layer.localAmount&&(previous.localEnabled!==false)===layer.localEnabled&&['start','end','points','brushRadius','exclude','target'].every(k=>equal(previous[k],layer[k]));
        locals.push(unchanged?structuredClone(previous):layer);
      }
    }
    let style=null;
    if(value.style){object(value.style,['id','amount'],'UNKNOWN_STYLE');if(!presetById(value.style.id))fail('UNKNOWN_STYLE','风格不存在。');style={id:value.style.id,amount:bounded(value.style.amount,0,100,'STYLE_AMOUNT')};}
    const crop=value.crop?validCrop(value.crop):null;if(value.crop&&!crop)fail('INVALID_CROP','裁剪范围无效。');
    if(crop?.angle!==undefined)bounded(crop.angle,-15,15,'INVALID_CROP');
    const state={...structuredClone(baseState),settings:{...neutralSettings(),...cleanSettings(value.settings)},style,crop,locals};
    const oldOrder=new Map(p.notes.map((note,index)=>[note.id,index]));
    return {...documentSnapshot(p,value,state,{allowImport}),toolRuns:cleanToolRuns(value.toolRuns===undefined?versionToolRuns(p.versions.find(v=>v.state===baseState)):value.toolRuns),notes:notes.sort((a,b)=>(oldOrder.get(a.id)??Infinity)-(oldOrder.get(b.id)??Infinity)),nextNoteNumber};
}
function versionName(value) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>40)fail('INVALID_VERSION_NAME','版本名称需为 1–40 个字符。');
  return value.trim();
}
// Current edits and imported editions commit together. A retry after a lost response
// reuses the same import identity, without adding duplicate versions.
export async function saveWorkspaceSnapshot(folder,value) {
  object(value,['revision','baseVersion','settings','style','crop','annotations','intent','conversation','toolRuns','name','versions','importId','document']);
  if(!Number.isInteger(value.revision))fail('STALE_REVISION','请先读取最新项目版本。');
  const importing=value.versions!==undefined;
  if(importing&&(!Array.isArray(value.versions)||value.versions.length>40||typeof value.importId!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(value.importId)))fail('INVALID_VERSIONS','迁移需有效编号，最多保留 40 个命名版本。');
  const importHash=importing?hash({...value,revision:undefined,baseVersion:undefined}):null;
  return locked(folder,async root=>{
    const p=await loadProject(root),prior=importing&&p.workspaceImports?.find(v=>v.id===value.importId);
    if(prior){if(prior.hash!==importHash)fail('REQUEST_CONFLICT','这次迁移内容已变化，请使用新的迁移编号。');if(prior.revision!==p.revision)fail('STALE_REVISION','迁移已保存，但项目后来有更新。请从最近项目打开，已有网页草稿仍保留。');return {project:p,version:currentVersion(p),reused:true};}
    expect(p,value.revision);
    if(value.baseVersion!==p.currentId)fail('STALE_REVISION','项目已在另一处更新，请先查看最新版本。');
    assertWorkspace(p);
    const before=currentVersion(p),initial=p.revision===1&&p.versions.length===1,snapshot=workspaceSnapshot(p,value,before.state,{allowImport:initial});
    if(importing){
      for(const v of value.versions)ids([v.id],'INVALID_VERSIONS');
      if(new Set(value.versions.map(v=>v.id)).size!==value.versions.length||p.versions.filter(v=>v.mode==='edition').length+value.versions.length>40)fail('INVALID_VERSIONS','最多保留 40 个独立命名版本。');
      for(const v of value.versions){
        object(v,['id','name','at','kind','patch'],'INVALID_VERSIONS');
        if(p.versions.some(old=>old.id===v.id)||typeof v.at!=='string'||!Number.isFinite(Date.parse(v.at)))fail('INVALID_VERSIONS','历史版本的编号或保存时间无效。');
        const saved=workspaceSnapshot(p,v.patch,p.versions[0].state,{allowImport:initial});
        validateCandidateState({...p,notes:saved.notes},saved.state);await verifyReferences(root,p,saved.state);
        p.versions.push({id:v.id,name:versionName(v.name),parentId:p.versions[0].id,createdAt:v.at,mode:'edition',kind:['manual','export','accepted','final'].includes(v.kind)?v.kind:'manual',state:saved.state,...(saved.recipe?{recipe:saved.recipe}:{}),toolRuns:saved.toolRuns,workspaceNotes:saved.notes});
      }
      p.workspaceImports ||= [];p.workspaceImports.push({id:value.importId,hash:importHash});
    }
    p.notes=snapshot.notes;p.nextNoteNumber=snapshot.nextNoteNumber;p.intent=text(value.intent);
    validateCandidateState(p,snapshot.state);await verifyReferences(root,p,snapshot.state);
    if(!equal(before.state,snapshot.state)||!equal(before.recipe,snapshot.recipe)) {
      const version={id:id(),name:text(value.name,40)||'网页调整',parentId:before.id,createdAt:now(),acceptedAt:now(),acceptedBy:'user',mode:'workspace',state:snapshot.state,...(snapshot.recipe?{recipe:snapshot.recipe}:{}),toolRuns:snapshot.toolRuns,workspaceNotes:structuredClone(p.notes)};
      p.versions.push(version);p.currentId=version.id;p.acceptedId=version.id;
    }
    if(value.conversation!==undefined){
      if(!Array.isArray(value.conversation)||value.conversation.length>24||JSON.stringify(value.conversation).length>256000)fail('INVALID_CONVERSATION','对话记录过长。');
      p.workspaceConversation=value.conversation.map(m=>{
        let proposal={};
        if(m.action?.kind==='document')proposal={id:text(m.id,80),action:{kind:'document',label:text(m.action.label,120),goal:text(m.action.goal,300),tradeoff:text(m.action.tradeoff,300),proposal:normalizeDocumentProposal(m.action.proposal)},scopeStepId:m.scopeStepId||null,applied:Boolean(m.applied),baseSignature:text(m.baseSignature,30000),baseIntent:text(m.baseIntent,180),baseAnnotations:text(m.baseAnnotations,30000)};
        if(m.action?.kind==='tools'){
          const operations=m.action.operations;
          cleanToolRuns([{namespace:text(m.id,80)||'archived',label:text(m.action.label,120)||'工具方案',operations,selectedItemIds:operations.map(op=>op.id),records:[]}]);
          proposal={id:text(m.id,80),action:{kind:'tools',label:text(m.action.label,120),goal:text(m.action.goal,300),tradeoff:text(m.action.tradeoff,300),operations:structuredClone(operations)},applied:Boolean(m.applied),baseSignature:text(m.baseSignature,30000),baseIntent:text(m.baseIntent,180),baseAnnotations:text(m.baseAnnotations,30000)};
        }
        return {role:['user','assistant','status'].includes(m.role)?m.role:'status',text:text(m.text,1600),source:['ai','local'].includes(m.source)?m.source:undefined,...proposal,provenance:m.provenance&&typeof m.provenance.model==='string'?{model:text(m.provenance.model,120),tier:['fast','standard','deep'].includes(m.provenance.tier)?m.provenance.tier:'standard',...(typeof m.provenance.effort==='string'?{effort:text(m.provenance.effort,30)}:{}),...(m.provenance.policy&&typeof m.provenance.policy==='object'&&JSON.stringify(m.provenance.policy).length<=8192?{policy:structuredClone(m.provenance.policy)}:{})}:undefined};
      });
    }
    if(p.versions.some(v=>v.recipe))p.schema=3;p.revision++;p.updatedAt=now();if(importing)p.workspaceImports.at(-1).revision=p.revision;await atomicWrite(root,p);
    return {project:p,version:currentVersion(p)};
  });
}
export const saveWorkspaceEdition=(folder,value)=>mutateProject(folder,value.revision,p=>{
  object(value,['revision','baseVersion','name','kind','patch']);assertWorkspace(p);
  if(!Number.isInteger(value.revision))fail('STALE_REVISION','请先读取最新项目版本。');
  if(value.baseVersion!==p.currentId)fail('STALE_REVISION','当前版本已变化，请重新打开版本面板。');
  if(p.versions.filter(v=>v.mode==='edition').length>=40)fail('VERSION_LIMIT','最多保留 40 个命名版本；已有方案仍保留。');
  let snapshotProject=p;
  if(value.patch?.document&&currentVersion(p).recipe&&documentHash(value.patch.document)!==documentHash(currentVersion(p).recipe)){
    const captured=p.versions.find(version=>version.recipe&&documentHash(version.recipe)===documentHash(value.patch.document));
    if(!captured)fail('DOCUMENT_COMMAND_REQUIRED','命名版本只能保存已确认的配方；新修改需要先通过文档命令。');
    snapshotProject={...p,currentId:captured.id};
  }
  const snapshot=value.patch?workspaceSnapshot(snapshotProject,value.patch):{state:structuredClone(currentVersion(p).state),recipe:structuredClone(currentVersion(p).recipe),notes:structuredClone(p.notes)};
  validateCandidateState({...p,notes:snapshot.notes},snapshot.state);
  const version={id:id(),name:versionName(value.name),parentId:p.currentId,createdAt:now(),mode:'edition',kind:['manual','export','accepted','final'].includes(value.kind)?value.kind:'manual',state:snapshot.state,...(snapshot.recipe?{recipe:snapshot.recipe}:{}),toolRuns:snapshot.toolRuns||versionToolRuns(currentVersion(p)),workspaceNotes:snapshot.notes};
  p.versions.push(version);return {version};
});
export const renameWorkspaceVersion=(folder,value)=>mutateProject(folder,value.revision,p=>{
  object(value,['revision','id','name']);
  if(!Number.isInteger(value.revision))fail('STALE_REVISION','请先读取最新项目版本。');
  const version=p.versions.find(v=>v.id===value.id);if(!version)fail('VERSION_NOT_FOUND','找不到这份已保存版本。');
  version.name=versionName(value.name);return {version};
});
export async function acceptCandidate(folder,value) {
  const acceptedBy=value.acceptedBy===undefined?'user':value.acceptedBy;
  if(!['user','agent'].includes(acceptedBy))fail('ACCEPT_SOURCE','接受来源应为 user 或 agent。');
  if(value.requireAudit!==undefined&&typeof value.requireAudit!=='boolean')fail('AUDIT_INVALID','requireAudit 应为布尔值。');
  return mutateProject(folder,value.revision,async(p,root)=>{
    const existing=p.candidates.find(n=>n.id===value.id);
    if(!existing)fail('CANDIDATE_NOT_FOUND','候选已接受或取消，请读取最新版本。');
    if(!existing.legacy&&(!Number.isInteger(value.revision)||value.selectionHash!==existing.selectionHash))fail('STALE_SELECTION','请使用已查看组合预览的 revision 和 selectionHash。');
    if(value.selectionHash!==undefined&&value.selectionHash!==existing.selectionHash)fail('STALE_SELECTION','预览与当前选择不一致。');
    const c=compileCandidate(p,existing);
    if(c.selectionHash!==existing.selectionHash||!equal(c.state,existing.state))fail('STALE_SELECTION','候选状态与所选项目不一致，请重新生成。');
    if(c.noChange||!c.selectedItemIds.length)fail('NO_CHANGE','没有选中实际修改，当前版本保持不变。');
    assertWorkflowDelivery(p,c,acceptedBy);
    if(value.requireAudit||acceptedBy==='agent'&&p.workflow?.mode==='reviewed'&&c.mode!=='guards'){
      const audit=latestAudit(p,c);
      if(!audit||audit.decision!=='ready'||audit.stateHash!==versionStateHash(c)||audit.selectionHash!==c.selectionHash||audit.pipeline!==versionPipeline(c)||audit.sourceChecksum!==p.source.checksum)fail('RESULT_AUDIT_REQUIRED','这份组合尚未通过成片审核。请查看实际预览、记录问题与修正，再提交 ready 审核。');
      const {previewPhoto}=await import('./render.mjs');
      const preview=await previewPhoto(root,c.id,{maxSide:audit.maxSide});
      if(preview.pixelHash!==audit.pixelHash||preview.frameSpecHash!==audit.frameSpecHash)fail('AUDIT_PREVIEW_MISMATCH','当前画面不能复现已审核预览，请重新查看并审核。');
    }
    await verifyReferences(root,p,c.state);
    const version={...c,baseFingerprint:undefined,planHash:undefined,baseDocument:undefined,documentProposal:undefined,acceptedAt:now(),acceptedBy};
    p.versions.push(version);p.currentId=c.id;p.acceptedId=c.id;p.candidates=p.candidates.filter(x=>x.id!==c.id);
    if(c.mode!=='guards'&&acceptedBy==='user')p.choices.push({versionId:c.id,name:c.name,mode:c.mode||'retouch',intent:p.intent,acceptedAt:now(),selectedItemIds:[...c.selectedItemIds],items:c.items.filter(i=>c.selectedItemIds.includes(i.id)),state:structuredClone(c.state),...(c.recipe?{recipe:structuredClone(c.recipe)}:{})});
    return {version};
  });
}
export const discardCandidate=(folder,value)=>mutateProject(folder,value.revision,p=>{if(!p.candidates.some(n=>n.id===value.id))fail('CANDIDATE_NOT_FOUND','候选已经取消。');p.candidates=p.candidates.filter(x=>x.id!==value.id);return {};});
export const restoreVersion=(folder,value)=>mutateProject(folder,value.revision,async(p,root)=>{
  const target=p.versions.find(v=>v.id===value.id);if(!target)fail('VERSION_NOT_FOUND','只能恢复已经保存的版本。');
  const base=currentVersion(p),state=structuredClone(target.state);state.guards=mergeRestoreGuards(base.state,target.state);
  const live=guardsOf(base.state);if((live.parameters.length||live.locals.length)&&(base.recipe||target.recipe)&&renderHash(projectDocument(p,base))!==renderHash(projectDocument(p,target)))fail('LOCK_CONFLICT','恢复会改变已冻结的顺序步骤，请先显式解除参数或局部锁。');
  assertGuards(base.state,state,{allowGuardChange:true});await verifyReferences(root,p,state);
  let version=target;
  if(target.recipe&&base.recipe){const recipe=structuredClone(target.recipe);recipe.revision=Math.max(base.recipe.revision,recipe.revision)+1;recipe.receipts=[];version={id:id(),name:`恢复：${target.name}`,parentId:base.id,restoredFrom:target.id,createdAt:now(),acceptedAt:now(),state,recipe};p.versions.push(version);}
  else if(!equal(state,target.state)){version={id:id(),name:`恢复：${target.name}`,parentId:base.id,...(target.recipe?{recipe:structuredClone(target.recipe)}:{}),restoredFrom:target.id,createdAt:now(),acceptedAt:now(),state};p.versions.push(version);}
  if(target.workspaceNotes)p.notes=structuredClone(target.workspaceNotes);
  p.currentId=version.id;return {version};
});
export const saveReview=(folder,value)=>mutateProject(folder,value.revision,p=>{const summary=text(value.summary,1200);if(!summary)fail('EMPTY_REVIEW','请写明实际画面观察或保留原片的依据。');
  const review={id:id(),versionId:p.currentId,intent:p.intent,createdAt:now(),source:'host-agent',summary,preserve:Array.isArray(value.preserve)?value.preserve.slice(0,6).map(x=>text(x)):[],model:text(value.model,80)};p.reviews.push(review);p.reviews=p.reviews.slice(-30);return {review};});
export async function saveResultAudit(folder,value,{signal,renderPreview}={}){
  object(value,['revision','versionId','maxSide','pixelHash','frameSpecHash','selectionHash','decision','summary','checked','strengths','issues','reviewer','resolutions','policy'],'AUDIT_INVALID');
  const nonempty=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
  if(!Number.isInteger(value.revision)||!nonempty(value.versionId,80)||!Number.isInteger(value.maxSide)||value.maxSide<512||value.maxSide>8192)fail('AUDIT_INVALID','审核需真实版本与查看尺寸。');
  const content=normalizeAuditContent(Object.fromEntries(['decision','summary','checked','strengths','issues','resolutions'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]])));
  const policy=value.policy?await verifyPolicyProvenance(value.policy):null;
  return mutateProject(folder,value.revision,async(p,root)=>{
    const version=findVersion(p,value.versionId);
    if(p.candidates.some(c=>c.id===version.id)&&version.baseFingerprint!==fingerprint(p))fail('STALE_CANDIDATE','审核目标已过期，请重新试片。');
    const {previewPhoto}=await import('./render.mjs');
    const preview=await (renderPreview||previewPhoto)(root,version.id,{maxSide:value.maxSide});
    if(value.pixelHash!==preview.pixelHash||value.frameSpecHash!==preview.frameSpecHash||value.selectionHash!==preview.selectionHash)fail('AUDIT_PREVIEW_MISMATCH','审核的画面与当前组合不一致，请读取并实际查看最新预览。');
    let reviewer=null;
    if(value.reviewer){
      object(value.reviewer,['id','mode','packetId'],'AUDIT_INVALID');
      if(!nonempty(value.reviewer.id,80)||!['self','independent'].includes(value.reviewer.mode))fail('AUDIT_INVALID','审片者需有效身份与 self/independent 来源。');
      if(value.reviewer.mode==='independent'){
        const packet=(p.reviewPackets||[]).find(r=>r.id===value.reviewer.packetId);
        if(!packet||packet.versionId!==version.id||packet.contextHash!==fingerprint(p)||packet.images.trial.pixelHash!==preview.pixelHash||packet.images.trial.frameSpecHash!==preview.frameSpecHash||packet.images.trial.selectionHash!==preview.selectionHash)fail('REVIEW_PACKET_STALE','独立复审任务包与这份试片不一致。');
        if(value.reviewer.id===packet.creatorId)fail('REVIEWER_NOT_INDEPENDENT','同一作者可以自审，不能声明为独立审片者。');
      }
      reviewer=structuredClone(value.reviewer);
    }
    const diagnosis=(p.diagnoses||[]).find(d=>d.id===version.diagnosisId),resolutions=value.resolutions||[];
    if(!Array.isArray(resolutions)||resolutions.length>12||new Set(resolutions.map(r=>r.findingId)).size!==resolutions.length)fail('AUDIT_INVALID','诊断复评记录无效。');
    for(const r of resolutions){object(r,['findingId','status','evidence'],'AUDIT_INVALID');if(!diagnosis?.findings.some(f=>f.id===r.findingId)||!['resolved','preserved','unresolved'].includes(r.status)||!nonempty(r.evidence,500))fail('AUDIT_INVALID','复评需对应诊断编号、结果与可见依据。');}
    if(value.decision==='ready'&&resolutions.some(r=>r.status==='unresolved'&&diagnosis?.findings.find(f=>f.id===r.findingId)?.priority==='blocking'))fail('AUDIT_NOT_READY','仍有未解决的诊断，不应记录 ready。');
    signal?.throwIfAborted();
    const audit={...content,policy,targetHash:auditTargetHash(p,version),viewing:{kind:'preview',maxSide:value.maxSide,width:preview.width,height:preview.height},id:id(),versionId:version.id,createdAt:now(),contextHash:fingerprint(p),reviewer,resolutions:structuredClone(resolutions),diagnosisId:version.diagnosisId||null,source:'host-agent-result-audit',intent:p.intent,decision:value.decision,summary:value.summary.trim(),checked:value.checked.map(s=>s.trim()),strengths:value.strengths.map(s=>s.trim()),issues:structuredClone(value.issues),selectionHash:preview.selectionHash,stateHash:preview.stateHash,pixelHash:preview.pixelHash,frameSpecHash:preview.frameSpecHash,frameSpec:preview.frameSpec,maxSide:value.maxSide,width:preview.width,height:preview.height,pipeline:preview.pipeline,sourceChecksum:p.source.checksum};
    p.resultAudits??=[];p.resultAudits.push(audit);p.resultAudits=p.resultAudits.slice(-40);
    return {audit,limitation:'身份核对只确认记录对应哪张预览；审美判断由实际看图的宿主 Agent 提供，工具不会自动评美。'};
  });
}
export const saveFeedback=async(folder,value)=>{
  object(value,['revision','versionId','verdict','reason'],'FEEDBACK_INVALID');
  if(!Number.isInteger(value.revision)||!['reject','prefer','neutral'].includes(value.verdict)||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>600)fail('FEEDBACK_INVALID','反馈需最新 revision、已保存 versionId、reject/prefer/neutral 和具体原因。只记录用户明确表达的选择。');
  return mutateProject(folder,value.revision,p=>{
    const version=p.versions.find(v=>v.id===value.versionId);if(!version)fail('VERSION_NOT_FOUND','反馈需对应已保存的版本；试片可以直接取消。');
    const feedback={id:id(),versionId:version.id,verdict:value.verdict,reason:value.reason.trim(),createdAt:now(),source:'user-feedback'};
    p.feedback??=[];p.feedback.push(feedback);
    if(value.verdict==='prefer'&&!p.choices.some(c=>c.versionId===version.id))p.choices.push({versionId:version.id,name:version.name,mode:version.mode||'retouch',intent:p.intent,acceptedAt:feedback.createdAt,source:'user-feedback',selectedItemIds:version.selectedItemIds||[],items:version.items||[],state:structuredClone(version.state)});
    return {feedback};
  });
};
export function preferenceChoices(p){
  const latest=new Map((p.feedback||[]).map(f=>[f.versionId,f]));
  return (p.choices||[]).filter(c=>{const feedback=latest.get(c.versionId);return feedback?feedback.verdict==='prefer':p.versions.find(v=>v.id===c.versionId)?.acceptedBy!=='agent';});
}
export const recordExport=(folder,value)=>mutateProject(folder,undefined,p=>{if(!p.versions.some(v=>v.id===value.versionId))fail('VERSION_NOT_FOUND','导出版本必须已保存。');p.exports.push({...value,createdAt:now()});return {};});
export function publicProject(p) {
  const capabilities=retouchCapabilities({source:p.source});
  return {...p,capabilities,workspaceSupport:workspaceSupport(p),documentContext:projectDocument(p),currentAudit:currentVersion(p)?latestAudit(p,currentVersion(p))||null:null,collaboration:handoffView(p),workflowStatus:workflowStatus(p),preferenceChoices:preferenceChoices(p),protectionLimits,candidates:p.candidates.map(c=>({...c,stale:c.baseFingerprint!==fingerprint(p)})),lettering:letteringCapabilities(),styles:presets.map(({id,name,category,mood,groups,adjustments})=>({id,name,category,mood,groups,adjustments})),parameters:adjustmentKeys.map(key=>({key,range:settingsBounds(key)})),limitations:capabilities.limitations};
}
