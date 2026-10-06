import { presets, stylePreferences } from './presets.js';
import {cleanIntent,intentStylePriority} from './creative-intent.js';
import { tasteAffinity } from './taste-memory.js';

function localReason(preset, stats) {
  const a = preset.adjustments;
  if (a.monochrome && a.grain > 20) return '去掉色彩后，粗颗粒与更深的黑位会强化线条；请检查暗部是否丢失细节。';
  if (a.monochrome && a.fade > 10) return '柔和的银灰能让明暗过渡更安静；请看主体是否仍有足够分离度。';
  if (a.monochrome) return '黑白与适度反差会把注意力放回光线和结构；请检查最亮处是否仍有层次。';
  if (stats.mean > .57 && a.highlights < -10) return '原片亮部偏集中，这组配方会收住高光，保留亮处层次。';
  if (stats.mean < .43 && a.shadows > 8) return '原片暗部偏深，这组配方会轻提阴影，让细节更可读。';
  if (stats.saturation < .23 && a.vibrance > 8) return '原片色彩较克制，可用自然饱和度建立更鲜明的主色。';
  if (stats.saturation > .32 && a.saturation < 0) return '原片色彩已经较丰富，收一点饱和度可让视线更集中。';
  if (stats.deviation < .2 && a.contrast > 8) return '原片明暗差异较柔和，这组配方会建立更清楚的影调层次。';
  if (preset.groups.includes('night')) return '冷暖光与更深的黑位会塑造夜色氛围；请检查主体是否因此变暗。';
  if (preset.feels.includes('film')) return '柔化黑位与少量颗粒能改变画面的节奏；请比较肤色与阴影是否自然。';
  if (preset.feels.includes('airy')) return '较柔和的对比与色彩会留出呼吸感；请确认主体没有失去重点。';
  return '这组配方会调整原片的色彩关系；请用前后对比判断主色和主体是否更明确。';
}

export function rankStyles({inspection,preference='auto',favorites=[],aiMatches=[],subject='unclassified',preferredSubjects=[],tasteRecords=[],creativeIntent=''} = {}) {
  const stats = inspection?.stats || {mean:.5,deviation:.22,saturation:.23,brightClip:0,darkClip:0};
  const favoriteSet = new Set(favorites);
  const validPreference = stylePreferences.some(item => item.id === preference) ? preference : 'auto';
  const matched = new Map(aiMatches.map((item,index) => [item.id,{...item,rank:index}]));
  return presets.map(preset => {
    const a = preset.adjustments;
    let score = 59;
    if (preset.groups.includes('night')) score += subject==='night' ? 20:stats.mean < .30 && stats.darkClip > .08 ? 8 : -26;
    if (stats.mean >= .54 && preset.feels.includes('airy')) score += 9;
    if (validPreference === 'auto' && stats.saturation > .08 && a.monochrome) score -= 18;
    if (stats.saturation < .14 && preset.feels.includes('vivid')) score -= 10;
    if (stats.saturation >= .32 && preset.feels.includes('vivid')) score += 5;
    if (stats.mean < .43) score += Math.max(0,a.shadows || 0) * .28 + Math.max(0,a.exposure || 0) * 19;
    if (stats.mean > .57) score += Math.max(0,-(a.highlights || 0)) * .22 - Math.max(0,a.exposure || 0) * 25;
    if (stats.saturation < .23) score += Math.max(0,a.vibrance || 0) * .2;
    if (stats.saturation > .32) score += Math.max(0,-(a.saturation || 0)) * .23;
    if (stats.deviation < .2) score += Math.max(0,a.contrast || 0) * .16;
    if (stats.deviation > .28) score += Math.max(0,-(a.contrast || 0)) * .16;
    score -= (stats.brightClip || 0) * Math.max(0,a.exposure || 0) * 70;
    if (validPreference !== 'auto') score += preset.feels.includes(validPreference) ? 28 : -38;
    if (favoriteSet.has(preset.id)) score += 5;
    if (subject !== 'unclassified' && preset.groups.includes(subject)) score += 11;
    if (preferredSubjects.some(item => preset.groups.includes(item))) score += 4;
    const personal = tasteAffinity({records:tasteRecords,preset,inspection,subject});
    score += personal.boost;
    const ai = matched.get(preset.id);
    if (ai) score += [60,45,30][Math.min(ai.rank,2)] || 8;
    const preferenceLabel = stylePreferences.find(item => item.id === validPreference)?.label;
    const prefix = validPreference !== 'auto' && preset.feels.includes(validPreference) ? `符合你偏好的「${preferenceLabel}」；` : '';
    return {
      preset,score,intentPriority:intentStylePriority(preset,creativeIntent),
      reason:(cleanIntent(creativeIntent) ? `围绕「${cleanIntent(creativeIntent)}」；` : prefix + personal.reason) + (ai?.reason || localReason(preset,stats)),
      source:cleanIntent(creativeIntent) ? 'intent' : ai ? ai.source || 'ai' : personal.reason ? 'personal' : 'local'
    };
  }).sort((a,b) => b.intentPriority - a.intentPriority || b.score - a.score || a.preset.name.localeCompare(b.preset.name,'zh'));
}

export function filterStyles(category,favorites=[]) {
  const favoriteSet = new Set(favorites);
  return presets.filter(preset => category === 'all' ||
    (category === 'favorites' ? favoriteSet.has(preset.id) : preset.groups.includes(category)));
}
