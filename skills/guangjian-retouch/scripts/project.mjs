import {readFile,writeFile,mkdir,rename,rm,stat,open} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {adjustmentKeys,neutralSettings} from './engine/editor-engine.js';
import {presets,presetById} from './engine/presets.js';
import {validCrop} from './engine/crop-utils.js';
import {cleanTextOverlays,validateTextComposition,letteringCapabilities} from './text-overlays.mjs';
import {outputGeometry} from './engine/export-settings.js';
import {PhotoError,fail,cleanSettings,cleanRect,settingsBounds,object,equal} from './engine/edit-values.js';
import {hash,legacyHash,pipelineVersion,selectionIdentity} from './engine/edit-identity.js';
import {normalizePlan,compileSelection,checkProtectedCrop,snapshotItem} from './engine/edit-plan.js';
import {emptyGuards,guardsOf,assertGuards,lockState,unlockState,validateGuards,geometryOf,mergeRestoreGuards} from './engine/edit-guards.js';
import {validateReferences,verifyReferences,protectionLimits} from './reference-store.mjs';
export {PhotoError,fail,cleanSettings,cleanRect,settingsBounds,hash};
const text=(v,max=300)=>String(v??'').trim().slice(0,max),id=()=>randomUUID(),now=()=>new Date().toISOString();
const fingerprint=p=>hash({current:p.currentId,state:currentVersion(p)?.state,source:p.source,intent:p.intent,notes:p.notes,pipeline:pipelineVersion});
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
  if(![1,2].includes(p.schema) || !Number.isInteger(p.revision)||!Array.isArray(p.versions)||!p.versions.length || !Array.isArray(p.notes)||!Array.isArray(p.candidates)||!currentVersion(p)||!Number.isInteger(p.source?.width)||!Number.isInteger(p.source?.height)||p.source.width<1||p.source.height<1||p.source.width*p.source.height>50_000_000)fail('INVALID_PROJECT','项目记录不完整。请保留目录，使用备份恢复。');
  if(p.schema===1) migrateLegacy(p);
  if(new Set([...p.versions,...p.candidates].map(v=>v.id)).size!==p.versions.length+p.candidates.length)fail('INVALID_PROJECT','版本编号重复。');
  for(const v of [...p.versions,...p.candidates]){
    cleanSettings(v.state?.settings);cleanTextOverlays(v.state?.textOverlays);
    if(v.state?.style && (!presetById(v.state.style.id)||!Number.isFinite(v.state.style.amount)||v.state.style.amount<0||v.state.style.amount>100))fail('INVALID_PROJECT','版本风格记录无效。');
    if(v.state?.crop && (!validCrop(v.state.crop)||v.state.crop.angle!==undefined&&(!Number.isFinite(v.state.crop.angle)||Math.abs(v.state.crop.angle)>15)))fail('INVALID_PROJECT','版本裁剪记录无效。');
    if(!Array.isArray(v.state?.locals)||v.state.locals.length>8)fail('INVALID_PROJECT','版本局部记录无效。');
    for(const l of v.state.locals){cleanRect(l.rect);cleanSettings(l.localSettings);}
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
  const temp=path.join(folder,`.project-${id()}.tmp`),file=path.join(folder,'project.json');
  const previous=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(previous&&JSON.parse(previous).schema===1)await writeFile(path.join(folder,'project.schema-1.backup.json'),previous,{flag:'wx',mode:0o600}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(p,null,2));await handle.sync();}finally{await handle.close();}
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
async function mutate(folder,revision,fn) {
  return locked(folder,async root=>{const p=await loadProject(root);expect(p,revision);const result=await fn(p,root);p.revision++;p.updatedAt=now();await atomicWrite(root,p);return {project:p,...result};});
}
export async function initProject(image,folder,{intent=''}={}) {
  folder=path.resolve(folder);const bytes=await readFile(path.resolve(image));
  if(bytes.length>30*1024*1024 || !bytes.length)fail('IMAGE_SIZE','照片为空或超过 30 MB，请转换成较小的 JPEG/PNG 后重新加入。');
  let metadata,normalized,info;
  try{metadata=await sharp(bytes,{limitInputPixels:50_000_000}).metadata();
    if(!['jpeg','png','webp','avif','heif'].includes(metadata.format) || (metadata.pages||1)>1)fail('IMAGE_FORMAT','本版支持静态 JPEG、PNG、WebP、AVIF；HEIC、RAW、TIFF 请先转成 JPEG/PNG。');
    if(metadata.format==='heif' && metadata.compression!=='av1')fail('IMAGE_FORMAT','HEIC 请先转成 JPEG/PNG。');
    if(Math.max(metadata.width,metadata.height)>16384)fail('IMAGE_SIZE','最长边超过 16384 像素，请先缩小照片。');
    normalized=await sharp(bytes,{limitInputPixels:50_000_000}).rotate().toColourspace('srgb').ensureAlpha().png().toBuffer();info=await sharp(normalized).metadata();
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
  const compiled=compileSelection(base.state,c.items,selected),warnings=validateCandidateState(p,compiled.state,c.allowProtectedCrop);
  return {...c,...compiled,warnings,selectionHash:selectionIdentity(base,{...c,...compiled})};
}
export async function createCandidate(folder,plan) {
  if(!plan || typeof plan!=='object' || Array.isArray(plan))fail('INVALID_PLAN','请提供候选方案 JSON。');
  return locked(folder,async root=>{
    const p=await loadProject(root),prior=p.candidates.find(c=>plan.requestId&&c.requestId===plan.requestId),planHash=hash(plan);
    if(prior){if(prior.planHash!==planHash&&!(prior.legacy&&prior.planHash===legacyHash(plan)))fail('REQUEST_CONFLICT','同一请求编号对应不同方案，请使用新编号。');return {project:p,candidate:prior,reused:true};}
    if(!Number.isInteger(plan.revision)||plan.baseVersion!==p.currentId)fail('STALE_REVISION','方案需填写 inspect 返回的 revision 和 currentId。');expect(p,plan.revision);
    if(p.candidates.length>=8)fail('CANDIDATE_LIMIT','最多保留 8 个候选。请接受或取消一个后继续。');
    const base=currentVersion(p);let source=base;
    if(plan.fromCandidate!==undefined){
      if(typeof plan.fromCandidate!=='string'||!plan.fromCandidate)fail('INVALID_PLAN','fromCandidate 必须是候选编号。');
      if(plan.items!==undefined)fail('AMBIGUOUS_PLAN','fromCandidate 用于整组精调；逐项计划请直接基于已保存版本提供完整 items。');
      source=p.candidates.find(c=>c.id===plan.fromCandidate);
      if(!source)fail('CANDIDATE_NOT_FOUND','精调所依据的试片已接受或取消，请读取最新版本。');
      source=compileCandidate(p,source);
      if(source.guardOperation)fail('GUARD_SELECTION','解除保护试片需单独预览并接受，不能继续叠加精调。');
    }
    const normalized=normalizePlan(plan,{base:source.state,notes:p.notes,cleanText:cleanTextOverlays});
    if(plan.fromCandidate!==undefined){
      const result=compileSelection(source.state,normalized.items,normalized.selectedItemIds);
      if(result.noChange)fail('NO_CHANGE','这份方案与所选效果一致，可以保留这版，不必重复试片。');
      normalized.items=[snapshotItem(base.state,result.state,plan.name||'整组精调')];
      normalized.selectedItemIds=['whole-plan'];
    }
    const draft={id:id(),name:text(plan.name,40)||'精调候选',mode:plan.mode==='lettering'?'lettering':'retouch',parentId:base.id,...(plan.fromCandidate?{refinedFrom:plan.fromCandidate}:{}),baseRevision:plan.revision,createdAt:now(),baseFingerprint:fingerprint(p),goal:text(plan.goal),tradeoff:text(plan.tradeoff),requestId:text(plan.requestId,80),planHash,allowProtectedCrop:plan.allowProtectedCrop===true,...normalized};
    const candidate=compileCandidate(p,draft);
    if(candidate.legacy&&candidate.noChange)fail('NO_CHANGE','这份方案与当前效果一致，可以保留当前版本。');
    await verifyReferences(root,p,candidate.state);
    p.candidates.push(candidate);p.revision++;p.updatedAt=now();await atomicWrite(root,p);return {project:p,candidate};
  });
}
export const selectCandidateItems=(folder,value)=>mutate(folder,value.revision,async(p,root)=>{
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
  return mutate(folder,value.revision,async(p,root)=>{
  const base=currentVersion(p);let state;
  if(value.operation==='lock') state=lockState(base.state,value);
  else if(value.operation==='unlock'){
    state=unlockState(base.state,value);
    if(p.candidates.length>=8)fail('CANDIDATE_LIMIT','请先接受或取消一个候选。');
    const candidate={id:id(),name:text(value.name,40)||'解除保护预览',mode:'guards',parentId:base.id,baseRevision:p.revision,createdAt:now(),baseFingerprint:fingerprint(p),state,items:[{id:'unlock',title:'解除所选保护',dependsOn:[],writePaths:['guards']}],selectedItemIds:['unlock'],guardOperation:{parameterKeys:value.parameterKeys||[],localIds:value.localIds||[],regionIds:value.regionIds||[]},legacy:false,noChange:false,warnings:['解除区域保护可能显露此前被覆盖的效果，请检查预览。']};
    candidate.selectionHash=selectionIdentity(base,candidate);await verifyReferences(root,p,state);p.candidates.push(candidate);return {candidate};
  }else fail('INVALID_GUARD_OPERATION','保护操作支持 lock、protect、unlock。');
  if(equal(state,base.state))fail('NO_CHANGE','所选保护已经生效。');
  await verifyReferences(root,p,state);
  const version={id:id(),name:text(value.name,40)||(value.operation==='protect'?'保留画面效果':'锁定参数'),mode:'guards',parentId:base.id,createdAt:now(),acceptedAt:now(),state};
  p.versions.push(version);p.currentId=version.id;return {version};
});
}
export async function commitProtection(folder,value,prepared) {
  const {verifyPreparedProtection,discardPreparedProtection}=await import('./protection-preparation.mjs');
  try {
    return await mutate(folder,value.revision,async(p,root)=>{
      if(prepared.revision!==p.revision||prepared.baseId!==p.currentId||prepared.projectHash!==hash(p))fail('STALE_REVISION','保护准备期间项目已更新，请重新读取后再保护。');
      validateReferences(p,prepared.state);
      await verifyPreparedProtection(root,prepared);
      const version={id:id(),name:text(value.name,40)||'保留画面效果',mode:'guards',parentId:p.currentId,createdAt:now(),acceptedAt:now(),state:prepared.state};
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
  return mutate(folder,value.revision,p=>{let note=p.notes.find(n=>n.id===value.id);if(value.id&&!note)fail('NOTE_NOT_FOUND','这处批注已经删除。请读取最新批注。');
    if(!note){if(p.notes.length>=8)fail('NOTE_LIMIT','最多标记 8 处。请先整理已有批注。');const number=Math.max(p.nextNoteNumber||1,p.notes.reduce((n,x)=>Math.max(n,x.number),0)+1);p.nextNoteNumber=number+1;note={id:id(),number,rect:cleanRect(value.rect),note:'',protect:false};p.notes.push(note);}
    if(value.rect)note.rect=cleanRect(value.rect);if(value.note!==undefined)note.note=text(value.note,600);if(value.protect!==undefined)note.protect=Boolean(value.protect);note.updatedAt=now();return {note};
  });
}
export const deleteNote=(folder,value)=>mutate(folder,value.revision,p=>{if(!p.notes.some(n=>n.id===value.id))fail('NOTE_NOT_FOUND','标记已删除。');p.notes=p.notes.filter(n=>n.id!==value.id);return {};});
export const setIntent=(folder,value)=>mutate(folder,value.revision,p=>{p.intent=text(value.intent);return {};});
export async function acceptCandidate(folder,value) {
  const acceptedBy=value.acceptedBy===undefined?'user':value.acceptedBy;
  if(!['user','agent'].includes(acceptedBy))fail('ACCEPT_SOURCE','接受来源应为 user 或 agent。');
  if(value.requireAudit!==undefined&&typeof value.requireAudit!=='boolean')fail('AUDIT_INVALID','requireAudit 应为布尔值。');
  return mutate(folder,value.revision,async(p,root)=>{
    const existing=p.candidates.find(n=>n.id===value.id);
    if(!existing)fail('CANDIDATE_NOT_FOUND','候选已接受或取消，请读取最新版本。');
    if(!existing.legacy&&(!Number.isInteger(value.revision)||value.selectionHash!==existing.selectionHash))fail('STALE_SELECTION','请使用已查看组合预览的 revision 和 selectionHash。');
    if(value.selectionHash!==undefined&&value.selectionHash!==existing.selectionHash)fail('STALE_SELECTION','预览与当前选择不一致。');
    const c=compileCandidate(p,existing);
    if(c.selectionHash!==existing.selectionHash||!equal(c.state,existing.state))fail('STALE_SELECTION','候选状态与所选项目不一致，请重新生成。');
    if(c.noChange||!c.selectedItemIds.length)fail('NO_CHANGE','没有选中实际修改，当前版本保持不变。');
    if(value.requireAudit){
      const audit=[...(p.resultAudits||[])].reverse().find(a=>a.versionId===c.id);
      if(!audit||audit.decision!=='ready'||audit.stateHash!==hash(c.state)||audit.selectionHash!==c.selectionHash||audit.pipeline!==pipelineVersion||audit.sourceChecksum!==p.source.checksum)fail('RESULT_AUDIT_REQUIRED','这份组合尚未通过成片审核。请查看实际预览、记录问题与修正，再提交 ready 审核。');
      const {previewPhoto}=await import('./render.mjs');
      const preview=await previewPhoto(root,c.id,{maxSide:audit.maxSide});
      if(preview.pixelHash!==audit.pixelHash||preview.frameSpecHash!==audit.frameSpecHash)fail('AUDIT_PREVIEW_MISMATCH','当前画面不能复现已审核预览，请重新查看并审核。');
    }
    await verifyReferences(root,p,c.state);
    const version={...c,baseFingerprint:undefined,planHash:undefined,acceptedAt:now(),acceptedBy};
    p.versions.push(version);p.currentId=c.id;p.acceptedId=c.id;p.candidates=p.candidates.filter(x=>x.id!==c.id);
    if(c.mode!=='guards'&&acceptedBy==='user')p.choices.push({versionId:c.id,name:c.name,mode:c.mode||'retouch',intent:p.intent,acceptedAt:now(),selectedItemIds:[...c.selectedItemIds],items:c.items.filter(i=>c.selectedItemIds.includes(i.id)),state:structuredClone(c.state)});
    return {version};
  });
}
export const discardCandidate=(folder,value)=>mutate(folder,value.revision,p=>{if(!p.candidates.some(n=>n.id===value.id))fail('CANDIDATE_NOT_FOUND','候选已经取消。');p.candidates=p.candidates.filter(x=>x.id!==value.id);return {};});
export const restoreVersion=(folder,value)=>mutate(folder,value.revision,async(p,root)=>{
  const target=p.versions.find(v=>v.id===value.id);if(!target)fail('VERSION_NOT_FOUND','只能恢复已经保存的版本。');
  const base=currentVersion(p),state=structuredClone(target.state);state.guards=mergeRestoreGuards(base.state,target.state);
  assertGuards(base.state,state,{allowGuardChange:true});await verifyReferences(root,p,state);
  let version=target;
  if(!equal(state,target.state)){version={id:id(),name:`恢复：${target.name}`,parentId:base.id,restoredFrom:target.id,createdAt:now(),acceptedAt:now(),state};p.versions.push(version);}
  p.currentId=version.id;return {version};
});
export const saveReview=(folder,value)=>mutate(folder,value.revision,p=>{const summary=text(value.summary,1200);if(!summary)fail('EMPTY_REVIEW','请写明实际画面观察或保留原片的依据。');
  const review={id:id(),versionId:p.currentId,intent:p.intent,createdAt:now(),source:'host-agent',summary,preserve:Array.isArray(value.preserve)?value.preserve.slice(0,6).map(x=>text(x)):[],model:text(value.model,80)};p.reviews.push(review);p.reviews=p.reviews.slice(-30);return {review};});
export async function saveResultAudit(folder,value){
  object(value,['revision','versionId','maxSide','pixelHash','frameSpecHash','selectionHash','decision','summary','checked','strengths','issues'],'AUDIT_INVALID');
  const nonempty=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
  if(!Number.isInteger(value.revision)||!nonempty(value.versionId,80)||!Number.isInteger(value.maxSide)||value.maxSide<512||value.maxSide>8192||!['ready','revise','reject'].includes(value.decision)||!nonempty(value.summary,1200)||!Array.isArray(value.checked)||value.checked.length<1||value.checked.length>8||value.checked.some(s=>!nonempty(s,300))||!Array.isArray(value.strengths)||value.strengths.length>6||value.strengths.some(s=>!nonempty(s,300))||!Array.isArray(value.issues)||value.issues.length>8)fail('AUDIT_INVALID','审核需版本、真实预览身份、检查位置、观察、保留关系与 ready/revise/reject 决定。');
  for(const issue of value.issues){object(issue,['area','observation','nextAction','severity'],'AUDIT_INVALID');if(!nonempty(issue.area,80)||!nonempty(issue.observation,400)||!nonempty(issue.nextAction,400)||!['blocking','minor'].includes(issue.severity))fail('AUDIT_INVALID','每个问题需位置、可见依据、下一步处理与 blocking/minor 级别。');}
  if(value.decision==='ready'&&value.issues.some(i=>i.severity==='blocking'))fail('AUDIT_NOT_READY','仍有阻碍交付的问题，应先修改或撤回，不能记为 ready。');
  if(value.decision!=='ready'&&!value.issues.length)fail('AUDIT_INVALID','修改或撤回需至少一个具体问题。');
  return mutate(folder,value.revision,async(p,root)=>{
    const version=findVersion(p,value.versionId);
    if(p.candidates.some(c=>c.id===version.id)&&version.baseFingerprint!==fingerprint(p))fail('STALE_CANDIDATE','审核目标已过期，请重新试片。');
    const {previewPhoto}=await import('./render.mjs');
    const preview=await previewPhoto(root,version.id,{maxSide:value.maxSide});
    if(value.pixelHash!==preview.pixelHash||value.frameSpecHash!==preview.frameSpecHash||value.selectionHash!==preview.selectionHash)fail('AUDIT_PREVIEW_MISMATCH','审核的画面与当前组合不一致，请读取并实际查看最新预览。');
    const audit={id:id(),versionId:version.id,createdAt:now(),source:'host-agent-result-audit',intent:p.intent,decision:value.decision,summary:value.summary.trim(),checked:value.checked.map(s=>s.trim()),strengths:value.strengths.map(s=>s.trim()),issues:structuredClone(value.issues),selectionHash:preview.selectionHash,stateHash:preview.stateHash,pixelHash:preview.pixelHash,frameSpecHash:preview.frameSpecHash,frameSpec:preview.frameSpec,maxSide:value.maxSide,width:preview.width,height:preview.height,pipeline:preview.pipeline,sourceChecksum:p.source.checksum};
    p.resultAudits??=[];p.resultAudits.push(audit);p.resultAudits=p.resultAudits.slice(-40);
    return {audit,limitation:'身份核对只确认记录对应哪张预览；审美判断由实际看图的宿主 Agent 提供，工具不会自动评美。'};
  });
}
export const saveFeedback=async(folder,value)=>{
  object(value,['revision','versionId','verdict','reason'],'FEEDBACK_INVALID');
  if(!Number.isInteger(value.revision)||!['reject','prefer','neutral'].includes(value.verdict)||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>600)fail('FEEDBACK_INVALID','反馈需最新 revision、已保存 versionId、reject/prefer/neutral 和具体原因。只记录用户明确表达的选择。');
  return mutate(folder,value.revision,p=>{
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
export const recordExport=(folder,value)=>mutate(folder,undefined,p=>{if(!p.versions.some(v=>v.id===value.versionId))fail('VERSION_NOT_FOUND','导出版本必须已保存。');p.exports.push({...value,createdAt:now()});return {};});
export function publicProject(p) {
  return {...p,preferenceChoices:preferenceChoices(p),protectionLimits,candidates:p.candidates.map(c=>({...c,stale:c.baseFingerprint!==fingerprint(p)})),lettering:letteringCapabilities(),styles:presets.map(({id,name,category,mood,groups,adjustments})=>({id,name,category,mood,groups,adjustments})),parameters:adjustmentKeys.map(key=>({key,range:settingsBounds(key)})),limitations:['8 位 sRGB；JPEG/PNG/WebP/AVIF 输入，JPEG/PNG 输出','输出最多 8192 px / 1600 万像素；局部范围是几何蒙版，不是自动主体分割','工具不调用模型；审片笔记来自宿主 Agent，图像统计不是审美结论']};
}
