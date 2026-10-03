import {adjustmentKeys,limits,neutralSettings} from './editor-engine.js';
import {snapshotSettings} from './batch-edits.js';
import {effectiveAnnotations} from './adjustment-layers.js';
export function workspacePatch(snapshot,{intent='',conversation=[]}={}) {
  const enabled=new Set(snapshot.active),raw=Object.fromEntries(adjustmentKeys.map(key=>[key,(snapshot.manual[key]||0)+(snapshot.recommendations||[]).filter(r=>enabled.has(r.id)).reduce((sum,r)=>sum+(r.adjustments[key]||0),0)+(snapshot.advisorLayers||[]).filter(l=>!l.annotationId).reduce((sum,l)=>sum+(l.settings[key]||0),0)]));
  const bounded=adjustmentKeys.every(key=>{const [min,max]=limits[key]||[-75,75];return raw[key]>=min&&raw[key]<=max;});
  return {settings:bounded?raw:snapshotSettings(snapshot),style:bounded&&snapshot.presetId?{id:snapshot.presetId,amount:snapshot.presetAmount}:null,crop:snapshot.crop,
    annotations:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers).map(a=>({...a,hasNote:a.hasNote!==false,hasLocal:Object.values(a.localSettings||{}).some(Boolean)||Boolean(a.hasLocal&&snapshot.annotations.find(original=>original.id===a.id)?.localSettings)})),intent,
    conversation:conversation.slice(-24).map(m=>({role:m.role,text:m.text,source:m.source,provenance:m.provenance?{model:m.provenance.model,tier:m.provenance.tier}:undefined}))};
}
export function snapshotFromProject(data) {
  const locals=data.current.locals,notes=data.notes,all=[...notes.map(note=>({...note,...locals.find(l=>l.id===note.id),note:note.note,rect:note.rect,hasNote:true,hasLocal:locals.some(l=>l.id===note.id)})),...locals.filter(l=>!notes.some(n=>n.id===l.id)).map(l=>({...l,note:'',hasNote:false,hasLocal:true}))];
  return {manual:{...neutralSettings(),...data.current.settings},active:[],advisorLayers:[],crop:data.current.crop,presetId:data.current.style?.id || null,presetAmount:data.current.style?.amount ?? 75,recommendations:[],annotations:all,agentApplied:[]};
}
