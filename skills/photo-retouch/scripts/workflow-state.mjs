import {hash,pipelineVersion,versionPipeline,versionStateHash} from './engine/edit-identity.js';
import {fail} from './engine/edit-values.js';

export const contextHash=p=>{const version=p.versions.find(v=>v.id===p.currentId);return hash({current:p.currentId,state:version?.state,...(version?.recipe?{recipe:version.recipe}:{}),source:p.source,intent:p.intent,notes:p.notes,pipeline:versionPipeline(version||{})});};
export const activeDiagnosis=p=>(p.diagnoses||[]).findLast(d=>d.contextHash===contextHash(p));
export function targetDiagnosis(p,v){
  // Candidates are not yet in versions. Include their exact state when resolving
  // a target, while retaining the saved base diagnosis until a newer applicable
  // diagnosis supersedes it after acceptance.
  const target=p.versions.some(saved=>saved.id===v.id)?p:{...p,versions:[...p.versions,v]};
  const contexts=new Set([contextHash({...target,currentId:v.id}),contextHash({...p,currentId:v.parentId||v.id})]);
  return (p.diagnoses||[]).findLast(d=>contexts.has(d.contextHash));
}
export const auditTargetHash=(p,v)=>{const d=targetDiagnosis(p,v);return hash({source:p.source,intent:p.intent,notes:p.notes,diagnosis:d?{id:d.id,goal:d.goal,preserve:d.preserve,findings:d.findings}:null});};
export function latestAudit(p,v,{maxSide,frameSpecHash}={}){
  const a=(p.resultAudits||[]).findLast(a=>a.versionId===v.id);if(!a)return null;
  const contextValid=a.targetHash?a.targetHash===auditTargetHash(p,v)
    :(a.diagnosisId??null)===(targetDiagnosis(p,v)?.id??null)&&[contextHash(p),contextHash({...p,currentId:v.parentId||v.id})].includes(a.contextHash);
  return contextValid&&a.selectionHash===(v.selectionHash||null)&&a.stateHash===versionStateHash(v)&&a.sourceChecksum===p.source.checksum&&a.pipeline===versionPipeline(v)&&(maxSide===undefined||a.maxSide===maxSide)&&(frameSpecHash===undefined||a.frameSpecHash===frameSpecHash)?a:null;
}
function auditDeliveryFailure(p,v,diagnosis,audit){
  if(!audit||audit.decision!=='ready')return 'RESULT_AUDIT_REQUIRED';
  if(p.workflow?.independent&&(audit.reviewer?.mode!=='independent'||audit.reviewer.id===v.actorId))return 'INDEPENDENT_REVIEW_REQUIRED';
  if(p.workflow?.mode==='reviewed'){
    if(!diagnosis||audit.diagnosisId!==diagnosis.id)return 'DIAGNOSIS_REQUIRED';
    if(diagnosis.findings.some(f=>f.priority==='blocking'&&!audit.resolutions?.some(r=>r.findingId===f.id&&['resolved','preserved'].includes(r.status))))return 'DIAGNOSIS_UNRESOLVED';
  }
  return null;
}
export function workflowStatus(p){
  const diagnosis=activeDiagnosis(p),candidates=(p.candidates||[]).filter(c=>c.baseFingerprint===contextHash(p));
  const mode=p.workflow?.mode||'manual',independent=p.workflow?.independent===true;
  const trials=candidates.map(c=>{const audit=latestAudit(p,c);return {id:c.id,name:c.name,diagnosisId:c.diagnosisId||null,audit:audit?{id:audit.id,decision:audit.decision,reviewer:audit.reviewer||null}:null,deliverable:Boolean((mode!=='reviewed'||diagnosis&&c.diagnosisId===diagnosis.id)&&!auditDeliveryFailure(p,c,diagnosis,audit))};});
  const current=p.versions.find(v=>v.id===p.currentId),currentAudit=current&&latestAudit(p,current);
  const delivered=Boolean(current&&!auditDeliveryFailure(p,current,targetDiagnosis(p,current),currentAudit));
  const stage=delivered?'delivered':!diagnosis?'diagnosis':trials.length?(trials.some(t=>t.deliverable)?'delivery':'review'):!diagnosis.findings.length?'preserve':'trial';
  return {mode,independent,stage,diagnosisId:diagnosis?.id||null,next:{delivered:'已保存审核版；导出后检查实际成片，继续改动前重新审片',diagnosis:'查看当前图并记录诊断、保留关系与具体目标',preserve:'保留当前照片；需要时直接导出已保存版本',trial:'基于当前诊断生成可撤回试片',review:'实际看完整试片与关键细节；返修或准备复审',delivery:'接受已审核组合，导出后复看实际文件'}[stage],trials,limitations:['流程记录与像素身份不证明实际看图或审美质量。','独立身份由宿主声明；运行时不启动或认证另一位 Agent。']};
}
export function assertWorkflowDelivery(p,c,acceptedBy){
  if(acceptedBy!=='agent'||p.workflow?.mode!=='reviewed'||c.mode==='guards')return;
  const d=activeDiagnosis(p);
  if(!d||c.diagnosisId!==d.id)fail('DIAGNOSIS_REQUIRED','先记录当前版本、意图与批注下的诊断，再生成或重建试片。');
  const failure=auditDeliveryFailure(p,c,d,latestAudit(p,c));
  if(failure)fail(failure,{RESULT_AUDIT_REQUIRED:'交付流程需要这份实际组合的 ready 审核。',INDEPENDENT_REVIEW_REQUIRED:'需要另一位宿主审片者读取复审任务包；同一作者的自审仍可记录，但不能替代独立复审。',DIAGNOSIS_REQUIRED:'审核需对应这份试片的当前诊断。',DIAGNOSIS_UNRESOLVED:'仍有诊断问题没有记录解决或有依据的保留结论。'}[failure]);
}
