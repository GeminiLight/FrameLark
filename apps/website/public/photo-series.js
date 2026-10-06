import {presets,presetById} from './presets.js';
import {photoSnapshot,planStyle} from './batch-edits.js';
import {cleanIntent} from './creative-intent.js';

export const seriesPlatforms=[{id:'xiaohongshu',label:'小红书'},{id:'douyin',label:'抖音图文'},{id:'general',label:'其他 / 作品集'}];
export const seriesRatios=['original','3:4','4:5','1:1','9:16'];
export const seriesBounds={exposure:.4,highlights:18,shadows:18,whites:12,blacks:12,warmth:12,tint:10,vibrance:12,saturation:10,contrast:12};
export function seriesBrief(value={}) {
  value=value&&typeof value==='object'?value:{};
  return {intent:cleanIntent(value.intent),platform:seriesPlatforms.some(p=>p.id===value.platform)?value.platform:'xiaohongshu',ratio:seriesRatios.includes(value.ratio)?value.ratio:'original'};
}
export function seriesSignature(photos,brief) {
  return JSON.stringify({brief:seriesBrief(brief),photos:photos.map(photo=>{
    const snapshot=photoSnapshot(photo);snapshot.recommendations=(snapshot.recommendations||[]).filter(item=>snapshot.active.includes(item.id));delete snapshot.agentApplied;
    return {id:photo.id,intent:cleanIntent(photo.creativeIntent),snapshot};
  }).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function restoreSeries(value,ids=[]) {
  const members=[...new Set(Array.isArray(value?.ids)?value.ids.filter(id=>ids.includes(id)):[])].slice(0,12);
  return {...seriesBrief(value),ids:members};
}
const text={type:'string',minLength:1,maxLength:240};
export function seriesSchema(ids) {
  const id={type:'string',enum:ids};
  return {type:'object',additionalProperties:false,required:['title','summary','preserve','tradeoff','order','sharedStyle','photos'],properties:{
    title:{...text,maxLength:40},summary:text,preserve:text,tradeoff:text,
    order:{type:'array',minItems:ids.length,maxItems:ids.length,items:id},
    sharedStyle:{type:'object',additionalProperties:false,required:['presetId','amount','reason'],properties:{presetId:{type:'string',enum:['none',...presets.map(p=>p.id)]},amount:{type:'number',minimum:0,maximum:70},reason:text}},
    photos:{type:'array',minItems:ids.length,maxItems:ids.length,items:{type:'object',additionalProperties:false,required:['id','role','reason','preserve','tradeoff','cropNote','changes'],properties:{
      id,role:{...text,maxLength:40},reason:text,preserve:text,tradeoff:text,cropNote:text,
      changes:{type:'array',maxItems:5,items:{type:'object',additionalProperties:false,required:['key','value'],properties:{key:{type:'string',enum:Object.keys(seriesBounds)},value:{type:'number',minimum:-18,maximum:18}}}}
    }}}
  }};
}
export function validateSeriesReview(value,ids) {
  const complete=list=>Array.isArray(list)&&list.length===ids.length&&new Set(list).size===ids.length&&list.every(id=>ids.includes(id));
  if(!complete(value?.order)||!complete(value?.photos?.map(p=>p.id)))throw new Error('组图结果未覆盖全部照片，请重试。');
  if(!value.sharedStyle||!['none',...presets.map(p=>p.id)].includes(value.sharedStyle.presetId)||!Number.isFinite(value.sharedStyle.amount)||value.sharedStyle.amount<0||value.sharedStyle.amount>70)throw new Error('共同风格结果不可用，请重试。');
  for(const photo of value.photos){
    if(!Array.isArray(photo.changes)||new Set(photo.changes.map(c=>c.key)).size!==photo.changes.length||photo.changes.some(c=>!Object.hasOwn(seriesBounds,c.key)||!Number.isFinite(c.value)||Math.abs(c.value)>seriesBounds[c.key]))throw new Error('逐张调整超出温和处理范围，请重试。');
  }
  return value;
}
export function seriesCandidate(photo,review,{useStyle=true,layerId='series-trial'}={}) {
  const before=photoSnapshot(photo),item=review.photos.find(p=>p.id===photo.id);
  if(!item)throw new Error('组图中缺少这张照片。');
  let candidate=structuredClone(before);
  if(useStyle&&review.sharedStyle.presetId!=='none')candidate=planStyle(candidate,review.sharedStyle.presetId,review.sharedStyle.amount);
  if(item.changes.length)candidate.advisorLayers.push({id:layerId,source:'series',label:`组图 · ${review.title}`,settings:Object.fromEntries(item.changes.map(c=>[c.key,c.value]))});
  return {before,candidate,item,style:useStyle?presetById(review.sharedStyle.presetId):null};
}
