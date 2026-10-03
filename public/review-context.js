import {adjustmentKeys,combineSettings} from './editor-engine.js';
import {metricLabels} from './diagnostics.js';
import {validPhotoMetering} from './photo-metering.js';

export function reviewContext(value={}) {
  const numeric = Object.fromEntries(adjustmentKeys.filter(key=>typeof value.settings?.[key]==='number' && Number.isFinite(value.settings[key])).map(key=>[key,value.settings[key]]));
  const settings=combineSettings({settings:numeric});
  const c=value.crop;
  const crop=c && ['x','y','width','height'].every(key=>typeof c[key]==='number' && Number.isFinite(c[key])) && c.x>=0 && c.y>=0 && c.width>0 && c.height>0 && c.x+c.width<=1.001 && c.y+c.height<=1.001
    ? {x:c.x,y:c.y,width:c.width,height:c.height,angle:typeof c.angle==='number' && Number.isFinite(c.angle) ? Math.max(-15,Math.min(15,c.angle)):0}:null;
  const localCount=Number.isInteger(value.localCount) ? Math.max(0,Math.min(50,value.localCount)):0;
  return {settings,crop,localCount,originalMetering:validPhotoMetering(value.originalMetering),editedMetering:validPhotoMetering(value.editedMetering)};
}

export function reviewBaseline(value) {
  const keys=Object.keys(metricLabels);
  if(!value || !keys.every(key=>typeof value.metrics?.[key]==='number' && Number.isFinite(value.metrics[key]) && value.metrics[key]>=0 && value.metrics[key]<=100))return null;
  // Retain bounded evidence as data, never as model instructions.
  const evidence=Object.fromEntries(keys.map(key=>[key,{evidence:typeof value.evidence?.[key]?.evidence==='string' ? value.evidence[key].evidence.slice(0,360):'',condition:typeof value.evidence?.[key]?.condition==='string' ? value.evidence[key].condition.slice(0,360):''}]));
  if(!keys.every(key=>evidence[key].evidence.trim() && evidence[key].condition.trim()))return null;
  return {metrics:Object.fromEntries(keys.map(key=>[key,value.metrics[key]])),evidence};
}

export function reviewContextPrompt(value) {
  const context=reviewContext(value);
  const changed=Object.fromEntries(Object.entries(context.settings).filter(([,value])=>value!==0));
  return `实际编辑记录（客户端提供、已校验数值）：${JSON.stringify({globalAdjustments:changed,crop:context.crop,localAdjustmentCount:context.localCount})}。这是实际已应用的合成参数，不是新的建议。先区分操作事实与可见结果：没有饱和度、鲜艳度或色温调整时，不能声称用户主动增色或改变白平衡；曝光改变也可能让颜色看起来不同。未添加局部调整时不能声称做了脸部或天空蒙版。参数不是画质改善的证明，以两张图实际得失为准。`;
}

export function anchoredAssessment(assessment,baseline) {
  const valid=reviewBaseline(baseline);
  return valid ? {...assessment,before:{...valid.metrics},beforeEvidence:structuredClone(valid.evidence),baselineSource:'original-review'}:{...assessment,baselineSource:'paired-review'};
}
