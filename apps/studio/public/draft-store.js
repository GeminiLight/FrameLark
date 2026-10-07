import {adjustmentKeys,renderingVersion} from './editor-engine.js';
import {cleanIntent} from './creative-intent.js';
import {validCrop} from './crop-utils.js';
import {validateDocument} from './edit-stack/document.js';
export const draftVersion=2;
export const supportedDraftVersions=[1,2];
const fields=['editDocument','documentSource','toolRuns','sourceOriginalBlob','originalFileName','imageName','creativeIntent','analysisIntent','subject','subjectSource','analysis','active','manual','advisorLayers','crop','compare','annotations','presetId','presetAmount','analysisSource','analysisStatus','analysisError','analysisProvenance','originalRecommendations','assessment','exported','lastExportSignature','history','conversation','versions','agentFallback','agentDraft','agentFocusId','acceptedSignature','acceptedRecordId'];
export function serializeDraftPhoto(photo) {
  // An unsynchronized file edit still needs a recoverable browser copy.
  if(photo.isDemo || photo.projectId&&!photo.projectPending || !(photo.originalBlob instanceof Blob)) return null;
  const result={id:photo.id,originalBlob:photo.originalBlob};
  for(const key of fields) result[key]=structuredClone(key==='active' ? [...photo.active] : photo.editGestureBefore&&key==='editDocument'?photo.editGestureBefore.editDocument:photo[key]);
  return result;
}
export function restoreDraftPhoto(saved) {
  if(!saved || !(saved.originalBlob instanceof Blob) || !saved.originalBlob.size || !Array.isArray(saved.active) || !Array.isArray(saved.annotations)) throw new Error('草稿中的照片或编辑记录不完整');
  const safePoint=point=>point && ['x','y'].every(key=>Number.isFinite(point[key]) && point[key]>=0 && point[key]<=1);
  const safeMask=item=>(item.exclude===undefined || Array.isArray(item.exclude)&&item.exclude.length<=8&&item.exclude.every(r=>r&&Number.isFinite(r.x)&&Number.isFinite(r.y)&&Number.isFinite(r.width)&&Number.isFinite(r.height)&&r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1.0001&&r.y+r.height<=1.0001)) && (!item.maskType || ['rectangle','linear','radial','brush'].includes(item.maskType)) && (item.feather===undefined || Number.isFinite(item.feather) && item.feather>=0 && item.feather<=1) && (item.maskType!=='brush' || Array.isArray(item.points) && item.points.length>0 && item.points.length<=600 && item.points.every(safePoint) && Number.isFinite(item.brushRadius) && item.brushRadius>0 && item.brushRadius<=.15) && (item.maskType!=='linear' || safePoint(item.start) && safePoint(item.end));
  const safeNote=item=>item && safeMask(item) && item.rect && ['x','y','width','height'].every(key=>Number.isFinite(item.rect[key])) && item.rect.x>=0 && item.rect.y>=0 && item.rect.width>0 && item.rect.height>0 && item.rect.x+item.rect.width<=1.0001 && item.rect.y+item.rect.height<=1.0001 && typeof item.note==='string';
  const safeSnapshot=item=>item && Array.isArray(item.active) && item.manual && typeof item.manual==='object' && Array.isArray(item.annotations) && item.annotations.every(safeNote) && (!item.advisorLayers || Array.isArray(item.advisorLayers)) && (!item.recommendations || Array.isArray(item.recommendations));
  if(!saved.annotations.every(safeNote) || saved.analysis && !Array.isArray(saved.analysis.recommendations) || !saved.manual || typeof saved.manual!=='object') throw new Error('草稿中的编辑记录不完整');
  if(saved.editDocument)validateDocument(saved.editDocument);
  for(const value of [...(saved.history?.past||[]),...(saved.history?.future||[]),...(saved.versions||[]).map(v=>v.snapshot)])if(value?.editDocument)validateDocument(value.editDocument);
  for(const list of [saved.history?.past,saved.history?.future]) if(Array.isArray(list) && list.some(item=>!safeSnapshot(item))) throw new Error('草稿中的历史记录不完整');
  if(Array.isArray(saved.versions) && saved.versions.some(item=>!safeSnapshot(item.snapshot))) throw new Error('草稿中的版本记录不完整');
  const photo={};
  for(const key of fields) photo[key]=structuredClone(saved[key]);
  photo.creativeIntent=cleanIntent(saved.creativeIntent);
  photo.analysisIntent=cleanIntent(saved.analysisIntent);
  photo.imageName=String(saved.imageName || '照片').slice(0,160);
  photo.active=new Set(saved.active);
  photo.manual=Object.fromEntries(adjustmentKeys.map(key=>[key,Number.isFinite(saved.manual?.[key]) ? saved.manual[key]:0]));
  photo.crop=saved.crop ? validCrop(saved.crop):null;
  photo.advisorLayers=Array.isArray(saved.advisorLayers) ? saved.advisorLayers:[];
  photo.history={past:Array.isArray(saved.history?.past) ? saved.history.past.slice(-30):[],future:Array.isArray(saved.history?.future) ? saved.history.future.slice(-30):[]};
  photo.versions=Array.isArray(saved.versions) ? saved.versions.slice(-40):[];
  photo.conversation=Array.isArray(saved.conversation) ? saved.conversation.slice(-24):[];
  if(photo.conversation.at(-1)?.role==='user')photo.conversation.push({role:'status',text:'上次回复未完成，照片与对话已恢复。',requestQuestion:photo.conversation.at(-1).text});
  photo.agentDraft=typeof saved.agentDraft==='string' ? saved.agentDraft.slice(0,800):'';
  photo.agentFocusId=saved.annotations.some(item=>item.id===saved.agentFocusId) ? saved.agentFocusId:null;
  if(['queued','checking','analyzing'].includes(photo.analysisStatus)){photo.analysisStatus='fallback';photo.analysisError={code:'CANCELLED',message:'上次审片未完成，已有结果和调整已恢复，可重新审片。',retryable:true};}
  photo.compare=Number.isFinite(saved.compare) ? saved.compare:50;
  photo.presetAmount=Number.isFinite(saved.presetAmount) ? saved.presetAmount:75;
  return photo;
}
export function buildDraftWorkspace(id,photos,currentPhotoId,series=null) {
  return {id,version:draftVersion,renderingVersion,savedAt:new Date().toISOString(),currentPhotoId,
    photos:photos.map(serializeDraftPhoto).filter(Boolean),series:structuredClone(series),deletedAt:null};
}
export {createDraftStore} from './draft-storage.js';
