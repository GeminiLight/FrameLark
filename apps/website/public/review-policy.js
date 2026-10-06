import { observationLabels } from './vision-review.js';
import {statisticalEvidence} from './diagnosis-explanation.js';
import {cropProtectedRegions} from './photo-geometry.js';
import {assertTintCorrectionDirection} from './control-reference.js';
import { validCrop } from './crop-utils.js';

export const conclusionLabels = {keep:'建议保留原片',adjust:'有明确的调整空间',uncertain:'暂不自动调整'};

// A retention verdict must agree with its evidence and executable actions.
export function validateReviewDecision(review) {
  const decision = review?.conclusion;
  if (!decision || !Object.hasOwn(conclusionLabels,decision.kind) || typeof decision.reason !== 'string' || !decision.reason.trim()) throw new Error('缺少明确的审片结论。');
  const recommendations = review.recommendations;
  const observations = review.observations;
  if (!Array.isArray(recommendations) || recommendations.length > 4 || !observations) throw new Error('审片依据不完整。');
  const hasCrop = review.crop?.needed === true;
  const hasChanges = recommendations.length > 0 || hasCrop;
  if ((decision.kind === 'adjust') !== hasChanges) throw new Error('审片结论与调整建议不一致。');
  if (decision.kind === 'keep' && !['subject','background','light','composition'].every(key => observations[key]?.verdict === 'keep' && observations[key]?.confidence !== 'low')) throw new Error('保留原片的结论缺少完整依据。');
  for (const recommendation of recommendations) {
    const supported = recommendation.observationIds?.some(key => observations[key]?.verdict === 'improve' && ['high','medium'].includes(observations[key]?.confidence));
    const meaningful = Object.entries(recommendation.adjustments || {}).some(([key,value]) => Number.isFinite(value) && Math.abs(value) >= (key === 'exposure' ? .01 : 1));
    if (!supported || !meaningful) throw new Error('调整建议缺少可靠的改善依据。');
    assertTintCorrectionDirection([recommendation.title,recommendation.goal].filter(Boolean).join('。'),recommendation.adjustments?.tint);
  }
  if (hasCrop && (!validCrop(review.crop,{suggestion:true}) || observations.composition?.verdict !== 'improve' || !['high','medium'].includes(observations.composition?.confidence))) throw new Error('裁剪建议缺少可靠的构图依据。');
  if(hasCrop && cropProtectedRegions(review.crop,observations,1,1).length)throw new Error('裁剪可能切到主体或关键光源的观察范围，请重新评估。');
  return {kind:decision.kind,reason:decision.reason.trim().slice(0,320)};
}

export function reviewPresentation(analysis) {
  const decision = analysis?.conclusion || {kind:'uncertain',reason:'当前没有完整的视觉判断，暂不自动改变原片。'};
  const fresh = (analysis?.recommendations || []).filter(item => !item.retained);
  const count = fresh.length + (analysis?.cropRecommendation ? 1 : 0);
  const title = decision.kind === 'adjust' ? count === 1 && analysis?.cropRecommendation && !fresh.length ? '只建议调整构图' : count ? `${count} 处可改善` : '原片的调整建议已保留' : conclusionLabels[decision.kind] || conclusionLabels.uncertain;
  const preserved = Object.entries(analysis?.observations || {}).filter(([,item]) => item.verdict === 'keep').map(([key,item]) => ({key,label:observationLabels[key],finding:item.finding,evidence:item.evidence}));
  return {kind:decision.kind,title,reason:decision.reason,count,fresh,preserved,retainedCount:(analysis?.recommendations || []).filter(item => item.retained).length};
}

const demoObservations = {
  order:{finding:'人物与晨光提供两个视线停留点。',evidence:'左侧人物的暖色与右上晨光形成呼应，远山延续视线。'},
  emotion:{finding:'广阔空间可以支持安静、探索的感觉。',evidence:'人物相对山峦较小，云海与冷暖层次保留距离感；这只是可选的阅读。'},
  subject:{finding:'橙色外套已经让人物从远山中清楚分离。',evidence:'人物处在左侧山脊，衣服暖色与灰蓝色山体形成对照。'},
  background:{finding:'前景、远山与云海保留了完整的空间层次。',evidence:'岩石、山脊和云海由近及远展开，交代了人物所处的环境。'},
  light:{finding:'晨光的暖色与山峦的冷色已经相互呼应。',evidence:'右上方的暖光与灰蓝色山体并置，形成清晨氛围。'},
  composition:{finding:'人物一侧的云海与远山值得留出空间。',evidence:'人物位于左侧，右侧的大幅景色让视线向远方延伸。'}
};

// Pixel statistics cannot tell a deliberate low-key look from an exposure mistake.
export function buildBasicReview(inspection,{isDemo = false} = {}) {
  const stats = inspection.stats;
  const bright = stats.brightClip >= .03;
  const dark = stats.darkClip >= .05;
  const note = bright && dark ? `近白像素约 ${Math.round(stats.brightClip*100)}%，近黑像素约 ${Math.round(stats.darkClip*100)}%。这可能来自画面的强烈光比，需要结合原片确认。` : bright ? `近白像素约 ${Math.round(stats.brightClip*100)}%。可能是明亮背景或高调表达，不能仅凭占比判断过曝。` : dark ? `近黑像素约 ${Math.round(stats.darkClip*100)}%。可能是夜景、剪影或低调表达，不自动提亮阴影。` : '像素统计未显示大面积近白或近黑区域；这不等于已判断主体、背景和构图。';
  return {
    scene:isDemo ? '山地日出 · 示例讲解' : '基于光色的画面分析',
    subject:isDemo ? 'landscape' : 'unclassified',
    summary:isDemo ? '人物、山脊与云海由近及远展开，晨光与灰蓝色远山形成色彩对照。以下保留理由是示例照片的预写讲解。' : note,
    conclusion:isDemo ? {kind:'keep',reason:'人物与环境的关系已经完整。保留远山与云海的空间，以及晨光原有的冷暖对照。'} : {kind:'uncertain',reason:'本地光色统计不能判断这些明暗与色彩是否符合你的表达。暂不提供自动调色或裁剪，可直接导出，也可手动调整。'},
    metricEvidence:statisticalEvidence(inspection),
    observations:isDemo ? Object.fromEntries(Object.entries(demoObservations).map(([key,item]) => [key,{...item,verdict:'keep',confidence:'medium',location:'示例讲解',condition:'以下是这张示例的预写观察；以保留人物与环境关系为目标，不适用于所有照片。',region:null}])) : null,
    observationSource:isDemo ? 'demo' : 'statistics',metrics:inspection.metrics,
    recommendedStyle:null,styleMatches:[],cropRecommendation:null,cropReason:isDemo ? '保留人物一侧的远景空间，当前不需要收紧画幅。' : '本地统计无法判断是否需要裁剪。',recommendations:[],
    lessons:[
      {title:'先分清表达与问题',body:'暗不一定是曝光错误，淡不一定要增色。先判断这些关系是否服务于你想表达的感觉。'},
      {title:'保留有用的空间',body:'留白、环境和主体之间的距离也能叙事。只有边缘确实分散视线时，才值得裁剪。'},
      {title:'把原片作为参照',body:'每次只改变有明确目的的一处。若调整没有带来更合适的表达，保留原片也是完整的决定。'}
    ],
    insight:'修片先决定值得保留什么，再决定是否需要改变。'
  };
}
