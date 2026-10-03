import {metricLabels} from './diagnostics.js';
const text=(value,max=360)=>{if(typeof value!=='string'||!value.trim())throw new Error('诊断缺少判断依据或适用条件');return value.trim().slice(0,max);};
export function normalizeMetricEvidence(value) {
  return Object.fromEntries(Object.keys(metricLabels).map(key=>[key,{evidence:text(value?.[key]?.evidence),condition:text(value?.[key]?.condition)}]));
}
export function normalizeAssessment(value) {
  const scores=items=>Object.fromEntries(Object.keys(metricLabels).map(key=>{const n=items?.[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)throw new Error('复评分数不完整');return [key,n];}));
  const list=items=>{if(!Array.isArray(items)||items.length>4)throw new Error('复评缺少得失说明');return items.map(item=>({finding:text(item.finding,220),evidence:text(item.evidence),condition:text(item.condition)}));};
  return {before:scores(value?.before),after:scores(value?.after),beforeEvidence:normalizeMetricEvidence(value?.beforeEvidence),afterEvidence:normalizeMetricEvidence(value?.afterEvidence),summary:text(value?.summary),observation:text(value?.observation),improvements:list(value?.improvements),tradeoffs:list(value?.tradeoffs),preserved:list(value?.preserved)};
}
export function statisticalEvidence(inspection) {
  const s=inspection.stats,pct=n=>`${(n*100).toFixed(1)}%`;
  return {
    light:{evidence:`全画面平均亮度 ${pct(s.mean)}，近白 ${pct(s.brightClip)}、近黑 ${pct(s.darkClip)}。`,condition:'以接近中间亮度为启发式参照；夜景、剪影、高调与低调照片不应追求这个分数。'},
    highlights:{evidence:`接近白色的像素占 ${pct(s.brightClip)}。`,condition:'亮背景、灯光和太阳可能本来就接近白色；占比不能证明细节丢失，也不能推断 RAW 的可恢复空间。'},
    shadows:{evidence:`接近黑色的像素占 ${pct(s.darkClip)}。`,condition:'剪影与深背景可以有意保留；只有影响你要呈现的内容时才考虑提亮。'},
    color:{evidence:`平均通道色差 ${pct(s.saturation)}，红蓝偏差 ${(s.warmth*100).toFixed(1)}%。`,condition:'只描述颜色分布，不能识别肤色准确性；黑白、淡彩、浓郁色彩各有合适的表达。'},
    contrast:{evidence:`亮度标准差 ${pct(s.deviation)}。`,condition:'这项参考偏向中等光比；雾、柔光或强烈明暗关系未必需要补偿。'},
    detail:{evidence:'根据相邻像素亮度差与明暗端点占比估计。',condition:'纹理和噪点都会增加边缘差；请在 100% 查看眼睛、头发和背景，不能把这个分数当成清晰度测量。'}
  };
}
export function buildStatisticalAssessment(before,after,{crop=null,failed=false}={}) {
  const change=(key,label)=>{const d=(after.stats[key]-before.stats[key])*100;return `${label}${Math.abs(d)<.05?'基本不变':`${d>0?'增加':'减少'} ${Math.abs(d).toFixed(1)} 个百分点`}`;};
  return {before:before.metrics,after:after.metrics,beforeEvidence:statisticalEvidence(before),afterEvidence:statisticalEvidence(after),source:'local',failed,
    summary:failed?'视觉复评未完成；以下是同一套本地统计的原片与当前效果对照。':'本地光色对照已更新。数值变化不等于审美改善，需结合表达目的判断。',
    improvements:[],tradeoffs:[{finding:crop?`裁剪保留 ${Math.round(crop.width*crop.height*100)}% 的画幅${crop.angle ? `，并拉直 ${crop.angle}°（会进一步收掉边缘）`: ''}。`:'明暗与色彩分布已变化。',evidence:[change('mean','平均亮度'),change('brightClip','近白占比'),change('darkClip','近黑占比'),change('saturation','平均色差')].join('；')+'。',condition:crop?'裁剪前后统计覆盖不同内容；请确认主体、光源和叙事元素未被切掉。':'统计无法判断这些变化是否更好，尤其是有意的低调、高调和黑白表达。'}],preserved:[],
    observation:'打开 100% 对照检查高光过渡、眼睛或纹理、暗部噪点；主体关系、视觉秩序与情绪需视觉审片或你自己确认。'};
}
