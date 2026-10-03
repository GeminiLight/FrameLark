import {buildBasicReview} from './review-policy.js';
import {retainAppliedRecommendations} from './vision-review.js';

export function onDemandReview(photo,{keepApplied=false}={}) {
  const local=buildBasicReview(photo.originalInspection,{isDemo:photo.isDemo});
  return keepApplied?retainAppliedRecommendations(photo.analysis,local,photo.active):local;
}
export function canPreviewAdvisorResult({source,action,photoId,currentPhotoId,baseSignature,currentSignature,baseIntent,currentIntent,notesChanged=false,dialogOpen=false,draft='',tab='agent'}) {
  return source==='ai'&&action?.kind!=='none'&&Boolean(action?.kind)&&photoId===currentPhotoId&&baseSignature===currentSignature&&baseIntent===currentIntent&&!notesChanged&&!dialogOpen&&!draft.trim()&&tab==='agent';
}
