import {contextHash} from './workflow-state.mjs';

// A waiting request is not a running agent. Status changes only on explicit claims.
export function handoffView(project){
  const request=project.handoffs?.at(-1);
  if(!request)return {status:'idle',request:null};
  const stale=['queued','running'].includes(request.status)&&request.contextHash!==contextHash(project);
  return {status:stale?'stale':request.status,request:{id:request.id,message:request.message,status:stale?'stale':request.status,
    actorId:request.actorId||null,summary:request.summary||'',baseVersion:request.baseVersion,requestedAt:request.requestedAt,
    updatedAt:request.updatedAt,candidateIds:request.candidateIds||[]}};
}
