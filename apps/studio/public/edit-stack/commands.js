import {createDocument,validateDocument,canonicalStep,validateGeometry,captureLegacyBase} from './document.js';
import {parametersFor} from './tools.js';
import {object,identifier,number,title,bool,fail} from './values.js';
import {validateMaskRef} from './masks.js';
import {contentHash,documentHash,renderHash} from './identity.js';
const clone=value=>structuredClone(value);
const stepAt=(document,id)=>{identifier(id);const step=document.steps.find(step=>step.id===id);if(!step)fail('STEP_MISSING','这一步已删除，请重新读取当前编辑。',{stepId:id});return step;};
export const commandTypes=['AddStep','UpdateStepParameters','SetStepEnabled','SetStepOpacity','ReplaceStepMask','MoveStep','RemoveStep','RenameStep','UpdateGeometry','ToggleGroup','AddGroup','RenameGroup','ReplaceLegacyBase','ClearSteps'];
export function applyCommands(document,commands,{expectedRevision=document.revision,expectedHash=documentHash(document),requestId}={}){
  validateDocument(document);if(!Array.isArray(commands)||!commands.length||commands.length>24)fail('INVALID_COMMANDS','一次编辑需要 1～24 条有限命令。');const commandsHash=contentHash(commands);
  if(requestId!==undefined){identifier(requestId);const receipt=document.receipts.find(receipt=>receipt.id===requestId);if(receipt){if(receipt.commandsHash!==commandsHash)fail('REQUEST_CONFLICT','同一请求编号不能提交不同编辑。');return {next:clone(document),receipt:clone(receipt),reused:true,transaction:null,invalidation:null};}}
  if(document.revision!==expectedRevision||documentHash(document)!==expectedHash)fail('STALE_REVISION','编辑内容已变化，请重新读取当前步骤。');
  const next=clone(document),beforeHash=documentHash(document),beforeRender=renderHash(document);
  for(const command of commands){
    if(!command||!commandTypes.includes(command.type))fail('INVALID_COMMANDS','不支持这个编辑命令。');
    switch(command.type){
      case 'AddStep':{object(command,['type','step','index'],['type','step']);const step=canonicalStep(command.step);if(next.steps.some(value=>value.id===step.id))fail('STEP_DUPLICATE','步骤编号已经存在。');const index=command.index??next.steps.length;if(!Number.isInteger(index)||index<0||index>next.steps.length)fail('INVALID_ORDER','插入位置无效。');next.steps.splice(index,0,step);break;}
      case 'UpdateStepParameters':{object(command,['type','stepId','parameters']);const step=stepAt(next,command.stepId);object(command.parameters,Object.keys(step.parameters),[]);step.parameters=parametersFor(step.tool,step.toolVersion,{...step.parameters,...command.parameters});break;}
      case 'SetStepEnabled':object(command,['type','stepId','enabled']);stepAt(next,command.stepId).enabled=bool(command.enabled);break;
      case 'SetStepOpacity':object(command,['type','stepId','opacity']);stepAt(next,command.stepId).opacity=number(command.opacity,0,1);break;
      case 'RenameStep':object(command,['type','stepId','title']);stepAt(next,command.stepId).title=title(command.title);break;
      case 'MoveStep':{object(command,['type','stepId','index']);stepAt(next,command.stepId);if(!Number.isInteger(command.index)||command.index<0||command.index>=next.steps.length)fail('INVALID_ORDER','移动位置无效。');const index=next.steps.findIndex(step=>step.id===command.stepId),[step]=next.steps.splice(index,1);next.steps.splice(command.index,0,step);break;}
      case 'RemoveStep':{
        object(command,['type','stepId','cascade'],['type','stepId']);stepAt(next,command.stepId);if(command.cascade!==undefined)bool(command.cascade);
        const affected=new Set([command.stepId]);let count;do{count=affected.size;for(const step of next.steps)if(step.dependsOn.some(id=>affected.has(id)))affected.add(step.id);}while(count!==affected.size);
        if(affected.size>1&&!command.cascade)fail('DEPENDENCY_REQUIRED','删除这一步会使其他步骤失去资源。',{stepIds:[...affected].filter(id=>id!==command.stepId)});next.steps=next.steps.filter(step=>!affected.has(step.id));break;
      }
      case 'ReplaceStepMask':{
        object(command,['type','stepId','maskRef','mask','shared'],['type','stepId']);const step=stepAt(next,command.stepId),old=step.maskRef;
        if(command.shared!==undefined)bool(command.shared);if(Object.hasOwn(command,'maskRef')===Object.hasOwn(command,'mask'))fail('INVALID_COMMANDS','请选择现有蒙版或创建新版本。');let ref;
        if(Object.hasOwn(command,'maskRef')){ref=clone(command.maskRef);if(ref!==null)validateMaskRef(ref);}
        else {object(command.mask,['expression','reference','provenance'],['expression','reference']);const maskId=old?.id||('mask-'+step.id).slice(0,80),version=Math.max(0,...next.masks.filter(mask=>mask.id===maskId).map(mask=>mask.version))+1;next.masks.push({id:maskId,version,...clone(command.mask)});ref={id:maskId,version};}
        const users=command.shared&&old?next.steps.filter(value=>value.maskRef?.id===old.id&&value.maskRef.version===old.version):[step];users.forEach(value=>value.maskRef=clone(ref));break;
      }
      case 'UpdateGeometry':object(command,['type','geometry']);next.geometry=clone(validateGeometry(command.geometry));break;
      case 'ToggleGroup':object(command,['type','groupId','enabled']);identifier(command.groupId);bool(command.enabled);if(!next.groups.some(group=>group.id===command.groupId))fail('GROUP_MISSING','分组不存在。');next.steps.filter(step=>step.groupId===command.groupId).forEach(step=>step.enabled=command.enabled);break;
      case 'AddGroup':object(command,['type','group']);object(command.group,['id','title','provenance'],['id','title']);identifier(command.group.id);title(command.group.title);if(next.groups.some(group=>group.id===command.group.id))fail('GROUP_DUPLICATE','分组编号已经存在。');next.groups.push(clone(command.group));break;
      case 'RenameGroup':{object(command,['type','groupId','title']);const group=next.groups.find(group=>group.id===command.groupId);if(!group)fail('GROUP_MISSING','分组不存在。');group.title=title(command.title);break;}
      case 'ReplaceLegacyBase':object(command,['type','state']);next.base=captureLegacyBase(command.state);break;
      case 'ClearSteps':object(command,['type']);next.steps=[];next.groups=[];next.masks=[];break;
    }
  }
  validateDocument(next);const afterHash=documentHash(next);if(afterHash===beforeHash)return {next:clone(document),transaction:null,invalidation:null,noChange:true};
  next.revision++;const receipt={id:requestId||('transaction-'+next.revision),commandsHash,beforeHash,afterHash,revision:next.revision};next.receipts=[...next.receipts,receipt].slice(-128);validateDocument(next);
  const changedRender=renderHash(next)!==beforeRender;let fromIndex=0;
  if(changedRender&&contentHash(document.base)===contentHash(next.base)&&contentHash(document.geometry)===contentHash(next.geometry)&&contentHash(document.masks)===contentHash(next.masks)){while(fromIndex<Math.min(document.steps.length,next.steps.length)&&contentHash(document.steps[fromIndex])===contentHash(next.steps[fromIndex]))fromIndex++;}
  return {next,receipt,transaction:{id:receipt.id,documentId:document.documentId,beforeHash,afterHash,commands:clone(commands),before:clone(document),after:clone(next)},invalidation:changedRender?{fromIndex}:null};
}
export function restoreTransaction(document,transaction,direction,{expectedRevision=document.revision}={}){
  validateDocument(document);if(!['undo','redo'].includes(direction)||transaction.documentId!==document.documentId||expectedRevision!==document.revision)fail('STALE_REVISION','撤销记录与当前编辑不一致。');
  validateDocument(transaction.before);validateDocument(transaction.after);if(documentHash(transaction.before)!==transaction.beforeHash||documentHash(transaction.after)!==transaction.afterHash||contentHash(transaction.before.source)!==contentHash(document.source)||contentHash(transaction.after.source)!==contentHash(document.source))fail('STALE_REVISION','撤销记录的来源或内容身份不一致。');
  const expected=direction==='undo'?transaction.afterHash:transaction.beforeHash;if(documentHash(document)!==expected)fail('STALE_REVISION','已有其他修改，请先读取当前编辑。');const next=clone(direction==='undo'?transaction.before:transaction.after);next.revision=document.revision+1;next.receipts=[];validateDocument(next);return next;
}
export function duplicateCommands(document,id,newId){const step=clone(stepAt(document,id));step.id=identifier(newId);step.title=step.title+' · 副本';return [{type:'AddStep',step,index:document.steps.findIndex(value=>value.id===id)+1}];}
export {createDocument};
