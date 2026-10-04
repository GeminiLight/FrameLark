import {presetById} from './presets.js';
import {validCrop} from './crop-utils.js';
import {viewToOriginalPoint,transformRect} from './photo-geometry.js';
import {cleanIntent} from './creative-intent.js';
// Build a disposable candidate. Preview and cancel never write to the working photo.
export function advisorCandidate(snapshot,message,{amount=snapshot.presetAmount,selectedSteps=null,width=1,height=1}={}) {
  const next=structuredClone(snapshot),action=message?.action;
  if(!action || action.kind==='none')return null;
  if(action.kind==='plan') {
    let result=next;
    for(const [index,step] of action.steps.entries()){
      if(selectedSteps&&!selectedSteps.includes(index))continue;
      const id=`${message.id}-step-${index}`;
      if(step.kind==='rotate'){result.crop={...(result.crop||{x:0,y:0,width:1,height:1}),angle:Math.max(-15,Math.min(15,(result.crop?.angle||0)+step.angle))};continue;}
      if(step.kind==='masked'){
        // Model masks refer to the input preview, before any proposed rotation or crop.
        const convert=r=>transformRect(r,p=>viewToOriginalPoint(p,snapshot.crop,width,height));
        const rect=convert(step.rect),exclude=step.exclude.map(convert);if(!rect||exclude.some(r=>!r))return null;
        result.annotations.push({id,rect,note:step.label,maskType:'rectangle',feather:step.feather,exclude,localSettings:{},localAmount:100,localEnabled:true,hasNote:false,hasLocal:true});
        result.advisorLayers.push({id,label:step.label,annotationId:id,settings:Object.fromEntries(step.changes.map(c=>[c.key,c.value])),fingerprint:message.actionFingerprint});
      }else{
        result=advisorCandidate(result,{...message,id,action:step},{amount});if(!result)return null;
      }
    }
    return result.annotations.length<=8 ? result:null;
  } else if(action.kind==='style') {
    if(!presetById(action.presetId))return null;
    next.presetId=action.presetId;next.presetAmount=Math.max(0,Math.min(100,amount));
  } else if(action.kind==='crop') {
    const crop=validCrop(action.crop,{suggestion:true});if(!crop)return null;next.crop={...crop,...(snapshot.crop?.angle ? {angle:snapshot.crop.angle}:{})};
  } else if(['adjustment','region'].includes(action.kind)) {
    if(action.kind==='region' && !next.annotations.some(item=>item.id===action.annotationId))return null;
    next.advisorLayers ||= [];
    if(next.advisorLayers.some(item=>item.id===message.id))return null;
    next.advisorLayers.push({id:message.id,label:action.label,settings:Object.fromEntries(action.changes.map(item=>[item.key,item.value])),annotationId:action.kind==='region' ? action.annotationId:null,fingerprint:message.actionFingerprint});
  } else return null;
  return next;
}
export function previewStillValid(preview,{photoId,signature,intent}) {
  return Boolean(preview && preview.photoId===photoId && preview.signature===signature && preview.intent===cleanIntent(intent));
}
export function actionExplanation(action) {
  const preset=presetById(action?.presetId);
  const scope=action?.kind==='tools' ? `${action.operations.length} 个工具步骤 · 支持区域与对象目标`:action?.kind==='plan' ? `${action.steps.length} 项子编辑 · 可逐项选择；蒙版范围以预览为准`:action?.kind==='region' ? '仅标记范围，沿已有羽化边缘过渡':action?.kind==='crop' ? '整张照片的画幅；保留范围见预览':'整张照片；保留已有局部调整';
  const tradeoff=action?.kind==='style' ? preset?.adjustments.monochrome ? '去掉色彩会失去原有颜色关系；请检查主体与背景是否仍分离。':'应用风格会改变画面光色；请检查肤色、高光与暗部是否自然。':action?.kind==='crop' ? '裁剪会减少场景信息；请检查边缘人物、关键光源和留白是否被切掉。':action?.kind==='region' ? '局部与周围的亮度或颜色可能不协调；请放大检查过渡。':'更清楚的层次也可能改变原有氛围；请检查亮暗关系与颜色是否符合意图。';
  return {scope,goal:action?.goal || preset?.mood || action?.label || '尝试另一种表达',tradeoff:action?.tradeoff || tradeoff};
}

// Activate independent review sources once. Personal crops and all other edits survive.
export function suggestionCandidate(snapshot,{ids=[],crop=null}={}) {
  const next=structuredClone(snapshot),known=new Set((next.recommendations || []).map(item=>item.id));
  next.active=[...new Set([...next.active,...ids.filter(id=>known.has(id))])];
  if(crop && !next.crop)next.crop=validCrop(crop,{suggestion:true});
  return JSON.stringify(next)===JSON.stringify(snapshot) ? null:next;
}

export function scalablePreview(before,candidate) {
  return Boolean(candidate && before.presetId===candidate.presetId && before.presetAmount===candidate.presetAmount && JSON.stringify(before.crop)===JSON.stringify(candidate.crop) && (candidate.active.some(id=>!before.active.includes(id)) || candidate.advisorLayers?.some(item=>!before.advisorLayers?.some(old=>old.id===item.id))));
}
export function scalePreview(before,candidate,amount=100) {
  const next=structuredClone(candidate);
  // Only the new sources change; the current version, style and older layers are untouched.
  const ratio=Math.max(25,Math.min(150,Number(amount)||100))/100;
  if(!scalablePreview(before,candidate))return next;
  next.recommendations=next.recommendations.map(item=>next.active.includes(item.id) && !before.active.includes(item.id) ? {...item,previewAmount:Math.round(ratio*100),adjustments:Object.fromEntries(Object.entries(item.adjustments).map(([key,value])=>[key,value*ratio]))}:item);
  next.advisorLayers=next.advisorLayers?.map(item=>before.advisorLayers?.some(old=>old.id===item.id) ? item:{...item,previewAmount:Math.round(ratio*100),settings:Object.fromEntries(Object.entries(item.settings).map(([key,value])=>[key,value*ratio]))});
  return next;
}
