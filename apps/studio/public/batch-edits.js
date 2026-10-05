import {adjustmentKeys,limits} from './editor-engine.js';
import {globalAdjustments,effectiveAnnotations} from './adjustment-layers.js';
import {presetById} from './presets.js';
import {srgbToLinear} from './tone-processing.js';
export const syncGroups=[
  {id:'light',label:'光线与影调',keys:['exposure','contrast','highlights','shadows','whites','blacks']},
  {id:'color',label:'白平衡与色彩',keys:['warmth','tint','vibrance','saturation']},
  {id:'curve',label:'影调曲线',keys:['curveShadows','curveMidtones','curveHighlights']},
  {id:'hsl',label:'色彩混合',keys:['orangeSaturation','greenSaturation','blueSaturation','orangeHue','greenHue','blueHue','orangeLuminance','greenLuminance','blueLuminance']},
  {id:'detail',label:'细节与降噪',keys:['texture','clarity','dehaze','sharpen','denoise']},
  {id:'finish',label:'颗粒与氛围',keys:['fade','vignette','grain','monochrome']}
];
export function photoSnapshot(photo) {
  return {editDocument:structuredClone(photo.editDocument||null),toolRuns:structuredClone(photo.toolRuns||[]),manual:{...photo.manual},active:[...photo.active],advisorLayers:structuredClone(photo.advisorLayers || []),crop:structuredClone(photo.crop),presetId:photo.presetId,presetAmount:photo.presetAmount,
    recommendations:structuredClone(photo.analysis?.recommendations || null),annotations:structuredClone(photo.annotations || []),agentApplied:(photo.conversation || []).map(item=>Boolean(item.applied))};
}
export function snapshotSettings(snapshot) {return globalAdjustments({...snapshot,preset:presetById(snapshot.presetId),amount:snapshot.presetAmount});}
// The median in linear light is less sensitive to a small bright window than mean brightness.
export function medianLight(histogram) {
  if(!Array.isArray(histogram) || !histogram.length)return null;
  const total=histogram.reduce((sum,n)=>sum+Math.max(0,n),0);if(!total)return null;
  let seen=0;for(let i=0;i<histogram.length;i++){seen+=histogram[i];if(seen>=total/2)return srgbToLinear((i+.5)/histogram.length);}return null;
}
export function exposureOffset(referenceHistogram,targetHistogram) {
  const a=medianLight(referenceHistogram),b=medianLight(targetHistogram);
  if(a===null || b===null || a<.005 || b<.005 || a>.9 || b>.9)return {ev:0,limited:true};
  const raw=Math.log2(a/b);return {ev:Math.max(-.65,Math.min(.65,raw)),limited:Math.abs(raw)>.65};
}
export function planSync(source,target,{keys=[],matchExposure=false,sourceHistogram,targetHistogram,crop=false,local=false}={}) {
  const result=structuredClone(target),desired=snapshotSettings(source);
  // Read the uncapped non-manual layers so already saturated layers are compensated correctly.
  const baseline=Object.fromEntries(adjustmentKeys.map(key=>[key,(target.recommendations || []).filter(item=>target.active.includes(item.id)).reduce((sum,item)=>sum+(Number(item.adjustments?.[key]) || 0),0)
    +(Number(presetById(target.presetId)?.adjustments?.[key]) || 0)*target.presetAmount/100
    +(target.advisorLayers || []).filter(item=>!item.annotationId).reduce((sum,item)=>sum+(Number(item.settings?.[key]) || 0),0)]));
  const chosen=new Set(keys.filter(key=>adjustmentKeys.includes(key)));let exposure=null;
  if(matchExposure && chosen.has('exposure')) {exposure=exposureOffset(sourceHistogram,targetHistogram);desired.exposure+=exposure.ev;}
  for(const key of chosen) {const [min,max]=limits[key] || [-75,75];result.manual[key]=Math.max(min,Math.min(max,desired[key]))-baseline[key];}
  if(crop)result.crop=structuredClone(source.crop);
  if(local){result.annotations=effectiveAnnotations(source.annotations,source.advisorLayers).map((item,index)=>({...structuredClone(item),id:`batch-local-${index+1}`}));result.advisorLayers=result.advisorLayers.filter(item=>!item.annotationId);}
  return {snapshot:result,exposure};
}
export function planStyle(snapshot,id,amount=75) {
  if(!presetById(id))throw new Error('请选择有效风格');
  return {...structuredClone(snapshot),presetId:id,presetAmount:Math.max(0,Math.min(100,Number(amount)||0))};
}
