import {versionToolRuns} from '../../public/photo-tools/history.js';
import {createProjectRenderPool} from './render-pool.mjs';
import {publicToolRun} from '../tools/results.mjs';
import {readFile,writeFile,mkdir,rename,realpath,mkdtemp,rm,stat} from 'node:fs/promises';
import {watch} from 'node:fs';
import {resolve,join,basename,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

export class ProjectBridge {
  constructor({root=process.cwd()}={}){this.root=resolve(root);this.file=join(this.root,'.guangjian/projects.json');this.records=null;this.writes=Promise.resolve();this.watchers=new Set();this.renderer=createProjectRenderPool();this.workers=this.renderer.workers;}
  async runtime(){
    try{return await import('../../../../skills/photo-retouch/scripts/project.mjs');}
    catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')throw Object.assign(new Error('请在项目目录运行 npm run setup，安装本地图片处理依赖后重试。'),{code:'PROJECT_SETUP_REQUIRED'});throw error;}
  }
  async capabilities(){try{await this.runtime();return {projects:true,heic:process.platform==='darwin'};}catch{return {projects:false,heic:process.platform==='darwin',setup:'npm run setup'};}}
  async registry(){if(!this.registryLoading)this.registryLoading=(async()=>{try{this.records=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;this.records={};}return this.records;})();return this.registryLoading;}
  async persist(){const value=JSON.stringify(await this.registry());this.writes=this.writes.catch(()=>{}).then(async()=>{await mkdir(join(this.root,'.guangjian'),{recursive:true,mode:0o700});const temp=this.file+'.'+randomUUID()+'.tmp';await writeFile(temp,value,{mode:0o600});await rename(temp,this.file);});return this.writes;}
  async register(folder){
    if(typeof folder!=='string'||!folder.trim()||folder.length>4096)throw Object.assign(new Error('请输入照片项目的文件夹路径。'),{code:'PROJECT_PATH'});
    const path=await realpath(resolve(folder)),runtime=await this.runtime(),p=await runtime.loadProject(path);
    if(typeof p.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(p.id))throw new Error('项目编号无效。');
    const records=await this.registry();records[p.id]={path,name:p.source.name,updatedAt:p.updatedAt};await this.persist();return this.get(p.id);
  }
  async resolve(id){
    if(!/^[-a-zA-Z0-9]{1,80}$/.test(id))throw Object.assign(new Error('项目编号无效。'),{code:'PROJECT_NOT_FOUND'});
    const entry=(await this.registry())[id];if(!entry)throw Object.assign(new Error('项目未登记，请重新打开项目文件夹。'),{code:'PROJECT_NOT_FOUND'});
    if(await realpath(entry.path)!==entry.path)throw Object.assign(new Error('项目位置已变化，请重新打开。'),{code:'PROJECT_MOVED'});
    const runtime=await this.runtime(),p=await runtime.loadProject(entry.path);
    if(p.id!==id)throw Object.assign(new Error('项目内容已变化，请重新打开。'),{code:'PROJECT_CHANGED'});
    return {runtime,p,path:entry.path};
  }
  view(p,path,runtime){
    const current=p.versions.find(v=>v.id===p.currentId),limitations=runtime.workspaceLimitations(p),native=runtime.publicProject(p);
    return {id:p.id,path,name:p.source.name,source:p.source,revision:p.revision,currentId:p.currentId,intent:p.intent,notes:p.notes,current:current.state,toolRuns:versionToolRuns(current),
      supported:!limitations,limitations,editor:`/api/projects/${p.id}/editor/?embedded=1`,workflow:native.workflowStatus,collaboration:native.collaboration,
      diagnosis:p.diagnoses?.find(d=>d.id===native.workflowStatus.diagnosisId)||null,updatedAt:p.updatedAt,acceptedBy:current.acceptedBy||null,
      versions:p.versions.map((v,index)=>({id:v.id,name:v.name,at:v.createdAt,kind:index===0?'original':v.kind||'native',mode:v.mode,toolRuns:versionToolRuns(v),state:v.state,notes:v.workspaceNotes||p.notes,supported:!runtime.workspaceLimitations(p,v.state,v.workspaceNotes||p.notes)})),candidates:p.candidates.map(c=>({id:c.id,name:c.name,goal:c.goal,tradeoff:c.tradeoff,actorId:c.actorId||null,handoffId:c.handoffId||null,selectionHash:c.selectionHash,selectedItemIds:c.selectedItemIds,items:c.items.map(({id,title,dependsOn,operation,execution})=>({id,title,dependsOn,operation,execution})),stale:c.baseFingerprint!==this.fingerprint(p),unsupported:c.mode==='guards'||Boolean(c.state.textOverlays?.length)})),
      exports:(p.exports||[]).map(e=>({path:e.path,versionId:e.versionId,width:e.width,height:e.height,at:e.createdAt})),conversation:p.workspaceConversation || []};
  }
  fingerprint(p){return this.hash?.({current:p.currentId,state:p.versions.find(v=>v.id===p.currentId)?.state,source:p.source,intent:p.intent,notes:p.notes,pipeline:this.pipeline});}
  async mutationView(runtime,p,path){this.hash=runtime.hash;const {pipelineVersion}=await import('../../../../skills/photo-retouch/scripts/engine/edit-identity.js');this.pipeline=pipelineVersion;return this.view(p,path,runtime);}
  async get(id){const {runtime,p,path}=await this.resolve(id);return this.mutationView(runtime,p,path);}
  async list(){return Object.entries(await this.registry()).map(([id,r])=>({id,...r}));}
  async handoff(id,value){const {runtime,path}=await this.resolve(id);const {handoffProject}=await import('../../../../skills/photo-retouch/scripts/handoff.mjs');const result=await handoffProject(path,value);return this.mutationView(runtime,result.project,path);}
  async editor(request,response,url,id,base,readBody,signal){
    const {path}=await this.resolve(id),{handleNativeProjectRoute}=await import('../../../../skills/photo-retouch/scripts/native-router.mjs');
    return handleNativeProjectRoute(request,response,url,{folder:path,base,embedded:true,readBody:async req=>JSON.parse((await readBody(req,64*1024)).toString('utf8')),
      render:(action,key,options)=>this.render(action,path,key,options,signal)});
  }
  async create(bytes,name){
    const runtime=await this.runtime(),scratch=await mkdtemp(join(tmpdir(),'frameyn-project-import-'));
    try{
      const safe=basename(String(name||'photo.png')).replace(/[\x00-\x1f]/g,'').slice(0,160)||'photo.png',image=join(scratch,safe);
      await writeFile(image,bytes,{mode:0o600});const parent=join(this.root,'projects');await mkdir(parent,{recursive:true,mode:0o700});
      const folder=join(parent,randomUUID());await runtime.initProject(image,folder);return await this.register(folder);
    }finally{await rm(scratch,{recursive:true,force:true});}
  }
  async save(id,value){const {runtime,path}=await this.resolve(id),result=await runtime.saveWorkspaceSnapshot(path,value);return this.mutationView(runtime,result.project,path);}
  async edition(id,value){const {runtime,path}=await this.resolve(id),result=await runtime.saveWorkspaceEdition(path,value);return this.mutationView(runtime,result.project,path);}
  async renameVersion(id,value){const {runtime,path}=await this.resolve(id),result=await runtime.renameWorkspaceVersion(path,value);return this.mutationView(runtime,result.project,path);}
  async propose(id,{revision,baseVersion,patch,goal='',tradeoff=''}){
    const {runtime,path,p}=await this.resolve(id),before=runtime.currentVersion(p).state;
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),items=[];
    const sameLocal=(a,b)=>a&&[...new Set([...Object.keys(a.localSettings||{}),...Object.keys(b.localSettings||{})])].every(k=>(a.localSettings?.[k]||0)===(b.localSettings?.[k]||0))&&['rect','maskType','feather','localAmount','localEnabled','start','end','points','brushRadius','exclude'].every(k=>same(a[k],b[k]));
    const global={};if(!same(before.settings,patch.settings))global.settings=patch.settings;
    if(!same(before.style,patch.style))global.style=patch.style;
    if(Object.keys(global).length)items.push({id:'global',title:'光色与风格',patch:global});
    if(!same(before.crop,patch.crop))items.push({id:'crop',title:'构图裁剪',patch:{crop:patch.crop}});
    const annotations=patch.annotations || [];
    const wanted=annotations.filter(a=>Object.values(a.localSettings||{}).some(Boolean)||a.hasLocal);
    for(const local of before.locals.filter(l=>!wanted.some(a=>a.id===l.id)))items.push({id:'remove-'+local.id,title:'移除局部调整',patch:{locals:[{annotationId:local.id,remove:true}]}});
    for(const a of wanted){
      const existing=before.locals.find(l=>l.id===a.id);
      if(a.maskType==='brush'){
        if(sameLocal(existing,a))continue;
        throw new Error('文件项目的候选暂不支持修改画笔范围，请先用矩形、径向或渐变。');
      }
      if(sameLocal(existing,a))continue;
      const local={annotationId:a.id,settings:a.localSettings,maskType:a.maskType||'rectangle',feather:a.feather??.36,enabled:a.localEnabled!==false,amount:a.localAmount??100};
      if(!p.notes.some(n=>n.id===a.id)){local.rect=a.rect;local.note=a.note;}
      if(a.exclude!==undefined)local.exclude=a.exclude;
      if(local.maskType==='linear'){local.start=a.start;local.end=a.end;}
      items.push({id:'local-'+a.id,title:'局部调整',patch:{locals:[local]}});
    }
    if(!items.length)throw new Error('这份方案与当前项目版本相同。');
    const result=await runtime.createCandidate(path,{revision,baseVersion,requestId:randomUUID(),actorId:'workspace-user',name:String(goal||'网页候选').slice(0,40),goal,tradeoff,items});
    return {...await this.mutationView(runtime,result.project,path),candidateId:result.candidate.id};
  }
  async proposeTools(id,value,options={}){
    const {runtime,path,p}=await this.resolve(id),limitations=runtime.workspaceLimitations(p);
    if(limitations)throw Object.assign(new Error(limitations),{code:'WORKSPACE_UNSUPPORTED'});
    const {createToolCandidate}=await import('../../../../skills/photo-retouch/scripts/tool-candidates.mjs');
    const result=await createToolCandidate(path,{revision:value.revision,baseVersion:value.baseVersion,requestId:randomUUID(),actorId:'workspace-user',name:String(value.name||'工具组合').slice(0,40),goal:String(value.goal||''),tradeoff:String(value.tradeoff||''),operations:value.operations,selectedItemIds:value.selectedItemIds},{...options,namespace:value.namespace});
    return {...await this.mutationView(runtime,result.project,path),candidateId:result.candidate.id,toolRun:{...publicToolRun(result.toolRun),history:result.candidate.toolRuns,label:result.candidate.name}};
  }
  async original(id){const {path}=await this.resolve(id);return readFile(join(path,'source/original.bin'));}
  async source(id){const {path}=await this.resolve(id);return readFile(join(path,'source/normalized.png'));}
  async candidate(id,operation,value){
    const {runtime,path,p}=await this.resolve(id);
    let result;
    if(operation==='select')result=await runtime.selectCandidateItems(path,value);
    else if(operation==='accept')result=await runtime.acceptCandidate(path,{...value,acceptedBy:'user'});
    else if(operation==='discard')result=await runtime.discardCandidate(path,value);
    else if(operation==='restore'){const target=runtime.findVersion(p,value.id),limitations=runtime.workspaceLimitations(p,target.state,target.workspaceNotes||p.notes);if(limitations)throw Object.assign(new Error(limitations),{code:'WORKSPACE_UNSUPPORTED'});result=await runtime.restoreVersion(path,value);}
    else throw new Error('不支持的项目操作。');
    return this.mutationView(runtime,result.project,path);
  }
  async render(action,folder,key,options,signal) {
    return this.renderer.run({id:1,action,folder,key,options},{signal});
  }
  async preview(id,version,revision,signal){
    const {runtime,p,path}=await this.resolve(id);
    if(revision!==p.revision)throw Object.assign(new Error('项目已更新，请重新预览。'),{code:'STALE_REVISION'});
    runtime.findVersion(p,version);
    const frame=await this.render('preview',path,version,{maxSide:1400},signal);
    if((await runtime.loadProject(path)).revision!==revision)throw Object.assign(new Error('预览期间项目已更新，请重试。'),{code:'STALE_REVISION'});
    return readFile(frame.path);
  }
  async export(id,{versionId,options={}},signal){
    const {runtime,p,path}=await this.resolve(id);if(!p.versions.some(v=>v.id===versionId))throw new Error('请先保存当前调整再导出。');
    const {maxSide,format,quality,dpi,includeArtwork,author,copyright}=options;
    const output=join(path,'exports',randomUUID()+(format==='png'?'.png':'.jpg'));
    let result;
    try{
      result=await this.render('export',path,versionId,{output,maxSide,format,quality:quality<=1?quality*100:quality,dpi,includeArtwork,author,copyright,title:p.source.name},signal);
      if(signal?.aborted)throw Object.assign(new Error('导出已取消。'),{code:'CANCELLED'});
      await runtime.recordExport(path,result);
    }catch(error){await rm(output,{force:true});throw error;}
    return {...result,download:`/api/projects/${id}/exports/${encodeURIComponent(basename(result.path))}`};
  }
  async exportedFile(id,name){
    const {p,path}=await this.resolve(id);if(basename(name)!==name||!p.exports.some(e=>e.path===join(path,'exports',name)))throw new Error('找不到这份成片。');
    const file=await realpath(join(path,'exports',name));if(!file.startsWith(join(path,'exports')+sep))throw new Error('成片路径无效。');
    return {bytes:await readFile(file),name};
  }
  async subscribe(id,send){
    const {path}=await this.resolve(id);let timer,closed=false;
    const watcher=watch(path,(_event,name)=>{if(name && String(name)!=='project.json')return;clearTimeout(timer);timer=setTimeout(async()=>{if(closed)return;try{const {p}=await this.resolve(id);send({revision:p.revision});}catch{send({error:'项目暂时无法读取，请重新打开。'});}},120);});
    const close=()=>{closed=true;clearTimeout(timer);watcher.close();this.watchers.delete(close);};
    watcher.on('error',()=>{send({error:'项目更新通知已断开，请重新打开。'});close();});this.watchers.add(close);return close;
  }
  close(){for(const close of this.watchers)close();return this.renderer.close();}
}
