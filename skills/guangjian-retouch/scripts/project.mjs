import {readFile,writeFile,mkdir,rename,rm,stat,open} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {adjustmentKeys,limits,neutralSettings} from './engine/editor-engine.js';
import {presets,presetById} from './engine/presets.js';
import {validCrop} from './engine/crop-utils.js';
import {originalToViewPoint,transformRect} from './engine/photo-geometry.js';
export class PhotoError extends Error {constructor(code,message){super(message);this.code=code;}}
export const fail=(code,message)=>{throw new PhotoError(code,message);};
export const hash=value=>createHash('sha256').update(typeof value==='string' || Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const text=(v,max=300)=>String(v??'').trim().slice(0,max),id=()=>randomUUID(),now=()=>new Date().toISOString();
export const settingsBounds=key=>limits[key] || (['sharpen','denoise'].includes(key)?[0,75]:[-75,75]);
export function cleanSettings(value={}) {
  if(!value || typeof value!=='object' || Array.isArray(value))fail('INVALID_SETTINGS','调整必须是参数对象。');
  const result={};for(const [key,n] of Object.entries(value)) {
    if(!adjustmentKeys.includes(key))fail('UNKNOWN_PARAMETER',`不支持参数 ${key}。请先查看工具参数说明。`);
    const [a,b]=settingsBounds(key);if(typeof n!=='number'||!Number.isFinite(n)||n<a||n>b)fail('PARAMETER_RANGE',`${key} 应在 ${a}～${b} 之间。`);
    result[key]=n;
  }return result;
}
export function cleanRect(value) {
  if(!value || !['x','y','width','height'].every(k=>Number.isFinite(value[k])) || value.x<0 || value.y<0 || value.width<.005 || value.height<.005 || value.x+value.width>1.00001 || value.y+value.height>1.00001)fail('INVALID_REGION','标记范围应在原片内，且不能为空。');
  return Object.fromEntries(['x','y','width','height'].map(k=>[k,value[k]]));
}
const fingerprint=p=>hash({current:p.currentId,intent:p.intent,notes:p.notes});
export const currentVersion=p=>p.versions.find(v=>v.id===p.currentId);
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
  if(p.schema!==1 || !Number.isInteger(p.revision)||!Array.isArray(p.versions)||!p.versions.length || !Array.isArray(p.notes)||!Array.isArray(p.candidates)||!currentVersion(p)||!Number.isInteger(p.source?.width)||!Number.isInteger(p.source?.height)||p.source.width<1||p.source.height<1||p.source.width*p.source.height>50_000_000)fail('INVALID_PROJECT','项目记录不完整。请保留目录，使用备份恢复。');
  for(const v of [...p.versions,...p.candidates]){cleanSettings(v.state?.settings);if(v.state?.crop && !validCrop(v.state.crop))fail('INVALID_PROJECT','版本裁剪记录无效。');if(!Array.isArray(v.state?.locals))fail('INVALID_PROJECT','版本局部记录无效。');for(const l of v.state.locals){cleanRect(l.rect);cleanSettings(l.localSettings);}}
  return p;
}
async function atomicWrite(folder,p) {
  const temp=path.join(folder,`.project-${id()}.tmp`),file=path.join(folder,'project.json');
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
  return locked(folder,async root=>{const p=await loadProject(root);expect(p,revision);const result=fn(p);p.revision++;p.updatedAt=now();await atomicWrite(root,p);return {project:p,...result};});
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
    const original={id:id(),name:'原片',parentId:null,createdAt:now(),state:{settings:neutralSettings(),style:null,crop:null,locals:[]}};
    const p={schema:1,id:id(),revision:1,createdAt:now(),updatedAt:now(),source:{name:path.basename(image),checksum:hash(bytes),normalizedChecksum:hash(normalized),width:info.width,height:info.height,format:metadata.format,bytes:bytes.length},intent:text(intent),notes:[],versions:[original],currentId:original.id,acceptedId:null,candidates:[],reviews:[],exports:[],choices:[]};
    await atomicWrite(folder,p);return {folder,project:p};
  }catch(error){throw error;}
}
function stateFromPlan(p,plan) {
  const next=structuredClone(currentVersion(p).state);next.settings={...next.settings,...cleanSettings(plan.settings)};
  if(plan.style!==undefined){if(plan.style===null)next.style=null;else {const preset=presetById(plan.style.id);if(!preset)fail('UNKNOWN_STYLE','风格不存在，请先读取风格目录。');if(!Number.isFinite(plan.style.amount)||plan.style.amount<0||plan.style.amount>100)fail('STYLE_AMOUNT','风格强度应为 0～100。');next.style={id:preset.id,amount:plan.style.amount};}}
  if(plan.crop!==undefined){if(plan.crop===null)next.crop=null;else {next.crop=validCrop(plan.crop);if(!next.crop||plan.crop.angle!==undefined&&(!Number.isFinite(plan.crop.angle)||Math.abs(plan.crop.angle)>15))fail('INVALID_CROP','裁剪越界、过小或拉直超过 ±15°。请保留至少 5% 的长宽。');}}
  if(plan.locals!==undefined){if(!Array.isArray(plan.locals)||plan.locals.length>8)fail('INVALID_LOCAL','局部调整最多 8 处。');for(const patch of plan.locals){
    const note=p.notes.find(n=>n.id===patch.annotationId);if(!note)fail('NOTE_NOT_FOUND','局部标记已更新或删除，请重新读取批注。');
    let target=next.locals.find(l=>l.id===note.id);if(patch.remove){next.locals=next.locals.filter(l=>l.id!==note.id);continue;}
    if(!target){target={id:note.id,rect:structuredClone(note.rect),note:note.note,maskType:'rectangle',feather:.36,localAmount:100,localEnabled:true,localSettings:{}};next.locals.push(target);}
    target.rect=structuredClone(note.rect);target.note=note.note;target.localSettings={...target.localSettings,...cleanSettings(patch.settings)};
    if(patch.feather!==undefined){if(!Number.isFinite(patch.feather)||patch.feather<0||patch.feather>1)fail('INVALID_FEATHER','羽化应为 0～1。');target.feather=patch.feather;}
    if(patch.maskType!==undefined){if(!['rectangle','radial','linear'].includes(patch.maskType))fail('INVALID_MASK','本版局部支持矩形、径向、渐变。');target.maskType=patch.maskType;}
    if(target.maskType==='linear'){for(const k of ['start','end']){const point=patch[k]||target[k]||{x:note.rect.x,y:note.rect.y+(k==='end'?note.rect.height:0)};if(!['x','y'].every(a=>Number.isFinite(point[a])&&point[a]>=0&&point[a]<=1))fail('INVALID_MASK','渐变端点必须在原片内。');target[k]={x:point.x,y:point.y};}}
    if(patch.enabled!==undefined)target.localEnabled=Boolean(patch.enabled);
  }}
  const warnings=[];
  if(next.crop){for(const note of p.notes.filter(n=>n.protect)){const n=note.rect,c=next.crop,full={x:0,y:0,width:1,height:1,angle:c.angle};
    const points=[{x:n.x,y:n.y},{x:n.x+n.width,y:n.y},{x:n.x,y:n.y+n.height},{x:n.x+n.width,y:n.y+n.height}].map(point=>originalToViewPoint(point,full,p.source.width,p.source.height));
    if(points.some(point=>point.x<c.x-1e-7||point.y<c.y-1e-7||point.x>c.x+c.width+1e-7||point.y>c.y+c.height+1e-7)){if(plan.allowProtectedCrop!==true)fail('PROTECTED_CROP','裁剪会切到用户要求保留的标记。请调整边界，或明确取得该处裁剪的同意。');warnings.push(`裁剪涉及保留标记 ${note.number}`);}}
  }return {state:next,warnings};
}
export async function createCandidate(folder,plan) {
  if(!plan || typeof plan!=='object')fail('INVALID_PLAN','请提供候选方案 JSON。');
  return locked(folder,async root=>{const p=await loadProject(root);const prior=p.candidates.find(c=>plan.requestId&&c.requestId===plan.requestId);
    const planHash=hash(plan);if(prior){if(prior.planHash!==planHash)fail('REQUEST_CONFLICT','同一请求编号对应了不同方案，请使用新编号。');return {project:p,candidate:prior,reused:true};}
    if(!Number.isInteger(plan.revision)||plan.baseVersion!==p.currentId)fail('STALE_REVISION','方案需填写 inspect 返回的 revision 和 currentId；请基于最新版本精调。');expect(p,plan.revision);
    if(p.candidates.length>=8)fail('CANDIDATE_LIMIT','最多保留 8 个候选。请接受或取消一个后继续。');
    const {state,warnings}=stateFromPlan(p,plan);if(hash(state)===hash(currentVersion(p).state))fail('NO_CHANGE','这份方案与当前效果一致，可以保留当前版本。');
    const candidate={id:id(),name:text(plan.name,40)||'精调候选',parentId:p.currentId,createdAt:now(),baseFingerprint:fingerprint(p),state,goal:text(plan.goal),tradeoff:text(plan.tradeoff),warnings,requestId:text(plan.requestId,80),planHash};
    p.candidates.push(candidate);p.revision++;p.updatedAt=now();await atomicWrite(root,p);return {project:p,candidate};
  });
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
  return mutate(folder,value.revision,p=>{const c=p.candidates.find(n=>n.id===value.id);if(!c)fail('CANDIDATE_NOT_FOUND','候选已接受或取消，请读取最新版本。');if(c.baseFingerprint!==fingerprint(p))fail('STALE_CANDIDATE','候选生成后照片、意图或批注已改变。请让 Agent 读取最新状态并重新试片。');
    p.versions.push({...c,baseFingerprint:undefined,planHash:undefined,acceptedAt:now()});p.currentId=c.id;p.acceptedId=c.id;p.candidates=p.candidates.filter(x=>x.id!==c.id);
    p.choices.push({versionId:c.id,name:c.name,intent:p.intent,acceptedAt:now(),state:structuredClone(c.state)});return {version:c};
  });
}
export const discardCandidate=(folder,value)=>mutate(folder,value.revision,p=>{if(!p.candidates.some(n=>n.id===value.id))fail('CANDIDATE_NOT_FOUND','候选已经取消。');p.candidates=p.candidates.filter(x=>x.id!==value.id);return {};});
export const restoreVersion=(folder,value)=>mutate(folder,value.revision,p=>{const version=p.versions.find(v=>v.id===value.id);if(!version)fail('VERSION_NOT_FOUND','只能恢复已经保存的版本。');p.currentId=version.id;return {version};});
export const saveReview=(folder,value)=>mutate(folder,value.revision,p=>{const summary=text(value.summary,1200);if(!summary)fail('EMPTY_REVIEW','请写明实际画面观察或保留原片的依据。');
  const review={id:id(),versionId:p.currentId,intent:p.intent,createdAt:now(),source:'host-agent',summary,preserve:Array.isArray(value.preserve)?value.preserve.slice(0,6).map(x=>text(x)):[],model:text(value.model,80)};p.reviews.push(review);p.reviews=p.reviews.slice(-30);return {review};});
export const recordExport=(folder,value)=>mutate(folder,undefined,p=>{if(!p.versions.some(v=>v.id===value.versionId))fail('VERSION_NOT_FOUND','导出版本必须已保存。');p.exports.push({...value,createdAt:now()});return {};});
export function publicProject(p) {
  return {...p,candidates:p.candidates.map(c=>({...c,stale:c.baseFingerprint!==fingerprint(p)})),styles:presets.map(({id,name,category,mood,groups,adjustments})=>({id,name,category,mood,groups,adjustments})),parameters:adjustmentKeys.map(key=>({key,range:settingsBounds(key)})),limitations:['8 位 sRGB；JPEG/PNG/WebP/AVIF 输入，JPEG/PNG 输出','输出最多 8192 px / 1600 万像素；局部范围是几何蒙版，不是自动主体分割','工具不调用模型；审片笔记来自宿主 Agent，图像统计不是审美结论']};
}
