import { presetById } from './presets.js';

export const tasteStorageKey = 'guangjian-taste-memory-v1';
const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
const round = (value,digits = 3) => Number((Number(value) || 0).toFixed(digits));
const statKeys = ['mean','deviation','saturation','warmth','brightClip','darkClip'];
const choiceKeys = ['exposure','contrast','highlights','shadows','whites','blacks','vibrance','saturation','warmth','tint','fade','grain','vignette','monochrome'];
const knownSubjects = new Set(['unclassified','landscape','portrait','street','architecture','night','other']);

function cleanStats(stats) {
  return Object.fromEntries(statKeys.map(key => [key,clamp(round(stats?.[key]),key === 'warmth' ? -1 : 0,1)]));
}

function deriveMoods({presetId,adjustments,original,final}) {
  const moods = new Set(presetById(presetId)?.feels || []);
  if (adjustments.monochrome >= 50) moods.add('mono');
  if (adjustments.fade >= 9 || adjustments.grain >= 10) moods.add('film');
  if (final.saturation-original.saturation >= .025) moods.add('vivid');
  if (final.saturation-original.saturation <= -.025 || final.deviation-original.deviation <= -.025) moods.add('airy');
  return [...moods].filter(mood => ['airy','film','vivid','mono'].includes(mood));
}

export function createAcceptedRecord({id,acceptedAt,subject,originalStats,finalStats,presetId,presetAmount,adjustments,crop,localCount = 0,recommendationCount = 0}) {
  const original = cleanStats(originalStats);
  const final = cleanStats(finalStats);
  const choices = Object.fromEntries(choiceKeys.map(key => [key,round(adjustments?.[key],2)]));
  const amount = Number.isFinite(presetAmount) ? clamp(Math.round(presetAmount),0,100) : 75;
  const usedPreset = amount > 0 && presetById(presetId) ? presetId : null;
  return {
    id:String(id || '').slice(0,80),acceptedAt:String(acceptedAt || new Date().toISOString()).slice(0,30),
    subject:knownSubjects.has(subject) ? subject : 'unclassified',
    original,final,presetId:usedPreset,presetAmount:usedPreset ? amount : 0,
    cropCoverage:crop ? clamp(round(crop.width*crop.height),0,1) : 1,
    localCount:clamp(Math.round(localCount)||0,0,8),
    recommendationCount:clamp(Math.round(recommendationCount)||0,0,10),
    adjustments:choices,
    moods:deriveMoods({presetId:usedPreset,adjustments:choices,original,final})
  };
}

export function sanitizeTasteRecords(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value.slice(-60)) {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || !item.original || !item.final) continue;
    seen.add(item.id);
    result.push(createAcceptedRecord({
      id:item.id,acceptedAt:item.acceptedAt,subject:item.subject,originalStats:item.original,finalStats:item.final,
      presetId:item.presetId,presetAmount:item.presetAmount,adjustments:item.adjustments,crop:{width:Number.isFinite(item.cropCoverage) ? item.cropCoverage : 1,height:1},
      localCount:item.localCount,recommendationCount:item.recommendationCount
    }));
  }
  return result;
}

export function summarizeTaste(records) {
  const safe = sanitizeTasteRecords(records);
  const count = safe.length;
  const moodCounts = Object.fromEntries(['airy','film','vivid','mono'].map(id => [id,safe.filter(item => item.moods.includes(id)).length]));
  const practices = {
    composition:safe.filter(item => item.cropCoverage < .95).length,
    light:safe.filter(item => Math.abs(item.adjustments.exposure) >= .05 || Math.abs(item.adjustments.highlights) >= 6 || Math.abs(item.adjustments.shadows) >= 6).length,
    color:safe.filter(item => Math.abs(item.adjustments.vibrance) >= 5 || Math.abs(item.adjustments.saturation) >= 5 || Math.abs(item.adjustments.warmth) >= 5 || item.adjustments.monochrome >= 50).length,
    focus:safe.filter(item => item.localCount > 0 || item.adjustments.vignette >= 8).length
  };
  const average = key => count ? safe.reduce((sum,item) => sum+item.final[key]-item.original[key],0)/count : 0;
  const tendencies = {light:round(average('mean')),contrast:round(average('deviation')),color:round(average('saturation')),warmth:round(average('warmth'))};
  const leadingMood = Object.entries(moodCounts).sort((a,b) => b[1]-a[1])[0];
  return {count,moodCounts,practices,tendencies,leadingMood:leadingMood?.[1] ? leadingMood[0] : null,records:safe};
}

export function tasteAffinity({records,preset,inspection,subject}) {
  const safe = sanitizeTasteRecords(records);
  if (!safe.length) return {boost:0,reason:''};
  const stats = inspection?.stats || {};
  let signal = 0, evidence = 0;
  for (const record of safe) {
    const subjectWeight = record.subject === subject && subject !== 'unclassified' ? 1.5 : record.subject === 'unclassified' ? .55 : .8;
    const lightDistance = Number.isFinite(stats.mean) ? Math.abs(record.original.mean-stats.mean) : .2;
    const colorDistance = Number.isFinite(stats.saturation) ? Math.abs(record.original.saturation-stats.saturation) : .15;
    const conditionWeight = lightDistance < .16 && colorDistance < .15 ? 1 : .5;
    const weight = subjectWeight*conditionWeight;
    let affinity = record.presetId === preset.id ? 1 : 0;
    const sharedMoods = record.moods.filter(mood => preset.feels.includes(mood)).length;
    affinity += Math.min(1,sharedMoods*.55);
    if (!affinity) continue;
    signal += weight*affinity;
    evidence += weight;
  }
  const confidence = Math.min(1,safe.length/4);
  const boost = Math.min(16,round(signal*5*confidence,1));
  return {boost,reason:boost >= 2 ? `与你定稿过的${evidence >= 1.4 ? '相近题材' : '作品'}影调接近；` : ''};
}

export function rememberedStyleAmount(records,presetId,subject) {
  const matching = sanitizeTasteRecords(records).filter(item => item.presetId === presetId);
  if (!matching.length) return null;
  const relevant = matching.filter(item => item.subject === subject);
  const pool = relevant.length ? relevant : matching;
  return clamp(Math.round(pool.reduce((sum,item) => sum+item.presetAmount,0)/pool.length),20,100);
}
