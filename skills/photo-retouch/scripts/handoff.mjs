import {randomUUID} from 'node:crypto';
import {watch} from 'node:fs';
import {loadProject,mutateProject,fail} from './project.mjs';
import {object} from './engine/edit-values.js';
import {contextHash} from './workflow-state.mjs';
import {handoffView} from './handoff-state.mjs';

const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function handoffProject(folder,value){
  object(value,['action','revision','id','requestId','message','actorId','summary','candidateIds'],'HANDOFF_INVALID');
  if(!Number.isInteger(value.revision)||!['request','claim','progress','complete','fail','cancel'].includes(value.action))fail('HANDOFF_INVALID','接续操作需最新 revision 和有效 action。');
  return mutateProject(folder,value.revision,p=>{
    const at=new Date().toISOString();p.handoffs||=[];
    if(value.action==='request'){
      if(!validText(value.message,800)||value.requestId!==undefined&&!/^[-\w]{1,80}$/.test(value.requestId))fail('HANDOFF_INVALID','请说明希望 Agent 继续处理什么，最多 800 字。');
      const retry=value.requestId&&p.handoffs.find(r=>r.requestId===value.requestId);
      if(retry){if(retry.message!==value.message.trim())fail('HANDOFF_REQUEST_CONFLICT','同一接续请求的内容已变化。');return {request:retry};}
      const active=p.handoffs.findLast(r=>['queued','running'].includes(r.status)&&r.contextHash===contextHash(p));
      if(active)fail('HANDOFF_PENDING','已有接续请求，请等候回应或先取消。');
      const request={id:randomUUID(),requestId:value.requestId||null,message:value.message.trim(),status:'queued',contextHash:contextHash(p),baseVersion:p.currentId,requestedAt:at,updatedAt:at,candidateIds:[]};
      p.handoffs=[...p.handoffs,request].slice(-20);return {request};
    }
    const request=p.handoffs.find(r=>r.id===value.id);
    if(!request)fail('HANDOFF_NOT_FOUND','找不到这份接续请求，请重新读取项目。');
    if(!['queued','running'].includes(request.status))fail('HANDOFF_CLOSED','这份接续请求已结束，不能再写入进度。');
    if(value.action==='cancel'){request.status='cancelled';request.updatedAt=at;return {request};}
    if(request.contextHash!==contextHash(p))fail('HANDOFF_STALE','照片、意图或批注已更新，请读取最新项目并重新接手。');
    if(!validText(value.actorId,80))fail('HANDOFF_INVALID','Agent 接手需声明 actorId。');
    if(value.action==='claim'){
      if(request.status==='running'&&request.actorId!==value.actorId)fail('HANDOFF_CLAIMED','另一位 Agent 已接手此请求。');
      request.status='running';request.actorId=value.actorId;request.summary='已接手，正在读取最新照片与批注。';
    }else{
      if(request.status!=='running'||request.actorId!==value.actorId)fail('HANDOFF_OWNER','先由同一位 Agent 接手，再报告进度或结果。');
      if(!validText(value.summary,600))fail('HANDOFF_INVALID','请用一句话说明实际进度或结果。');
      if(value.action==='complete'){
        const ids=value.candidateIds||[];
        if(!Array.isArray(ids)||ids.length>8||new Set(ids).size!==ids.length||ids.some(id=>!p.candidates.some(c=>c.id===id&&c.handoffId===request.id&&c.actorId===request.actorId&&c.baseFingerprint===request.contextHash)))fail('HANDOFF_RESULT','结果需对应本次上下文中的实际候选。');
        request.candidateIds=ids;request.status='completed';
      }else if(value.action==='fail')request.status='failed';
      request.summary=value.summary.trim();
    }
    request.updatedAt=at;return {request};
  });
}

// The host owns model execution. This command waits for file events, not a model.
export async function waitForProject(folder,{afterRevision,timeoutMs=60000,signal}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<0||timeoutMs>600000||afterRevision!==undefined&&(!Number.isInteger(afterRevision)||afterRevision<1))fail('WATCH_INVALID','等待时间应为 0～600 秒，版本号应为正整数。');
  const initial=await loadProject(folder),baseline=afterRevision??initial.revision;
  if(signal?.aborted)fail('CANCELLED','等待已取消。');
  return new Promise((resolve,reject)=>{
    let finished=false,debounce;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(debounce);watcher.close();signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
    const cancel=()=>finish(Object.assign(new Error('等待已取消。'),{code:'CANCELLED'}));
    const read=async()=>{try{const p=await loadProject(folder),collaboration=handoffView(p);if(collaboration.status==='queued'||p.revision>baseline)finish(null,{type:collaboration.status==='queued'?'handoff':'project-updated',revision:p.revision,currentId:p.currentId,collaboration});}catch(error){finish(error);}};
    const watcher=watch(folder,(_event,name)=>{if(name&&String(name)!=='project.json')return;clearTimeout(debounce);debounce=setTimeout(read,70);});
    watcher.on('error',error=>finish(error));
    const timer=setTimeout(()=>finish(null,{type:'timeout',revision:baseline}),timeoutMs);
    signal?.addEventListener('abort',cancel,{once:true});
    // Re-read after subscribing so a write between the first read and watch is seen.
    read();if(signal?.aborted)cancel();
  });
}
