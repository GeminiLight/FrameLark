import {neutralSettings} from '../editor-engine.js';
import {presetById} from '../presets.js';
import {validCrop} from '../crop-utils.js';
import {validateToolState} from '../photo-tools/registry.js';
import {object,identifier,number,title,hashValue,ids,bool,fail} from './values.js';
import {parametersFor,pixelTool} from './tools.js';
import {validateMasks,validateMaskRef} from './masks.js';
import {contentHash,documentHash,renderHash} from './identity.js';
export const stackPipeline='edit-stack-linear-v2';
export const legacyPipeline='photo-render-2026-09-30-masks+lettering-v1+protected-regions-v1';
const clone=value=>structuredClone(value);
export function validateGeometry(geometry){object(geometry,['crop']);if(geometry.crop!==null){object(geometry.crop,['x','y','width','height','angle'],['x','y','width','height']);if(!validCrop(geometry.crop)||!Number.isFinite(geometry.crop.angle??0)||Math.abs(geometry.crop.angle??0)>15)fail('INVALID_DOCUMENT','构图范围或角度无效。');}return geometry;}
export function captureLegacyBase(state){
  const input={settings:{...neutralSettings(),...state.settings},style:clone(state.style||null),crop:clone(state.crop||null),locals:clone(state.locals||[])};
  const pinned=validateToolState(input),preset=pinned.style?presetById(pinned.style.id):null;
  return {kind:'legacy-v1',pipeline:legacyPipeline,state:pinned,stateHash:contentHash(pinned),presetHash:preset?contentHash(preset.adjustments):null};
}
export function canonicalStep(step){
  object(step,['id','tool','toolVersion','title','parameters','enabled','opacity','maskRef','dependsOn','groupId','provenance'],['id','tool','toolVersion','title','parameters']);
  return {...clone(step),parameters:parametersFor(step.tool,step.toolVersion,step.parameters,{partial:true}),enabled:step.enabled??true,opacity:step.opacity??1,maskRef:clone(step.maskRef||null),dependsOn:clone(step.dependsOn||[]),groupId:step.groupId||null};
}
export function validateDocument(document){
  object(document,['schema','documentId','revision','source','pipeline','geometry','base','steps','masks','groups','receipts']);
  if(document.schema!==3)fail('DOCUMENT_SCHEMA_UNSUPPORTED','这个编辑文档版本不受支持。');identifier(document.documentId);
  if(!Number.isSafeInteger(document.revision)||document.revision<0)fail('INVALID_DOCUMENT','编辑文档 revision 无效。');
  object(document.source,['assetId','contentHash','normalizedHash','width','height'],['assetId','contentHash','width','height']);identifier(document.source.assetId);hashValue(document.source.contentHash);if(document.source.normalizedHash!==undefined)hashValue(document.source.normalizedHash);for(const key of ['width','height']){number(document.source[key],1,16384);if(!Number.isInteger(document.source[key]))fail('INVALID_DOCUMENT','源尺寸须为整数。');}if(document.source.width*document.source.height>50_000_000)fail('RENDER_BUDGET_EXCEEDED','源图像素超过项目上限。');
  object(document.pipeline,['id','colorSpace','kernelVersion']);if(document.pipeline.id!==stackPipeline||document.pipeline.colorSpace!=='linear-srgb'||document.pipeline.kernelVersion!==1)fail('TOOL_VERSION_UNSUPPORTED','编辑栈管线版本不受支持。');validateGeometry(document.geometry);
  object(document.base,['kind','pipeline','state','stateHash','presetHash']);if(document.base.kind!=='legacy-v1'||document.base.pipeline!==legacyPipeline)fail('TOOL_VERSION_UNSUPPORTED','兼容基础的渲染版本不受支持。');
  object(document.base.state,['settings','style','crop','locals']);validateToolState(document.base.state);hashValue(document.base.stateHash);if(contentHash(document.base.state)!==document.base.stateHash)fail('LEGACY_BASE_CHANGED','兼容基础身份不一致。');
  const preset=document.base.state.style?presetById(document.base.state.style.id):null;if((preset?contentHash(preset.adjustments):null)!==document.base.presetHash)fail('TOOL_VERSION_UNSUPPORTED','兼容基础的旧风格配方无法复现。');
  if(!Array.isArray(document.steps)||document.steps.length>64||!Array.isArray(document.groups)||document.groups.length>64)fail('STEP_LIMIT','编辑步骤或分组超过上限。');ids(document.steps.map(step=>step.id));ids(document.groups.map(group=>group.id));
  for(const group of document.groups){object(group,['id','title','provenance'],['id','title']);title(group.title);if(group.provenance!==undefined&&JSON.stringify(group.provenance).length>2048)fail('INVALID_DOCUMENT','分组来源说明过长。');}
  const masks=validateMasks(document.masks,document.source),previous=new Map(),groups=new Set(document.groups.map(group=>group.id));
  for(const step of document.steps){
    object(step,['id','tool','toolVersion','title','parameters','enabled','opacity','maskRef','dependsOn','groupId','provenance'],['id','tool','toolVersion','title','parameters','enabled','opacity','maskRef','dependsOn','groupId']);title(step.title);pixelTool(step.tool,step.toolVersion);parametersFor(step.tool,step.toolVersion,step.parameters);bool(step.enabled);number(step.opacity,0,1);ids(step.dependsOn,24);
    if(step.groupId!==null&&!groups.has(step.groupId))fail('GROUP_MISSING','步骤引用的分组不存在。');
    if(step.maskRef!==null){validateMaskRef(step.maskRef);if(!masks.has(step.maskRef.id+'@'+step.maskRef.version))fail('MASK_REFERENCE_MISSING','步骤引用的蒙版版本不存在。');}
    for(const dependency of step.dependsOn){const producer=previous.get(dependency);if(!producer)fail('INVALID_ORDER','依赖步骤必须位于当前步骤之前。',{stepId:step.id,dependency});if(step.enabled&&!producer.enabled)fail('DEPENDENCY_REQUIRED','使用此资源的步骤仍启用，请先处理依赖。',{stepId:step.id,dependency});}
    if(step.provenance!==undefined&&JSON.stringify(step.provenance).length>2048)fail('INVALID_DOCUMENT','步骤来源说明过长。');previous.set(step.id,step);
  }
  if(!Array.isArray(document.receipts)||document.receipts.length>128)fail('INVALID_DOCUMENT','编辑请求记录超出限制。');
  for(const receipt of document.receipts){object(receipt,['id','commandsHash','beforeHash','afterHash','revision']);identifier(receipt.id);hashValue(receipt.commandsHash);hashValue(receipt.beforeHash);hashValue(receipt.afterHash);if(!Number.isSafeInteger(receipt.revision)||receipt.revision<1||receipt.revision>document.revision)fail('INVALID_DOCUMENT','编辑请求记录无效。');}
  if(new TextEncoder().encode(JSON.stringify(document)).length>1024*1024)fail('DOCUMENT_TOO_LARGE','编辑文档超过保存预算。');return document;
}
export function createDocument({documentId,source,base}){const document={schema:3,documentId,revision:0,source:clone(source),pipeline:{id:stackPipeline,colorSpace:'linear-srgb',kernelVersion:1},geometry:{crop:clone(base.crop||null)},base:captureLegacyBase(base),steps:[],masks:[],groups:[],receipts:[]};return validateDocument(document);}
export function compileRenderPlan(document,frameSpec){validateDocument(document);const identities=[];let prefix=contentHash({source:document.source,base:document.base,geometry:document.geometry,pipeline:document.pipeline,frameSpec});
  for(const step of document.steps){const {title,provenance,groupId,...effect}=step;prefix=contentHash({prefix,effect,masks:document.masks});identities.push({stepId:step.id,prefixHash:prefix});}
  return {document:clone(document),documentRevision:document.revision,documentHash:documentHash(document),renderHash:renderHash(document),frameSpec:clone(frameSpec),frameSpecHash:contentHash(frameSpec),prefixes:identities};
}
