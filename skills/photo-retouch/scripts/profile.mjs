import {readFile,writeFile,rename,mkdir,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadProject,preferenceChoices} from './project.mjs';
import {hash} from './engine/edit-identity.js';
import {object,fail} from './engine/edit-values.js';
const text=(s,n=300)=>typeof s==='string'&&s.trim()&&s.length<=n;
async function readProfile(file){
  if((await stat(file)).size>1024*1024)fail('PROFILE_INVALID','偏好档案过大，请整理后再读取。');
  let p;try{p=JSON.parse(await readFile(file,'utf8'));}catch{fail('PROFILE_INVALID','偏好档案无法读取，原文件未改动。');}
  if(p.schema!=='frameyn-preferences/1'||!Array.isArray(p.entries)||p.entries.length>500||new Set(p.entries.map(e=>e.id)).size!==p.entries.length||p.entries.some(e=>!text(e.id,80)||!text(e.subject,80)||!text(e.lighting,120)||!text(e.reason,600)||!['prefer','reject'].includes(e.signal)))fail('PROFILE_INVALID','偏好记录不完整，请保留文件并从备份恢复。');return p;
}
async function updateProfile(file,fn){
  const lock=file+'.lock';try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')fail('PROFILE_BUSY','另一项偏好更新正在进行；请检查进程后重试。');throw e;}
  const temp=file+'.'+randomUUID()+'.tmp';
  try{const p=await readProfile(file),result=await fn(p);p.updatedAt=new Date().toISOString();await writeFile(temp,JSON.stringify(p,null,2),{flag:'wx',mode:0o600});await rename(temp,file);return {profile:p,...result};}
  finally{await rm(temp,{force:true});await rm(lock,{recursive:true,force:true});}
}
export async function initProfile(file,name='我的摄影偏好'){
  const profile={schema:'frameyn-preferences/1',id:randomUUID(),name:String(name).slice(0,80),createdAt:new Date().toISOString(),entries:[]};
  try{await writeFile(file,JSON.stringify(profile,null,2),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')fail('PROFILE_EXISTS','已有偏好档案，请读取或选择新路径。');throw e;}return {path:path.resolve(file),profile};
}
export async function inspectProfile(file,{subject,lighting}={}){
  const p=await readProfile(file);return {profile:p,matches:p.entries.filter(e=>(!subject||e.subject===subject)&&(!lighting||e.lighting===lighting)),guidance:'当前创作意图优先。档案记录是有条件的用户选择，不自动转换成调色参数；相同题材、光线的证据优先。'};
}
export async function learnProfile(folder,file,value){
  object(value,['revision','versionId','subject','lighting','reason'],'PROFILE_INVALID');
  if(!Number.isInteger(value.revision)||!text(value.subject,80)||!text(value.lighting,120)||!text(value.reason,600))fail('PROFILE_INVALID','记录需当前 revision、版本、题材、光线及用户明确表达的理由。');
  const p=await loadProject(folder),v=p.versions.find(v=>v.id===value.versionId);
  if(value.revision!==p.revision)fail('STALE_REVISION','项目反馈已改变，请重新读取。');
  if(!v)fail('VERSION_NOT_FOUND','偏好需对应已保存版本。');
  const feedback=(p.feedback||[]).findLast(f=>f.versionId===v.id),choice=preferenceChoices(p).find(c=>c.versionId===v.id);
  if(feedback?.verdict==='neutral')return updateProfile(file,async q=>{
    if((await loadProject(folder)).revision!==p.revision)fail('STALE_REVISION','学习期间用户反馈已改变，请重新读取。');
    const count=q.entries.length;q.entries=q.entries.filter(e=>!(e.projectId===p.id&&e.versionId===v.id));
    return {removed:count-q.entries.length,guidance:'仅保留为试片的版本已移出偏好档案，不新增偏好。'};
  });
  const signal=feedback?.verdict==='reject'?'reject':choice?'prefer':null;
  if(!signal)fail('USER_PREFERENCE_REQUIRED','只有用户明确接受/喜欢或拒绝的版本才能学习；Agent 试修和 neutral 不作为偏好。');
  const evidenceId=hash({project:p.id,version:v.id,feedback:feedback?.id||choice.acceptedAt});
  const entry={id:randomUUID(),evidenceId,projectId:p.id,sourceChecksum:p.source.checksum,versionId:v.id,stateHash:hash(v.state),subject:value.subject,lighting:value.lighting,intent:p.intent,reason:value.reason.trim(),signal,createdAt:new Date().toISOString(),evidence:{source:feedback?'user-feedback':'user-accept',reason:feedback?.reason||value.reason},look:{settings:v.state.settings,style:v.state.style,cropCoverage:v.state.crop?v.state.crop.width*v.state.crop.height:1}};
  return updateProfile(file,async q=>{
    if((await loadProject(folder)).revision!==p.revision)fail('STALE_REVISION','学习期间用户反馈已改变，请重新读取。');
    if(q.entries.some(e=>e.evidenceId===evidenceId))return {reused:true,entry:q.entries.find(e=>e.evidenceId===evidenceId)};
    // A later rejection supersedes the earlier preference of this exact version.
    const remaining=q.entries.filter(e=>!(e.projectId===p.id&&e.versionId===v.id));
    if(remaining.length>=500)fail('PROFILE_LIMIT','最多保存 500 条偏好证据，请先整理。');
    q.entries=[...remaining,entry];return {entry};
  });
}
export async function editProfile(file,value){
  object(value,['id','subject','lighting','reason','remove'],'PROFILE_INVALID');
  if(!text(value.id,80)||value.remove!==undefined&&typeof value.remove!=='boolean')fail('PROFILE_INVALID','指定需要修改或删除的记录 ID。');
  for(const k of ['subject','lighting','reason'])if(value[k]!==undefined&&!text(value[k],k==='reason'?600:120))fail('PROFILE_INVALID','偏好说明不能为空或过长。');
  return updateProfile(file,p=>{const e=p.entries.find(e=>e.id===value.id);if(!e)fail('PROFILE_NOT_FOUND','记录已删除或不存在。');if(value.remove)p.entries=p.entries.filter(e=>e.id!==value.id);else for(const k of ['subject','lighting','reason'])if(value[k]!==undefined)e[k]=value[k].trim();return {removed:value.remove===true};});
}
