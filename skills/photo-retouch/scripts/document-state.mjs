import {createDocument,validateDocument,captureLegacyBase,stackPipeline} from './engine/edit-stack/document.js';
import {compileRetouchPlan} from './engine/edit-stack/planning.js';
import {documentHash,renderHash,contentHash} from './engine/edit-stack/identity.js';
import {guardsOf} from './engine/edit-guards.js';
import {versionPipeline,versionStateHash} from './engine/edit-identity.js';
import {fail,equal} from './engine/edit-values.js';
import {neutralSettings} from './engine/editor-engine.js';
export {versionPipeline,versionStateHash};
export function projectDocument(project,version=project.versions.find(v=>v.id===project.currentId)){
  return version.recipe||createDocument({documentId:('doc-'+project.id).slice(0,80),source:{assetId:project.id,contentHash:project.source.checksum,normalizedHash:project.source.normalizedChecksum,width:project.source.width,height:project.source.height},base:version.state});
}
export function validateProjectDocument(project,version){
  if(!version.recipe)return;const recipe=validateDocument(version.recipe),source=recipe.source;
  if(source.contentHash!==project.source.checksum||source.normalizedHash!==undefined&&source.normalizedHash!==project.source.normalizedChecksum||source.width!==project.source.width||source.height!==project.source.height)fail('SOURCE_CHANGED','编辑配方不属于当前项目原片。');
  const expected={...captureLegacyBase(version.state).state,crop:recipe.base.state.crop};
  if(contentHash(expected)!==recipe.base.stateHash||!equal(recipe.geometry.crop,version.state.crop||null))fail('DOCUMENT_STATE_CONFLICT','旧状态与配方的兼容基础不一致。请保留记录并恢复备份。');
}
export function compileProjectProposal(project,candidate,selected=candidate.selectedItemIds){
  const base=project.versions.find(v=>v.id===candidate.parentId),current=projectDocument(project,base);
  if(documentHash(current)!==documentHash(candidate.baseDocument))fail('STALE_REVISION','提案的基础步骤已变化。');
  const result=compileRetouchPlan(candidate.baseDocument,{kind:'document',proposal:candidate.documentProposal},{scopeStepId:candidate.scopeStepId||null,requireVisual:Boolean(candidate.policy),diagnosis:(project.diagnoses||[]).find(d=>d.id===candidate.diagnosisId),selectedItemIds:selected}),recipe=result.document,state={...structuredClone(base.state),...structuredClone(recipe.base.state),crop:structuredClone(recipe.geometry.crop),guards:structuredClone(guardsOf(base.state)),textOverlays:structuredClone(base.state.textOverlays||[])};
  const guards=guardsOf(base.state);if((guards.parameters.length||guards.locals.length)&&renderHash(current)!==renderHash(recipe))fail('LOCK_CONFLICT','旧参数或局部锁不能安全映射到顺序步骤，请先显式解除对应锁。');
  return {recipe,state,items:result.items,selectedItemIds:result.selectedItemIds,noChange:result.noChange,documentProposal:result.proposal,baseDocument:structuredClone(candidate.baseDocument)};
}
export function statePixelContent(state){return {settings:{...neutralSettings(),...state.settings},style:state.style||null,crop:state.crop||null,locals:(state.locals||[]).map(layer=>({id:layer.id,rect:layer.rect,localSettings:{...neutralSettings(),...layer.localSettings},maskType:layer.maskType||'rectangle',feather:layer.feather??.36,exclude:layer.exclude||[],localAmount:layer.localAmount??100,localEnabled:layer.localEnabled!==false,start:layer.start||null,end:layer.end||null,points:layer.points||null,brushRadius:layer.brushRadius??.03}))};}
export function documentSnapshot(project,value,state,{allowImport=false}={}){
  const current=project.versions.find(v=>v.id===project.currentId);
  if(!value.document){if(current.recipe)fail('DOCUMENT_COMMAND_REQUIRED','快照缺少可编辑配方，不能覆盖当前步骤。');return {state};}
  const recipe=structuredClone(validateDocument(value.document));
  if(!allowImport&&(!current.recipe||documentHash(current.recipe)!==documentHash(recipe)))fail('DOCUMENT_COMMAND_REQUIRED','修改步骤需要通过文档命令，不能用旧快照覆盖。');
  const desired={...structuredClone(state),...structuredClone(recipe.base.state),crop:structuredClone(recipe.geometry.crop)};
  if(contentHash(statePixelContent(state))!==contentHash(statePixelContent(desired)))fail('DOCUMENT_STATE_CONFLICT','快照参数与权威配方不一致。');validateProjectDocument(project,{state:desired,recipe});return {state:desired,recipe};
}
