import {cleanToolRuns} from './photo-tools/history.js';
import {adjustmentKeys,neutralSettings,limits,renderingVersion} from './editor-engine.js';
import {presets} from './presets.js';
import {validCrop} from './crop-utils.js';
import {validateDocument} from './edit-stack/document.js';
export const exchangeSchema='frameyn-photo-exchange/1';
export const editableExchangeSchema='framelark-photo-exchange/2';
export const exchangeFormatFor=versions=>versions.some(v=>v.recipe||v.document)?editableExchangeSchema:exchangeSchema;
const rectValid=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.x>=0&&r.y>=0&&r.width>=.005&&r.height>=.005&&r.x+r.width<=1.0001&&r.y+r.height<=1.0001;
const bounds=k=>limits[k]||(['sharpen','denoise'].includes(k)?[0,75]:[-75,75]);
const problem=s=>{throw new Error(s);};
const string=(s,n)=>typeof s==='string'&&s.length<=n;
export function cleanExchangeState(state){
  if(!state||typeof state!=='object'||Array.isArray(state))problem('照片参数不完整。');
  if(state.textOverlays?.length||Object.values(state.guards||{}).some(v=>Array.isArray(v)?v.length:Object.keys(v||{}).length))problem('这份版本含文字或保护约束，请在 Agent 暗房继续；交换不会丢弃这些效果。');
  const settings={...neutralSettings()};
  if(!state.settings||typeof state.settings!=='object'||Array.isArray(state.settings))problem('缺少实际调整目标。');
  for(const [k,n] of Object.entries(state.settings)){const [min,max]=bounds(k);if(!adjustmentKeys.includes(k)||!Number.isFinite(n)||n<min||n>max)problem('照片参数超出支持范围。');settings[k]=n;}
  const style=state.style||null;
  if(style&&(!presets.some(p=>p.id===style.id)||!Number.isFinite(style.amount)||style.amount<0||style.amount>100))problem('风格记录无效。');
  if(state.crop&&(!validCrop(state.crop)||!Number.isFinite(state.crop.angle??0)||Math.abs(state.crop.angle||0)>15))problem('裁剪记录无效。');
  if(!Array.isArray(state.locals)||state.locals.length>8||new Set(state.locals.map(l=>l.id)).size!==state.locals.length)problem('局部记录无效或超过 8 处。');
  const point=p=>p&&['x','y'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1);
  const locals=state.locals.map(l=>{
    if(l.exclude!==undefined&&(!Array.isArray(l.exclude)||l.exclude.length>8||!l.exclude.every(rectValid)))problem("排除范围无效。");
    if(!string(l.id,80)||!l.id||!string(l.note||'',600)||!rectValid(l.rect)||!['rectangle','radial','linear'].includes(l.maskType)||!Number.isFinite(l.feather)||l.feather<0||l.feather>1||!Number.isFinite(l.localAmount)||l.localAmount<0||l.localAmount>150||typeof l.localEnabled!=='boolean'||l.maskType==='linear'&&(!point(l.start)||!point(l.end)))problem('局部范围无法交换；画笔请在原工作区继续。');
    return {...structuredClone(l),localSettings:cleanExchangeState({settings:l.localSettings||{},locals:[]}).settings};
  });
  return {settings,style:structuredClone(style),crop:state.crop?structuredClone(state.crop):null,locals,textOverlays:[]};
}
export function validateExchange(value){
  if(!value||![exchangeSchema,editableExchangeSchema].includes(value.schema)||value.renderingVersion!==renderingVersion)problem('项目交换格式或像素引擎版本不兼容。');
  const s=value.source;
  if(!s||!string(s.name,160)||!string(s.data,42*1024*1024)||!Number.isInteger(s.bytes)||s.bytes<1||s.bytes>30*1024*1024||!/^[a-f0-9]{64}$/.test(s.checksum)||!['image/jpeg','image/png','image/webp','image/avif'].includes(s.mime)||!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<1||s.height<1||Math.max(s.width,s.height)>16384||s.width*s.height>50_000_000)problem('原片数据不完整或超出导入限制。');
  if(!string(value.intent,300)||!Array.isArray(value.notes)||value.notes.length>8||new Set(value.notes.map(n=>n.id)).size!==value.notes.length)problem('意图或批注记录无效。');
  for(const n of value.notes)if(!string(n.id,80)||!n.id||!string(n.note,600)||!rectValid(n.rect)||n.protect!==undefined&&typeof n.protect!=='boolean')problem('批注范围无效。');
  if(!Array.isArray(value.versions)||!value.versions.length||value.versions.length>42||new Set(value.versions.map(v=>v.id)).size!==value.versions.length||!value.versions.some(v=>v.id===value.currentId))problem('版本记录无效或超过交换上限。');
  const versions=value.versions.map(v=>{if(!string(v.id,80)||!v.id||!string(v.name,80)||!v.name)problem('版本名称无效。');const state=cleanExchangeState(v.state),role=v.role||'edit';if(!['original','edit','working'].includes(role)||role==='original'&&(Object.values(state.settings).some(Boolean)||state.style||state.crop||state.locals.length||v.recipe))problem('原片角色与实际参数不符。');if(v.recipe){if(value.schema!==editableExchangeSchema)problem('可编辑配方不能放入旧交换格式。');validateDocument(v.recipe);if(v.recipe.source.contentHash!==s.checksum||v.recipe.source.width!==s.width||v.recipe.source.height!==s.height)problem('配方源身份与交换原片不符。');}return {id:v.id,name:v.name,role,state,...(v.recipe?{recipe:structuredClone(v.recipe)}:{}),...(v.toolRuns?{toolRuns:cleanToolRuns(v.toolRuns)}:{})};});
  if(versions.filter(v=>v.role==='original').length!==1)problem('交换需要一份明确的未处理原片版本。');
  for(const v of versions){
    if(new Set([...value.notes.map(n=>n.id),...v.state.locals.map(l=>l.id)]).size>8)problem('批注与历史局部合计超过 8 处，请在 Agent 暗房继续。');
    for(const l of v.state.locals){const n=value.notes.find(n=>n.id===l.id);if(n&&['x','y','width','height'].some(k=>Math.abs(n.rect[k]-l.rect[k])>1e-6))problem('批注位置与已保存局部范围不同，请在 Agent 暗房继续；交换不会移动局部效果。');}
  }
  return {schema:value.schema,renderingVersion,source:{...s},intent:value.intent,notes:structuredClone(value.notes),versions,currentId:value.currentId};
}
export function exchangeSnapshot(v,notes){
  const state=cleanExchangeState(v.state),byId=new Map();
  for(const l of state.locals)byId.set(l.id,{...l,note:notes.find(n=>n.id===l.id)?.note||l.note});
  for(const n of notes)if(!byId.has(n.id))byId.set(n.id,{...structuredClone(n),localSettings:{},maskType:'rectangle',feather:.36,localAmount:100,localEnabled:true});
  return {editDocument:v.recipe?structuredClone(v.recipe):null,toolRuns:cleanToolRuns(v.toolRuns||[]),manual:state.settings,presetId:state.style?.id||null,presetAmount:state.style?.amount||0,crop:state.crop,annotations:[...byId.values()],advisorLayers:[],active:[],recommendations:[],agentApplied:[],agentAppliedIds:[]};
}
export function restoreWebExchange(pack,basicReview){
  if(pack.intent.length>180)problem('意图超过网页的 180 字限制，请在 Agent 暗房继续或先明确精简。');
  if(pack.versions.filter(v=>v.role==='edit').length>40)problem('网页最多保存 40 个命名版本，请先在 Agent 暗房整理。');
  if(!basicReview||!Array.isArray(basicReview.recommendations))problem('原片基础光色未准备好，已有工作保留。');
  const current=pack.versions.find(v=>v.id===pack.currentId);
  return {...exchangeSnapshot(current,pack.notes),creativeIntent:pack.intent,analysis:structuredClone(basicReview),originalRecommendations:structuredClone(basicReview.recommendations),analysisStatus:'fallback',analysisSource:'local',analysisProvenance:null,analysisError:{code:'PROJECT_IMPORTED',message:'已恢复编辑；尚未进行视觉审片。',retryable:true},history:{past:[],future:[]},versions:pack.versions.filter(v=>v.role==='edit').map(v=>({id:v.id,kind:'manual',label:v.name,at:new Date().toISOString(),snapshot:exchangeSnapshot(v,pack.notes)}))};
}
