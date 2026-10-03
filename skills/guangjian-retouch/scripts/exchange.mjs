import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadProject,initProject,mutateProject,findVersion} from './project.mjs';
import {previewPhoto} from './render.mjs';
import {hash} from './engine/edit-identity.js';
import {renderingVersion} from './engine/editor-engine.js';
import {emptyGuards} from './engine/edit-guards.js';
import {exchangeSchema,validateExchange} from './engine/project-exchange.js';
import {fail} from './engine/edit-values.js';

export async function exportExchange(folder,output,{version}={}){
  const p=await loadProject(folder),bytes=await readFile(path.join(folder,'source','original.bin'));
  if(hash(bytes)!==p.source.checksum)fail('SOURCE_CHANGED','原片已改变，请恢复后再交换。');
  const selected=version===undefined?null:findVersion(p,version);
  if(selected&&!p.versions.some(v=>v.id===selected.id))fail('UNACCEPTED_EXPORT','交换只包含已保存版本；请先检查并接受试片。');
  const versions=selected?[p.versions[0],...p.versions.filter(v=>v.id===selected.id&&v.id!==p.versions[0].id)]:p.versions;
  if(versions.length>42)fail('EXCHANGE_VERSION_LIMIT','历史超过交换上限。用 --version current 或已保存版本编号，明确导出单版；原项目历史保留。');
  const mime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',heif:'image/avif'}[p.source.format];
  const value=validateExchange({schema:exchangeSchema,renderingVersion,source:{name:p.source.name,mime,bytes:bytes.length,checksum:hash(bytes),width:p.source.width,height:p.source.height,data:bytes.toString('base64')},intent:p.intent,notes:p.notes.map(({id,number,rect,note,protect})=>({id,number,rect,note,protect:Boolean(protect)})),versions:versions.map(({id,name,state,role},index)=>({id,name,role:index===0?'original':!selected&&role==='working'&&id===p.currentId?'working':'edit',state})),currentId:selected?.id||p.currentId});
  if(!output)fail('OUTPUT_REQUIRED','用 --output 指定新的 .frameyn.json 文件。');
  try{await writeFile(output,JSON.stringify(value),{flag:'wx',mode:0o600});}catch(e){if(e.code==='EEXIST')fail('OUTPUT_EXISTS','交换文件已存在，请换一个名称。');throw e;}
  return {path:path.resolve(output),versionCount:value.versions.length,scope:'原片、已保存版本、意图、批注、全局/风格/几何局部/裁剪；不交换候选、对话、审美审核或偏好。'};
}
export async function importExchange(folder,value){
  const pack=validateExchange(value),bytes=Buffer.from(pack.source.data,'base64');
  if(bytes.length!==pack.source.bytes||hash(bytes)!==pack.source.checksum)fail('EXCHANGE_SOURCE_MISMATCH','交换原片损坏或与校验不符。');
  const temp=await mkdtemp(path.join(os.tmpdir(),'frameyn-import-'));let created=false;
  try{
    const file=path.join(temp,'source');await writeFile(file,bytes,{mode:0o600});const initial=await initProject(file,folder,{intent:pack.intent});created=true;
    const actualMime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',heif:'image/avif'}[initial.project.source.format];if(actualMime!==pack.source.mime)fail('EXCHANGE_SOURCE_MISMATCH','原片实际格式与项目记录不符。');
    if(initial.project.source.width!==pack.source.width||initial.project.source.height!==pack.source.height)fail('EXCHANGE_SOURCE_MISMATCH','正向原片尺寸与项目记录不同。');
    const result=await mutateProject(folder,initial.project.revision,p=>{
      p.source.name=pack.source.name;const original=p.versions[0];
      // The actual unedited original remains a separate version regardless of incoming labels.
      const originalIncoming=pack.versions.find(v=>v.role==='original');
      const now=new Date().toISOString();if(originalIncoming){original.id=originalIncoming.id;original.name=originalIncoming.name;}
      p.versions=[original,...pack.versions.filter(v=>v!==originalIncoming).map(v=>({...v,parentId:original.id,createdAt:now,acceptedAt:now,acceptedBy:'agent',state:{...v.state,guards:emptyGuards()}}))];
      p.currentId=pack.currentId;p.acceptedId=p.currentId;
      p.notes=pack.notes.map((n,i)=>({...n,number:i+1}));p.importedFrom=exchangeSchema;return {versionCount:p.versions.length};
    });
    return {...result,folder,preview:await previewPhoto(folder,'current'),guidance:'已新增文件项目，未覆盖原有工作。导入版本不自动形成偏好；继续前重新实际审片。'};
  }catch(e){if(created)await rm(folder,{recursive:true,force:true});throw e;}finally{await rm(temp,{recursive:true,force:true});}
}
