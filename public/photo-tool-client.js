import {cleanToolRuns} from './photo-tools/history.js';
import {workspacePatch} from './project-snapshot.js';
import {applyToolEffect} from './photo-tools/registry.js';
import {readVisionStream} from './vision-stream.js';
export function toolStateFromSnapshot(snapshot){
  const patch=workspacePatch(snapshot);
  return {settings:patch.settings,style:patch.style,crop:patch.crop,locals:patch.annotations.filter(a=>a.hasLocal).map(a=>({...a,localSettings:{...a.localSettings}}))};
}
// Tool identity does not appear here. The Adapter consumes the shared effect
// contract while retaining older manual/review/advisor sources for undo.
export function toolRunCandidate(snapshot,run,{label='工具组合'}={}){
  const next=structuredClone(snapshot);next.advisorLayers||=[];
  let native=toolStateFromSnapshot(snapshot);
  for(const [index,record] of run.records.entries()){
    const effect=record.effect,after=applyToolEffect(native,effect),id=`tool-${run.namespace}-source-${index}`;
    if(effect.settings){
      const settings=Object.fromEntries(Object.keys(effect.settings).map(key=>[key,after.settings[key]-(native.settings[key]||0)]).filter(([,value])=>Math.abs(value)>.000001));
      if(Object.keys(settings).length)next.advisorLayers.push({id,label:record.operation.title,settings,annotationId:null,tool:record.operation.tool,operation:record.operation});
    }
    for(const local of effect.locals||[]){
      const existing=next.annotations.find(a=>a.id===local.id),old=native.locals.find(a=>a.id===local.id);
      if(local.remove){next.annotations=next.annotations.filter(a=>a.id!==local.id||a.hasNote!==false);if(existing)existing.localSettings={};next.advisorLayers=next.advisorLayers.filter(l=>l.annotationId!==local.id);continue;}
      const layer=local.layer;
      if(existing){const manual=existing.localSettings,hasNote=existing.hasNote;Object.assign(existing,structuredClone(layer),{localSettings:manual,hasNote});}
      else next.annotations.push({...structuredClone(layer),localSettings:{},hasNote:false,hasLocal:true});
      const settings=Object.fromEntries(Object.keys(layer.localSettings).map(key=>[key,layer.localSettings[key]-(old?.localSettings?.[key]||0)]).filter(([,value])=>Math.abs(value)>.000001));
      next.advisorLayers.push({id,label:record.operation.title,settings,annotationId:local.id,tool:record.operation.tool,operation:record.operation});
    }
    if(Object.hasOwn(effect,'crop'))next.crop=structuredClone(effect.crop);
    if(Object.hasOwn(effect,'style')){next.presetId=effect.style?.id||null;next.presetAmount=effect.style?.amount??next.presetAmount;}
    native=after;
  }
  next.toolRuns=run.history?cleanToolRuns(run.history):[...(snapshot.toolRuns||[]),{namespace:run.namespace,label,operations:run.operations,selectedItemIds:run.selectedItemIds,records:run.records.map(({id,execution,preview})=>({id,execution,preview}))}].slice(-24);
  return next;
}
export async function requestToolRun(value,{signal,onEvent=()=>{},fetchImpl=fetch}={}){
  const response=await fetchImpl('/api/photo-tools/run',{method:'POST',signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify(value)});
  const result=await readVisionStream(response,onEvent,{maxBytes:8*1024*1024});
  if(!response.ok||result.error)throw Object.assign(new Error(result.error?.message||'工具执行未完成。'),{code:result.error?.code});return result;
}
