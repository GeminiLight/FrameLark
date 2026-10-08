import {loadProject,currentVersion,createCandidate,projectDocument} from './project.mjs';
import {activeDiagnosis} from './workflow-state.mjs';
import {loadRetouchPolicy,verifyPolicyProvenance,policyTopics} from './retouch-policy.mjs';
import {planningContext,documentPlanningInstructions,compileRetouchPlan} from './engine/edit-stack/planning.js';
import {documentActionSchema,maskDefinitions,strictProviderSchema} from './engine/edit-stack/planner.js';
import {documentPlanSchema} from './engine/edit-stack/schema.js';
import {fail,object} from './engine/edit-values.js';

export const retouchPlanSchema={type:'object',additionalProperties:false,properties:{...Object.fromEntries(['revision','baseVersion','policy','actorId','diagnosisId','handoffId','scopeStepId','generatedBy'].map(k=>[k,documentPlanSchema.properties[k]])),action:documentActionSchema},required:['revision','baseVersion','action','policy'],$defs:strictProviderSchema(maskDefinitions)};

export async function prepareRetouchPlan(folder,{scopeStepId=null,topics}={}) {
  const p=await loadProject(folder),document=projectDocument(p),policy=await loadRetouchPolicy({task:'plan',topics:topics||policyTopics({intent:p.intent})});
  const context=planningContext(document,{scopeStepId,surface:'native',source:p.source});
  return {submissionSchema:retouchPlanSchema,revision:p.revision,baseVersion:p.currentId,diagnosis:activeDiagnosis(p)||null,document,context,policy,
    instructions:policy.instructions+'\n'+documentPlanningInstructions(context),schema:{...documentActionSchema,$defs:strictProviderSchema(maskDefinitions)}};
}

export async function createPlannedCandidate(folder,value,{signal}={}) {
  object(value,['revision','baseVersion','action','scopeStepId','policy','actorId','diagnosisId','handoffId','generatedBy']);
  const p=await loadProject(folder);
  if(value.revision!==p.revision||value.baseVersion!==p.currentId)fail('STALE_REVISION','共同计划需最新项目 revision 与 baseVersion。');
  const policy=await verifyPolicyProvenance(value.policy);
  if(policy.task!=='plan')fail('POLICY_INVALID','编辑方案需要 plan 策略。');
  const compiled=compileRetouchPlan(projectDocument(p,currentVersion(p)),value.action,{scopeStepId:value.scopeStepId||null,diagnosis:activeDiagnosis(p)});
  signal?.throwIfAborted();
  return createCandidate(folder,{revision:value.revision,baseVersion:value.baseVersion,documentProposal:compiled.proposal,policy,scopeStepId:value.scopeStepId||null,
    name:(value.action.label||compiled.proposal.name||'共同精修方案').slice(0,40),goal:value.action.goal||compiled.proposal.goal||'',tradeoff:value.action.tradeoff||compiled.proposal.tradeoff||'',
    actorId:value.actorId||'host-agent',...(value.diagnosisId?{diagnosisId:value.diagnosisId}:{}),...(value.handoffId?{handoffId:value.handoffId}:{}),generatedBy:value.generatedBy||{kind:'agent'}},{signal});
}
