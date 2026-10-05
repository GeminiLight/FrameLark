import {fail} from './values.js';
// Archives describe accepted work. They are data, never executable authority.
export function cleanToolRuns(value=[]){
  if(!Array.isArray(value)||value.length>24||JSON.stringify(value).length>512*1024)fail('TOOL_HISTORY_INVALID','工具记录超过保存限制。');
  for(const run of value){
    if(!run||typeof run.namespace!=='string'||run.namespace.length>80||typeof run.label!=='string'||run.label.length>120||!Array.isArray(run.operations)||run.operations.length>24||!Array.isArray(run.selectedItemIds)||!Array.isArray(run.records))fail('TOOL_HISTORY_INVALID','工具记录无效。');
    const ids=new Set();
    for(const op of run.operations){if(!op||typeof op.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(op.id)||ids.has(op.id)||typeof op.tool!=='string'||!/^[-a-zA-Z0-9_]{1,60}$/.test(op.tool)||!Number.isInteger(op.version)||op.version<1||!op.target||!op.parameters||!Array.isArray(op.dependsOn))fail('TOOL_HISTORY_INVALID','工具步骤记录无效。');ids.add(op.id);}
    if(new Set(run.selectedItemIds).size!==run.selectedItemIds.length||run.selectedItemIds.some(id=>!ids.has(id))||run.records.length>24||run.records.some(r=>!r||!ids.has(r.id)))fail('TOOL_HISTORY_INVALID','工具选择记录无效。');
  }
  return structuredClone(value);
}
export function versionToolRuns(version){
  if(version?.toolRuns)return cleanToolRuns(version.toolRuns);
  const items=version?.items?.filter(item=>item.operation)||[];
  return items.length?[{namespace:version.toolNamespace||version.id,label:version.name||'工具组合',operations:items.map(i=>i.operation),selectedItemIds:version.selectedItemIds||items.map(i=>i.id),records:items.map(i=>({id:i.id,execution:i.execution}))}]:[];
}
