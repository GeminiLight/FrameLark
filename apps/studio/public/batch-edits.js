import {derivedTitle} from './edit-stack/values.js';
import {adjustmentKeys,limits} from './editor-engine.js';
import {globalAdjustments,effectiveAnnotations} from './adjustment-layers.js';
import {presetById} from './presets.js';
import {srgbToLinear} from './tone-processing.js';
import {applyCommands} from './edit-stack/commands.js';
import {pixelTool,splitSettings} from './edit-stack/tools.js';
import {presetCommands} from './edit-stack/styles.js';
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
  if(source.editDocument||target.editDocument)return planDocumentSync(source,target,{keys,matchExposure,sourceHistogram,targetHistogram,crop,local});
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
// A sequential recipe has no equivalent aggregate slider value. Batch sync
// appends selected operations, retaining their order, masks and strength.
function planDocumentSync(source,target,{keys,matchExposure,sourceHistogram,targetHistogram,crop,local}){
  if(!target.editDocument)throw Error('请先为目标照片准备可编辑配方。');
  const chosen=new Set(keys),commands=[],copies=new Map(),sourceSteps=source.editDocument?.steps||splitSettings(snapshotSettings(source)).map((value,index)=>({...value,id:'legacy-'+index,title:'已有调整',enabled:true,opacity:1,dependsOn:[]}));
  const selected=sourceSteps.filter(step=>(local||!step.maskRef)&&pixelTool(step.tool,step.toolVersion).writes.some(key=>chosen.has(key)));
  let exposure=null;
  if(matchExposure&&chosen.has('exposure'))exposure=exposureOffset(sourceHistogram,targetHistogram);
  function expand(expression,reference){
    if(expression.kind==='reference'){const resource=source.editDocument.masks.find(mask=>mask.id===expression.id&&mask.version===expression.version);if(resource.reference.kind!==reference.kind)throw Error('混合参考的组合蒙版请逐张编辑，无法安全同步。');return expand(resource.expression,reference);}
    const result=structuredClone(expression);if(result.input)result.input=expand(result.input,reference);if(result.a){result.a=expand(result.a,reference);result.b=expand(result.b,reference);}return result;
  }
  for(const step of selected)copies.set(step.id,'sync-'+crypto.randomUUID());
  for(const step of selected){
    if((step.dependsOn||[]).some(id=>!copies.has(id)))throw Error('所选步骤依赖未选择的步骤，请一并选择其参数。');
    const tool=pixelTool(step.tool,step.toolVersion),parameters={...tool.defaults};
    for(const key of tool.writes)if(chosen.has(key))parameters[key==='exposure'?'ev':key]=step.parameters?.[key==='exposure'?'ev':key]??tool.defaults[key==='exposure'?'ev':key];
    if(step.tool==='exposure'){parameters.headroomPolicy=step.parameters?.headroomPolicy||tool.defaults.headroomPolicy;parameters.ev=Math.max(-3,Math.min(3,parameters.ev+(exposure?.ev||0)));}
    const copy={...structuredClone(step),id:copies.get(step.id),title:derivedTitle(step.title,{prefix:'同步 · '}),parameters,dependsOn:(step.dependsOn||[]).map(id=>copies.get(id)),maskRef:null};delete copy.groupId;
    commands.push({type:'AddStep',step:copy});
    if(step.maskRef){const mask=source.editDocument.masks.find(mask=>mask.id===step.maskRef.id&&mask.version===step.maskRef.version);commands.push({type:'ReplaceStepMask',stepId:copy.id,mask:{expression:expand(mask.expression,mask.reference),reference:mask.reference.kind==='frozen-source'?{kind:'frozen-source',sourceHash:target.editDocument.source.contentHash}:{kind:'live-input'}}});}
  }
  if(crop)commands.push({type:'UpdateGeometry',geometry:{crop:structuredClone(source.editDocument?.geometry.crop||source.crop)}});
  if(!commands.length)return {snapshot:structuredClone(target),commands,exposure};
  const next=applyCommands(target.editDocument,commands).next;
  return {snapshot:{...structuredClone(target),editDocument:next,crop:next.geometry.crop},commands,exposure};
}
export function planStyle(snapshot,id,amount=75) {
  if(!presetById(id))throw new Error('请选择有效风格');
  if(snapshot.editDocument){const commands=presetCommands(id,Math.max(0,Math.min(100,Number(amount)||0)),{groupId:'look-'+crypto.randomUUID()});return {...structuredClone(snapshot),editDocument:applyCommands(snapshot.editDocument,commands).next};}
  return {...structuredClone(snapshot),presetId:id,presetAmount:Math.max(0,Math.min(100,Number(amount)||0))};
}
