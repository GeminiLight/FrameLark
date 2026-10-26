import {readFile,writeFile,open,rename,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './engine/edit-values.js';
import {projectLimits} from './engine/project-contract.js';

const format='framelark-project-record/1';
const storageThreshold=512*1024;
const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const invalid=()=>fail('PROJECT_STORAGE_INVALID','项目的配方存储不完整或校验不符。请保留文件并使用备份恢复。');
const tooLarge=()=>fail('PROJECT_TOO_LARGE','项目记录接近保存容量，请保留现有项目并将需要的版本另存后继续。');
function eachDocument(project,visit){
  for(const field of ['versions','candidates','choices']){
    if(!Array.isArray(project[field]))invalid();
    for(const record of project[field]){
      if(!plain(record))invalid();
      for(const key of ['recipe','baseDocument'])if(record[key]!==undefined)record[key]=visit(record[key]);
    }
  }
}

// Normalization is a storage detail: callers always see the original project
// schema and independent document snapshots. Everything commits in one file.
export function encodeProjectRecord(project){
  const payload=JSON.parse(JSON.stringify(project)),documents=Object.create(null),masks=Object.create(null);
  eachDocument(payload,document=>{
    if(!plain(document)||!Array.isArray(document.masks))invalid();
    const maskIds=document.masks.map(mask=>{const key=digest(mask);masks[key]=mask;return key;});
    const {masks:unused,...value}=document,entry={value,maskIds},key=digest(entry);
    documents[key]=entry;return {documentRef:key};
  });
  return {schema:4,format,project:payload,documents,masks};
}
export function decodeProjectRecord(record){
  if(record?.schema!==4)return record;
  if(!exact(record,['schema','format','project','documents','masks'])||record.format!==format||!plain(record.project)||![2,3].includes(record.project.schema))invalid();
  for(const table of [record.documents,record.masks]){
    if(!plain(table)||Object.keys(table).length>8192)invalid();
    for(const [key,value] of Object.entries(table))if(!/^[a-f0-9]{64}$/.test(key)||digest(value)!==key)invalid();
  }
  const payload=structuredClone(record.project),cache=new Map();let expanded=Buffer.byteLength(JSON.stringify(payload));
  eachDocument(payload,ref=>{
    if(!exact(ref,['documentRef'])||typeof ref.documentRef!=='string'||!Object.hasOwn(record.documents,ref.documentRef))invalid();
    if(!cache.has(ref.documentRef)){
      const entry=record.documents[ref.documentRef];
      if(!exact(entry,['value','maskIds'])||!plain(entry.value)||Object.hasOwn(entry.value,'masks')||!Array.isArray(entry.maskIds)||entry.maskIds.length>256)invalid();
      const masks=entry.maskIds.map(key=>{if(typeof key!=='string'||!Object.hasOwn(record.masks,key))invalid();return record.masks[key];});
      const document={...entry.value,masks},bytes=Buffer.byteLength(JSON.stringify(document));
      if(bytes>projectLimits.documentBytes)invalid();cache.set(ref.documentRef,{document,bytes});
    }
    const {document,bytes}=cache.get(ref.documentRef);expanded+=bytes;
    if(expanded>projectLimits.expandedBytes)tooLarge();
    return structuredClone(document);
  });
  return payload;
}
export async function readProjectRecord(folder){
  const file=join(resolve(folder),'project.json');
  if((await stat(file)).size>projectLimits.recordBytes)tooLarge();
  return decodeProjectRecord(JSON.parse(await readFile(file,'utf8')));
}
async function backup(folder,previous){
  const schema=JSON.parse(previous).schema,base=join(folder,`project.schema-${schema}.backup.json`);
  try{await writeFile(base,previous,{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    if(digest(await readFile(base))===digest(previous))return;
    const file=join(folder,`project.schema-${schema}-${digest(previous).slice(0,16)}.backup.json`);
    try{await writeFile(file,previous,{flag:'wx',mode:0o600});}
    catch(next){if(next.code!=='EEXIST')throw next;if(digest(await readFile(file))!==digest(previous))invalid();}
  }
}
export async function writeProjectRecord(folder,project){
  const file=join(folder,'project.json'),previous=await readFile(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const prior=previous?JSON.parse(previous):null;
  let serialized=JSON.stringify(project,null,2),nextSchema=project.schema;
  if(prior?.schema===4||Buffer.byteLength(serialized)>storageThreshold){
    const record=encodeProjectRecord(project);
    // Apply the same expansion budget on write; never create an unreadable record.
    decodeProjectRecord(record);serialized=JSON.stringify(record);nextSchema=4;
  }
  if(Buffer.byteLength(serialized)>projectLimits.recordBytes)tooLarge();
  if(previous&&prior.schema!==nextSchema)await backup(folder,previous);
  const temp=join(folder,`.project-${randomUUID()}.tmp`);
  try{
    const handle=await open(temp,'wx',0o600);
    try{await handle.writeFile(serialized);await handle.sync();}finally{await handle.close();}
    await rename(temp,file);
  }finally{await rm(temp,{force:true});}
}
