import {collectionDraft,collectionPlan,moveCollectionPhoto,setCollectionDecision,sameCollectionContext,collectionExportStatus} from './collection-model.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(path,value,signal){
  const response=await fetch(path,{...(value?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}:{}),signal});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message||'共享组图操作未完成。'),{code:data.error?.code,status:response.status});return data;
}
export function createCollectionWorkspace({onEdit,notify}){
  const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./collection-workspace.css',import.meta.url).href;document.head.append(link);
  document.body.insertAdjacentHTML('beforeend',`<dialog id="collection-picker" class="collection-picker"><header><div><small>共同编辑</small><h2>打开共享组图</h2></div><button type="button" data-collection-close="picker" aria-label="关闭共享组图入口">×</button></header><p>打开 Agent 已建立的组图，或者从一个原片目录开始。单图的版本和批注沿用原项目。</p><label>组图目录<input id="collection-source" placeholder="含 collection.json 的组图文件夹" /></label><button type="button" id="collection-load" class="primary-button">打开已有组图</button><details><summary>从原片目录建立新组图</summary><label>原片目录<input id="collection-images" placeholder="电脑上的照片文件夹" /></label><label>这组想表达什么？<input id="collection-new-theme" maxlength="600" /></label><button type="button" id="collection-create">建立共享组图</button><small>复制原片到新组图，不覆盖原片目录。已有精修项目请用上面的入口打开。</small></details><div id="collection-recent"></div><p id="collection-picker-status" role="status"></p></dialog>
  <dialog id="shared-collection-dialog" class="shared-collection-dialog" aria-labelledby="shared-collection-title"><header><div><small>共同编辑 · 组图册</small><h2 id="shared-collection-title">共享组图</h2></div><button type="button" data-collection-close="workspace" aria-label="关闭共享组图">×</button></header><div class="shared-collection-body"><section class="shared-collection-direction"><label>主题<input id="collection-theme" maxlength="600" /></label><label>用途<select id="collection-purpose"><option value="story">叙事分享</option><option value="travel">旅行随记</option><option value="portrait">人物交付</option><option value="event">活动记录</option><option value="catalog">商品展示</option><option value="portfolio">作品精选</option><option value="archive">留作记录</option></select></label><button type="button" id="collection-save-theme">保存主题</button><p id="collection-status" role="status" aria-live="polite"></p><div class="collection-recovery"><button type="button" id="collection-backup">保存草稿备份</button><button type="button" id="collection-reload">读取最新组图</button></div><details><summary>共同编辑的位置</summary><p id="collection-folder"></p><p>这里的主题、取舍和顺序与 Agent 使用同一份组图记录。候选效果需进入单图比较并接受。</p></details><section id="collection-downloads" aria-label="组图导出文件"></section></section><section class="shared-collection-board"><div class="collection-board-heading"><strong id="collection-count"></strong><span>按当前保存版本预览</span></div><div id="collection-grid" class="collection-grid"></div><nav class="collection-pages" aria-label="组图分页"><button id="collection-previous" type="button">上一页</button><span id="collection-page"></span><button id="collection-next" type="button">下一页</button></nav></section></div><footer><span id="collection-plan-status"></span><div><button type="button" id="collection-save-plan" class="primary-button">保存选片与顺序</button><button type="button" id="collection-export">按顺序导出</button></div></footer></dialog>`);
  const $=id=>document.getElementById(id),picker=$('collection-picker'),dialog=$('shared-collection-dialog');
  const entry=document.createElement('button');entry.id='collection-open';entry.className='series-entry';entry.type='button';entry.textContent='共享组图';entry.hidden=true;$('add-photo-button').before(entry);
  let data=null,draft=null,page=1,dirtyTheme=false,dirtyPlan=false,conflict=false,backupMade=false,busy=false,stream=null,refreshing=null,queued=false,exportController=null;
  const dirty=()=>dirtyTheme||dirtyPlan;
  const status=text=>{$('collection-status').textContent=text;};
  function stop(){stream?.close();stream=null;exportController?.abort();exportController=null;}
  function downloads(){
    const job=data.jobs?.at(-1);$('collection-downloads').innerHTML=job?`<strong>${escape(collectionExportStatus(data,job).label)}</strong>${job.items.filter(i=>i.status==='done').map(i=>`<a href="/api/collections/${data.id}/exports/${job.id}/${encodeURIComponent(i.result.path.split(/[\\/]/).at(-1))}">下载 ${escape(i.id)}</a>`).join('')}<a href="/api/collections/${data.id}/exports/${job.id}/manifest.json">下载顺序与版本记录</a>`:'';
  }
  function render({preserveInputs=false}={}){
    if(!data)return;
    $('collection-theme').disabled=busy;$('collection-purpose').disabled=busy;
    $('shared-collection-title').textContent=data.plan?.title||data.brief.theme||'共享组图';$('collection-folder').textContent=data.folder;
    if(!preserveInputs){$('collection-theme').value=draft.brief.theme;$('collection-purpose').value=draft.brief.purpose;}
    const remaining=data.photos.filter(p=>!draft.order.includes(p.id)).map(p=>p.id),ids=[...draft.order,...remaining];
    const pages=Math.max(1,Math.ceil(ids.length/9));page=Math.max(1,Math.min(page,pages));
    $('collection-count').textContent=`${draft.order.length} 张入选 · 共 ${data.photos.length} 张`;
    if(!preserveInputs)$('collection-grid').innerHTML=ids.slice((page-1)*9,page*9).map(id=>{
      const photo=data.photos.find(p=>p.id===id),record=draft.decisions.find(d=>d.id===id),position=draft.order.indexOf(id),must=draft.brief.mustKeep.includes(id);
      return `<article data-collection-photo="${id}" class="collection-photo ${record?.decision==='select'?'is-selected':''}"><div class="collection-photo-heading"><strong>${position>=0?String(position+1).padStart(2,'0')+' · ':''}${id}${must?' · 必留':''}</strong><div><button type="button" data-collection-move="${id}" data-direction="-1" aria-label="前移 ${id}" ${position<=0?'disabled':''}>←</button><button type="button" data-collection-move="${id}" data-direction="1" aria-label="后移 ${id}" ${position<0||position===draft.order.length-1?'disabled':''}>→</button></div></div>${photo.preview?`<img src="${escape(photo.preview)}" alt="${escape(photo.name)} 当前保存版本" />`:`<p>${escape(photo.error?.message||'照片暂时不可用')}</p>`}<span class="collection-photo-name">${escape(photo.name)}</span><label class="sr-only" for="collection-decision-${id}">${id} 的取舍</label><select id="collection-decision-${id}" data-collection-decision="${id}" ${!record?'disabled':''}>${[['select','入选'],['reserve','备选'],['exclude','暂不使用']].map(([value,label])=>`<option value="${value}" ${record?.decision===value?'selected':''}>${label}</option>`).join('')}</select>${record?`<label>取舍理由<input data-collection-reason="${id}" maxlength="600" value="${escape(record.reason)}" /></label>`:''}<button type="button" data-collection-edit="${escape(photo.projectId||'')}" ${!photo.projectId?'disabled':''}>打开单图精修 ↗</button></article>`;
    }).join('');
    $('collection-page').textContent=`${page} / ${pages}`;$('collection-previous').disabled=page<=1;$('collection-next').disabled=page>=pages;
    $('collection-plan-status').textContent=conflict?'有新更新，当前草稿已保留':dirty()?'当前输入尚未保存':data.plan?.stale?'单图或主题已更新，请复看并重新保存排列':data.plan?'选片与顺序已保存':'先确认照片，再保存选片与顺序';
    $('collection-export').disabled=busy||conflict||dirty()||!data.plan||data.plan.stale||!data.plan.order.length;
    $('collection-save-theme').disabled=busy||conflict;$('collection-save-plan').disabled=busy||conflict||dirtyTheme||!draft.order.length;
    downloads();
  }
  function adopt(next){data=next;draft=collectionDraft(next);dirtyTheme=false;dirtyPlan=false;conflict=false;backupMade=false;render();}
  async function refresh(){
    if(!data||!dialog.open)return;if(busy||refreshing){queued=true;return;}const id=data.id;
    refreshing=(async()=>{
      const next=await request('/api/collections/'+id);if(data.id!==id||!dialog.open)return;
      if(dirty()&&!sameCollectionContext(data,next)){conflict=true;status('Agent 或另一处已更新组图。你的未保存输入已保留，请先保存草稿备份，再读取最新组图。');render({preserveInputs:true});return;}
      if(dirty()){data=next;draft.revision=next.revision;render({preserveInputs:true});}else adopt(next);
    })().catch(error=>status(error.message)).finally(()=>{refreshing=null;if(queued&&!busy){queued=false;refresh();}});
    return refreshing;
  }
  async function show(next){
    if(data&&data.id!==next.id&&dirty()&&!backupMade)throw new Error('请先保存或备份当前组图草稿，再打开另一组。');
    stop();if(data?.id===next.id&&dirty()){if(sameCollectionContext(data,next)){data=next;draft.revision=next.revision;}else conflict=true;render();}
    else adopt(next);
    picker.close();if(!dialog.open)dialog.showModal();
    stream=new EventSource(`/api/collections/${data.id}/events`);
    stream.onmessage=event=>{try{const value=JSON.parse(event.data);if(value.error)status(value.error);else if(value.revision!==data.revision||value.snapshotHash!==data.snapshotHash)refresh();}catch{status('组图更新通知无法读取，请重新打开。');}};
    stream.onerror=()=>status('正在重连组图更新；现有照片与输入仍保留。');
  }
  async function operate(action){
    if(busy)return;busy=true;render();
    for(const input of dialog.querySelectorAll('input,select,[data-collection-move]'))input.disabled=true;
    try{await action();}catch(error){status(error.name==='AbortError'?'导出已停止，已完成文件仍保留。':error.message);notify(error.name==='AbortError'?'导出已停止。':error.message);}
    finally{busy=false;render();if(queued){queued=false;refresh();}}
  }
  entry.addEventListener('click',async()=>{
    picker.showModal();$('collection-picker-status').textContent='';
    try{const result=await request('/api/collections');$('collection-recent').innerHTML=result.collections.length?'<strong>最近的共享组图</strong>'+result.collections.map(c=>`<button type="button" data-collection-recent="${escape(c.id)}">${escape(c.name||'共享组图')}</button>`).join(''):'';}catch(error){$('collection-picker-status').textContent=error.message;}
  });
  for(const button of document.querySelectorAll('[data-collection-close]'))button.addEventListener('click',()=>{button.dataset.collectionClose==='picker'?picker.close():dialog.close();});
  dialog.addEventListener('close',stop);
  picker.addEventListener('click',async event=>{
    const id=event.target.closest('[data-collection-recent]')?.dataset.collectionRecent;if(!id)return;
    try{await show(await request('/api/collections/'+id));}catch(error){$('collection-picker-status').textContent=error.message;}
  });
  for(const [id,path,body] of [['collection-load','register',()=>({path:$('collection-source').value})],['collection-create','create',()=>({directory:$('collection-images').value,brief:{theme:$('collection-new-theme').value}})]]){
    $(id).addEventListener('click',async()=>{const button=$(id);button.disabled=true;try{await show(await request('/api/collections/'+path,body()));}catch(error){$('collection-picker-status').textContent=error.message;}finally{button.disabled=false;}});
  }
  for(const id of ['collection-theme','collection-purpose'])$(id).addEventListener('input',()=>{draft.brief.theme=$('collection-theme').value;draft.brief.purpose=$('collection-purpose').value;dirtyTheme=true;backupMade=false;$('collection-plan-status').textContent='主题尚未保存';$('collection-save-plan').disabled=true;$('collection-export').disabled=true;});
  $('collection-grid').addEventListener('change',event=>{
    const id=event.target.dataset.collectionDecision;if(!id||busy)return;
    try{setCollectionDecision(draft,id,event.target.value);dirtyPlan=true;backupMade=false;render();}catch(error){notify(error.message);render();}
  });
  $('collection-grid').addEventListener('input',event=>{const id=event.target.dataset.collectionReason;if(!id||busy)return;draft.decisions.find(d=>d.id===id).reason=event.target.value;dirtyPlan=true;backupMade=false;$('collection-plan-status').textContent='选片输入尚未保存';$('collection-export').disabled=true;});
  $('collection-grid').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||busy)return;
    if(button.dataset.collectionMove){moveCollectionPhoto(draft,button.dataset.collectionMove,Number(button.dataset.direction));dirtyPlan=true;backupMade=false;render();}
    if(button.dataset.collectionEdit){if(dirty()&&!backupMade){notify('先保存或备份当前组图输入，再进入单图精修。');return;}dialog.close();onEdit(button.dataset.collectionEdit).catch(error=>notify(error.message));}
  });
  $('collection-previous').addEventListener('click',()=>{page--;render();});$('collection-next').addEventListener('click',()=>{page++;render();});
  $('collection-save-theme').addEventListener('click',()=>operate(async()=>{
    const next=await request(`/api/collections/${data.id}/brief`,{revision:data.revision,brief:draft.brief});
    data=next;draft.revision=next.revision;draft.snapshotHash=next.snapshotHash;draft.brief=structuredClone(next.brief);dirtyTheme=false;status('主题已保存，与 Agent 共用。');
  }));
  $('collection-save-plan').addEventListener('click',()=>operate(async()=>{adopt(await request(`/api/collections/${data.id}/plan`,collectionPlan(draft,data)));status('选片与顺序已保存，与 Agent 共用。');}));
  $('collection-export').addEventListener('click',()=>operate(async()=>{
    exportController=new AbortController();status('正在按保存顺序导出，每张保留实际版本…');
    const exported=await request(`/api/collections/${data.id}/export`,{revision:data.revision,snapshotHash:data.snapshotHash,preset:'share'},exportController.signal);
    exportController=null;adopt(await request('/api/collections/'+data.id));const finished=collectionExportStatus(data,exported.job);
    status(finished.complete?'整组已导出，可下载独立照片与顺序记录。':!finished.current?'导出文件对应任务开始时的版本；当前组图已更新，请复看并保存新方案后导出。':'部分导出未完成，已完成文件仍保留，请检查后重试。');
  }));
  $('collection-backup').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='framelark-collection-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);backupMade=true;status('草稿备份已保存，可以读取最新组图。');
  });
  $('collection-reload').addEventListener('click',()=>operate(async()=>{if(dirty()&&!backupMade)throw new Error('请先保存草稿备份，再读取最新组图。');adopt(await request('/api/collections/'+data.id));status('已读取最新组图。');}));
  window.addEventListener('beforeunload',event=>{if(dirty()&&!backupMade){event.preventDefault();event.returnValue='';}});
  request('/api/local-capabilities').then(c=>{entry.hidden=!c.local;entry.disabled=!c.projects;entry.title=c.projects?'主题、选片和顺序与 Agent 共用':'先准备本地修图工具';}).catch(()=>{});
  return {close(){dialog.close();picker.close();stop();}};
}
