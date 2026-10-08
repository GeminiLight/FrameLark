import {plannerContext,validatePlannerAction} from './planner.js';
import {compileDocumentProposal} from './proposals.js';
import {retouchCapabilities} from './capabilities.js';
import {fail} from './values.js';

export function planningContext(document,options={}) {
  return {...plannerContext(document,options),methodCapabilities:retouchCapabilities({surface:options.surface||'browser',source:options.source})};
}

export function documentPlanningInstructions(context) {
  return `需要编辑时使用 action.kind=document；无动作时 kind=none。proposal.baseRevision=${context.revision}，baseHash=${context.hash}。每个 items 项代表一个独立可取舍的视觉改动，visual 写 goal、benefit、tradeoff、findingIds（没有诊断则为空数组）。一项的有限 commands 原子执行；dependsOn 仅声明实际资源依赖，不为普通串行后继强加依赖。未使用的可选字段填 null，参数数值不可填 null。
当前文档与真实能力：${JSON.stringify(context)}。
修改原步骤用 UpdateStepParameters，保留未指定参数、ID、maskRef、opacity 和独立后继；不能添加反向补偿步骤。scopeStepId 非空时所有命令只针对该步骤，用户只改 EV 时仅发 UpdateStepParameters。启停、强度、删除、改名、合法移动使用对应命令；构图用 UpdateGeometry 固定阶段。
整体提亮但保护已有亮处时，在同一提案项 AddStep 曝光并 ReplaceStepMask 绑定 live-input 的 exclude-highlights 明度范围，必要时组合绘制范围。蒙版原片坐标需结合当前裁剪、原尺寸换算；无法定位时说明限制。曝光 headroomPolicy 不是语义分割，也不是永久保护。几何蒙版是近似范围，精确语义分割和外部 AI 编辑未声明时不可生成对应操作。`;
}

// All entry points use this plan boundary, then the existing atomic compiler.
// Older/manual proposals can omit visual metadata; new advisor plans cannot.
export function compileRetouchPlan(document,action,{scopeStepId=null,diagnosis=null,requireVisual=true,selectedItemIds}={}) {
  scopeStepId=scopeStepId||action.proposal?.scopeStepId||null;
  const valid=validatePlannerAction(document,action,{scopeStepId});
  for(const item of valid.proposal.items){
    if(requireVisual&&!item.visual)fail('VISUAL_GOAL_REQUIRED','每项建议需要具体视觉目标、收益、代价与诊断关联。');
    if(item.visual?.findingIds.some(id=>!diagnosis?.findings.some(f=>f.id===id)))fail('FINDING_REFERENCE_INVALID','提案引用了不存在或过期的诊断问题。');
  }
  const compiled=compileDocumentProposal(document,valid.proposal,selectedItemIds);
  return {...compiled,action:valid};
}

export function withPreviewTuning(base,input,selectedItemIds,commands) {
  const proposal=structuredClone(input),selected=[...selectedItemIds],chosen=proposal.items.filter(i=>selected.includes(i.id));
  const stepIds=new Set([...base.steps.map(s=>s.id),...chosen.flatMap(i=>i.commands.filter(c=>c.type==='AddStep').map(c=>c.step.id))]);
  const tuning=commands.filter(c=>!c.stepId||stepIds.has(c.stepId));
  if(tuning.length&&selected.length){
    const dependsOn=chosen.filter(item=>item.commands.some(resource=>tuning.some(c=>resource.type==='AddStep'&&c.stepId===resource.step.id||resource.type==='AddGroup'&&(c.groupId===resource.group.id||c.step?.groupId===resource.group.id)))).map(i=>i.id);
    proposal.items.push({id:'preview-tuning',title:'预览微调',visual:{goal:'按当前预览调整所选步骤',benefit:'保留手动确认的强度或参数变化',tradeoff:'仍需复看当前组合的细节与过渡',findingIds:[]},commands:tuning,dependsOn});selected.push('preview-tuning');
  }
  proposal.selectedItemIds=selected;return proposal;
}
