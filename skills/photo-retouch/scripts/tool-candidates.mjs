import {randomUUID} from 'node:crypto';
import {loadProject,currentVersion,createCandidate,discardCandidate,fail,hash} from './project.mjs';
import {runPhotoToolPlan} from './photo-tool-runtime.mjs';
export async function createToolCandidate(folder,plan,{signal,onEvent,executor,namespace=randomUUID()}={}){
  const project=await loadProject(folder);
  if(plan.revision!==project.revision||plan.baseVersion!==project.currentId)fail('STALE_REVISION','请读取最新版本，再执行工具方案。');
  if(plan.requestId&&project.candidates.some(c=>c.requestId===plan.requestId))return createCandidate(folder,plan);
  const state=currentVersion(project).state;
  const renderProject={source:project.source,revision:project.revision,currentId:project.currentId,versions:project.versions.map(({id,parentId,state})=>({id,parentId,state})),candidates:[],notes:project.notes};
  const result=await runPhotoToolPlan({operations:plan.operations,state,source:project.source,notes:project.notes,namespace,selectedItemIds:plan.selectedItemIds,preview:{project:renderProject,folder}},{signal,onEvent,executor});
  if(signal?.aborted)fail('CANCELLED','工具方案已取消，当前版本保持原样。');
  const made=await createCandidate(folder,plan,{toolExecution:result.records,toolNamespace:namespace,signal});
  if(signal?.aborted){await discardCandidate(folder,{id:made.candidate.id}).catch(()=>{});fail('CANCELLED','工具方案已取消，未应用到当前版本。');}
  if(hash(made.candidate.state)!==hash(result.state))fail('TOOL_RESULT_MISMATCH','工具结果与候选编译不一致。');
  return {...made,toolRun:{operations:result.operations,records:result.records,namespace}};
}
