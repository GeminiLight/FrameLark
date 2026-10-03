export const tierNames={fast:'快速',standard:'标准',deep:'深入'};
export function defaultModelTiers() {
  return {fast:{model:'gpt-6.1-sol',effort:'low'},standard:{model:'gpt-6.1-sol',effort:'medium'},deep:{model:'gpt-6-astra',effort:'high'}};
}
export function normalizeModelTiers(value,legacyModel=null) {
  const defaults=defaultModelTiers(),result={};
  for(const tier of Object.keys(defaults)) {
    const entry=value?.[tier] || (legacyModel?{model:legacyModel,effort:defaults[tier].effort}:defaults[tier]);
    if(typeof entry.model!=='string'||!/^[a-zA-Z0-9._:/-]{1,120}$/.test(entry.model)||!['low','medium','high','xhigh','max'].includes(entry.effort))throw new Error('请为每个档位选择有效的模型和思考强度。');
    result[tier]={model:entry.model,effort:entry.effort};
  }
  return result;
}
export function routeModel(tiers,{task='advisor',tier='auto'}={}) {
  if(tier!=='auto'&&!Object.hasOwn(tierNames,tier))throw new Error('不支持的模型档位。');
  // Predictable task routing, never escalate after a failure or based on hidden
  // model self-assessment. A user may override the tier before sending.
  const selected=tier==='auto'?(task==='probe'?'fast':task==='series'?'deep':'standard'):tier;
  return {...tiers[selected],tier:selected};
}
