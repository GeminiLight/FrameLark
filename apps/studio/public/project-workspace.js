import {documentHash} from './edit-stack/identity.js';
import {readVisionStream} from './vision-stream.js';
import {createProjectCollaboration} from './project-collaboration.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function projectRequest(url,{method='GET',value,body,headers={},signal,onEvent}={}) {
  const response=await fetch(url,{method,signal,headers:{...(value?{'Content-Type':'application/json'}:{}),...headers,...(onEvent?{Accept:'application/x-ndjson'}:{})},body:value?JSON.stringify(value):body});
  const result=onEvent?await readVisionStream(response,onEvent,{maxBytes:8*1024*1024}):await response.json();if(!response.ok)throw Object.assign(new Error(result.error?.message || '项目操作未完成。'),{code:result.error?.code,status:response.status});return result;
}
export function createProjectWorkspace({getPhoto,getPhotos,getPatch,getVersions=()=>[],onLoad,onUpdate,onVersions=()=>{},onState=()=>{},notify}) {
  document.querySelector('.heading-actions').insertAdjacentHTML('afterbegin','<button type="button" class="draft-status" id="project-open" hidden>文件项目</button>');
  document.querySelector('.page-heading').insertAdjacentHTML('afterend','<div class="project-sync-status" id="project-sync-status" hidden role="status"></div>');
  document.body.insertAdjacentHTML('beforeend',`<dialog id="project-dialog" class="project-dialog"><header><h2>文件项目</h2><button type="button" id="project-close" aria-label="关闭文件项目">×</button></header><p>照片、批注和版本保存在本机，网页与 Codex Skill 共用同一个项目。</p><button type="button" id="project-create">将当前照片保存为文件项目</button><form id="project-register"><label for="project-path">已有项目的文件夹路径</label><div><input id="project-path" placeholder="包含 project.json 的文件夹" /><button type="submit">打开</button></div></form><p id="project-notice" role="status"></p><section id="project-details"></section><h3>最近项目</h3><div id="project-recent"></div></dialog>
  <dialog id="project-preview" class="project-preview"><header><h2 id="project-preview-title">比较方案</h2><button type="button" id="project-preview-close" aria-label="关闭项目预览">×</button></header><div class="project-preview-images"><figure><figcaption>当前版本</figcaption><img id="project-before" alt="项目当前版本" /></figure><figure><figcaption>候选方案</figcaption><img id="project-after" alt="项目候选预览" /></figure></div><p id="project-preview-note"></p><button type="button" id="project-accept" disabled>应用这个方案</button></dialog>`);
  const $=id=>document.getElementById(id),links=new Map(),updatingPhotos=new WeakMap();let selected=null,previewToken=null,available=false;
  async function updatePhoto(photo,action){
    if(!photo)return action();
    updatingPhotos.set(photo,(updatingPhotos.get(photo)||0)+1);
    try{return await action();}
    finally{const count=updatingPhotos.get(photo)-1;if(count)updatingPhotos.set(photo,count);else updatingPhotos.delete(photo);}
  }
  const collaboration=createProjectCollaboration({getPhoto,onOpen:()=>open(),onPreview:previewCandidate,onRequest:requestContinue,
    onSwitchEditor:photo=>flush(photo),
    onCancel:async id=>{const photo=getPhoto();await flush(photo);return mutate(photo,'handoff',{action:'cancel',id,revision:photo.projectRevision});},
    onPending:pending=>{const photo=getPhoto();if(!photo)return;photo.projectNativePending=pending;status(photo);if(!pending)drainRemote(photo).catch(error=>notify(error.message));},notify});
  const pendingLoads=new Map();let loadQueue=Promise.resolve();
  const notice=text=>{$('project-notice').textContent=text;};
  function status(photo=getPhoto()){
    const node=$('project-sync-status'),link=photo&&links.get(photo.id);node.hidden=!photo?.projectId;
    if(photo){const pending=Boolean(link&&(link.dirty||link.busy||link.conflict||link.error));if(Boolean(photo.projectPending)!==pending){photo.projectPending=pending;onState(photo);}}
    if(photo===getPhoto()){const url=new URL(location.href);if(photo?.projectId)url.searchParams.set('project',photo.projectId);else url.searchParams.delete('project');history.replaceState(null,'',url);}
    if(photo===getPhoto())collaboration.show(photo,link?.data);
    if(!photo?.projectId)return;
    node.title=photo.projectPath;
    node.textContent=(photo.projectNativePending?'协作精修有未保存输入':link?.conflict?'项目有更新 · 当前修改尚未同步':link?.error?'项目保存失败':link?.busy||link?.dirty?'正在保存到项目…':link?.remote>photo.projectRevision?'正在读取项目更新…':'已保存到文件项目')+' · 本机共享项目';
  }
  function render(data=selected) {
    selected=data;
    $('project-create').disabled=!getPhoto()||!available||collaboration.isNative(getPhoto());
    $('project-create').textContent=getPhoto()?.projectId?'将当前修改另存为新项目':'将当前照片保存为文件项目';
    $('project-details').innerHTML=data?`<h3>${escape(data.name)}</h3><p class="project-path">${escape(data.path)}</p><p>版本 ${data.revision} · 自动保存到此文件夹</p>${!data.supported?`<p class="project-error">已进入协作精修，诊断、文字和保护设置会完整保留。</p>`:''}<div class="project-buttons"><button type="button" data-project-copy>复制给 Codex</button><button type="button" data-project-reload>重新读取项目</button></div><h3>候选方案</h3>${data.candidates.map(c=>`<article class="project-candidate" data-candidate="${escape(c.id)}"><strong>${escape(c.name)}</strong><p>${escape(c.goal)}</p><p>${escape(c.tradeoff)}</p>${c.items.map(item=>`<label><input type="checkbox" data-project-item="${escape(item.id)}" ${c.selectedItemIds.includes(item.id)?'checked':''} ${c.stale||c.unsupported?'disabled':''}/>${escape(item.title)}</label>`).join('')}<div class="project-buttons"><button type="button" data-project-preview="${escape(c.id)}" ${c.stale||c.unsupported?'disabled':''}>${c.stale?'方案已过期':'对比预览'}</button><button type="button" data-project-discard="${escape(c.id)}">取消方案</button></div></article>`).join('')||'<p>还没有候选。可以在 Codex 中生成方案。</p>'}<details data-project-section="versions"><summary>已保存版本 · ${data.versions.length}</summary>${data.versions.slice().reverse().map(v=>`<div class="project-version"><span>${escape(v.name)}<small>${escape(new Date(v.at).toLocaleString())}</small></span><button type="button" data-project-restore="${escape(v.id)}" ${v.id===data.currentId?'disabled':''}>${v.id===data.currentId?'当前':'恢复'}</button></div>`).join('')}</details><details data-project-section="exports"><summary>导出记录 · ${data.exports.length}</summary>${data.exports.map(e=>`<p class="project-path">${escape(e.path)} · ${escape(e.width)} × ${escape(e.height)}</p>`).join('')||'<p>导出后可在这里查看文件位置。</p>'}</details>`:'';
  }
  async function recent(){const {projects}=await projectRequest('/api/projects');$('project-recent').innerHTML=projects.map(p=>`<button type="button" class="project-recent" data-project-load="${escape(p.id)}"><strong>${escape(p.name)}</strong><small>${escape(p.path)}</small></button>`).join('')||'<p>尚未保存文件项目。</p>';}
  async function attach(photo,data,baseline=getPatch(photo)){
    links.get(photo.id)?.events.close();
    Object.assign(photo,{projectId:data.id,projectPath:data.path,projectRevision:data.revision,projectCurrentId:data.currentId,projectData:data});
    const link={photo,baseline:JSON.stringify(baseline),dirty:!collaboration.isNative(photo)&&JSON.stringify(getPatch(photo))!==JSON.stringify(baseline),busy:false,remote:0,error:null,conflict:false,data,events:new EventSource(`/api/projects/${data.id}/events`)};links.set(photo.id,link);
    onVersions(photo,data);
    link.events.onmessage=async event=>{
      if(links.get(photo.id)!==link)return;
      let update;try{update=JSON.parse(event.data);}catch{return;}
      if(update.error){link.error=update.error;status();return;}
      if(!Number.isInteger(update.revision)||update.revision<=photo.projectRevision)return;
      link.remote=Math.max(link.remote,update.revision);
      if(link.busy||photo.projectNativePending)return;
      if(!collaboration.isNative(photo)&&JSON.stringify(getPatch(photo))!==link.baseline){link.conflict=true;status();notice('项目已在另一处更新，当前修改尚未同步。请先保存副本，再重新读取项目。');return;}
      try{await drainRemote(photo);}catch(error){link.error=error.message;status();}
    };
    link.events.onerror=()=>{link.error='项目更新连接已断开，正在重连。';status();};
    link.events.onopen=()=>{link.error=null;status();};status(photo);
  }
  function load(id){
    if(pendingLoads.has(id))return pendingLoads.get(id);
    // Serialize different imports as well: capacity checks see every prior insertion.
    const pending=loadQueue.catch(()=>{}).then(()=>loadProject(id)).finally(()=>pendingLoads.delete(id));
    pendingLoads.set(id,pending);loadQueue=pending;return pending;
  }
  async function loadProject(id){
    const data=await projectRequest(`/api/projects/${id}`);render(data);
    if(getPhoto()?.projectNativePending)throw new Error('协作精修里还有未保存的输入，请先保存、试片或重置后再切换项目。');
    const existing=getPhotos().find(p=>p.projectId===id),link=existing&&links.get(existing.id);
    if(link&&(link.dirty||link.busy||link.conflict))throw new Error('这个项目仍有未同步修改，请先保存或导出副本。');
    const photo=await updatePhoto(existing,async()=>{const loaded=await onLoad(data,existing);if(!loaded)throw new Error('照片未能打开。');await attach(loaded,data);return loaded;});
    notice('已打开文件项目，后续修改会自动保存。');return photo;
  }
  async function refresh(photo){
    const link=links.get(photo.id);if(!link)return;
    const data=await projectRequest(`/api/projects/${link.data.id}`);
    if(links.get(photo.id)!==link)return;
    if(data.revision<=photo.projectRevision)return;
    if(link.dirty||link.busy||!collaboration.isNative(photo)&&JSON.stringify(getPatch(photo))!==link.baseline){link.conflict=true;status();return;}
    try{await updatePhoto(photo,async()=>{await onUpdate(photo,data);Object.assign(photo,{projectRevision:data.revision,projectCurrentId:data.currentId,projectData:data});link.data=data;link.error=null;link.baseline=JSON.stringify(getPatch(photo));if(previewToken&&previewToken.revision!==data.revision){previewToken=null;$('project-accept').disabled=true;}if(selected?.id===data.id)render(data);});}finally{status();}
  }
  async function drainRemote(photo){
    const link=links.get(photo.id);if(!link||link.busy||photo.projectNativePending)return;
    if(link.refreshing)return link.refreshing;
    link.refreshing=(async()=>{
      while(links.get(photo.id)===link&&link.remote>photo.projectRevision&&!link.conflict){
        const revision=photo.projectRevision;await refresh(photo);
        if(photo.projectRevision===revision)break;
      }
      if(link.remote<=photo.projectRevision)link.remote=0;
    })();
    try{await link.refreshing;}finally{link.refreshing=null;status();}
  }
  function schedule(photo){
    if(!photo?.projectId||updatingPhotos.has(photo)||photo.editSaving)return;
    const link=links.get(photo.id);if(!link)return;
    if(collaboration.isNative(photo)){status(photo);return;}
    link.dirty=JSON.stringify(getPatch(photo))!==link.baseline||getVersions(photo).some(v=>!link.data.versions.some(saved=>saved.id===v.id));status();
    clearTimeout(link.timer);if(link.dirty&&!link.conflict)link.timer=setTimeout(()=>flush(photo).catch(error=>{link.error=error.message;notice(error.message);status();}),500);
    else if(!link.dirty&&link.remote>photo.projectRevision)drainRemote(photo).catch(error=>{link.error=error.message;notice(error.message);status();});
  }
  async function flush(photo=getPhoto()){
    const link=photo&&links.get(photo.id);if(!link)return null;
    clearTimeout(link.timer);
    if(link.conflict)throw new Error('项目已在另一处更新，请先处理未同步修改。');
    if(collaboration.isNative(photo)){if(photo.projectNativePending)throw new Error('请先保存协作精修里的输入，或生成试片。');await drainRemote(photo);return link.data;}
    if(link.busy){await link.promise;return flush(photo);}
    const patch=getPatch(photo),serialized=JSON.stringify(patch);
    const savedIds=new Set(link.data.versions.map(v=>v.id));
    const versions=JSON.parse(JSON.stringify(getVersions(photo).filter(v=>!savedIds.has(v.id))));
    if(serialized===link.baseline&&!versions.length){link.dirty=false;await drainRemote(photo);return link.data;}
    link.busy=true;link.error=null;status();
    link.promise=(async()=>{
      try{
        const data=await projectRequest(`/api/projects/${link.data.id}/save`,{method:'POST',value:{...patch,...(versions.length?{versions,importId:crypto.randomUUID()}:{}),revision:photo.projectRevision,baseVersion:photo.projectCurrentId}});
        if(links.get(photo.id)!==link)return data;
        photo.projectRevision=data.revision;photo.projectCurrentId=data.currentId;photo.projectData=data;link.data=data;link.baseline=serialized;link.dirty=JSON.stringify(getPatch(photo))!==serialized;
        onVersions(photo,data);
        if(selected?.id===data.id)render(data);return data;
      }catch(error){if(error.status===409)link.conflict=true;link.error=error.message;throw error;}
      finally{link.busy=false;status();}
    })();
    const data=await link.promise;
    if(links.get(photo.id)!==link)return links.get(photo.id)?.data||data;
    if(link.dirty||getVersions(photo).some(v=>!link.data.versions.some(saved=>saved.id===v.id)))return flush(photo);
    await drainRemote(photo);return link.data;
  }
  async function mutate(photo,operation,value,baseline,{reload=false,signal,onEvent}={}){
    const link=links.get(photo.id);if(!link)throw new Error('项目未连接。');
    while(link.busy)await link.promise;
    if(links.get(photo.id)!==link)throw new Error('项目已切换，请在当前项目重试。');
    const beforeReload=reload?JSON.stringify(getPatch(photo)):null;
    link.busy=true;link.error=null;status();
    link.promise=projectRequest(`/api/projects/${link.data.id}/${operation}`,{method:'POST',value,signal,onEvent}).then(async data=>{
      if(links.get(photo.id)!==link)return data;
      if(reload){
        if(JSON.stringify(getPatch(photo))!==beforeReload){link.conflict=true;throw new Error('恢复已写入文件项目，但等待期间有新的网页修改。已保留这些修改，请先另存副本或重新读取项目。');}
        if(!data.supported){link.conflict=true;throw new Error(data.limitations||'这个版本需要在 Skill 中继续编辑。当前网页编辑仍保留。');}
        await updatePhoto(photo,()=>onUpdate(photo,data));link.baseline=JSON.stringify(getPatch(photo));link.dirty=false;
      }
      Object.assign(photo,{projectRevision:data.revision,projectCurrentId:data.currentId,projectData:data});link.data=data;
      onVersions(photo,data);
      if(baseline)link.baseline=JSON.stringify(baseline);
      link.dirty=!collaboration.isNative(photo)&&JSON.stringify(getPatch(photo))!==link.baseline;
      if(selected?.id===data.id)render(data);return data;
    }).catch(async error=>{
      if(error.status===409)link.conflict=true;link.error=error.name==='AbortError'||error.code==='CANCELLED'?null:error.message;link.busy=false;
      // A write can commit even when its response is lost. Reconcile a recorded event.
      if(link.remote>photo.projectRevision)await drainRemote(photo).catch(()=>{});
      throw error;
    }).finally(()=>{link.busy=false;status();});
    const data=await link.promise;
    if(links.get(photo.id)!==link)throw new Error('项目已切换，旧操作的结果保留在原文件项目中。');
    // Applying a preview commits the browser snapshot immediately after this return.
    // Wait for schedule() to observe that snapshot before reconciling remote edits.
    if(baseline&&link.dirty)return data;
    await drainRemote(photo);return {...link.data,candidateId:data.candidateId,toolRun:data.toolRun,remoteUpdated:link.data.revision!==data.revision};
  }
  async function open(section){notice(available?'':'请先运行 npm run setup，安装本地图片处理依赖后刷新页面。');render(getPhoto()?.projectId?links.get(getPhoto().id)?.data:null);$('project-dialog').showModal();try{if(getPhoto()?.projectId){await flush(getPhoto());render(links.get(getPhoto().id)?.data);}await recent();if(['versions','exports'].includes(section))$('project-details').querySelector(`[data-project-section="${section}"]`)?.setAttribute('open','');}catch(error){notice(error.message);}}
  async function requestContinue(){
    const photo=getPhoto();if(!photo)return;if(!photo.projectId)await createFileProject(photo);await flush(photo);
    const message=`请按当前意图与全部最新批注继续审片，先给我可比较的候选。${photo.creativeIntent?'目标：'+photo.creativeIntent:''}`;
    const data=await mutate(photo,'handoff',{action:'request',requestId:crypto.randomUUID(),revision:photo.projectRevision,message});
    try{await navigator.clipboard.writeText(`用 $photo-retouch 处理这个项目中的最新接续请求：\n${data.path}\n先 inspect，再 handoff claim；看实际预览与批注，生成候选后 handoff complete。`);notify('接续请求已保存，项目提示已复制。交给你的 Agent 后可在这里看进度。');}
    catch{notify('接续请求已保存。让 Agent inspect 此项目即可接手。');}
  }
  async function previewCandidate(data,id){
    const photo=getPhotos().find(p=>p.projectId===data.id);if(photo){await flush(photo);data=links.get(photo.id).data;}
    const c=data.candidates.find(c=>c.id===id);if(!c||c.stale)throw new Error('这个方案已变化，请读取最新候选。');
    if(c.unsupported){photo.preferNativeEditor=true;status(photo);return;}
    const token={project:data.id,id:c.id,revision:data.revision,selectionHash:c.selectionHash};previewToken=token;$('project-accept').disabled=true;
    $('project-preview-title').textContent=c.name;$('project-preview-note').textContent=[c.goal,c.tradeoff].filter(Boolean).join(' ');
    let loaded=0;const ready=()=>{if(previewToken===token&&++loaded===2)$('project-accept').disabled=false;};
    for(const [image,version] of [[$('project-before'),data.currentId],[$('project-after'),c.id]]){image.onload=ready;image.onerror=()=>{$('project-preview-note').textContent='预览未完成，请重新读取项目后重试。';};image.src=`/api/projects/${data.id}/preview?version=${encodeURIComponent(version)}&revision=${data.revision}`;}
    $('project-preview').showModal();
  }
  $('project-open').addEventListener('click',open);$('project-close').addEventListener('click',()=>$('project-dialog').close());
  $('project-register').addEventListener('submit',async event=>{event.preventDefault();try{const data=await projectRequest('/api/projects/register',{method:'POST',value:{path:$('project-path').value.trim()}});await load(data.id);await recent();}catch(error){notice(error.message);}});
  async function createFileProject(photo=getPhoto()){
    if(!photo)return;$('project-create').disabled=true;notice('正在保存原片和项目…');
    try{
      const bytes=photo.projectId?await(await fetch(`/api/projects/${photo.projectId}/original`)).blob():photo.sourceOriginalBlob||photo.originalBlob||await(await fetch(photo.src)).blob();
      const {patch,versions}=JSON.parse(JSON.stringify({patch:getPatch(photo),versions:getVersions(photo,{copy:true})})),signature=JSON.stringify({patch,versions});
      if(!photo.pendingProject||photo.pendingProject.signature!==signature){
        const data=await projectRequest('/api/projects/create',{method:'POST',body:bytes,headers:{'Content-Type':'application/octet-stream','X-Photo-Name':encodeURIComponent(photo.originalFileName||photo.imageName)}});
        photo.pendingProject={data,signature,importId:crypto.randomUUID(),patch,versions};
      }
      const staged=photo.pendingProject,data=await projectRequest(`/api/projects/${staged.data.id}/save`,{method:'POST',value:{...staged.patch,versions:staged.versions,importId:staged.importId,revision:staged.data.revision,baseVersion:staged.data.currentId}});
      // Do not exclude the browser draft until every saved edition has committed.
      await attach(photo,data,staged.patch);delete photo.pendingProject;
      // Persist edits and editions created while the initial migration was in flight.
      const latest=await flush(photo);render(latest);await recent();notice('已保存照片、全部命名版本与批注。网页与 Codex 可以继续编辑。');return latest;
    }finally{$('project-create').disabled=false;}
  }
  $('project-create').addEventListener('click',async()=>{try{await createFileProject();}catch(error){notice(error.message);}});
  $('project-recent').addEventListener('click',async event=>{const id=event.target.closest('[data-project-load]')?.dataset.projectLoad;if(!id)return;try{await load(id);}catch(error){notice(error.message);}});
  $('project-details').addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||!selected)return;
    try{
      if(button.hasAttribute('data-project-copy')){await navigator.clipboard.writeText(`请用 FrameLark Skill 继续编辑这个项目：\n${selected.path}\n先 inspect 并查看当前预览与全部批注，基于最新 revision 生成候选。网页会同步候选，先让我比较再应用。`);notice('已复制项目位置和继续编辑说明。');return;}
      if(button.hasAttribute('data-project-reload')){await load(selected.id);return;}
      if(button.dataset.projectDiscard){await projectRequest(`/api/projects/${selected.id}/discard`,{method:'POST',value:{id:button.dataset.projectDiscard,revision:selected.revision}});await load(selected.id);return;}
      if(button.dataset.projectRestore){await projectRequest(`/api/projects/${selected.id}/restore`,{method:'POST',value:{id:button.dataset.projectRestore,revision:selected.revision}});await load(selected.id);return;}
      if(button.dataset.projectPreview)await previewCandidate(selected,button.dataset.projectPreview);
    }catch(error){notice(error.message);}
  });
  $('project-details').addEventListener('change',async event=>{
    const card=event.target.closest('[data-candidate]');if(!card||!selected)return;
    const c=selected.candidates.find(c=>c.id===card.dataset.candidate);if(!c)return;
    try{render(await projectRequest(`/api/projects/${selected.id}/select`,{method:'POST',value:{id:c.id,revision:selected.revision,selectionHash:c.selectionHash,selectedItemIds:[...card.querySelectorAll('input:checked')].map(i=>i.dataset.projectItem)}}));}catch(error){notice(error.message);render();}
  });
  $('project-preview-close').addEventListener('click',()=>$('project-preview').close());
  $('project-preview').addEventListener('close',()=>{previewToken=null;});
  $('project-accept').addEventListener('click',async()=>{
    const token=previewToken;if(!token)return;$('project-accept').disabled=true;
    try{await projectRequest(`/api/projects/${token.project}/accept`,{method:'POST',value:{id:token.id,revision:token.revision,selectionHash:token.selectionHash}});$('project-preview').close();await load(token.project);notify('已应用项目方案。');}catch(error){$('project-preview-note').textContent=error.message;}
  });
  async function capabilities(){try{const result=await projectRequest('/api/local-capabilities');available=result.projects;collaboration.enable(Boolean(result.local&&result.projects));$('project-open').hidden=!result.local;return result;}catch{return {projects:false,heic:false};}}
  return {open,load,attach,schedule,flush,status,capabilities,refresh,
    async saveEdition(photo,name,kind='manual'){const patch=JSON.parse(JSON.stringify(getPatch(photo)));await flush(photo);return mutate(photo,'versions',{revision:photo.projectRevision,baseVersion:photo.projectCurrentId,name,kind,patch});},
    async renameEdition(photo,id,name){await flush(photo);return mutate(photo,'versions/rename',{revision:photo.projectRevision,id,name});},
    async restoreEdition(photo,id){await flush(photo);return mutate(photo,'restore',{revision:photo.projectRevision,id},null,{reload:true});},
    async proposeTools(photo,value,{signal,onEvent}={}){
      await flush(photo);const data=await mutate(photo,'tools',{...value,revision:photo.projectRevision,baseVersion:photo.projectCurrentId},undefined,{signal,onEvent});
      const candidate=data.candidates.find(c=>c.id===data.candidateId);if(!candidate||!data.toolRun)throw new Error('工具候选已变化，请重新生成。');
      return {run:data.toolRun,token:{projectId:photo.projectId,id:candidate.id,revision:data.revision,selectionHash:candidate.selectionHash}};
    },
    async proposeDocument(photo,proposal,{signal}={}){
      const link=links.get(photo.id);if(!link)throw new Error('项目未连接。');
      link.documentRequests||=new Map();const requestId=proposal.requestId||crypto.randomUUID();let value=link.documentRequests.get(requestId);if(!value){value={revision:photo.projectRevision,baseVersion:photo.projectCurrentId,requestId,name:proposal.name||'编辑步骤',goal:proposal.goal||'',tradeoff:proposal.tradeoff||'',proposal:structuredClone(proposal)};link.documentRequests.set(requestId,value);if(link.documentRequests.size>128)link.documentRequests.delete(link.documentRequests.keys().next().value);}
      let baseline=JSON.parse(link.baseline);const current=getPatch(photo),metadata={...baseline,intent:current.intent,conversation:current.conversation};if(JSON.stringify(metadata)!==JSON.stringify(baseline)){await mutate(photo,'save',{...metadata,revision:photo.projectRevision,baseVersion:photo.projectCurrentId},metadata,{signal});baseline=metadata;value={...value,revision:photo.projectRevision,baseVersion:photo.projectCurrentId};link.documentRequests.set(requestId,value);}
      const data=await mutate(photo,'document',value,baseline,{signal});
      const candidate=data.candidates.find(c=>c.id===data.candidateId);if(!candidate?.document)throw new Error('文档候选尚未完成。');return {document:candidate.document,token:{projectId:photo.projectId,id:candidate.id,revision:data.revision,selectionHash:candidate.selectionHash,documentHash:documentHash(candidate.document)}};
    },
    async recoverDocument(photo,requestId,expectedHash,{signal}={}){const link=links.get(photo.id);if(!link)return null;const data=await projectRequest(`/api/projects/${photo.projectId}`,{signal}),version=data.versions.find(version=>version.id===data.currentId);if(version?.requestId!==requestId||!data.document||documentHash(data.document)!==expectedHash)return null;await updatePhoto(photo,()=>onUpdate(photo,data));Object.assign(photo,{projectRevision:data.revision,projectCurrentId:data.currentId,projectData:data});link.data=data;link.baseline=JSON.stringify(getPatch(photo));link.dirty=false;link.conflict=false;link.error=null;onVersions(photo,data);status(photo);return data.document;},
    async renderDocumentPreview(photo,token,{signal}={}){const response=await fetch(`/api/projects/${photo.projectId}/preview?version=${encodeURIComponent(token.id)}&revision=${token.revision}`,{signal});if(!response.ok){const failure=await response.json().catch(()=>null);throw new Error(failure?.error?.message||'文件项目预览未完成。');}const bytes=await response.arrayBuffer();if(!bytes.byteLength)throw new Error('文件项目预览为空。');if(response.headers.get('X-Project-Revision')!==String(token.revision)||response.headers.get('X-Version-Id')!==token.id||response.headers.get('X-Selection-Hash')!==token.selectionHash||response.headers.get('X-Document-Hash')!==token.documentHash||!response.headers.get('X-Frame-Spec'))throw new Error('预览与当前配方或所选组合不一致，请重新预览。');const checksum=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(checksum!==response.headers.get('X-Png-Hash'))throw new Error('预览图像校验失败，请重新预览。');return bytes;},
    async propose(photo,patch,explanation){await flush(photo);const data=await mutate(photo,'candidate',{revision:photo.projectRevision,baseVersion:photo.projectCurrentId,patch,goal:explanation.goal,tradeoff:explanation.tradeoff});const candidate=data.candidates.find(c=>c.id===data.candidateId);return {projectId:photo.projectId,id:candidate.id,revision:data.revision,selectionHash:candidate.selectionHash};},
    async accept(photo,token,patch,{signal}={}){const {id,revision,selectionHash}=token;return mutate(photo,'accept',{id,revision,selectionHash},patch,{signal});},
    async discard(photo,token){if(!token)return;try{if(photo&&links.has(photo.id))await mutate(photo,'discard',{id:token.id});else if(token.projectId)await projectRequest(`/api/projects/${token.projectId}/discard`,{method:'POST',value:{id:token.id}});}catch{/* It may already have been accepted or discarded elsewhere. */}},
    hasPending:()=>[...links.values()].some(l=>l.dirty||l.busy||l.conflict||l.photo.projectNativePending),
    release(photo){const link=links.get(photo.id);link?.events.close();clearTimeout(link?.timer);links.delete(photo.id);},
    async exportVersion(photo,versionId,options,signal){return projectRequest(`/api/projects/${photo.projectId}/export`,{method:'POST',signal,value:{versionId,options}});},
    close(){for(const photo of getPhotos())this.release(photo);}
  };
}
