import {readFile,writeFile,mkdir,readdir,rename,rm,open,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {initProject,loadProject,hash,fail,localFailure} from './project.mjs';
import {previewPhoto,exportPhoto} from './render.mjs';
import {object} from './engine/edit-values.js';
import {pipelineVersion} from './engine/edit-identity.js';

export const collectionPurposes=['story','travel','portrait','event','catalog','portfolio','archive'];
export const collectionSequences=['visual','chronological','emotional','manual'];
const now=()=>new Date().toISOString();
const requiredText=(value,max=600)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)fail('COLLECTION_TEXT',`请填写明确说明，最多 ${max} 字。`);
  return value.trim();
};
function brief(value={}){
  object(value,['theme','purpose','sequence','targetCount','mustKeep','constraints']);
  const b={theme:'',purpose:'story',sequence:'visual',targetCount:null,mustKeep:[],constraints:[],...value};
  if(typeof b.theme!=='string'||b.theme.length>600||!collectionPurposes.includes(b.purpose)||!collectionSequences.includes(b.sequence)||b.targetCount!==null&&(!Number.isInteger(b.targetCount)||b.targetCount<1||b.targetCount>500))fail('COLLECTION_BRIEF','用途、顺序或目标数量无效。');
  if(!Array.isArray(b.mustKeep)||new Set(b.mustKeep).size!==b.mustKeep.length||!Array.isArray(b.constraints)||b.constraints.length>12)fail('COLLECTION_BRIEF','必留照片不能重复；约束最多 12 条。');
  b.constraints=b.constraints.map(c=>requiredText(c,300));b.theme=b.theme.trim();return b;
}
async function writeState(root,state){
  const bytes=JSON.stringify(state,null,2);
  if(Buffer.byteLength(bytes)>8*1024*1024)fail('COLLECTION_SIZE','组图记录达到 8 MB 上限，请新建后续批次；已有记录保留。');
  const temp=path.join(root,`.collection-${randomUUID()}.tmp`),handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await rename(temp,path.join(root,'collection.json'));}finally{await rm(temp,{force:true});}
}
export async function loadCollection(folder){
  const root=path.resolve(folder),file=path.join(root,'collection.json');
  if((await stat(file)).size>8*1024*1024)fail('COLLECTION_SIZE','组图记录超过读取上限。');
  const c=JSON.parse(await readFile(file,'utf8'));
  if(c.schema!==1||!Number.isInteger(c.revision)||!Array.isArray(c.photos)||c.photos.length>500||!Array.isArray(c.plans)||!Array.isArray(c.jobs)||new Set(c.photos.map(p=>p.id)).size!==c.photos.length||c.photos.some(p=>!/^P\d{4}$/.test(p.id)||p.project!==`photos/${p.id}`))fail('COLLECTION_INVALID','组图记录不完整，请使用备份恢复。');
  brief(c.brief);return c;
}
async function locked(folder,fn){
  const root=path.resolve(folder),lock=path.join(root,'.collection-lock');let acquired=false;
  for(let n=0;n<45&&!acquired;n++){
    try{await mkdir(lock);acquired=true;await writeFile(path.join(lock,'owner'),String(process.pid));}
    catch(e){if(e.code!=='EEXIST')throw e;
      const owner=Number(await readFile(path.join(lock,'owner'),'utf8').catch(()=>0));
      if(owner){try{process.kill(owner,0);}catch(e){if(e.code==='ESRCH')await rm(lock,{recursive:true,force:true});}}
      else {const s=await stat(lock).catch(()=>null);if(s&&Date.now()-s.mtimeMs>5000)await rm(lock,{recursive:true,force:true});}
      await new Promise(resolve=>setTimeout(resolve,70));
    }
  }
  if(!acquired)fail('COLLECTION_BUSY','组图正在保存或导出，请稍后重试。');
  try{return await fn(root,await loadCollection(root));}finally{await rm(lock,{recursive:true,force:true});}
}
function revision(c,value){if(!Number.isInteger(value)||value!==c.revision)fail('STALE_COLLECTION','组图已更新。请重新 collection-inspect，再提交。');}
const projectPath=(root,p)=>path.join(root,p.project);
async function context(root,c){
  const photos=[];
  for(const p of c.photos){
    try{const project=await loadProject(projectPath(root,p));
      photos.push({...p,revision:project.revision,versionId:project.currentId,stateHash:hash(project.versions.find(v=>v.id===project.currentId).state),source:project.source,intent:project.intent,notes:project.notes,acceptedId:project.acceptedId});
    }catch(e){photos.push({...p,error:localFailure(e)});}
  }
  // Candidate browsing and export records do not alter the accepted image/context.
  const snapshotHash=hash({pipeline:pipelineVersion,brief:c.brief,photos:photos.map(({id,versionId,stateHash,source,intent,notes,error})=>({id,versionId,stateHash,source,intent,notes,error}))});
  return {photos,snapshotHash};
}
export async function initCollection(folder,value){
  object(value,['images','directory','brief']);
  if(Boolean(value.images)===Boolean(value.directory))fail('COLLECTION_INPUT','请选择 images 文件列表或 directory 目录其中一种。');
  let images=value.images;
  if(value.directory){
    const dir=path.resolve(requiredText(value.directory,4096));
    images=(await readdir(dir,{withFileTypes:true})).filter(p=>p.isFile()&&/\.(jpe?g|png|webp|avif|heic|heif|tiff?|dng|cr[23]|nef|arw)$/i.test(p.name)).map(p=>path.join(dir,p.name)).sort();
  }
  if(!Array.isArray(images)||!images.length||images.length>500||images.some(p=>typeof p!=='string'||!p.trim()))fail('COLLECTION_INPUT','每组支持 1–500 个文件；目录不递归读取。');
  const b=brief(value.brief);if(b.mustKeep.length)fail('COLLECTION_BRIEF','导入后读取照片 ID，再设置必留照片。');
  const root=path.resolve(folder);
  try{await mkdir(root,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('COLLECTION_EXISTS','组图目录已存在，请读取已有组图或选择新目录。');throw e;}
  await mkdir(path.join(root,'photos'));await mkdir(path.join(root,'sheets'));await mkdir(path.join(root,'exports'));await mkdir(path.join(root,'plans'));
  const c={schema:1,id:randomUUID(),revision:1,createdAt:now(),updatedAt:now(),brief:b,photos:[],imports:[],plans:[],jobs:[]};
  await writeState(root,c);
  const seen=new Map();
  for(let i=0;i<images.length;i++){
    const id=`P${String(i+1).padStart(4,'0')}`,project=`photos/${id}`;
    try{
      const result=await initProject(images[i],path.join(root,project)),checksum=result.project.source.checksum;
      c.photos.push({id,project,name:result.project.source.name,...(seen.has(checksum)?{duplicateOf:seen.get(checksum)}:{})});
      seen.set(checksum,seen.get(checksum)||id);c.imports.push({id,name:path.basename(images[i]),status:'ready'});
    }catch(e){c.imports.push({id,name:path.basename(images[i]),status:'failed',error:localFailure(e)});}
    await writeState(root,c);
  }
  return inspectCollection(root);
}
export async function inspectCollection(folder){
  const root=path.resolve(folder),c=await loadCollection(root),ctx=await context(root,c),plan=c.plans.at(-1);
  return {folder:root,...c,...ctx,plan:plan?{...plan,stale:plan.snapshotHash!==ctx.snapshotHash}:null,unreviewed:ctx.photos.filter(p=>!plan?.decisions.some(d=>d.id===p.id)).map(p=>p.id),visualAnalysis:'宿主 Agent 须实际看联系表与单图；工具未进行视觉评分、主题识别或自动淘汰。'};
}
export async function updateCollectionBrief(folder,value,{collectionId}={}){
  object(value,['revision','brief']);
  if(!value.brief||typeof value.brief!=='object'||Array.isArray(value.brief))fail('COLLECTION_BRIEF','请提供要更新的 brief 对象。');
  return locked(folder,async(root,c)=>{
    if(collectionId&&c.id!==collectionId)fail('COLLECTION_IDENTITY','组图身份已变化，请重新读取。');
    revision(c,value.revision);const next=brief({...c.brief,...value.brief});
    if(next.mustKeep.some(id=>!c.photos.some(p=>p.id===id)))fail('COLLECTION_IDS','必留照片 ID 不存在。');
    c.brief=next;c.revision++;c.updatedAt=now();await writeState(root,c);return inspectCollection(root);
  });
}
export async function saveCollectionPlan(folder,value,{collectionId}={}){
  object(value,['revision','snapshotHash','title','rationale','decisions','order','anchorId','source']);
  if(value.source!==undefined&&!['host-agent','workspace-user'].includes(value.source))fail('COLLECTION_PLAN','选片来源无效。');
  return locked(folder,async(root,c)=>{
    if(collectionId&&c.id!==collectionId)fail('COLLECTION_IDENTITY','组图身份已变化，请重新读取。');
    revision(c,value.revision);const ctx=await context(root,c);
    if(value.snapshotHash!==ctx.snapshotHash)fail('STALE_COLLECTION','主题、照片或批注已变化，请重新看图并读取组图。');
    if(!Array.isArray(value.decisions)||value.decisions.length>c.photos.length||new Set(value.decisions.map(d=>d.id)).size!==value.decisions.length)fail('COLLECTION_DECISIONS','每张照片最多一条取舍记录。');
    const decisions=value.decisions.map(d=>{
      object(d,['id','decision','reason','observations','preserve','role']);
      const p=ctx.photos.find(p=>p.id===d.id);
      if(!p||p.error||!['select','reserve','exclude'].includes(d.decision))fail('COLLECTION_DECISIONS','取舍记录包含不可用的照片或无效决定。');
      return {id:d.id,decision:d.decision,reason:requiredText(d.reason),observations:requiredText(d.observations),preserve:requiredText(d.preserve),role:requiredText(d.role,120),versionId:p.versionId};
    });
    const selected=decisions.filter(d=>d.decision==='select').map(d=>d.id);
    if(!Array.isArray(value.order)||new Set(value.order).size!==selected.length||value.order.length!==selected.length||value.order.some(id=>!selected.includes(id)))fail('COLLECTION_ORDER','顺序须恰好包含全部入选照片，各一次。');
    if(c.brief.mustKeep.some(id=>!selected.includes(id)))fail('COLLECTION_MUST_KEEP','不能排除用户明确必留的照片；请说明冲突并让用户调整约束。');
    if(value.anchorId!==undefined&&value.anchorId!==null&&!selected.includes(value.anchorId))fail('COLLECTION_ANCHOR','定调参考须是入选照片。');
    const plan={id:randomUUID(),title:requiredText(value.title,80),rationale:requiredText(value.rationale,1200),snapshotHash:ctx.snapshotHash,brief:structuredClone(c.brief),decisions,order:[...value.order],anchorId:value.anchorId||null,createdAt:now(),source:value.source||'host-agent'};
    await mkdir(path.join(root,'plans'),{recursive:true});await writeFile(path.join(root,'plans',`${plan.id}.json`),JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});
    c.plans.push(plan);c.plans=c.plans.slice(-5);c.revision++;c.updatedAt=now();await writeState(root,c);
    return {...await inspectCollection(root),warnings:c.brief.targetCount!==null&&selected.length!==c.brief.targetCount?[`目标 ${c.brief.targetCount} 张，实际入选 ${selected.length} 张；不为凑数自动补图。`]:[]};
  });
}
export async function collectionSheet(folder,value={}){
  object(value,['page','view','selected']);
  if(value.selected!==undefined&&typeof value.selected!=='boolean')fail('COLLECTION_VIEW','selected 必须为布尔值。');
  const root=path.resolve(folder),c=await loadCollection(root),ctx=await context(root,c),plan=c.plans.at(-1),view=value.view||'current';
  if(!['current','original','planned'].includes(view))fail('COLLECTION_VIEW','联系表支持 current、original、planned。');
  if((view==='planned'||value.selected)&&(!plan||plan.snapshotHash!==ctx.snapshotHash))fail('STALE_COLLECTION','选片方案未生成或已过期。请重新检查后保存方案。');
  const list=value.selected?plan.order.map(id=>ctx.photos.find(p=>p.id===id)):ctx.photos,page=value.page??1;
  const pages=Math.ceil(list.length/20);
  if(!Number.isInteger(page)||page<1||page>pages)fail('COLLECTION_PAGE','此页不存在；每页最多 20 张。');
  const items=list.slice((page-1)*20,page*20),canvas=createCanvas(1280,Math.ceil(items.length/4)*260),drawing=canvas.getContext('2d'),records=[];
  drawing.fillStyle='#202226';drawing.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<items.length;i++){
    const p=items[i],x=(i%4)*320+12,y=Math.floor(i/4)*260+12;
    const version=view==='original'?'original':view==='planned'?plan.decisions.find(d=>d.id===p.id).versionId:p.versionId;
    const record={id:p.id,name:p.name,project:projectPath(root,p),versionId:version};
    try{
      if(p.error)throw Object.assign(new Error(p.error.message),p.error);
      const preview=await previewPhoto(projectPath(root,p),version,{maxSide:512}),image=await loadImage(preview.path),scale=Math.min(296/image.width,202/image.height);
      drawing.drawImage(image,x+(296-image.width*scale)/2,y+(202-image.height*scale)/2,image.width*scale,image.height*scale);record.preview=preview.path;
    }catch(e){record.error=localFailure(e);drawing.fillStyle='#ceb99b';drawing.font='16px sans-serif';drawing.fillText('Preview unavailable',x+24,y+105);}
    drawing.fillStyle='#e7ded1';drawing.font='bold 16px sans-serif';drawing.fillText(p.id,x,y+222);
    drawing.fillStyle='#aeb0b7';drawing.font='13px sans-serif';drawing.fillText(p.name.slice(0,28),x+64,y+222,230);records.push(record);
  }
  const file=path.join(root,'sheets',`${view}-${value.selected?'selected':'all'}-${page}-${randomUUID()}.png`);
  await writeFile(file,canvas.toBuffer('image/png'),{flag:'wx',mode:0o600});
  return {path:file,page,pages,total:list.length,photos:records,snapshotHash:ctx.snapshotHash,detail:'联系表用于初选；表情、焦点、噪点与重复帧取舍仍需打开单图和细节。'};
}
export async function exportCollection(folder,value,{collectionId}={}){
  object(value,['revision','snapshotHash','preset','format','retryJob']);
  return locked(folder,async(root,c)=>{
    if(collectionId&&c.id!==collectionId)fail('COLLECTION_IDENTITY','组图身份已变化，请重新读取。');
    revision(c,value.revision);const ctx=await context(root,c),plan=c.plans.at(-1);
    if(!plan||!plan.order.length||plan.snapshotHash!==ctx.snapshotHash||value.snapshotHash!==ctx.snapshotHash)fail('STALE_COLLECTION','请基于当前主题和最终版本保存选片排序，再导出。');
    const preset=value.preset||'share',format=value.format||(preset==='original'?'png':'jpeg');
    if(!['share','print','original'].includes(preset)||!['png','jpeg'].includes(format))fail('COLLECTION_EXPORT','导出预设或格式无效。');
    let job;
    if(value.retryJob){
      job=c.jobs.find(j=>j.id===value.retryJob);
      if(!job||job.snapshotHash!==ctx.snapshotHash||job.planId!==plan.id)fail('STALE_COLLECTION_JOB','该任务不对应当前选片与版本，请发起新导出。');
      if(job.preset!==preset||job.format!==format)fail('COLLECTION_EXPORT','重试时须使用原任务的预设和格式。');
      if(job.folder!==`exports/${job.id}`||!/^[-\w]{36}$/.test(job.id))fail('COLLECTION_INVALID','导出任务路径无效。');
      if(!Array.isArray(job.items)||job.items.length!==plan.order.length||job.items.some((item,i)=>item.id!==plan.order[i]||item.position!==i+1||item.versionId!==ctx.photos.find(p=>p.id===item.id)?.versionId||!['pending','done','failed'].includes(item.status)))fail('COLLECTION_INVALID','导出队列与保存的顺序或版本不一致。');
    }else{
      job={id:randomUUID(),planId:plan.id,snapshotHash:ctx.snapshotHash,preset,format,createdAt:now(),items:plan.order.map((id,i)=>({id,position:i+1,versionId:ctx.photos.find(p=>p.id===id).versionId,status:'pending'}))};
      job.folder=`exports/${job.id}`;await mkdir(path.join(root,job.folder));c.jobs.push(job);
    }
    const unreviewed=c.photos.filter(p=>!plan.decisions.some(d=>d.id===p.id)).map(p=>p.id);
    const persist=async()=>{job.updatedAt=now();job.status=job.items.every(i=>i.status==='done')?'done':'partial';c.revision++;c.updatedAt=now();await writeState(root,c);await writeFile(path.join(root,job.folder,'manifest.json'),JSON.stringify({brief:plan.brief,title:plan.title,rationale:plan.rationale,order:plan.order,decisions:plan.decisions,unreviewed,job},null,2),{mode:0o600});};
    await persist();
    for(const item of job.items){
      const output=path.join(root,job.folder,`${String(item.position).padStart(3,'0')}-${item.id}.${format==='jpeg'?'jpg':'png'}`);
      try{
        if(item.status==='done'){
          if(hash(await readFile(output))!==item.result.fileHash)fail('COLLECTION_OUTPUT_CHANGED','已导出的文件被改变；请使用新的导出任务。');
          continue;
        }
        const fresh=await context(root,c);
        if(fresh.snapshotHash!==ctx.snapshotHash)fail('STALE_COLLECTION','导出期间照片或批注已更新，剩余任务停止；请重新检查整组。');
        const p=c.photos.find(p=>p.id===item.id);
        item.result=await exportPhoto(projectPath(root,p),item.versionId,{preset,format,output});item.status='done';delete item.error;
      }catch(e){item.status='failed';item.error=localFailure(e);}
      await persist();
    }
    job.stale=(await context(root,c)).snapshotHash!==ctx.snapshotHash;await persist();
    return {folder:root,revision:c.revision,job,unreviewed,manifest:path.join(root,job.folder,'manifest.json'),next:job.stale?'导出期间照片或批注有新变化。文件对应任务开始时的版本；请复看并保存新方案后重新导出。':job.status==='done'?'检查导出成片与顺序；上传发布仍由用户决定。':'已完成文件保留。恢复失败照片后，以最新 revision 和同一 snapshotHash 重试任务；版本改变时需新选片方案。'};
  });
}
