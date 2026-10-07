const copy=value=>structuredClone(value);
export const sameCollectionContext=(a,b)=>a.id===b.id&&a.snapshotHash===b.snapshotHash&&a.plan?.id===b.plan?.id;
export function collectionDraft(data){
  const previous=new Map((data.plan?.decisions||[]).map(d=>[d.id,d])),valid=data.photos.filter(p=>!p.error);
  const decisions=valid.map(p=>({...copy(previous.get(p.id)||{id:p.id,decision:'select',observations:'用户手动选择，未填写额外画面观察。',reason:'用户保留此照片。',preserve:'保留原片与当前保存版本。',role:'组图成员'})}));
  const selected=decisions.filter(d=>d.decision==='select').map(d=>d.id);
  const order=[...(data.plan?.order||[]).filter(id=>selected.includes(id)),...selected.filter(id=>!data.plan?.order.includes(id))];
  return {id:data.id,revision:data.revision,snapshotHash:data.snapshotHash,brief:copy(data.brief),title:data.plan?.title||data.brief.theme||'共享组图',rationale:data.plan?.rationale||'用户确认当前选片与观看顺序。',anchorId:data.plan?.anchorId||null,order,decisions};
}
export function moveCollectionPhoto(draft,id,direction){
  const index=draft.order.indexOf(id),next=index+direction;
  if(index<0||!Number.isInteger(direction)||next<0||next>=draft.order.length)return;
  [draft.order[index],draft.order[next]]=[draft.order[next],draft.order[index]];
}
export function setCollectionDecision(draft,id,decision){
  if(!['select','reserve','exclude'].includes(decision))throw new Error('选片状态无效。');
  if(draft.brief.mustKeep.includes(id)&&decision!=='select')throw new Error('这张是用户必留照片，请先明确修改必留条件。');
  const record=draft.decisions.find(d=>d.id===id);if(!record)throw new Error('照片暂时不可用。');record.decision=decision;
  draft.order=draft.order.filter(value=>value!==id);if(decision==='select')draft.order.push(id);
  if(decision!=='select'&&draft.anchorId===id)draft.anchorId=null;
}
export function collectionPlan(draft,data){
  if(draft.id!==data.id||draft.revision!==data.revision||draft.snapshotHash!==data.snapshotHash)throw new Error('组图已更新，请保留草稿并读取最新版本。');
  return {revision:data.revision,snapshotHash:data.snapshotHash,title:draft.title||data.brief.theme||'共享组图',rationale:draft.rationale||'用户确认当前选片与观看顺序。',
    anchorId:draft.anchorId,order:[...draft.order],decisions:draft.decisions.map(({id,decision,observations,reason,preserve,role})=>({id,decision,observations,reason:reason||'用户手动取舍。',preserve,role:role||'组图成员'}))};
}
export function collectionExportStatus(data,job){
  const current=Boolean(job&&!job.stale&&!data.plan?.stale&&job.snapshotHash===data.snapshotHash&&job.planId===data.plan?.id);
  return {current,complete:current&&job.status==='done',label:!current?'此前导出的版本 · 当前组图已更新':job.status==='done'?'当前版本已导出成片':'部分导出 · 已完成文件保留'};
}
