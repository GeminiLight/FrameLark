import {cleanToolRuns} from './photo-tools/history.js';
import {adjustmentKeys,limits,neutralSettings} from './editor-engine.js';
import {snapshotSettings} from './batch-edits.js';
import {effectiveAnnotations} from './adjustment-layers.js';
import {validateDocument} from './edit-stack/document.js';
export function workspacePatch(snapshot,{intent='',conversation=[]}={}) {
  if(snapshot.editDocument){const recipe=validateDocument(snapshot.editDocument),base=recipe.base.state;return {...workspacePatch({...snapshot,editDocument:null,manual:base.settings,active:[],advisorLayers:[],recommendations:[],presetId:base.style?.id||null,presetAmount:base.style?.amount||0,crop:recipe.geometry.crop,annotations:snapshot.annotations}),document:structuredClone(recipe),intent,conversation:structuredClone(conversation.slice(-24))};}
  const enabled=new Set(snapshot.active),raw=Object.fromEntries(adjustmentKeys.map(key=>[key,(snapshot.manual[key]||0)+(snapshot.recommendations||[]).filter(r=>enabled.has(r.id)).reduce((sum,r)=>sum+(r.adjustments[key]||0),0)+(snapshot.advisorLayers||[]).filter(l=>!l.annotationId).reduce((sum,l)=>sum+(l.settings[key]||0),0)]));
  const bounded=adjustmentKeys.every(key=>{const [min,max]=limits[key]||[-75,75];return raw[key]>=min&&raw[key]<=max;});
  return {toolRuns:cleanToolRuns(snapshot.toolRuns||[]),settings:bounded?raw:snapshotSettings(snapshot),style:bounded&&snapshot.presetId?{id:snapshot.presetId,amount:snapshot.presetAmount}:null,crop:snapshot.crop,
    annotations:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers).map(a=>({...a,hasNote:a.hasNote!==false,hasLocal:Object.values(a.localSettings||{}).some(Boolean)||Boolean(a.hasLocal&&snapshot.annotations.find(original=>original.id===a.id)?.localSettings)})),intent,
    conversation:conversation.slice(-24).map(m=>({role:m.role,text:m.text,source:m.source,...(['tools','document'].includes(m.action?.kind)?{id:m.id,action:structuredClone(m.action),scopeStepId:m.scopeStepId||null,applied:Boolean(m.applied),baseSignature:m.baseSignature,baseIntent:m.baseIntent,baseAnnotations:m.baseAnnotations}:{}),provenance:m.provenance?{model:m.provenance.model,tier:m.provenance.tier}:undefined}))};
}
export function snapshotFromProject(data) {
  // Local edits are composited in order. Note numbering must not reorder effects.
  const locals=data.current.locals,notes=data.notes,all=[...locals.map(local=>{const note=notes.find(n=>n.id===local.id);return {...local,...(note?{number:note.number,updatedAt:note.updatedAt,protect:note.protect}:{}),note:note?.note ?? local.note ?? '',hasNote:Boolean(note),hasLocal:true};}),...notes.filter(note=>!locals.some(l=>l.id===note.id)).map(note=>({...note,hasNote:true,hasLocal:false}))];
  return {editDocument:data.document?structuredClone(validateDocument(data.document)):null,toolRuns:cleanToolRuns(data.toolRuns||[]),manual:{...neutralSettings(),...data.current.settings},active:[],advisorLayers:[],crop:data.current.crop,presetId:data.current.style?.id || null,presetAmount:data.current.style?.amount ?? 75,recommendations:[],annotations:all,agentApplied:[]};
}
export function editionsFromProject(data){
  return data.versions.filter(v=>v.mode!=='workspace').map(v=>({id:v.id,label:v.name,at:v.at,kind:data.exports?.some(item=>item.versionId===v.id)?'export':v.kind,supported:v.supported!==false,snapshot:snapshotFromProject({current:v.state,document:v.document,notes:v.notes||[],toolRuns:v.toolRuns||[]})}));
}
export function workspaceEditions(versions,{copy=false}={}){
  if(copy&&versions.some(v=>v.supported===false))throw new Error('历史版本含网页不支持的文字或保护设置。请在 Skill 中复制完整项目，原项目和当前编辑仍保留。');
  return versions.filter(v=>v.kind!=='original').map(v=>({id:v.id,name:v.label,at:v.at,kind:v.kind,patch:workspacePatch(v.snapshot)}));
}
export function rememberExportVersion(photo,snapshot,signature,{projectVersionId,at=new Date().toISOString()}={}){
  photo.versions||=[];
  const shared=projectVersionId&&photo.versions.find(item=>item.id===projectVersionId);
  if(shared){shared.kind='export';shared.signature=signature;return shared;}
  if(photo.versions.length>=40||photo.versions.some(item=>item.kind==='export'&&item.signature===signature))return null;
  const version={id:projectVersionId||crypto.randomUUID(),kind:'export',label:'导出版本',at,signature,snapshot:structuredClone(snapshot)};
  photo.versions.push(version);return version;
}
