import {remainingAdjustments} from './adjustment-layers.js';
export const observationLabels = {subject:'主体关系',background:'背景层次',light:'光线',composition:'构图',order:'视觉秩序',emotion:'情绪表达'};
export const verdictLabels = {keep:'值得保留',improve:'值得调整',uncertain:'还不确定'};

export function normalizeObservations(value) {
  if (!value || typeof value !== 'object') throw new Error('审片结果缺少画面依据。');
  return Object.fromEntries(Object.keys(observationLabels).map(key => {
    const item = value[key];
    if (!item || !['finding','evidence','condition',...(key==='emotion'?[]:['location'])].every(field => typeof item[field] === 'string' && item[field].trim()) || !Object.hasOwn(verdictLabels,item.verdict) || !['high','medium','low'].includes(item.confidence)) throw new Error('审片结果缺少完整的画面观察及适用条件。');
    if(item.location!==undefined && item.location!==null && typeof item.location!=='string')throw new Error('审片位置格式无法读取。');
    const location=typeof item.location==='string' && item.location.trim() ? item.location:'整幅画面 · 整体氛围';
    let region = item.region;
    if (!region || !['x','y','width','height'].every(field => Number.isFinite(region[field])) || region.x < 0 || region.y < 0 || region.width <= .005 || region.height <= .005 || region.x + region.width > 1.001 || region.y + region.height > 1.001) region = null;
    return [key,{finding:item.finding.slice(0,200),evidence:item.evidence.slice(0,300),location:location.slice(0,60),condition:item.condition.slice(0,300),verdict:item.verdict,confidence:item.confidence,region:region ? {x:region.x,y:region.y,width:region.width,height:region.height} : null}];
  }));
}

export function reviewSourceLabel({analyzing,analysisStatus,analysisSource,isDemo}) {
  if (analyzing) return analysisStatus === 'checking' ? '准备审片' : '审片中';
  if (analysisSource === 'ai') return ['fallback','unconfigured'].includes(analysisStatus) ? '上次视觉审片' : '视觉审片';
  return isDemo ? '示例 · 光色分析' : '基础光色';
}

export function normalizeVisionFailure(value) {
  const error = value?.error || value;
  if (!error || typeof error !== 'object') return {code:'NETWORK_ERROR',message:'未能连接视觉审片，请重试。',retryable:true};
  return {code:typeof error.code === 'string' ? error.code : 'VISION_REQUEST_FAILED',message:typeof error.message === 'string' ? error.message.slice(0,200) : '视觉审片暂未完成，请重试。',retryable:error.retryable === true,retryAfterSeconds:Number(error.retryAfterSeconds)||0};
}

// Replacing the diagnosis must not change already-applied pixels.
export function retainAppliedRecommendations(previous, next, active) {
  const retained = (previous?.recommendations || []).filter(item => active.has(item.id)).map(item => ({...item,retained:true}));
  const sameAdjustment = (a,b) => [...new Set([...Object.keys(a || {}),...Object.keys(b || {})])].every(key => (Number(a?.[key]) || 0) === (Number(b?.[key]) || 0));
  const applied=retained.reduce((sum,item)=>{for(const [key,value] of Object.entries(item.adjustments || {})) sum[key]=(sum[key]||0)+value;return sum;},{});
  const fresh = next.recommendations.filter(item => !retained.some(old => sameAdjustment(old.adjustments,item.adjustments))).map(item=>({...item,adjustments:remainingAdjustments(item.adjustments,applied)})).filter(item=>Object.values(item.adjustments).some(value=>Math.abs(value)>.001));
  return {...next,recommendations:[...retained,...fresh]};
}
