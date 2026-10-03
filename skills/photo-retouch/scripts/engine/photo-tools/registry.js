import tone from './builtins/tone.js';
import color from './builtins/color.js';
import detail from './builtins/detail.js';
import finish from './builtins/finish.js';
import style from './builtins/style.js';
import rotate from './builtins/rotate.js';
import crop from './builtins/crop.js';
import mask from './builtins/mask.js';
import {record,identifier,text,validate,fail,cleanRect} from './values.js';
import {targetSchema,normalizeTarget,resolveTarget,normalizeMask} from './targets.js';
import {validCrop} from '../crop-utils.js';
import {adjustmentKeys,neutralSettings} from '../editor-engine.js';
import {bounds} from './builtins/adjustment.js';
const copy=value=>structuredClone(value);
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
export function createPhotoToolRegistry(definitions=[]){
  const entries=new Map();
  function register(tool){
    if(!tool||!/^[-a-zA-Z0-9_]{1,60}$/.test(tool.id)||!Number.isSafeInteger(tool.version)||tool.version<1||!Array.isArray(tool.targets)||typeof tool.execute!=='function'||!tool.parameters)fail('TOOL_DEFINITION_INVALID','工具定义不完整。');
    if(entries.has(tool.id))fail('TOOL_DUPLICATE','工具名称已注册。');entries.set(tool.id,tool);return tool;
  }
  definitions.forEach(register);
  const descriptor=tool=>({id:tool.id,title:tool.title,description:tool.description,version:tool.version,targets:[...tool.targets],parameters:copy(tool.parameters)});
  const operationSchema=({references=false}={})=>({anyOf:[...entries.values()].map(tool=>record({id:identifier,title:{...text(100),minLength:1},tool:{type:'string',enum:[tool.id]},version:{type:'number',enum:[tool.version]},target:references?{$ref:'#/$defs/photoTarget'}:targetSchema,parameters:tool.parameters,dependsOn:{type:'array',maxItems:24,uniqueItems:true,items:identifier}}))});
  function normalize(operation,context={},resolveGeometry=true){
    validate(operation,operationSchema());const tool=entries.get(operation.tool);
    if(!tool.targets.includes(operation.target.kind))fail('TOOL_TARGET_UNSUPPORTED','这个工具不支持所选目标。');
    const normalized=copy(operation);normalized.target=!resolveGeometry||operation.target.kind==='annotation'?copy(operation.target):normalizeTarget(operation.target,context);
    if(!resolveGeometry&&operation.target.mask)normalizeMask(operation.target.mask);
    if(normalized.target.kind==='output'&&!normalized.dependsOn.includes(normalized.target.operationId))normalized.dependsOn.push(normalized.target.operationId);
    return normalized;
  }
  function execute(operation,context){
    const tool=entries.get(operation.tool);if(!tool||tool.version!==operation.version)fail('TOOL_VERSION_CHANGED','工具版本已改变，请重新生成方案。');
    validate(operation.parameters,tool.parameters);
    const prepared=operation.target.kind==='annotation'?normalizeTarget(operation.target,{...context,state:context.inputState||context.state}):operation.target;
    const target=resolveTarget(prepared,context.outputs||new Map());
    if(target.kind!=='image')normalizeMask(target.mask);
    if(!tool.targets.includes(target.kind)&&!tool.targets.includes('output'))fail('TOOL_TARGET_UNSUPPORTED','这个工具不支持所选目标。');
    const result=tool.execute(operation,{...context,target});
    if(result?.then)fail('TOOL_ASYNC_EFFECT','纯编辑 Adapter 应返回可重放的同步效果；外部工作使用执行器。');
    if(!result||typeof result!=='object'||!result.effect)fail('TOOL_RESULT_INVALID','工具未返回有效效果。');
    const effect=validateEffect(result.effect);return {...result,effect};
  }
  return {register,describe:()=>[...entries.values()].map(descriptor),operationSchema,schemaDefinitions:()=>({photoTarget:copy(targetSchema)}),normalize,execute};
}
export const photoTools=createPhotoToolRegistry([tone,color,detail,finish,style,rotate,crop,mask]);
export function validateToolState(value){
  if(!value||typeof value!=='object'||!value.settings||!Array.isArray(value.locals)||value.locals.length>8)fail('TOOL_STATE_INVALID','工具需要有效的当前编辑状态。');
  const result={...copy(value),settings:{...neutralSettings(),...value.settings}};
  validateEffect({settings:result.settings,locals:result.locals.map(layer=>({id:layer.id,layer})),...(result.crop?{crop:result.crop}:{}),...(result.style?{style:result.style}:{})});return result;
}
export function validateEffect(effect){
  if(!effect||typeof effect!=='object'||Array.isArray(effect)||Object.keys(effect).some(k=>!['settings','style','crop','locals','textOverlays'].includes(k)))fail('TOOL_RESULT_INVALID','工具效果包含不支持的字段。');
  const out=copy(effect);
  if(Object.hasOwn(out,'settings')&&(!out.settings||typeof out.settings!=='object'||Array.isArray(out.settings)))fail('TOOL_RESULT_INVALID','工具参数结果必须是对象。');
  if(out.settings){for(const [key,value] of Object.entries(out.settings)){if(!adjustmentKeys.includes(key))fail('TOOL_RESULT_INVALID','工具返回未知参数。');const [min,max]=bounds(key);if(!Number.isFinite(value)||value<min||value>max)fail('TOOL_RESULT_INVALID','工具返回的参数超出范围。');}}
  if(out.crop){const r=cleanRect(Object.fromEntries(['x','y','width','height'].map(k=>[k,out.crop[k]])));if(!Number.isFinite(out.crop.angle??0)||Math.abs(out.crop.angle??0)>15)fail('TOOL_RESULT_INVALID','工具返回的角度无效。');out.crop={...r,...(out.crop.angle?{angle:out.crop.angle}:{})};if(!validCrop(out.crop))fail('TOOL_RESULT_INVALID','工具裁剪范围无效。');}
  if(out.style){validate(out.style,style.parameters);}
  if(out.locals){
    if(!Array.isArray(out.locals)||out.locals.length>8)fail('TOOL_RESULT_INVALID','工具返回过多局部层。');
    for(const local of out.locals){validate(local.id,identifier);if(local.remove)continue;
      const layer=local.layer;if(!layer||layer.id!==local.id)fail('TOOL_RESULT_INVALID','局部层身份不一致。');
      normalizeMask({shape:layer.maskType||'rectangle',rect:layer.rect,feather:layer.feather??.36,exclude:layer.exclude||[],...(layer.maskType==='linear'?{start:layer.start,end:layer.end}:{}),...(layer.maskType==='brush'?{points:layer.points,radius:layer.brushRadius}:{})});
      validateEffect({settings:layer.localSettings});
      if(!Number.isFinite(layer.localAmount??100)||(layer.localAmount??100)<0||(layer.localAmount??100)>150)fail('TOOL_RESULT_INVALID','局部层强度无效。');
    }
  }
  // Lettering still requires its explicit native mode; no tool bypasses it.
  if(out.textOverlays)fail('TOOL_RESULT_INVALID','文字效果需使用显式文字模式。');
  return out;
}
export function applyToolEffect(state,effect){
  const next=copy(state),patch=validateEffect(effect);
  if(patch.settings)Object.assign(next.settings,patch.settings);
  for(const key of ['style','crop'])if(Object.hasOwn(patch,key))next[key]=copy(patch[key]);
  for(const local of patch.locals||[]){const index=next.locals.findIndex(l=>l.id===local.id);if(local.remove){if(index>=0)next.locals.splice(index,1);}else if(index>=0)next.locals[index]=copy(local.layer);else next.locals.push(copy(local.layer));}
  if(next.locals.length>8)fail('TOOL_LOCAL_LIMIT','工具组合与已有局部合计最多 8 处。');return next;
}
export function effectPaths(effect){return [...Object.keys(effect.settings||{}).map(k=>'settings.'+k),...['style','crop','textOverlays'].filter(k=>Object.hasOwn(effect,k)),...(effect.locals||[]).map(l=>'locals.'+l.id)];}
export function normalizeToolPlan(operations,context,{registry=photoTools,resolveGeometry=true}={}){
  if(!Array.isArray(operations)||!operations.length||operations.length>24)fail('TOOL_PLAN_INVALID','工具方案需要 1～24 个步骤。');
  const normalized=operations.map(op=>registry.normalize(op,context,resolveGeometry)),byId=new Map(normalized.map(op=>[op.id,op]));
  if(byId.size!==normalized.length)fail('TOOL_OPERATION_DUPLICATE','工具步骤编号不能重复。');
  const sorted=[],visiting=new Set(),done=new Set();
  function visit(op){if(visiting.has(op.id))fail('DEPENDENCY_CYCLE','工具步骤形成循环依赖。');if(done.has(op.id))return;visiting.add(op.id);
    for(const id of op.dependsOn){const dependency=byId.get(id);if(!dependency)fail('DEPENDENCY_MISSING','工具依赖不存在。');visit(dependency);}
    visiting.delete(op.id);done.add(op.id);sorted.push(op);
  }
  normalized.forEach(visit);return sorted;
}
export function toolSelection(operations,selected=operations.map(op=>op.id)){
  const chosen=new Set(selected);if(!Array.isArray(selected)||chosen.size!==selected.length||selected.some(id=>!operations.some(op=>op.id===id)))fail('UNKNOWN_ITEM','工具选择包含未知或重复编号。');
  for(const op of operations)if(chosen.has(op.id)&&op.dependsOn.some(id=>!chosen.has(id)))fail('DEPENDENCY_REQUIRED','请同时选中所依赖的工具步骤。',{itemId:op.id,dependsOn:op.dependsOn});
  return operations.filter(op=>chosen.has(op.id));
}
export function compileToolPlan(base,operations,{source,notes=[],namespace='plan',selected,registry=photoTools,onStep=()=>{}}={}){
  let state=validateToolState(base);const outputs=new Map(),records=[],owners=new Map(),byId=new Map(operations.map(op=>[op.id,op]));
  const depends=(op,id)=>op.dependsOn.some(dep=>dep===id||depends(byId.get(dep),id));
  for(const operation of toolSelection(operations,selected)){
    const before=copy(state),result=registry.execute(operation,{state,inputState:base,source,notes,outputs,layerId:`tool-${namespace.slice(0,40)}-${operations.indexOf(operation)}`}),paths=effectPaths(result.effect);
    for(const path of paths){const previous=owners.get(path);if(previous&&!depends(operation,previous))fail('PATCH_CONFLICT','多个工具修改同一处，请明确执行依赖。',{path,itemIds:[previous,operation.id]});owners.set(path,operation.id);}
    state=applyToolEffect(state,result.effect);outputs.set(operation.id,result.outputs||{});
    const record={id:operation.id,operation:copy(operation),effect:copy(result.effect),writePaths:paths,outputs:copy(result.outputs||{}),before,after:copy(state)};records.push(record);onStep(record);
  }
  return {state,records,selectedItemIds:records.map(r=>r.id),noChange:stable(state)===stable(base)};
}
