const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={idle:'等你说出下一步',queued:'等待 Agent 接手',running:'Agent 正在处理',completed:'Agent 已回应',failed:'这次处理未完成',cancelled:'接续已取消',stale:'照片已更新，请重新接手'};

export function createProjectCollaboration({getPhoto,onRequest,onCancel,onPreview,onOpen,onPending,onSwitchEditor,notify}){
  if(typeof window==='undefined')return {show(){},clear(){},enable(){},isNative:photo=>Boolean(photo?.projectId&&(!photo.projectData?.supported||photo.preferNativeEditor))};
  const $=id=>document.getElementById(id);
  document.querySelector('#workspace-title').insertAdjacentHTML('afterend','<span id="native-project-state" class="native-project-state" hidden></span>');
  document.querySelector('.heading-actions').insertAdjacentHTML('beforeend','<button type="button" class="draft-status" id="project-native-back" hidden>常规精修</button>');
  document.querySelector('.work-area').insertAdjacentHTML('beforeend',`<section id="project-collaboration" class="project-collaboration" hidden aria-label="与 Agent 接续编辑"><div class="collaboration-heading"><div><span class="collaboration-eyebrow">共同编辑</span><strong id="collaboration-status" role="status"></strong></div><button type="button" id="project-native-open">协作精修 ↗</button></div><p id="collaboration-detail"></p><div id="collaboration-candidates"></div><div class="collaboration-actions"><button type="button" id="collaboration-request">交给 Agent 继续</button><button type="button" id="collaboration-cancel" hidden>取消接续</button><button type="button" id="collaboration-project">项目与记录</button></div></section>`);
  document.querySelector('.workspace').insertAdjacentHTML('beforeend',`<section id="project-native-workspace" class="project-native-workspace" hidden aria-label="协作精修"><iframe id="project-native-frame" title="照片协作精修工作区"></iframe><div class="project-native-loading" id="project-native-loading" role="status">正在打开协作精修…</div></section>`);
  let current=null,frameProject=null,available=false,switching=false;
  function show(photo,data){
    data=data||photo?.projectData||null;
    current=data||null;const native=Boolean(photo?.projectId&&(!data?.supported||photo.preferNativeEditor));
    document.querySelector('.workspace').classList.toggle('project-native',native);
    $('native-project-state').hidden=!native;$('project-native-back').hidden=!native||!data?.supported;
    if(native){photo.preferNativeEditor=true;$('native-project-state').textContent=data.exports.some(e=>e.versionId===data.currentId)?'已导出':data.currentId===data.versions[0]?.id?'原片':'已保存';}
    $('project-native-workspace').hidden=!native;$('project-collaboration').hidden=!photo||!available||native;
    for(const id of ['photo-export-shortcut','versions-open','mark-photo']){const button=$(id);if(button)button.hidden=native;}
    if(native){
      if(frameProject!==data.id){frameProject=data.id;$('project-native-loading').hidden=false;$('project-native-frame').src=data.editor||`/api/projects/${data.id}/editor/?embedded=1`;}
      return;
    }
    if(frameProject){$('project-native-frame').src='about:blank';frameProject=null;}
    $('project-native-open').hidden=!data;
    if(!data){
      $('collaboration-status').textContent='让 Agent 接着你的编辑';$('collaboration-detail').textContent='把当前照片、调整与版本保存成共享项目，再交给 Agent 提出试片。';
      $('collaboration-request').textContent='与 Agent 一起修';$('collaboration-request').disabled=!available;$('collaboration-cancel').hidden=true;$('collaboration-candidates').innerHTML='';return;
    }
    $('collaboration-request').textContent='交给 Agent 继续';
    const collaboration=data.collaboration||{status:'idle'},request=collaboration.request;
    const fresh=data.candidates.filter(c=>!c.stale),accepted=(request?.candidateIds||[]).includes(data.currentId)&&data.acceptedBy==='user';
    $('collaboration-status').textContent=accepted?'你已接受这版':collaboration.status==='idle'&&fresh.length?`${fresh.length} 份试片等你比较`:labels[collaboration.status]||labels.idle;
    $('collaboration-detail').textContent=request?.summary||request?.message||'批注、试片与已保存版本共用一个项目。Agent 回应后，你可以逐项选择。';
    const active=['queued','running'].includes(collaboration.status);
    $('collaboration-request').disabled=active;$('collaboration-cancel').hidden=!active;
    $('collaboration-candidates').innerHTML=data.candidates.filter(c=>!c.stale).map(c=>`<button type="button" class="collaboration-candidate" data-collaboration-preview="${escape(c.id)}"><span><strong>${escape(c.name)}</strong><small>${c.handoffId?'Agent 接续 · ':c.actorId==='workspace-user'?'你的试片 · ':''}${escape(c.goal||'先比较，再决定')} · ${c.selectedItemIds.length} 项调整</small></span><span>比较效果 ↗</span></button>`).join('');
  }
  async function switchEditor(native){
    const photo=getPhoto();if(switching||!photo?.projectId||!native&&!photo.projectData?.supported)return;
    if(photo.projectNativePending){notify('请先保存协作精修里的输入，或生成试片。');return;}
    const button=$(native?'project-native-open':'project-native-back');switching=true;button.disabled=true;
    try{
      // Save browser edits and reconcile remote edits before the other editor
      // reads its baseline. A failed save must leave this editor and its edits open.
      await onSwitchEditor(photo);
      if(photo!==getPhoto()||!native&&!photo.projectData?.supported)return;
      photo.preferNativeEditor=native;show(photo,photo.projectData);
    }catch(error){notify(error.message);}
    finally{switching=false;button.disabled=false;}
  }
  $('project-native-open').addEventListener('click',()=>switchEditor(true));
  $('project-native-back').addEventListener('click',()=>switchEditor(false));
  $('collaboration-project').addEventListener('click',()=>onOpen());
  $('collaboration-request').addEventListener('click',async()=>{const button=$('collaboration-request');button.disabled=true;try{await onRequest();}catch(error){notify(error.message);}finally{show(getPhoto(),getPhoto()?.projectData);}});
  $('collaboration-cancel').addEventListener('click',async()=>{try{await onCancel(current.collaboration.request.id);}catch(error){notify(error.message);}});
  $('collaboration-candidates').addEventListener('click',event=>{const id=event.target.closest('[data-collaboration-preview]')?.dataset.collaborationPreview;if(id)onPreview(current,id).catch(error=>notify(error.message));});
  // Accept only messages from the current same-origin editor, never another frame.
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==$('project-native-frame').contentWindow||event.data?.projectId!==frameProject)return;
    if(event.data.type==='frameyn:editor-ready')$('project-native-loading').hidden=true;
    if(event.data.type==='frameyn:editor-pending')onPending(Boolean(event.data.pending));
  });
  return {show,clear(){show(null,null);},enable(value){available=value;show(getPhoto(),getPhoto()?.projectData);},isNative:photo=>Boolean(photo?.projectId&&(!photo.projectData?.supported||photo.preferNativeEditor))};
}
