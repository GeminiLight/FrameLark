import {readFile,mkdir,realpath} from 'node:fs/promises';
import {watch} from 'node:fs';
import {fork} from 'node:child_process';
import {join,resolve,basename,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {FileRegistry} from './registry.mjs';
import {createProjectRenderPool} from './render-pool.mjs';

const failure=(code,message)=>Object.assign(new Error(message),{code});
const runtime=()=>import('../../../../skills/photo-retouch/scripts/collection.mjs');
function exportWorker(){
  // A child owns the collection lock PID. Cancelling it leaves a recoverable
  // partial export, rather than an abandoned thread lock owned by the studio.
  const child=fork(fileURLToPath(new URL('./collection-worker.mjs',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc']});
  child.postMessage=value=>child.send(value);
  child.terminate=()=>new Promise((resolve,reject)=>{
    if(child.exitCode!==null||child.signalCode!==null)return resolve();
    const timer=setTimeout(()=>child.kill('SIGKILL'),2000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});child.kill('SIGTERM');
  });
  return child;
}

export class CollectionBridge {
  constructor({root=process.cwd(),projects}={}){
    this.root=resolve(root);this.projects=projects;this.registry=new FileRegistry(join(this.root,'.guangjian/collections.json'));
    this.watchers=new Set();this.exports=createProjectRenderPool({concurrency:1,maxQueued:2,createWorker:exportWorker});
  }
  async list(){return Object.entries(await this.registry.read()).map(([id,record])=>({id,...record}));}
  async register(folder){
    if(typeof folder!=='string'||!folder.trim()||folder.length>4096)throw failure('COLLECTION_PATH','请输入含 collection.json 的组图目录。');
    const path=await realpath(resolve(folder)),c=await (await runtime()).inspectCollection(path);
    if(typeof c.id!=='string'||!/^[-\w]{1,80}$/.test(c.id))throw failure('COLLECTION_INVALID','组图编号无效。');
    await this.registry.set(c.id,{path,name:c.plan?.title||c.brief.theme||'共享组图',updatedAt:c.updatedAt});return this.get(c.id);
  }
  async folder(id){
    if(!/^[-\w]{1,80}$/.test(id||''))throw failure('COLLECTION_NOT_FOUND','找不到这个共享组图。');
    const record=(await this.registry.read())[id];if(!record)throw failure('COLLECTION_NOT_FOUND','请先打开这份组图目录。');
    const path=await realpath(record.path),c=await (await runtime()).loadCollection(path);
    if(path!==record.path||c.id!==id)throw failure('COLLECTION_IDENTITY','组图目录或身份已变化，请重新打开真实组图，现有内容保持原样。');
    return path;
  }
  async get(id){
    const folder=await this.folder(id),c=await (await runtime()).inspectCollection(folder);
    if(c.id!==id)throw failure('COLLECTION_IDENTITY','组图身份已变化，请重新打开。');
    const {loadProject}=await this.projects.runtime(),known=await this.projects.registry(),photos=[];
    for(const photo of c.photos){
      if(photo.error){photos.push(photo);continue;}
      const path=join(folder,photo.project),p=await loadProject(path);
      if(known[p.id]?.path!==path)await this.projects.register(path);
      photos.push({...photo,projectId:p.id,preview:`/api/projects/${p.id}/preview?version=current&revision=${p.revision}`});
    }
    return {...c,photos};
  }
  async create({directory,brief={}}){
    const parent=join(this.root,'projects','collections');await mkdir(parent,{recursive:true,mode:0o700});
    const folder=join(parent,randomUUID());await (await runtime()).initCollection(folder,{directory,brief});return this.register(folder);
  }
  async brief(id,value){await (await runtime()).updateCollectionBrief(await this.folder(id),value,{collectionId:id});return this.get(id);}
  async plan(id,value){await (await runtime()).saveCollectionPlan(await this.folder(id),{...value,source:'workspace-user'},{collectionId:id});return this.get(id);}
  async export(id,value,{signal}={}){
    return this.exports.run({id:1,action:'collection-export',folder:await this.folder(id),key:id,options:value},{signal});
  }
  async exportedFile(id,jobId,name){
    if(basename(name)!==name||!/^[-\w]{36}$/.test(jobId||''))throw failure('COLLECTION_FILE','组图成片路径无效。');
    const folder=await this.folder(id),c=await (await runtime()).loadCollection(folder),job=c.jobs.find(j=>j.id===jobId);
    if(!job||job.folder!==`exports/${jobId}`)throw failure('COLLECTION_FILE','找不到这份组图导出。');
    const item=job.items.find(i=>i.status==='done'&&basename(i.result?.path||'')===name);
    if(name!=='manifest.json'&&!item)throw failure('COLLECTION_FILE','该文件未登记为组图成片。');
    const base=await realpath(join(folder,job.folder)),path=await realpath(join(base,name));
    if(base!==join(folder,job.folder))throw failure('COLLECTION_FILE','组图导出目录已被重定向，请恢复实际导出文件后重试。');
    if(!path.startsWith(base+sep))throw failure('COLLECTION_FILE','组图成片路径无效。');
    const bytes=await readFile(path);
    if(item&&createHash('sha256').update(bytes).digest('hex')!==item.result.fileHash)throw failure('COLLECTION_FILE','成片文件已改变，请重新导出。');
    return {bytes,name};
  }
  async subscribe(id,send){
    const folder=await this.folder(id),c=await (await runtime()).loadCollection(folder),watchers=[];
    let timer,closed=false,reading=false,again=false;
    const read=async()=>{
      if(closed)return;if(reading){again=true;return;}reading=true;
      try{const latest=await this.get(id);if(!closed)send({revision:latest.revision,snapshotHash:latest.snapshotHash});}
      catch{if(!closed)send({error:'组图暂时无法读取，请重新打开。'});}
      finally{reading=false;if(again){again=false;read();}}
    };
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(read,70);};
    const close=()=>{if(closed)return;closed=true;clearTimeout(timer);for(const watcher of watchers)watcher.close();this.watchers.delete(close);};
    try{
      for(const [path,file] of [[folder,'collection.json'],...c.photos.map(p=>[join(folder,p.project),'project.json'])]){
        const watcher=watch(path,(_event,name)=>{if(!name||String(name)===file)schedule();});
        watcher.on('error',()=>{if(!closed)send({error:'组图更新通知已断开，请重新打开。'});close();});watchers.push(watcher);
      }
    }catch(error){close();throw error;}
    this.watchers.add(close);await read();return close;
  }
  close(){for(const close of this.watchers)close();return this.exports.close();}
}
