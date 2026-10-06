import {createStyleThumbnails,renderPresetTrial} from './style-thumbnails.js';
import {toolStateFromSnapshot,toolRunCandidate,requestToolRun} from './photo-tool-client.js';
import {photoTools} from './photo-tools/registry.js';
import {exchangeSchema,exchangeFormatFor,validateExchange,restoreWebExchange} from './project-exchange.js';
import {onDemandReview,canPreviewAdvisorResult} from './photo-first-policy.js';
import {preparePhotoFile} from './import-conversion.js';
import {createProjectWorkspace} from './project-workspace.js';
import {bindActivePhotoState} from './photo-state.js';
import {createEditStackController} from './edit-stack-controller.js';
import {createDocument} from './edit-stack/document.js';
import {documentHash,renderHash} from './edit-stack/identity.js';
import {applyCommands} from './edit-stack/commands.js';
import {compileDocumentProposal} from './edit-stack/proposals.js';
import {validatePlannerAction,legacyIntentProposal} from './edit-stack/planner.js';
import {createEditStackView} from './edit-stack-view.js';
import {pixelCapabilities} from './edit-stack/tools.js';
import {presetCommands,presetTrial} from './edit-stack/styles.js';
import {workspacePatch,snapshotFromProject,editionsFromProject,workspaceEditions,rememberExportVersion} from './project-snapshot.js';
import {readVisionStream,partialReply} from './vision-stream.js';
import {defaultModelTiers,tierNames,modelEffortChoices} from './model-routing.js';
import {importLimits,importAccept,runImportBatch,loadPhotoImage,PhotoImportError} from './photo-import.js';
import {enhanceSelectControls} from './select-control.js?v=3';
import {readServiceJSON,requestFailure} from './service-response.js';
import {attachmentContext,createAnnotationPeek} from './annotation-attachments.js?v=1';
import {snapshotAnnotations,annotationsChanged} from './advisor-context.js';
import {photoPhase,editorTab,inspectionVisibility,panelGuidance} from './workspace-flow.js?v=2';
import {createStyleAudition} from './style-audition.js';
import {shortcutAction,photoNavigationIndex,editableTarget,readerPosition} from './editor-navigation.js?v=2';
import {drawPhotoSource,viewToOriginalPoint,originalToViewPoint,transformRect,ratioCrop,resizeRatioCrop,straightenTransform,cropProtectedRegions} from './photo-geometry.js';
import {maskWeight,maskTypes,brushBounds} from './local-masks.js';
import {cleanIntent,describeIntent,styleSelections} from './creative-intent.js';
import {advisorCandidate,suggestionCandidate,previewStillValid,actionExplanation,scalablePreview,scalePreview} from './advisor-candidate.js';
import {createPhotoViewer} from './photo-viewer.js';
import {createDraftStore,buildDraftWorkspace,restoreDraftPhoto,draftVersion,supportedDraftVersions} from './draft-store.js';
import {createDraftAutosave} from './draft-autosave.js';
import { adjustmentKeys, neutralSettings, combineSettings, renderPixels,renderingVersion } from './editor-engine.js';
import { presets, presetById, styleCategories, stylePreferences } from './presets.js';
import {normalizeMetricEvidence,normalizeAssessment,statisticalEvidence,buildStatisticalAssessment} from './diagnosis-explanation.js';
import {createPhotoRequests} from './photo-requests.js';
import {photoMetering} from './photo-metering.js';
import {photoToolTrials} from './review-calibration.js';
import {retryReview} from './review-retry.js';
import {reviewContext,reviewBaseline} from './review-context.js';
import { inspectPixels, metricLabels } from './diagnostics.js';
import { rankStyles, filterStyles } from './style-matcher.js';
import { validCrop, cropPixelRect, cropPixels } from './crop-utils.js';
import { photoSubjects, subjectLabel, validSubject, summarizeWorkspace } from './workspace-profile.js';
import { localDesignReply, normalizeDesignReply } from './design-agent.js?v=7';
import { rectFromPoints, viewToImageRect, imageToViewRect, measureRegion } from './annotations.js';
import {renderPhotoPixels,createPhotoRenderer} from './photo-rendering.js';
import {createPhotoExporter} from './photo-export.js';
import {globalAdjustments,effectiveAnnotations,adjustmentSignature,remainingAdjustments,hasLocalEffects} from './adjustment-layers.js';
import {createTaskQueue,latestReviewTask,elapsedReview,unresolvedFailure} from './task-queue.js';
import {syncGroups,photoSnapshot,snapshotSettings,planSync,planStyle} from './batch-edits.js';
import {createSeriesWorkspace} from './series-workspace.js';
import {outputGeometry,exportPresets,exportLimits,safeFilename,printCentimeters} from './export-settings.js';
import {createPhotoArchive} from './export-files.js';
import {buildToneCurve,mapTone} from './tone-processing.js';
import { buildBasicReview, validateReviewDecision, reviewPresentation } from './review-policy.js';
import { observationLabels, verdictLabels, normalizeObservations, reviewSourceLabel, normalizeVisionFailure, retainAppliedRecommendations } from './vision-review.js';
import { tasteStorageKey,createAcceptedRecord,sanitizeTasteRecords,summarizeTaste,rememberedStyleAmount } from './taste-memory.js?v=2';

let studioTab='agent',workspaceSpace='studio',nextPanelAction=null;
const inspectorPositions={diagnosis:0,adjust:0,presets:0};
let slidersInitialized=false;

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  book: '<path d="M12 7c-2.3-1.7-5-2-9-1v13c4-1 6.7-.7 9 1 2.3-1.7 5-2 9-1V6c-4-1-6.7-.7-9 1Z"/><path d="M12 7v13"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  sparkles: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/><path d="m19 17 .7 2.3L22 20l-2.3.7L19 23l-.7-2.3L16 20l2.3-.7L19 17Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 0 1 4.7 1.1c0 1.8-2.4 2.2-2.4 3.6"/><path d="M12 17h.01"/>',
  user: '<circle cx="12" cy="8" r="3.3"/><path d="M5.5 20c.5-3.4 2.8-5.1 6.5-5.1s6 1.7 6.5 5.1"/>',
  upload: '<path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-2"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h2"/>',
  chevrons: '<path d="m10 8-4 4 4 4"/><path d="m14 8 4 4-4 4"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  'arrow-right': '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
  scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/><circle cx="12" cy="12" r="3"/>',
  lightbulb: '<path d="M9 18h6m-5 3h4M8 14c-1.4-1.1-2-2.6-2-4a6 6 0 0 1 12 0c0 1.4-.6 2.9-2 4-.8.6-1 1.4-1 2H9c0-.6-.2-1.4-1-2Z"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M5 5 19 19M19 5 5 19"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  palette: '<circle cx="12" cy="12" r="9"/><path d="M7 8h.01M12 6h.01M17 8h.01M6 13h.01"/><path d="M15 17c0-1.4 1-2 2-2h3"/>',
  sliders: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="9" cy="5" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="19" r="2" fill="currentColor" stroke="none"/>',
  settings: '<path d="m9.5 3-.6 2.2-2 .9-2.1-.6-2 3.5 1.6 1.6v2.8l-1.6 1.6 2 3.5 2.1-.6 2 .9.6 2.2h5l.6-2.2 2-.9 2.1.6 2-3.5-1.6-1.6v-2.8l1.6-1.6-2-3.5-2.1.6-2-.9-.6-2.2Z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  focus: '<circle cx="12" cy="12" r="3"/><path d="M3 9V5a2 2 0 0 1 2-2h4m6 0h4a2 2 0 0 1 2 2v4m0 6v4a2 2 0 0 1-2 2h-4m-6 0H5a2 2 0 0 1-2-2v-4"/>',
  crop: '<path d="M6 2v15a1 1 0 0 0 1 1h15M2 6h15a1 1 0 0 1 1 1v15"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  message: '<path d="M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3Z"/><path d="M8 8h8M8 12h5"/>',
  trend: '<path d="M4 4v16h16M7 15l4-5 4 2 5-7"/>',
  history: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v5l3 2"/>'
};

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const shape = icons[el.dataset.icon];
    if (shape) el.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shape}</svg>`;
  });
}
hydrateIcons();

const $ = selector => document.querySelector(selector);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
enhanceSelectControls(document);
const defaults = neutralSettings();
const stackStyles=document.createElement('link');stackStyles.rel='stylesheet';stackStyles.href='/edit-stack.css';document.head.append(stackStyles);
const photoRenderer = createPhotoRenderer();
let renderRevision = 0,renderedFrameKey=null,renderedEffectKey=null;
let editStack=null,stackDrawing=null;
let cachedCropPreview=null;
const draftStore=createDraftStore();
const draftAutosave=createDraftAutosave({capture:captureDraftSnapshot,save:snapshot=>draftStore.save(snapshot),onState:renderDraftStatus});
const photoViewer=createPhotoViewer($('#viewer-dialog'));
let advisorPreviewReady=false;
const advisorViewer=createPhotoViewer($('#advisor-preview-dialog'),{prefix:'advisor-preview',onState:status=>{advisorPreviewReady=status==='ready';if(status==='ready'&&pendingAdvisorPreview?.toolRun&&!pendingAdvisorPreview.toolPending){const label=$('#advisor-tool-status');if(label)label.textContent=`${pendingAdvisorPreview.toolRun.records.length} 个工具步骤已完成，可以比较后应用。`;}updateAdvisorAccept();}});
const advisorRequests=createPhotoRequests(),reassessmentRequests=createPhotoRequests();
let reassessmentRequest=null;
let exportAfterPreview=null;
let pendingAdvisorPreview=null,collectionPresetId=null,collectionGeneration=0,collectionHolding=false,collectionHoverId=null;
const collectionAmounts=new Map(),collectionRenderer=createPhotoRenderer();
let collectionPixels=Promise.resolve();
const thumbnailRenderer=createPhotoRenderer();
const styleThumbnails=createStyleThumbnails({
  renderer:thumbnailRenderer,
  encode:(pixels,width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(pixels,width,height),0,0);const result=canvas.toDataURL('image/jpeg',.9);canvas.width=canvas.height=0;return result;},
  isCurrent:request=>request.photoId===currentPhotoId&&request.image===state.image&&request.signature===presetThumbnailSignature(),
  onThumbnail:(src,id)=>{for(const image of document.querySelectorAll(`[data-preset="${id}"] img`)){image.src=src;image.closest('[data-preset]').querySelector('.style-audition-toggle em')?.replaceChildren('预览');}},
  onReady:(results,request)=>{const photo=currentPhoto();if(photo?.id!==request.photoId)return;photo.presetThumbs=results;for(const image of document.querySelectorAll('[data-preset] img')){const id=image.closest('[data-preset]').dataset.preset;if(results[id])image.src=results[id];}},
  onError:()=>{$('#style-audition-help').textContent='部分风格缩略图未能更新，重新打开风格库即可重试。';}
});
window.addEventListener('pagehide',()=>styleThumbnails.dispose(),{once:true});
const auditionRenderer=createPhotoRenderer();
let auditionTimer=null,keyboardInteraction=false,agentThreadPhoto=null;
const agentReading=new Map();
const styleAudition=createStyleAudition({
  context:()=>state.image && !state.loading ? {photoId:currentPhotoId,signature:currentEffectSignature(),snapshot:editSnapshot(),image:state.image,source:currentPreviewPixels()}:null,
  render:async(snapshot,captured)=>{
    const version=viewerVersion(snapshot,'audition','预览'),source=captured.source,image=captured.image;
    const pixels=await renderPresetTrial(auditionRenderer,{pixels:source.data,width:source.width,height:source.height,settings:version.settings,annotations:version.annotations,crop:snapshot.crop,document:version.document,
      frame:{fullWidth:image.naturalWidth,fullHeight:image.naturalHeight,sourceRect:cropPixelRect(snapshot.crop,image.naturalWidth,image.naturalHeight),angle:snapshot.crop?.angle || 0}},snapshot.styleTrial);
    return {pixels,width:source.width,height:source.height,canApply:snapshot.styleTrial?.canApply!==false};
  },
  onState:({phase,styleId,amount,output})=>{
    const active=phase!=='idle',ready=phase==='ready',canvas=$('#style-audition-canvas');
    $('#style-audition-strip').hidden=!active;canvas.hidden=!ready;
    $('#photo-stage').classList.toggle('auditioning',active);
    $('#photo-stage').classList.toggle('audition-ready',ready);
    $('#style-audition-label').textContent=active ? `${presetById(styleId)?.name} · ${amount}%${phase==='loading' ? ' · 正在预览…':phase==='failed' ? ' · 未能预览，请重试':''}`:'';
    $('#style-audition-note').textContent=output?.canApply===false ? '步骤已达上限 · 整理步骤后可应用':phase==='failed' ? '当前版本仍然保留':innerWidth<=600 ? '当前版本未变':'正在预览 · 尚未应用';
    $('#style-audition-open').textContent=innerWidth<=600 ? '调节强度 ↗':'调整与应用 ↗';
    if(ready){canvas.width=output.width;canvas.height=output.height;canvas.getContext('2d').putImageData(new ImageData(output.pixels,output.width,output.height),0,0);}
    document.querySelectorAll('.style-audition-toggle').forEach(button=>button.setAttribute('aria-pressed',String(active && button.closest('[data-preset]').dataset.preset===styleId)));
  }
});
function endStyleAudition(){clearTimeout(auditionTimer);auditionTimer=null;if(styleAudition.active)styleAudition.end();}
function startStyleAudition(id,mode){
  clearTimeout(auditionTimer);
  if(state.renderPending || document.querySelector('dialog[open]') || !presetById(id))return;
  const amount=state.presetId===id ? state.presetAmount:rememberedStyleAmount(tasteRecords,id,currentPhoto()?.subject) ?? 75;
  setMarkingPhoto(false);hideComparisonPopover();styleAudition.start(id,amount,mode);
}
let versionSelections=[];
let maskTool='rectangle',showLocalMask=false;
let draftWorkspaceId=crypto.randomUUID();
let draftRestoring=false,draftTransition=false,draftList=[];
let pendingDraftDeleteId=null;
let draftListFailed=false;

const sliderSpecs = [
  {key:'exposure',label:'曝光',group:'light',min:-1.5,max:1.5,step:.01,unit:' EV'},
  {key:'contrast',label:'对比度',group:'light',min:-50,max:50,step:1,unit:''},
  {key:'highlights',label:'高光',group:'light',min:-50,max:50,step:1,unit:''},
  {key:'shadows',label:'阴影',group:'light',min:-50,max:50,step:1,unit:''},
  {key:'whites',label:'白色色阶',group:'light',min:-50,max:50,step:1,unit:''},
  {key:'blacks',label:'黑色色阶',group:'light',min:-50,max:50,step:1,unit:''},
  {key:'curveShadows',label:'暗调曲线',group:'curve',min:-50,max:50,step:1,unit:''},
  {key:'curveMidtones',label:'中间调曲线',group:'curve',min:-50,max:50,step:1,unit:''},
  {key:'curveHighlights',label:'亮调曲线',group:'curve',min:-50,max:50,step:1,unit:''},
  {key:'warmth',label:'色温',group:'color',min:-75,max:75,step:1,unit:''},
  {key:'tint',label:'色调',group:'color',min:-75,max:75,step:1,unit:''},
  {key:'vibrance',label:'自然饱和度',group:'color',min:-50,max:50,step:1,unit:''},
  {key:'saturation',label:'饱和度',group:'color',min:-50,max:50,step:1,unit:''},
  {key:'orangeHue',label:'橙 · 色相',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'orangeSaturation',label:'橙 · 饱和度',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'orangeLuminance',label:'橙 · 明度',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'greenHue',label:'绿 · 色相',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'greenSaturation',label:'绿 · 饱和度',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'greenLuminance',label:'绿 · 明度',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'blueHue',label:'蓝 · 色相',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'blueSaturation',label:'蓝 · 饱和度',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'blueLuminance',label:'蓝 · 明度',group:'mixer',min:-50,max:50,step:1,unit:''},
  {key:'texture',label:'纹理',group:'effects',min:-50,max:50,step:1,unit:''},
  {key:'clarity',label:'清晰度',group:'effects',min:-50,max:50,step:1,unit:''},
  {key:'dehaze',label:'去朦胧',group:'effects',min:-50,max:50,step:1,unit:''},
  {key:'fade',label:'褪色',group:'effects',min:0,max:50,step:1,unit:''},
  {key:'vignette',label:'暗角',group:'effects',min:0,max:50,step:1,unit:''},
  {key:'grain',label:'颗粒',group:'effects',min:0,max:40,step:1,unit:''},
  {key:'sharpen',label:'锐化',group:'detail',min:0,max:50,step:1,unit:''},
  {key:'denoise',label:'降噪',group:'detail',min:0,max:50,step:1,unit:''}
];
const controlGroups = [
  {id:'light',name:'光线',description:'曝光与明暗端点'},
  {id:'curve',name:'曲线',description:'精细塑造暗调、中间调、亮调'},
  {id:'color',name:'色彩',description:'白平衡与整体饱和度'},
  {id:'mixer',name:'色彩混合',description:'分别控制橙、绿、蓝'},
  {id:'effects',name:'效果',description:'纹理、去雾与暗角'},
  {id:'detail',name:'细节',description:'锐化与噪点控制'}
];
const metricKeys = Object.keys(metricLabels);
const settingLabels = Object.fromEntries(sliderSpecs.map(item => [item.key, item.label]));
function savedStylePreferences() {
  try {
    const preference = localStorage.getItem('guangjian-style-preference');
    const favorites = JSON.parse(localStorage.getItem('guangjian-style-favorites') || '[]');
    return {
      preference:stylePreferences.some(item => item.id === preference) ? preference : 'auto',
      favorites:new Set(Array.isArray(favorites) ? favorites.filter(id => presetById(id)) : [])
    };
  } catch { return {preference:'auto',favorites:new Set()}; }
}
const savedStyles = savedStylePreferences();
function loadPersonalProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem('guangjian-personal-profile') || '{}');
    return {
      name:typeof saved.name === 'string' ? saved.name.trim().slice(0,20) : '',
      subjects:Array.isArray(saved.subjects) ? saved.subjects.filter(id => photoSubjects.some(item => item.id === id && id !== 'unclassified')).slice(0,6) : []
    };
  } catch { return {name:'',subjects:[]}; }
}
const personalProfile = loadPersonalProfile();
function loadTasteRecords() {
  try { return sanitizeTasteRecords(JSON.parse(localStorage.getItem(tasteStorageKey) || '[]')); }
  catch { return []; }
}
let tasteRecords = loadTasteRecords();
let profileView = 'overview';


const state = {
  image: null, imageName:'清晨的山脊', isDemo:true, creativeIntent:'',analysisIntent:'',
  previewSource:null, previewData:null, analysis:null,
  advisorLayers:[], active:new Set(), manual:{...defaults}, crop:null, compare:50, annotations:[],
  presetId:null, presetAmount:75, presetThumbs:{},
  stylePreference:savedStyles.preference,styleCategory:'all',favoritePresets:savedStyles.favorites,
  aiAvailable:false, aiModel:'', visionConfigurationEditable:true, analysisSource:'local',analysisStatus:'idle',analysisError:null,analysisProvenance:null, analyzing:false, renderPending:false,renderFailed:false, loading:false, loadingPurpose:'photo',
  originalInspection:null, originalRecommendations:null, assessment:null, assessmentBusy:false, exported:false
};

const originalImage = $('#original-image');
const editedCanvas = $('#edited-canvas');
const fileInput = $('#file-input');
const toast = $('#toast');
let toastTimer;
const photoSessions = [];
let currentPhotoId = null;
bindActivePhotoState(state,currentPhoto);
let analysisController = null;
let selectedEvidenceKey = null;
let visionConfigController = null;
let visionConfigBusy = false;
let nextPhotoId = 1;
let pendingCloseId = null;
let pendingCloseAfterExportId = null;
let importingFiles = false;
let importRows=[],importController=null,importSequence=0;
fileInput.accept=importAccept;
let libraryFilter = 'all';
let librarySelecting=false;
const selectedPhotos=new Set();
let exportPhotoIds=[],exportGroup=0,lastBatch=null;
const analysisQueue=createTaskQueue({concurrency:2,onChange:taskChanged});
const exportQueue=createTaskQueue({concurrency:1,onChange:taskChanged});
let analysisGeneration = 0;
let reassessGeneration = 0;
let markingPhoto = false;
let annotationDrag = null;
let selectedAnnotationId = null;
let annotationNoteBefore = null;
let nextAnnotationId = 1;
const editHistory = {past:[],future:[],range:null};
const seriesWorkspace=createSeriesWorkspace({
  getPhotos:()=>{commitPhotoInputs({finish:false});return photoSessions;},onChange:()=>scheduleDraftSave(),notify:showToast,
  canOpen:()=>!importingFiles&&!state.loading,
  onEdit:id=>activatePhoto(id),onExport:ids=>openExportDialog(ids),
  onAccept:plans=>{
    commitPhotoInputs();const changed=[];
    for(const plan of plans)if(commitPhotoSnapshot(plan.photo,plan.candidate,plan.before)){
      changed.push({id:plan.photo.id,before:plan.before,after:photoSnapshot(plan.photo)});
      plan.photo.versions ||= [];if(plan.photo.versions.length<40)plan.photo.versions.push({id:crypto.randomUUID(),kind:'manual',label:'组图调整前',at:new Date().toISOString(),signature:snapshotAcceptanceSignature(plan.before),snapshot:structuredClone(plan.before)});
    }
    if(changed.length)lastBatch=changed;
    scheduleDraftSave();renderPhotoTabs();showToast(changed.length?`已应用 ${changed.length} 张的组图调整，可逐张精调或整组撤销。`:'已保留这组照片的当前光色。');
  }
});

const projectWorkspace=createProjectWorkspace({
  getPhoto:currentPhoto,getPhotos:()=>photoSessions,
  getPatch:photo=>{commitPhotoInputs({finish:false});return workspacePatch(photoSnapshot(photo),{intent:photo.creativeIntent,conversation:photo.conversation});},
  getVersions:(photo,options)=>workspaceEditions(photo.versions||[],options),
  onVersions:syncSharedEditions,onOpenVersions:openEditions,
  onLoad:async(data,existing)=>{
    let photo=existing;
    if(!photo){
      if(photoSessions.length>=12)throw new Error('最多打开 12 张照片，请先移出一张。');
      if(photoSessions.reduce((sum,p)=>sum+p.image.naturalWidth*p.image.naturalHeight,0)+data.source.width*data.source.height>100_000_000)throw new Error('工作区照片总尺寸接近上限，请先移出部分照片。');
      const [response,original]=await Promise.all([fetch(`/api/projects/${data.id}/source`),fetch(`/api/projects/${data.id}/original`)]);
      if(!response.ok||!original.ok)throw new Error('项目原片无法读取。请恢复项目文件后重试，已有编辑保留。');
      const [blob,raw]=await Promise.all([response.blob(),original.blob()]);
      photo=await addPhotoSource(URL.createObjectURL(blob),data.name,false,false,blob,{strict:true});photo.sourceOriginalBlob=raw;
    }
    await applySharedProject(photo,data);if(currentPhotoId!==photo.id)activatePhoto(photo.id);return photo;
  },onUpdate:applySharedProject,onState:()=>scheduleDraftSave(),notify:showToast
});
function syncSharedEditions(photo,data){
  const saved=editionsFromProject(data).map(v=>({...v,signature:snapshotAcceptanceSignature(v.snapshot)}));
  const known=new Set(data.versions.map(v=>v.id));
  photo.versions=[...saved,...(photo.versions||[]).filter(v=>v.kind!=='original'&&!known.has(v.id))];
  if(currentPhotoId===photo.id){renderVersions();if($('#versions-dialog').open)renderEditions();}
}

editStack=createEditStackController({root:$('#edit-stack-mount'),getPhoto:currentPhoto,
  prepareDocument:async photo=>{
    if(photo.projectData?.documentContext)return structuredClone(photo.projectData.documentContext);
    const blob=photo.sourceOriginalBlob||photo.originalBlob||(photo.isDemo?await(await fetch(photo.src)).blob():null);if(!blob)throw new Error('原片还没有准备好，请重新读取后重试。');
    const checksum=await digestPhoto(new Uint8Array(await blob.arrayBuffer())),patch=workspacePatch(photoSnapshot(photo));
    return createDocument({documentId:'doc-'+photo.id,source:{assetId:photo.id,contentHash:checksum,width:photo.image.naturalWidth,height:photo.image.naturalHeight},base:{settings:patch.settings,style:patch.style,crop:patch.crop,locals:patch.annotations.filter(a=>a.hasLocal).map(a=>({...a,localSettings:a.localSettings||{}}))}});
  },
  getSnapshot:photo=>({...photoSnapshot(photo),projectVersionId:photo.projectCurrentId}),
  setSnapshot:(photo,snapshot)=>{if(photo===currentPhoto())restoreEdit(snapshot,{gesture:true});else Object.assign(photo,{editDocument:structuredClone(snapshot.editDocument||null),manual:{...snapshot.manual},crop:structuredClone(snapshot.crop),active:new Set(snapshot.active),advisorLayers:structuredClone(snapshot.advisorLayers),presetId:snapshot.presetId,presetAmount:snapshot.presetAmount,annotations:structuredClone(snapshot.annotations)});},
  onChange:photo=>{photo.active=new Set();photo.advisorLayers=[];photo.assessment=null;photo.exported=false;if(photo===currentPhoto()){sizePhotoStage();scheduleRender();refreshActions();}},
  onBusy:photo=>{if(photo===currentPhoto())refreshActions();},
  onHistory:(photo,before)=>{if(photo===currentPhoto())saveEdit(before);else{photo.history.past.push(before);photo.history.future=[];}scheduleDraftSave();},
  persist:async(photo,{proposal,document:recipe,snapshot,signal,retrying})=>{
    if(!photo.projectId)return recipe;
    if(retrying){const recovered=await projectWorkspace.recoverDocument(photo,proposal.requestId,documentHash(recipe),{signal});if(recovered)return recovered;}
    const made=await projectWorkspace.proposeDocument(photo,proposal,{signal});if(documentHash(made.document)!==documentHash(recipe))throw new Error('网页与文件项目的配方结果不一致，请重新预览。');
    await projectWorkspace.renderDocumentPreview(photo,made.token,{signal});
    const data=await projectWorkspace.accept(photo,made.token,workspacePatch(snapshot,{intent:photo.creativeIntent,conversation:photo.conversation}),{signal});return data.document;
  },
  onError:(message,photo)=>{if(photo===currentPhoto())showToast(message);scheduleDraftSave();},
  onDiscuss:(id,photo)=>{selectTab('agent');$('#agent-input').placeholder='说明想怎么修改选中的步骤…';renderAgent();$('#agent-input').focus();},
  onDraw:(shape,id,operation)=>{stackDrawing={shape,stepId:id,operation,photoId:currentPhotoId};maskTool=shape;localToolCreating=false;setMarkingPhoto(true);showToast(`在照片上拖动绘制${maskTypes[shape]}，只改变选中步骤的范围。`);},
  onLegacy:()=>{const photo=currentPhoto();if(photo){photo.editLegacy=!photo.editLegacy;renderSliders();refreshActions();}}
});
$('#edit-stack-start').addEventListener('click',()=>editStack.command([{type:'AddStep',step:{id:'step-'+crypto.randomUUID(),title:'提亮暗处',tool:'exposure',toolVersion:2,parameters:{ev:0}}}]));
function applySharedProject(photo,data,{force=false}={}) {
  syncSharedEditions(photo,data);
  const meaningful=value=>JSON.stringify([value.currentId,value.current,value.intent,value.notes.map(({id,note,rect,protect})=>({id,note,rect,protect}))]);
  if(!force&&photo.projectData&&meaningful(photo.projectData)===meaningful(data)){
    if(JSON.stringify(data.conversation)!==JSON.stringify(photo.projectData.conversation)){photo.conversation=data.conversation.map(m=>({...m,id:m.id||crypto.randomUUID()}));if(currentPhotoId===photo.id)renderAgent();}
    photo.projectData=data;return;
  }
  const snapshot=snapshotFromProject(data);
  advisorRequests.cancel(photo.id,'project-updated');photo.agentBusy=false;
  Object.assign(photo,{toolRuns:snapshot.toolRuns,manual:snapshot.manual,active:new Set(),advisorLayers:[],crop:snapshot.crop,presetId:snapshot.presetId,presetAmount:snapshot.presetAmount,annotations:snapshot.annotations,
    editDocument:snapshot.editDocument,creativeIntent:data.intent,conversation:data.conversation.map(m=>({...m,id:m.id||crypto.randomUUID()})),history:{past:[],future:[]},projectId:data.id,projectPath:data.path,projectRevision:data.revision,projectCurrentId:data.currentId,originalFileName:data.name,projectData:data});
  preparePhotoPreview(photo);photo.analysis=analyzeLocal(photo);photo.analysisSource='local';photo.analysisStatus='idle';photo.analysisProvenance=null;photo.originalRecommendations=null;photo.analysisIntent=data.intent;photo.assessment=null;photo.exported=data.exports.some(e=>e.versionId===data.currentId);photo.lastExportSignature=photo.exported?snapshotAcceptanceSignature(photoSnapshot(photo)):'';
  nextAnnotationId=Math.max(nextAnnotationId,...photo.annotations.map(a=>Number(String(a.id).replace('note-',''))+1).filter(Number.isFinite));
  if(currentPhotoId===photo.id){
    if($('#advisor-preview-dialog').open)$('#advisor-preview-dialog').close();
    editHistory.past=[];editHistory.future=[];editHistory.range=null;
    renderSliders();renderAnnotations();renderLocalEditor();renderPresets();renderAnalysis();renderAgent();sizePhotoStage();scheduleRender();refreshActions();
  }
}

function currentPhoto() { return photoSessions.find(photo => photo.id === currentPhotoId); }

function photoHasEdits(photo) {
  if (photo.id === currentPhotoId) return hasEdits();
  return Boolean(photo.editDocument?.steps.length) || photo.advisorLayers.some(item=>!item.annotationId) || photo.active.size > 0 || Boolean(photo.crop) || Boolean(photo.presetId && photo.presetAmount > 0) || adjustmentKeys.some(key => Math.abs(photo.manual[key] || 0) > .001) || hasLocalEffects(photo.annotations,photo.advisorLayers);
}

function photoHasNotes(photo) { return Boolean((photo.id === currentPhotoId ? state.annotations : photo.annotations)?.length || cleanIntent(photo.id === currentPhotoId ? state.creativeIntent:photo.creativeIntent)); }

function commitPhotoInputs({finish=true}={}) {
  // Editing fields already belong to the photo. Commit only pending UI text
  // and the active undo buffer before changing selections or taking a snapshot.
  const photo = currentPhoto();
  if (!photo) return;
  if(finish) {finishAnnotationNote();finishRangeEdit();}
  photo.history = {past:editHistory.past,future:editHistory.future};
}

function syncPhotoTabs() {
  seriesWorkspace.refresh();
  for (const element of document.querySelectorAll('.photo-tab')) {
    const photo = photoSessions.find(item => item.id === element.dataset.photoId);
    if (!photo) continue;
    const active = photo.id === currentPhotoId;
    const edited = photoHasEdits(photo);
    const exported = active ? state.exported : photo.exported;
    element.classList.toggle('active', active);
    element.classList.toggle('dirty', edited && !exported);
    element.classList.toggle('exported', exported);
    const select = element.querySelector('.photo-tab-main');
    select.setAttribute('aria-label', `${photo.imageName}${edited && !exported ? '，有未导出的调整' : exported ? '，已导出' : ''}`);
    if (active) select.setAttribute('aria-current','true'); else select.removeAttribute('aria-current');
    select.tabIndex=active ? 0:-1;
    select.disabled = state.loading;
    element.querySelector('.photo-task-label').textContent=photoTaskLabel(photo);
    const close = element.querySelector('.photo-tab-close');
    if (close) close.disabled = state.loading;
  }
  $('#photo-count').textContent = String(photoSessions.length);
  const activeIndex = photoSessions.findIndex(photo => photo.id === currentPhotoId);
  $('#heading-counter').textContent = activeIndex < 0 ? '00 / 00' : `${String(activeIndex + 1).padStart(2, '0')} / ${String(photoSessions.length).padStart(2, '0')}`;
  $('#add-photo-button').disabled = state.loading || importingFiles || photoSessions.length >= 12;
  if ($('#library-dialog').open) renderLibrary();
  if ($('#profile-dialog').open) renderPersonalProfile();
}

function renderPhotoTabs() {
  const restoreFocus=Boolean(document.activeElement?.closest('#photo-tabs'));
  const scroller = $('.photo-tab-scroll');
  const previousScroll = scroller.scrollLeft;
  $('#photo-tabs').innerHTML = photoSessions.map(photo => `<div class="photo-tab" data-photo-id="${photo.id}"><button type="button" class="photo-tab-main" data-photo-select="${photo.id}" title="${escapeHtml(photo.imageName)}"><img src="${photo.src}" alt="" /><span>${escapeHtml(photo.imageName)}</span><i class="photo-tab-dot" aria-hidden="true"></i><small class="photo-task-label"></small></button><button type="button" class="photo-tab-close" data-photo-close="${photo.id}" aria-label="移出 ${escapeHtml(photo.imageName)}" title="移出工作区"><span data-icon="close"></span></button></div>`).join('');
  scroller.scrollLeft = previousScroll;
  revealCurrentPhotoTab();
  hydrateIcons($('#photo-tabs'));
  syncPhotoTabs();
  if(restoreFocus)(document.querySelector(`.photo-tab-main[data-photo-select="${currentPhotoId}"]`) || $('#add-photo-button')).focus({preventScroll:true});
}

function revealCurrentPhotoTab() {
  const scroller=$('.photo-tab-scroll');
  const activeTab = currentPhotoId ? document.querySelector(`#photo-tabs .photo-tab[data-photo-id="${currentPhotoId}"]`) : null;
  if (activeTab) {
    const tabRect = activeTab.getBoundingClientRect();
    const viewportRect = scroller.getBoundingClientRect();
    if (tabRect.left < viewportRect.left) scroller.scrollLeft += tabRect.left - viewportRect.left - 4;
    else if (tabRect.right > viewportRect.right) scroller.scrollLeft += tabRect.right - viewportRect.right + 4;
  }
}

function renderLibrary() {
  const summary = summarizeWorkspace(photoSessions);
  $('#library-filters').innerHTML = [{id:'all',label:'全部',count:summary.total},...photoSubjects.map(item => ({...item,count:summary.subjects[item.id]}))]
    .map(item => `<button type="button" class="library-filter${libraryFilter === item.id ? ' active' : ''}" data-library-filter="${item.id}" aria-pressed="${libraryFilter === item.id}">${item.label}<span>${item.count}</span></button>`).join('');
  const visible = photoSessions.filter(photo => libraryFilter === 'all' || validSubject(photo.subject) === libraryFilter);
  $('#library-grid').innerHTML = visible.length ? visible.map(photo => {
    const edited = photoHasEdits(photo);
    const exported = photo.id === currentPhotoId ? state.exported : photo.exported;
    const status = edited && !exported ? '有未导出的调整' : exported ? '已导出' : '原片';
    return `<article class="library-card${selectedPhotos.has(photo.id) ? ' selected':''}"><button type="button" class="library-photo${photo.id === currentPhotoId ? ' active' : ''}" data-library-select="${photo.id}"><img src="${photo.src}" alt="" /><span><strong>${escapeHtml(photo.imageName)}</strong><small>${subjectLabel(photo.subject)} · ${photoTaskLabel(photo) || status}</small></span></button>${librarySelecting ? `<label class="library-check"><input type="checkbox" data-batch-select="${photo.id}" aria-label="选择 ${escapeHtml(photo.imageName)}" ${selectedPhotos.has(photo.id) ? 'checked':''} /></label>`:''}</article>`;
  }).join('') : `<div class="library-empty">${photoSessions.length ? '该题材下暂无照片，可在审片面板为照片选择题材。' : '还没有照片。添加一张，开始你的创作。'}</div>`;
  $('#library-add').disabled = importingFiles || state.loading || photoSessions.length >= 12;
  $('#library-selection-actions').hidden=!librarySelecting;$('#library-selection-count').textContent=`已选 ${selectedPhotos.size} 张`;
  $('#library-select-mode').textContent=librarySelecting ? '完成选择':'选择照片';
  for(const button of document.querySelectorAll('[data-batch-action]'))button.disabled=button.dataset.batchAction==='series'?selectedPhotos.size<2:!selectedPhotos.size;
  $('#library-undo-batch').hidden=!lastBatch;
}

function persistPersonalProfile() {
  try { localStorage.setItem('guangjian-personal-profile',JSON.stringify(personalProfile)); return true; } catch { return false; }
}

function showProfileSaveStatus(saved) {
  $('#profile-save-status').hidden=false;
  $('#profile-save-status').textContent=saved ? '偏好已保存':'当前页面已保留；浏览器未能保存，重新打开后可能丢失。';
}

function renderAccountAvatar() {
  $('#profile-button').title='我的 · 个人档案';
  $('#profile-button').setAttribute('aria-label','我的，打开个人档案');
  const avatar=$('#account-avatar');
  avatar.replaceChildren();
  if(personalProfile.name)avatar.textContent=[...personalProfile.name][0];
  else {const image=document.createElement('img');image.src='/assets/xiaozhen-avatar.png?v=1';image.alt='';image.className='xiaozhen-avatar';image.width=28;image.height=28;avatar.append(image);}
}

function renderPersonalProfile() {
  $('#account-name').textContent = '我的';
  renderAccountAvatar();
  $('#profile-name').value = personalProfile.name;
  $('#profile-subjects').innerHTML = photoSubjects.filter(item => item.id !== 'unclassified').map(item =>
    `<button type="button" class="profile-choice${personalProfile.subjects.includes(item.id) ? ' active' : ''}" data-profile-subject="${item.id}" aria-pressed="${personalProfile.subjects.includes(item.id)}">${item.label}</button>`).join('');
  $('#profile-styles').innerHTML = stylePreferences.map(item =>
    `<button type="button" class="profile-choice${state.stylePreference === item.id ? ' active' : ''}" data-profile-style="${item.id}" aria-pressed="${state.stylePreference === item.id}">${item.label}</button>`).join('');
  const summary = summarizeWorkspace(photoSessions);
  $('#profile-photo-count').textContent = `${summary.total} 张照片`;
  const subjectRows = photoSubjects.filter(item => summary.subjects[item.id]).map(item => ({label:item.label,count:summary.subjects[item.id]}));
  const aspectRows = [{id:'landscape',label:'横幅'},{id:'portrait',label:'竖幅'},{id:'square',label:'方幅'}].filter(item => summary.aspects[item.id]).map(item => ({label:item.label,count:summary.aspects[item.id]}));
  const bars = rows => rows.length ? rows.map(item => `<div class="profile-stat-row"><span>${item.label}</span><div class="profile-stat-track"><i style="width:${Math.round(item.count / summary.total * 100)}%"></i></div><strong>${item.count}</strong></div>`).join('') : '<p class="profile-stat-empty">加入照片后显示</p>';
  $('#profile-subject-chart').innerHTML = bars(subjectRows);
  $('#profile-aspect-chart').innerHTML = bars(aspectRows);
  renderTasteProfile();
  renderPersonalOverview();
}

function renderPersonalOverview() {
  const photo=currentPhoto();
  const summary=summarizeTaste(tasteRecords);
  const finalized=photo && photo.acceptedSignature===currentAcceptanceSignature() && tasteRecords.some(record=>record.id===photo.acceptedRecordId);
  const photoStatus=photo ? photoTaskLabel(photo) || (finalized ? '已定稿':state.exported ? '已导出':photoHasEdits(photo) ? '编辑中':'原片'):'';
  const avatar=$('#personal-avatar');avatar.replaceChildren($('#account-avatar').cloneNode(true));avatar.firstElementChild.removeAttribute('id');
  $('#personal-current-photo').innerHTML=photo ? `<div class="personal-photo-row"><img src="${escapeHtml(photo.src)}" alt="${escapeHtml(photo.imageName)}的原片缩略图" /><div class="personal-photo-copy"><span class="personal-caption">${photo.isDemo ? '示例照片 · 原片预览':'当前照片 · 原片预览'}</span><strong>${escapeHtml(photo.imageName)}</strong><span>${escapeHtml(subjectLabel(photo.subject))} · ${escapeHtml(photoStatus)}</span><button type="button" class="personal-primary" id="personal-resume-photo" ${state.loading ? 'disabled':''}><span data-icon="sliders"></span>${state.loading ? '照片准备中…':'继续修片'}<span data-icon="arrow-right"></span></button></div></div>` : `<div class="personal-no-photo"><span data-icon="image"></span><div><strong>从一张自己的照片开始</strong><p>添加照片，试试看你的第一版。</p><button type="button" class="personal-primary" id="personal-add-photo"><span data-icon="plus"></span>添加照片</button></div></div>`;
  $('#personal-subject-summary').textContent=personalProfile.subjects.length ? personalProfile.subjects.map(subjectLabel).join('、'):'尚未设置';
  const style=stylePreferences.find(item=>item.id===state.stylePreference);
  $('#personal-style-summary').textContent=state.stylePreference==='auto' ? '根据照片自动推荐':style?.label || '根据照片自动推荐';
  $('#personal-preference-note').textContent=summary.count ? `推荐会参考 ${summary.count} 张定稿的选择，优先考虑这张照片的调整目标。`:'设置偏好，用于以后的风格推荐。';
  $('#personal-workspace-meta').innerHTML=`<span class="section-label"><span data-icon="grid"></span>工作区 ${photoSessions.length} 张</span><span class="section-label"><span data-icon="heart"></span>收藏风格 ${state.favoritePresets.size} 款</span>`;
  $('#personal-view-growth').hidden=summary.count===0;
  $('#personal-recent-records').innerHTML=summary.count ? `<p class="personal-caption">已记录 ${summary.count} 张定稿 · 保存选择摘要</p><ol class="personal-record-list">${[...summary.records].reverse().slice(0,3).map(record=>{const date=new Date(record.acceptedAt);const day=Number.isNaN(date.getTime())?'定稿':`${date.getMonth()+1}.${String(date.getDate()).padStart(2,'0')}`;return `<li><span class="personal-record-date">${day}</span><div><strong>${escapeHtml(subjectLabel(record.subject))}</strong><span>${escapeHtml(presetById(record.presetId)?.name || (record.moods.includes('mono') ? '黑白精修':'手动精修'))}</span></div><span data-icon="check"></span></li>`;}).join('')}</ol>` : `<div class="personal-record-empty"><span data-icon="history"></span><strong>还没有定稿记录</strong><p>将满意的版本记为定稿，在这里查看题材、影调和调整记录。</p><button type="button" class="personal-text-action" data-profile-view="growth">看看如何记录 <span data-icon="arrow-right"></span></button></div>`;
  hydrateIcons($('#profile-dialog'));
}

const moodNames = {airy:'轻盈留白',film:'胶片质感',vivid:'鲜明色彩',mono:'黑白结构'};
const practiceGuide = [
  {id:'composition',name:'构图取舍',prompt:'下次试试只裁掉一个真正分散视线的边缘。'},
  {id:'light',name:'光线层次',prompt:'下次先保护最亮处，再决定暗部要留多少。'},
  {id:'color',name:'色彩表达',prompt:'下次先确定一两种主色，再动饱和度。'},
  {id:'focus',name:'视觉重点',prompt:'下次观察第一眼落点，选择一处局部调整。'}
];
function lookLabel(stats) {
  const light = stats.mean >= .59 ? '明亮' : stats.mean <= .39 ? '低调' : '中间调';
  const color = stats.saturation >= .31 ? '浓彩' : stats.saturation <= .17 ? '淡彩' : '自然色彩';
  return `${light} · ${color}`;
}

function currentAcceptanceSignature() {
  return snapshotAcceptanceSignature(editSnapshot());
}

function renderTasteProfile() {
  const summary = summarizeTaste(tasteRecords);
  const count = summary.count;
  $('#profile-growth-view').classList.toggle('without-records', count === 0);
  $('#taste-headline').textContent = count ? count < 3 ? '已保存的定稿还不多' : '看看常用的调整' : '从第一张定稿开始';
  $('#taste-subtitle').textContent = count ? `已记录 ${count} 张定稿作品。这里呈现你做过的选择，不给作品或审美打分。` : '保存定稿后，系统才会将前后的光色、风格与参数偏好用于后续推荐。';
  $('#taste-evidence').textContent = count ? `依据 ${count} 张定稿 · ${count < 3 ? '初步观察' : '持续更新'}` : '暂无定稿记录';
  const signals = [];
  if (summary.leadingMood) signals.push({kicker:'影调选择',title:moodNames[summary.leadingMood],detail:`出现在 ${summary.moodCounts[summary.leadingMood]} 张定稿中`});
  if (count && summary.tendencies.color <= -.015) signals.push({kicker:'色彩取舍',title:'常降低饱和度',detail:'定稿的色彩通常比原片更淡'});
  else if (count && summary.tendencies.color >= .015) signals.push({kicker:'色彩取舍',title:'常增加饱和度',detail:'相对原片，定稿常更鲜明'});
  if (count && summary.tendencies.light >= .025) signals.push({kicker:'光线选择',title:'让画面更明亮',detail:'定稿的平均亮度高于原片'});
  else if (count && summary.tendencies.light <= -.025) signals.push({kicker:'光线选择',title:'保留低调氛围',detail:'定稿的平均亮度低于原片'});
  if (summary.practices.composition) signals.push({kicker:'构图习惯',title:'经常裁剪照片',detail:`有 ${summary.practices.composition} 张定稿重新裁剪`});
  if (count >= 2) {
    const subjects = Object.entries(summary.records.reduce((result,item) => { result[item.subject] = (result[item.subject] || 0)+1;return result; },{})).sort((a,b) => b[1]-a[1]);
    if (subjects[0]?.[1] >= 2 && subjects[0][0] !== 'unclassified') signals.push({kicker:'常拍题材',title:subjectLabel(subjects[0][0]),detail:`出现在 ${subjects[0][1]} 张定稿中`});
  }
  if (count && !signals.length) signals.push({kicker:'起点',title:'调整幅度较小',detail:'这张作品只做了很轻的调整'});
  $('#taste-signals').innerHTML = signals.length ? signals.slice(0,4).map(item => `<article class="taste-signal"><span>${item.kicker}</span><strong>${item.title}</strong><small>${item.detail}</small></article>`).join('') : '<p class="taste-empty">还没有定稿记录。可以将满意的版本记为定稿。</p>';
  $('#taste-practice').innerHTML = practiceGuide.map(item => {
    const occurrences = summary.practices[item.id];
    return `<article class="taste-practice-item"><div class="taste-practice-head"><strong>${item.name}</strong><span>${occurrences ? `${occurrences} 次实践` : '可以从这里开始'}</span></div><div class="taste-practice-marks" aria-hidden="true">${Array.from({length:4},(_,index) => `<i class="${index < occurrences ? 'filled' : ''}"></i>`).join('')}</div><p>${item.prompt}</p></article>`;
  }).join('');
  const half = Math.max(2,Math.floor(count/2));
  const averageDelta = (records,key) => records.reduce((sum,item) => sum+item.final[key]-item.original[key],0)/records.length;
  const recentColor = count >= 4 ? averageDelta(summary.records.slice(-half),'saturation') : 0;
  const earlyColor = count >= 4 ? averageDelta(summary.records.slice(0,half),'saturation') : 0;
  const recentLight = count >= 4 ? averageDelta(summary.records.slice(-half),'mean') : 0;
  const earlyLight = count >= 4 ? averageDelta(summary.records.slice(0,half),'mean') : 0;
  let evolution = `再定稿 ${Math.max(0,4-count)} 张，就可以比较早期和最近的光色选择。`;
  if (count >= 4) evolution = Math.abs(recentColor-earlyColor) >= .025 ? `与早期相比，你最近定稿的色彩${recentColor < earlyColor ? '更克制' : '更鲜明'}。可以看看这是否符合你的偏好。` : Math.abs(recentLight-earlyLight) >= .03 ? `与早期相比，你最近定稿的整体影调${recentLight < earlyLight ? '更低调' : '更明亮'}。试着留意这种变化是否适合不同题材。` : '早期与最近定稿的光色变化不大。';
  $('#taste-evolution').textContent = evolution;
  $('#taste-timeline').innerHTML = count ? [...summary.records].reverse().slice(0,6).map(record => {
    const date = new Date(record.acceptedAt);
    const dateLabel = Number.isNaN(date.getTime()) ? '定稿' : `${date.getMonth()+1}.${String(date.getDate()).padStart(2,'0')}`;
    const style = presetById(record.presetId)?.name || (record.moods.includes('mono') ? '黑白精修' : '手动精修');
    const choices = [record.cropCoverage < .95 ? '重新构图' : null,record.localCount ? `${record.localCount} 处局部调整` : null,record.adjustments.highlights <= -8 ? '保护高光' : null].filter(Boolean).join(' · ');
    return `<article class="taste-record"><span class="taste-record-date">${dateLabel}</span><div class="taste-record-main"><strong>${escapeHtml(subjectLabel(record.subject))} · ${escapeHtml(style)}</strong><span>原片 ${lookLabel(record.original)} → 定稿 ${lookLabel(record.final)}${choices ? ` · ${choices}` : ''}</span></div><button type="button" data-taste-remove="${escapeHtml(record.id)}" aria-label="移除这条定稿记录">移除</button></article>`;
  }).join('') : '<p class="taste-empty">定稿后，这里会出现每次选择的简短记录。照片本身不会存入档案。</p>';
  const photo = currentPhoto();
  const canAccept = photo && !photo.isDemo && state.previewData && !state.loading;
  const unchanged = canAccept && photo.acceptedSignature === currentAcceptanceSignature() && tasteRecords.some(item => item.id === photo.acceptedRecordId);
  $('#profile-accept-current').disabled = !canAccept || unchanged;
  $('#profile-accept-current').hidden=!canAccept || unchanged;
  $('#profile-start-practice').hidden=canAccept && !unchanged;
  $('#profile-accept-current').textContent = unchanged ? '这一版已记入档案' : photo?.acceptedRecordId ? '更新这张照片的定稿' : '把当前版本记为定稿';
  $('#taste-accept-hint').textContent = !photo || photo.isDemo ? '导入自己的照片后可定稿；示例照片不参与偏好学习。' : '只保存光色、题材与调整摘要，不保存照片。';
  $('#profile-note').textContent = profileView === 'growth' ? '定稿仅保存选择摘要；移除后推荐会重新计算。' : profileView==='overview' ? '偏好与定稿摘要保存在此浏览器。':'修改自动保存；推荐优先参考当前照片。';
  for(const view of ['overview','preferences','growth']) {
    $(`#profile-${view}-view`).hidden=profileView!==view;
    $(`#profile-${view}-tab`).setAttribute('aria-selected',String(profileView===view));
    $(`#profile-${view}-tab`).tabIndex=profileView===view ? 0:-1;
  }
  $('#profile-title').textContent=profileView==='overview' ? personalProfile.name || '我的':profileView==='growth' ? '定稿记录':'修图偏好';
  $('#profile-intro').textContent=profileView==='overview' ? '查看偏好和已保存的定稿。':profileView==='growth' ? '查看定稿记录和常用的调整。':'设置常用拍摄题材与偏好影调。';
  $('#profile-done').textContent = profileView === 'preferences' ? '完成设置':workspaceSpace==='learn' ? '返回学习':'返回修片';
}

function persistTasteRecords() {
  try { localStorage.setItem(tasteStorageKey,JSON.stringify(tasteRecords)); return true; }
  catch { return false; }
}

async function acceptCurrentVersion() {
  endStyleAudition();finishRangeEdit();finishAnnotationNote();
  const photo = currentPhoto();
  if (!photo || photo.isDemo || !state.previewData) return {status:'unavailable'};
  const signature = currentAcceptanceSignature();
  if (photo.acceptedSignature === signature && tasteRecords.some(item => item.id === photo.acceptedRecordId)) return {status:'unchanged'};
  const wasAccepted = Boolean(photo.acceptedRecordId && tasteRecords.some(item => item.id === photo.acceptedRecordId));
  const source = currentPreviewPixels();
  const finalStats = inspectPixels(renderCurrentPixels(source.data,source.width,source.height),source.width,source.height).stats;
  const record = createAcceptedRecord({
    id:photo.acceptedRecordId || crypto.randomUUID(),acceptedAt:new Date().toISOString(),subject:photo.subject,
    originalStats:state.originalInspection.stats,finalStats,editDocument:state.editDocument,presetId:state.presetId,presetAmount:state.presetAmount,
    adjustments:getAdjustments(),crop:state.crop,localCount:renderedAnnotations().filter(item => item.localEnabled!==false && Object.values(item.localSettings || {}).some(Boolean) && (item.localAmount ?? 100) > 0).length,
    recommendationCount:state.active.size
  });
  // A file save may finish after the user switches photos or continues editing.
  // The accepted summary belongs to the pixels and choices at the time of the click.
  if(!await captureVersion('final','定稿'))return {status:'unavailable'};
  tasteRecords = [...tasteRecords.filter(item => item.id !== record.id),record].slice(-60);
  const persisted = persistTasteRecords();
  photo.acceptedRecordId = record.id;
  photo.acceptedSignature = signature;
  scheduleDraftSave();
  renderPresets();
  renderPersonalProfile();refreshActions();
  return {status:wasAccepted ? 'updated' : 'saved',persisted};
}

function showEmptyWorkspace() {
  cancelReassessment('empty');
  hideComparisonPopover();
  analysisController?.abort();
  analysisGeneration++;
  reassessGeneration++;
  selectedEvidenceKey = null;
  currentPhotoId = null;
  projectWorkspace.status(null);
  state.image = null;
  state.previewSource = null;
  state.previewData = null;
  state.analysis = null;
  state.active = new Set();
  state.advisorLayers = [];
  state.manual = {...defaults};
  state.crop = null;
  state.annotations = [];
  selectedAnnotationId = null;
  setMarkingPhoto(false);
  state.presetId = null;
  state.assessment = null;
  state.assessmentBusy = false;
  state.exported = false;
  state.analyzing = false;
  editHistory.past = [];
  editHistory.future = [];
  editHistory.range = null;
  $('.workspace').classList.add('empty');
  $('#drop-zone').hidden = true;
  $('#empty-workspace').hidden = false;
  $('.right-panel').hidden = true;
  $('#workspace-title').textContent = '照片工作台';
  $('#workspace-title').removeAttribute('title');
  $('#heading-counter').textContent = '00 / 00';
  renderPhotoTabs();
  refreshActions();
}

function preparePhotoPreview(photo) {
  if (photo.previewData) return;
  const image = photo.image;
  const previewScale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * previewScale));
  const height = Math.max(1, Math.round(image.naturalHeight * previewScale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  context.drawImage(image, 0, 0, width, height);
  photo.previewSource = canvas;
  photo.previewData = {data:context.getImageData(0, 0, width, height).data, width, height};
  photo.originalInspection = inspectPixels(photo.previewData.data, width, height);
}

function activatePhoto(id) {
  if (id === currentPhotoId || state.loading) return;
  if(currentPhoto()?.projectNativePending){showToast('协作精修里还有未保存的输入，请先保存、试片或重置。');return;}
  const photo = photoSessions.find(item => item.id === id);
  if (!photo) return;
  endStyleAudition();
  hideComparisonPopover();
  setMarkingPhoto(false);
  selectedAnnotationId = null;showLocalMask=false;
  $('.workspace').classList.remove('empty');
  $('#drop-zone').hidden = false;
  $('#empty-workspace').hidden = true;
  $('.right-panel').hidden = false;
  cancelReassessment('switched');
  commitPhotoInputs();
  analysisGeneration++;
  reassessGeneration++;
  currentPhotoId = id;
  projectWorkspace.status(photo);
  $('#agent-live').textContent='';
  photo.versions=(photo.versions || []).map(item=>({...item,signature:snapshotAcceptanceSignature(item.snapshot)}));
  preparePhotoPreview(photo);
  if(!photo.analysis){photo.analysis=onDemandReview(photo);photo.analysisStatus=photo.isDemo?'example':'idle';}
  renderAnnotations();renderLocalEditor();
  editHistory.past = photo.history.past;
  editHistory.future = photo.history.future;
  editHistory.range = null;
  state.analyzing=analysisQueue.tasks.some(task=>task.photoId===id && ['queued','running'].includes(task.status));
  state.assessmentBusy = false;
  originalImage.src = photo.src;
  originalImage.alt = photo.imageName;
  $('#crop-editor-image').src = photo.src;
  $('#file-name').textContent = photo.imageName;
  $('#file-meta').textContent = `${photo.image.naturalWidth} × ${photo.image.naturalHeight} · ${photo.isDemo ? '示例照片' : '本地导入的照片'}`;
  $('#photo-subject').value = validSubject(photo.subject);
  $('#workspace-title').textContent = photo.imageName;
  $('#workspace-title').title = photo.imageName;
  $('#agent-context-photo').title = photo.imageName;
  $('#heading-counter').textContent = `${String(photoSessions.indexOf(photo) + 1).padStart(2, '0')} / ${String(photoSessions.length).padStart(2, '0')}`;
  if (studioTab==='presets' && !Object.keys(state.presetThumbs).length) buildPresetThumbs(photo.image);
  renderSliders();
  if(studioTab==='presets')renderPresets();
  sizePhotoStage();
  setCompare(state.compare);
  scheduleRender();
  if (state.analysis) {
    renderAnalysis();
    renderAnalysisStatus();
  } else {
    $('#diagnosis-radar').innerHTML = '';
    $('#metric-grid').innerHTML = '';
    photo.analysis=onDemandReview(photo);state.analysis=photo.analysis;renderAnalysis();
  }
  selectTab(studioTab);
  renderAgent();
  renderPhotoTabs();
  refreshActions();
  scheduleDraftSave();
}

function removePhoto(id) {
  const index = photoSessions.findIndex(photo => photo.id === id);
  if (index < 0) return;
  const photo = photoSessions[index];
  if(photo.projectNativePending){showToast('请先保存协作精修里的输入，或生成试片。');return;}
  projectWorkspace.release(photo);
  advisorRequests.cancel(id,'removed');reassessmentRequests.cancel(id,'removed');
  if(reassessmentRequest?.id===id)cancelReassessment('removed');
  const nextId = photoSessions[index + 1]?.id || photoSessions[index - 1]?.id;
  for(const queue of [analysisQueue,exportQueue])queue.releasePhoto(id);
  editStack.release(photo);
  selectedPhotos.delete(id);
  photoSessions.splice(index,1);
  if (photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src);
  if (!photoSessions.length) showEmptyWorkspace();
  else if (id === currentPhotoId) {
    currentPhotoId = null;
    activatePhoto(nextId);
  } else renderPhotoTabs();
  scheduleDraftSave();
  showToast(`已将「${photo.imageName}」移出工作区。`);
}

function requestClosePhoto(id) {
  const photo = photoSessions.find(item => item.id === id);
  if (!photo || state.loading) return;
  if(photo.projectNativePending){showToast('请先保存协作精修里的输入，或生成试片。');return;}
  if ((photoHasEdits(photo) && !(id === currentPhotoId ? state.exported : photo.exported)) || photoHasNotes(photo)) {
    pendingCloseId = id;
    $('#replace-description').textContent = `「${photo.imageName}」有调整、批注或调整目标。这些随草稿保存，导出照片不会包含批注与意图。移出会从当前草稿移除这张照片，原片文件仍然保留。`;
    $('#replace-dialog').showModal();
  } else removePhoto(id);
}

function editSnapshot() {
  return {
    editDocument:structuredClone(state.editDocument||null),projectVersionId:currentPhoto()?.projectCurrentId,toolRuns:structuredClone(state.toolRuns||[]),advisorLayers:structuredClone(state.advisorLayers),active:[...state.active],manual:{...state.manual},crop:state.crop ? {...state.crop} : null,presetId:state.presetId,presetAmount:state.presetAmount,
    recommendations:state.analysis ? structuredClone(state.analysis.recommendations) : null,
    annotations:structuredClone(state.annotations),
    agentApplied:currentPhoto()?.conversation.map(message => Boolean(message.applied)) || [],
    agentAppliedIds:currentPhoto()?.conversation.filter(message=>message.applied && message.id).map(message=>message.id) || []
  };
}

function saveEdit(before) {
  if (JSON.stringify(before) === JSON.stringify(editSnapshot())) return;
  editHistory.past.push(before);
  if (editHistory.past.length > 30) editHistory.past.shift();
  editHistory.future.length = 0;
  refreshActions();
  scheduleDraftSave();
}

function finishRangeEdit() {
  if (!editHistory.range) return;
  saveEdit(editHistory.range.before);
  editHistory.range = null;
}

function beginRangeEdit(key) {
  endStyleAudition();
  if (editHistory.range?.key === key) return;
  finishRangeEdit();
  editHistory.range = {key,before:editSnapshot()};
}

function beforeEdit() { endStyleAudition();finishRangeEdit(); return editSnapshot(); }

function restoreEdit(snapshot,{gesture=false}={}) {
  const previousCrop = JSON.stringify(state.crop);
  const revision=state.editDocument?.revision||0;state.editDocument=snapshot.editDocument?structuredClone(snapshot.editDocument):null;if(state.editDocument&&!gesture){state.editDocument.revision=Math.max(revision,state.editDocument.revision)+1;state.editDocument.receipts=[];}
  state.active = new Set(snapshot.active);
  state.toolRuns=structuredClone(snapshot.toolRuns||[]);
  state.advisorLayers = structuredClone(snapshot.advisorLayers || []);
  state.manual = {...defaults,...snapshot.manual};
  state.crop = snapshot.crop ? {...snapshot.crop} : null;
  state.annotations = structuredClone(snapshot.annotations || []);
  if (!state.annotations.some(item => item.id === selectedAnnotationId)) selectedAnnotationId = null;
  state.presetId = snapshot.presetId;
  state.presetAmount = snapshot.presetAmount;
  if (state.analysis && Array.isArray(snapshot.recommendations)) state.analysis.recommendations = structuredClone(snapshot.recommendations);
  currentPhoto()?.conversation.forEach((message,index)=>{
    if(['adjustment','region'].includes(message.action?.kind))message.applied=state.advisorLayers.some(item=>item.id===message.id);
    else if(Array.isArray(snapshot.agentAppliedIds))message.applied=snapshot.agentAppliedIds.includes(message.id);
    else if(Array.isArray(snapshot.agentApplied))message.applied=Boolean(snapshot.agentApplied[index]);
  });
  if (previousCrop !== JSON.stringify(state.crop)) buildPresetThumbs(state.image);
  renderSliders(); renderAnalysis(); renderPresets(); renderAgent(); sizePhotoStage(); renderAnnotations();renderLocalEditor(); scheduleRender(); markAssessmentStale();
  setCompare(hasEdits() ? Math.max(state.compare,68) : 50);
}

function restorePhotoHistory(photo,history){photo.history=history;if(currentPhoto()===photo){editHistory.past=history.past;editHistory.future=history.future;editHistory.range=null;refreshActions();}scheduleDraftSave();}

function undoEdit() {
  finishRangeEdit();
  if (!editHistory.past.length) return;
  if(currentPhoto()?.projectId&&state.editDocument){const photo=currentPhoto(),before=editSnapshot(),target=editHistory.past.at(-1);if(target.projectVersionId){const history=photo.history;photo.editSaving=true;refreshActions();editStack.render();projectWorkspace.restoreEdition(photo,target.projectVersionId).then(()=>{history.future.push(before);history.past.pop();restorePhotoHistory(photo,history);showToast('已撤销步骤修改。');}).catch(error=>showToast(error.message)).finally(()=>{photo.editSaving=false;refreshActions();editStack.render();});return;}}
  editHistory.future.push(editSnapshot());
  restoreEdit(editHistory.past.pop());
  showToast('已撤销上一步调整。');
}

function redoEdit() {
  finishRangeEdit();
  if (!editHistory.future.length) return;
  if(currentPhoto()?.projectId){const photo=currentPhoto(),before=editSnapshot(),target=editHistory.future.at(-1);if(target.projectVersionId){const history=photo.history;photo.editSaving=true;refreshActions();editStack.render();projectWorkspace.restoreEdition(photo,target.projectVersionId).then(()=>{history.past.push(before);history.future.pop();restorePhotoHistory(photo,history);showToast('已重做步骤修改。');}).catch(error=>showToast(error.message)).finally(()=>{photo.editSaving=false;refreshActions();editStack.render();});return;}}
  editHistory.past.push(editSnapshot());
  restoreEdit(editHistory.future.pop());
  showToast('已重做调整。');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setLoading(value,purpose = 'photo') {
  state.loading = value;
  state.loadingPurpose = purpose;
  $('.workspace').inert=value;
  $('.sidebar').inert=value;
  $('.topbar').inert=value;
  const exporting=value && purpose==='export';
  $('#cancel-export').disabled=exporting;$('#close-export').disabled=exporting;
  $('#export-dialog').querySelectorAll('input,select').forEach(input=>{input.disabled=exporting || input.id==='export-remember' && state.isDemo;});
  $('#image-loading').hidden = !value;
  if (value) $('#image-loading span:last-child').textContent = purpose === 'export' ? '正在准备导出…' : '正在读取画面…';
  $('#confirm-export').disabled = value && purpose === 'export';
  $('#confirm-export-label').textContent = value && purpose === 'export' ? '正在生成…' : pendingCloseAfterExportId ? '导出并移出' : '下载照片';
  refreshActions();
}

function setCompare(value) {
  state.compare = clamp(Number(value), 0, 100);
  $('#compare-slider').value = state.compare;
  $('#compare-value').textContent = hasEdits() ? `${Math.round(state.compare)}%` : '原片';
  editedCanvas.style.clipPath = `inset(0 ${100 - state.compare}% 0 0)`;
  $('#compare-handle').style.left = `${state.compare}%`;
  $('.badge-after').style.opacity = state.compare < 12 ? 0 : 1;
  $('.badge-before').textContent=state.crop ? '原片 · 同构图':'原图';
  $('.badge-before').style.opacity = state.compare > 88 ? 0 : 1;
}

function showComparisonPopover() {
  if (state.renderPending || state.renderFailed || !state.image || !editedCanvas.width || !editedCanvas.height) return;
  $('#compare-original-preview').src = originalImage.src;
  const preview = $('#compare-edited-preview');
  preview.width = editedCanvas.width;
  preview.height = editedCanvas.height;
  preview.getContext('2d').drawImage(editedCanvas,0,0);
  $('#compare-popover').hidden = false;
  $('#hold-compare').setAttribute('aria-pressed','true');
}

function hideComparisonPopover() {
  $('#compare-popover').hidden = true;
  $('#hold-compare').setAttribute('aria-pressed','false');
}

function getAdjustments() {
  return globalAdjustments({manual:state.manual,recommendations:state.analysis?.recommendations,active:state.active,
    preset:presetById(state.presetId),amount:state.presetAmount,advisorLayers:state.advisorLayers});
}
function renderedAnnotations() { return effectiveAnnotations(state.annotations,state.advisorLayers); }
function currentEffectSignature() { return state.editDocument?renderHash(state.editDocument):adjustmentSignature(getAdjustments(),state.crop,renderedAnnotations()); }
function currentPreviewPixels() {
  if(!state.crop) return state.previewData;
  const signature=JSON.stringify(state.crop);
  if(cachedCropPreview?.image===state.image && cachedCropPreview.signature===signature) return cachedCropPreview.data;
  const rect=cropPixelRect(state.crop,state.image.naturalWidth,state.image.naturalHeight);
  const scale=Math.min(1,1400/Math.max(state.image.naturalWidth,state.image.naturalHeight));
  const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  drawPhotoSource(context,state.image,state.crop,width,height,rect);
  const data={data:context.getImageData(0,0,width,height).data,width,height};
  cachedCropPreview={image:state.image,signature,data};return data;
}
function currentRenderJob(source,width,height) {
  return {pixels:source,width,height,settings:getAdjustments(),annotations:structuredClone(renderedAnnotations()),crop:state.crop ? {...state.crop}:null,document:state.editDocument,maskView:editStack?.maskView(currentPhoto()),
    frame:{fullWidth:state.image.naturalWidth,fullHeight:state.image.naturalHeight,sourceRect:cropPixelRect(state.crop,state.image.naturalWidth,state.image.naturalHeight),angle:state.crop?.angle || 0}};
}
function renderCurrentPixels(source,width,height) {
  if(!state.renderPending&&!state.renderFailed&&!styleAudition.active&&!editStack?.maskView(currentPhoto())&&renderedEffectKey===currentEffectSignature()&&renderedFrameKey===JSON.stringify({photo:currentPhotoId,crop:state.crop})&&editedCanvas.width===width&&editedCanvas.height===height)return editedCanvas.getContext('2d').getImageData(0,0,width,height).data;
  return renderPhotoPixels({...currentRenderJob(source,width,height),maskView:undefined});
}

function updateSliderTotals() {
  const total=getAdjustments();
  for (const spec of sliderSpecs) {
    const output=$(`#total-${spec.key}`);
    if (output) output.textContent=`手动调整值 · 叠加后 ${formatSlider(Number(total[spec.key].toFixed(2)),spec)}`;
  }
}
function renderAdjustmentLayers() {
  editStack?.render();$('#edit-stack-start').disabled=editingBlocked();const active=Boolean(state.editDocument);$('#edit-stack-start').closest('.edit-stack-entry').hidden=active;$('#manual-sliders').hidden=active&&!currentPhoto()?.editLegacy;$('.manual-adjustment-head').hidden=active&&!currentPhoto()?.editLegacy;$('.local-control-group').hidden=active;$('#clear-manual').hidden=active&&!currentPhoto()?.editLegacy;
  const legacyBlocked=editingBlocked();for(const input of $('#manual-sliders').querySelectorAll('input'))input.disabled=legacyBlocked;$('#clear-manual').disabled=legacyBlocked;
  if(active){$('#adjustment-layers').hidden=true;return;}
  const rows=[];
  for (const item of state.analysis?.recommendations || []) if(state.active.has(item.id)) rows.push({id:`suggestion:${item.id}`,label:item.title,source:`审片建议${item.previewAmount ? ' · 强度 '+item.previewAmount+'%':''}`,settings:item.adjustments});
  if(state.presetId && state.presetAmount>0) rows.push({id:'style',label:presetById(state.presetId)?.name,source:`风格 · ${state.presetAmount}%`,settings:combineSettings({settings:presetById(state.presetId)?.adjustments,amount:state.presetAmount/100})});
  for(const item of state.advisorLayers) rows.push({id:`advisor:${item.id}`,label:item.label,source:(item.source==='series'?'组图 · 逐张光色':item.annotationId ? '顾问 · 局部':'顾问 · 全局')+(item.previewAmount ? ' · 强度 '+item.previewAmount+'%':''),settings:item.settings});
  if(adjustmentKeys.some(key=>state.manual[key])) rows.push({id:'manual',label:'手动参数',source:'手动调整 · 叠加值',settings:state.manual});
  for(const item of state.annotations) if(item.localSettings && Object.values(item.localSettings).some(Boolean)) rows.push({id:`region:${item.id}`,label:`标记 ${state.annotations.indexOf(item)+1}`,source:item.localEnabled===false ? '局部手动调整 · 已暂停':'局部手动调整',settings:item.localSettings});
  if(state.crop) rows.push({id:'crop',label:'构图裁剪',source:`保留 ${Math.round(state.crop.width*state.crop.height*100)}%`,settings:{}});
  $('#adjustment-layers').hidden=!inspectionVisibility({sources:rows.length}).sources;
  if(!rows.length)$('#adjustment-layers').open=false;
  $('#layer-summary').textContent=rows.length ? `当前调整 · ${rows.length} 项来源`:'当前调整 · 原片';
  $('#layer-list').innerHTML=rows.map(row=>`<li><div><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(row.source)}</small><span>${formatAdjustmentChips(row.settings)}</span></div><button type="button" data-layer-remove="${escapeHtml(row.id)}" aria-label="撤回${escapeHtml(row.label)}">撤回</button></li>`).join('') || '<li class="layer-empty">尚未应用调整，原片保持不变。</li>';
}
function removeAdjustmentLayer(id) {
  const before=beforeEdit();
  if(id.startsWith('suggestion:')) state.active.delete(id.slice(11));
  else if(id==='style') state.presetId=null;
  else if(id==='manual') state.manual={...defaults};
  else if(id==='crop') state.crop=null;
  else if(id.startsWith('advisor:')) {
    const layerId=id.slice(8);
    state.advisorLayers=state.advisorLayers.filter(item=>item.id!==layerId);
    const message=currentPhoto()?.conversation.find(item=>item.id===layerId);
    if(message) message.applied=false;
  } else if(id.startsWith('region:')) {
    const item=state.annotations.find(item=>item.id===id.slice(7));
    if(item) item.localSettings=null;
  }
  saveEdit(before);renderSliders();renderAnalysis();
  if($('#tab-presets').classList.contains('active') || $('#tab-agent').classList.contains('active')) buildPresetThumbs(state.image);
  renderPresets();renderAgent();sizePhotoStage();scheduleRender();markAssessmentStale();
  showToast('已撤回这一项，其他调整保留。');
}

function hasEdits() {
  return Boolean(state.editDocument?.steps.length) || state.advisorLayers.some(item=>!item.annotationId) || state.active.size > 0 || Boolean(state.crop) || Boolean(state.presetId && state.presetAmount > 0) || adjustmentKeys.some(key => Math.abs(state.manual[key] || 0) > .001) || hasLocalEffects(state.annotations,state.advisorLayers);
}

function editingBlocked(photo=currentPhoto()){return Boolean(editStack?.busy(photo));}
function refreshActions() {
  $('#photo-export-shortcut').disabled=editingBlocked()||!state.image||state.loading||state.renderPending||state.renderFailed;
  $('#run-photo-review').disabled=!state.image||state.loading||state.analyzing;
  $('#run-photo-review').textContent=state.aiAvailable?'完整审片':'连接模型以审片';
  renderPhotoProposal();
  const photo=currentPhoto();
  if(photo && !photo.isDemo) state.exported=photo.lastExportSignature===currentAcceptanceSignature() || (photo.versions || []).some(item=>item.kind==='export' && item.signature===currentAcceptanceSignature());
  const edited = hasEdits();
  $('#photo-stage').classList.toggle('has-edits',edited);
  const visibility=inspectionVisibility({hasPhoto:Boolean(state.image),edited,past:editHistory.past.length,future:editHistory.future.length});
  $('#compare-controls').hidden=!visibility.comparison;
  $('#hold-compare').hidden=!visibility.comparison;
  if(!visibility.comparison)hideComparisonPopover();
  $('.photo-history').hidden=!visibility.history;
  $('#photo-reset').hidden=!edited;
  $('#versions-open').hidden=!state.image||Boolean(photo?.projectId);
  $('#mark-photo').hidden=!state.image;
  $('#heading-counter').hidden=!state.image;
  $('#open-tasks').hidden=!analysisQueue.tasks.length && !exportQueue.tasks.length;
  $('#photo-state').hidden=!state.image;
  $('#compare-slider').disabled = !edited;
  $('#hold-compare').disabled = !edited || state.renderPending || state.renderFailed;
  $('#compare-value').textContent = edited ? `${Math.round(state.compare)}%` : '原片';
  const review = reviewPresentation(state.analysis);
  const allApplied = review.fresh.every(item => state.active.has(item.id)) && (!state.analysis?.cropRecommendation || Boolean(state.crop));
  const busy = state.loading || state.analyzing || editingBlocked(photo);
  const hasSuggestions = review.count > 0;
  const showApply=studioTab==='diagnosis' && hasSuggestions && !allApplied;
  $('#apply-all').hidden = !showApply;
  $('.action-primary-row').classList.toggle('single-action',!showApply);
  $('#export-button-label').textContent = edited ? '导出成片' : '导出照片';
  $('#apply-all').disabled = busy || !state.analysis || !hasSuggestions || allApplied;
  $('#apply-all').classList.toggle('featured',!edited && hasSuggestions);
  $('#export-button').disabled = state.loading || editingBlocked(photo) || !state.image || state.renderPending || state.renderFailed;
  $('#export-button').title=state.renderFailed?'先重试预览，确认效果后再导出':state.renderPending?'效果更新后即可导出':'';
  $('#export-button').classList.toggle('featured',edited || Boolean(state.analysis && !hasSuggestions));
  document.querySelectorAll('[data-editor-action="upload"]').forEach(button => { button.disabled = state.loading || importingFiles || photoSessions.length >= 12; });
  document.querySelectorAll('[data-editor-action="undo"]').forEach(button => { button.disabled = !editHistory.past.length || busy; });
  document.querySelectorAll('[data-editor-action="redo"]').forEach(button => { button.disabled = !editHistory.future.length || busy; });
  document.querySelectorAll('[data-editor-action="reset"]').forEach(button => { button.disabled = (!edited && !state.presetId) || busy; });
  document.querySelectorAll('[data-editor-action="reassess"]').forEach(button => { button.disabled = !edited || state.assessmentBusy || busy; });
  const needsReview = edited && !state.assessment;
  $('#panel-diagnosis').classList.toggle('needs-review', needsReview);
  $('#panel-diagnosis').setAttribute('aria-label', needsReview ? '审片，有调整待复评' : '审片');
  const pieces = [];
  if (state.advisorLayers.some(item=>!item.annotationId)) pieces.push('顾问微调');
  if (state.active.size) pieces.push(`${state.active.size} 项建议`);
  if (state.crop) pieces.push('裁剪');
  if (state.presetId && state.presetAmount > 0) pieces.push(presetById(state.presetId)?.name || '风格');
  if (adjustmentKeys.some(key => Math.abs(state.manual[key] || 0) > .001)) pieces.push('手动参数');
  if (hasLocalEffects(state.annotations,state.advisorLayers)) pieces.push('局部微调');
  $('#edit-status').textContent = state.loading ? state.loadingPurpose === 'export' ? '正在导出照片…' : '正在读取照片…' : state.analyzing ? '正在分析画面…' : state.assessmentBusy ? '正在复评当前效果…' : state.exported ? '已导出 · 可以继续调整' : pieces.length ? `${pieces.join(' · ')}已生效` : review.kind === 'keep' ? '建议保留原片 · 可直接导出' : '原片就绪 · 可导出或手动调整';
  renderReviewConclusion();
  renderPanelGuidance();
  renderAdjustmentLayers();
  updateSliderTotals();
  syncPhotoTabs();
  renderDraftStatus();
  if($('#draft-dialog').open) renderVersions();
}

function currentPhotoPhase() {
  const photo=currentPhoto();
  return photoPhase({hasPhoto:Boolean(state.image),loading:state.loading,analyzing:state.analyzing,analysisStatus:state.analysisStatus,assessmentBusy:state.assessmentBusy,edited:hasEdits(),exported:state.exported,acceptedSignature:photo?.acceptedSignature,signature:state.image ? currentAcceptanceSignature():'',hasAcceptedRecord:tasteRecords.some(item=>item.id===photo?.acceptedRecordId)});
}
function renderPanelGuidance() {
  const phase=currentPhotoPhase(),review=reviewPresentation(state.analysis);
  $('#photo-state').textContent=phase.label;$('#photo-state').dataset.phase=phase.key;
  const pending=review.fresh.filter(item=>!state.active.has(item.id)).length+(state.analysis?.cropRecommendation && !state.crop ? 1:0);
  const guide=panelGuidance({tab:studioTab,phase:phase.key,kind:review.kind,pending,edited:hasEdits(),assessed:Boolean(state.assessment),visual:studioTab==='agent' ? state.aiAvailable && !currentPhoto()?.agentFallback:state.analysisSource==='ai',intent:cleanIntent(state.creativeIntent),hasConversation:Boolean(currentPhoto()?.conversation?.length)});
  $('#panel-next-title').textContent=guide.title;$('#panel-next-description').textContent=guide.description;
  const status=`${phase.label} · ${guide.title}`;if($('#edit-status').textContent!==status)$('#edit-status').textContent=status;
  const action=$('#panel-next-action');action.textContent=guide.label;action.hidden=!guide.action;action.disabled=state.loading || !state.image;nextPanelAction=guide.action;
  $('#suggestion-count').hidden=!review.count && !review.retainedCount;
  $('#tab-suggestions').hidden=!review.count && !review.retainedCount;
  $('.panel-guide').hidden=phase.key==='original' && review.kind==='keep' && !pending;
  $('#clear-manual').hidden=!adjustmentKeys.some(key=>Math.abs(state.manual[key] || 0)>.001);
  renderLearningContext();
}
function focusLightControls() {
  const group=$('#slider-exposure').closest('details');group.open=true;
  group.scrollIntoView({block:'nearest',behavior:'smooth'});$('#slider-exposure').focus({preventScroll:true});
}
$('#panel-next-action').addEventListener('click',()=>{
  const action=nextPanelAction;
  if(action==='adjust' || action==='suggestions')selectTab(action);
  if(action==='reassess')reassessPhoto();
  if(action==='export')openExportDialog();
  if(action==='versions')$('#versions-open').click();
  if(action==='tasks')$('#open-tasks').click();
  if(action==='light')focusLightControls();
  if(action==='style')openStyleCollection(collectionRanking()[0]?.preset.id);
  if(action==='compose')$('#agent-input').focus();
  if(action==='first-suggestion'){
    const card=[...document.querySelectorAll('.suggestion-card')].find(item=>!state.active.has(item.dataset.id));
    if(card){card.scrollIntoView({block:'nearest',behavior:'smooth'});card.querySelector('.suggestion-apply').focus({preventScroll:true});}
    else {$('#crop-suggestion').scrollIntoView({block:'nearest',behavior:'smooth'});$('#crop-suggestion button')?.focus({preventScroll:true});}
  }
});
function renderLearningContext() {
  $('#learn-practice').innerHTML=`${state.image ? '用当前照片练习':'添加照片开始练习'} <span data-icon="arrow-right"></span>`;hydrateIcons($('#learn-practice'));
  $('#learn-photo-context').textContent=state.image ? `当前照片 · ${state.imageName}`:'从你自己拍的一张照片开始。';
  $('#learning-photo-notes').hidden=!state.analysis?.lessons?.length || !state.image;
  $('#learn-note-source').textContent=state.analysisSource==='ai' ? '视觉审片提供':state.isDemo ? '示例讲解':'通用引导 · 未识别内容';
}
function renderSpaceNavigation() {
  const modalSpace=$('#library-dialog').open ? 'library':$('#profile-dialog').open ? 'profile':workspaceSpace;
  for(const [id,space] of [['nav-studio','studio'],['nav-library','library'],['nav-profile','profile'],['nav-learn','learn']]){
    const selected=modalSpace===space;const button=$(`#${id}`);button.classList.toggle('active',selected);selected ? button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');
  }
  document.querySelectorAll('.mobile-spaces [data-space]').forEach(button=>{const selected=modalSpace===button.dataset.space;selected ? button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');});
}
function showWorkspaceSpace(space) {
  endStyleAudition();
  const next=space==='learn' ? 'learn':'studio',changed=workspaceSpace!==next;
  workspaceSpace=next;
  $('.workspace').hidden=workspaceSpace==='learn';$('#learn-space').hidden=workspaceSpace!=='learn';document.body.dataset.space=workspaceSpace;
  renderLearningContext();renderSpaceNavigation();
  if(workspaceSpace==='studio' && state.image)sizePhotoStage();
  if(changed)window.scrollTo({top:0,behavior:'instant'});
}
$('#more-tools').addEventListener('click',()=>$('#more-tools-dialog').showModal());
$('#mobile-settings-button').addEventListener('click',()=>$('#more-tools-dialog').showModal());
$('#more-tools-close').addEventListener('click',()=>$('#more-tools-dialog').close());
$('#more-tools-dialog').addEventListener('click',event=>{
  const tool=event.target.closest('[data-workspace-tool]')?.dataset.workspaceTool;if(!tool)return;
  $('#more-tools-dialog').close();
  if(tool==='models')openVisionSettings();else if(tool==='projects')projectWorkspace.open();else if(tool==='drafts')$('#draft-status').click();else if(tool==='help')$('#help-button').click();
});
$('#try-example').addEventListener('click',async()=>{await addPhotoSource('/assets/alpine-demo.png','清晨的山脊',true);selectTab('agent');});
$('#empty-projects').addEventListener('click',()=>projectWorkspace.open());

$('#nav-learn').addEventListener('click',()=>showWorkspaceSpace('learn'));
document.querySelectorAll('.mobile-spaces [data-space]').forEach(button=>button.addEventListener('click',()=>{
  button.focus({preventScroll:true});
  if(button.dataset.space==='library')$('#nav-library').click();else if(button.dataset.space==='profile')$('#profile-button').click();else showWorkspaceSpace(button.dataset.space);
}));
$('#learn-practice').addEventListener('click',()=>{showWorkspaceSpace('studio');if(!state.image){fileInput.click();return;}selectTab('adjust');focusLightControls();});

function markAssessmentStale() {
  state.assessment = null;
  state.exported = false;
  renderDiagnosis();
  updateWorkflow();
  scheduleDraftSave();
}

function updateWorkflow() {
  refreshActions();
}

function drawHistogram(data, width, height) {
  const canvas = $('#histogram-canvas');
  const context = canvas.getContext('2d');
  const {histogram} = inspectPixels(data, width, height);
  const peak = Math.max(...histogram);
  context.clearRect(0,0,canvas.width,canvas.height);
  context.fillStyle = '#202426';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle = '#c0c8c9';
  const barWidth = canvas.width / histogram.length;
  histogram.forEach((count,index) => {
    const barHeight = Math.max(1, Math.sqrt(count / peak) * (canvas.height - 8));
    context.fillRect(index * barWidth, canvas.height - barHeight, Math.max(1, barWidth - 1), barHeight);
  });
}

function scheduleRender() {
  endStyleAudition();
  renderRevision++;
  const frameKey=JSON.stringify({photo:currentPhotoId,crop:state.crop});
  if(frameKey!==renderedFrameKey) editedCanvas.hidden=true;
  if(state.renderPending){photoRenderer.cancel();return;}if(!state.previewData)return;
  state.renderPending = true;state.renderFailed=false;$('#render-retry').hidden=true;refreshActions();
  $('#render-status').hidden = false;
  $('#render-status-text').textContent='正在更新效果…';
  hideComparisonPopover();
  requestAnimationFrame(async () => {
    try {
      while (state.previewData) {
        const revision=renderRevision,photoId=currentPhotoId;
        const source=currentPreviewPixels();
        let output;try{output=await photoRenderer.render(currentRenderJob(source.data,source.width,source.height));}catch(error){if(error.name==='AbortError'&&(revision!==renderRevision||photoId!==currentPhotoId))continue;throw error;}
        if (revision!==renderRevision || photoId!==currentPhotoId) continue;
        editedCanvas.width=source.width;editedCanvas.height=source.height;
        editedCanvas.getContext('2d',{willReadFrequently:true}).putImageData(new ImageData(output,source.width,source.height),0,0);
        editedCanvas.hidden=false;renderedFrameKey=JSON.stringify({photo:currentPhotoId,crop:state.crop});renderedEffectKey=currentEffectSignature();
        drawHistogram(output,source.width,source.height);renderToneCurve();
        break;
      }
      $('#render-status').hidden=true;
    } catch(error) {
      state.renderFailed=true;$('#render-status-text').textContent='预览未更新 · 已有编辑保留';$('#render-retry').hidden=false;
    } finally { state.renderPending=false;refreshActions();
      const queued=exportAfterPreview;if(queued){exportAfterPreview=null;if(!state.renderFailed&&queued.photoId===currentPhotoId&&queued.signature===currentEffectSignature()&&!document.querySelector('dialog[open]'))openExportDialog();else showToast('已应用调整，请确认当前效果后再导出。');}
    }
  });
}

function presetThumbnailSignature(){
  return JSON.stringify({photo:currentPhotoId,recipe:state.editDocument?renderHash(state.editDocument):null,manual:state.manual,active:[...state.active],recommendations:state.analysis?.recommendations,advisors:state.advisorLayers,notes:state.annotations,crop:state.crop,amount:state.presetAmount,taste:tasteRecords.map(item=>[item.id,item.presetId,item.presetAmount,item.recipe?.styles])});
}
function buildPresetThumbs(image){
  if(!image)return;
  const signature=presetThumbnailSignature();
  if(styleThumbnails.completedSignature===signature&&Object.keys(state.presetThumbs).length)return;
  const width = 320, height = 240;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  const source = cropPixelRect(state.crop,image.naturalWidth,image.naturalHeight);
  const sourceRatio = source.width / source.height;
  const targetRatio = width / height;
  const cropWidth = sourceRatio > targetRatio ? source.height * targetRatio : source.width;
  const cropHeight = sourceRatio > targetRatio ? source.height : source.width / targetRatio;
  drawPhotoSource(context,image,state.crop,width,height,{x:source.x+(source.width-cropWidth)/2,y:source.y+(source.height-cropHeight)/2,width:cropWidth,height:cropHeight});
  const original = context.getImageData(0, 0, width, height).data;
  const sourceRect={x:source.x+(source.width-cropWidth)/2,y:source.y+(source.height-cropHeight)/2,width:cropWidth,height:cropHeight};
  const thumbCrop={x:sourceRect.x/image.naturalWidth,y:sourceRect.y/image.naturalHeight,width:cropWidth/image.naturalWidth,height:cropHeight/image.naturalHeight};
  const snapshot=photoSnapshot(currentPhoto()),annotations=renderedAnnotations(),frame={fullWidth:image.naturalWidth,fullHeight:image.naturalHeight,sourceRect,angle:state.crop?.angle||0};
  const items=presets.map(preset=>{
    const amount=snapshot.presetId===preset.id?snapshot.presetAmount:rememberedStyleAmount(tasteRecords,preset.id,currentPhoto()?.subject)??75;
    const trial=snapshot.editDocument?presetTrial(snapshot.editDocument,preset.id,amount,{groupId:'thumb-'+preset.id+'-'+crypto.randomUUID().slice(0,8)}):null;
    return {id:preset.id,trial,job:{pixels:original,width,height,settings:globalAdjustments({...snapshot,preset,amount}),document:trial?.document,annotations,crop:{...thumbCrop,angle:state.crop?.angle||0},frame}};
  });
  return styleThumbnails.build({signature,photoId:currentPhotoId,image,items});
}

function renderPresets() {
  endStyleAudition();
  const ranked=collectionRanking();
  $('#style-audition-help').textContent=innerWidth<=600 ? '点缩略图预览，再点恢复；「调整与应用」可选择强度，应用后才保存。':'悬停或聚焦缩略图，临时预览；点击可停留查看。只有「应用」会保存调整。';
  renderCreativeIntent();
  $('#style-categories').innerHTML = styleCategories.map(item => `<button class="style-chip ${state.styleCategory === item.id ? 'active' : ''}" type="button" data-category="${item.id}" aria-pressed="${state.styleCategory === item.id}">${escapeHtml(item.label)}</button>`).join('');
  $('#recommendation-source').textContent = cleanIntent(state.creativeIntent) ? '优先按这张照片的调整目标推荐。点击风格可查看完整效果。' : reviewPresentation(state.analysis).kind === 'keep' ? '建议保留原片。也可以尝试以下风格，按照片光色和你的偏好排序。' : state.analysisSource === 'ai' && state.analysis?.styleMatches?.length ? '结合画面视觉分析、原片光色与历史定稿偏好排序' : tasteRecords.length ? `结合原片光色与 ${tasteRecords.length} 张定稿作品的倾向初筛；未识别新照片内容` : state.isDemo ? '根据示例照片已知的晨光场景、原片光色与个人偏好排序' : '依据原片亮度、色彩与个人偏好初筛；未识别画面内容';
  const picks=styleSelections(ranked,[...state.favoritePresets]);
  const pickCard=({preset,reason,source},favorite=false)=>`<article class="curated-style-card" data-preset="${escapeHtml(preset.id)}"><button type="button" class="style-audition-toggle" aria-label="预览：${escapeHtml(preset.name)}；再次点击恢复当前版本" aria-pressed="false" aria-describedby="style-audition-help"><img src="${state.presetThumbs[preset.id] || state.image?.src || ''}" alt="" /><span>${state.presetId===preset.id ? '当前风格':favorite ? '已收藏':source==='intent' ? '符合调整目标':source==='ai' ? '视觉推荐':source==='demo' ? '示例场景':'光色适配'}</span><em>${state.presetThumbs[preset.id] ? '预览':'准备预览'}</em></button><div><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.category)}</small><p>${escapeHtml(favorite ? preset.mood:reason)}</p><button type="button" class="style-preview-open">调整与应用 ↗</button></div></article>`;
  $('#style-recommendations').innerHTML=picks.recommended.map(item=>pickCard(item)).join('');
  $('.style-favorites').hidden=!picks.favorite.length && state.favoritePresets.size>0;
  $('.style-favorites .style-block-heading').hidden=!picks.favorite.length;
  $('#favorite-style-picks').innerHTML=picks.favorite.map(item=>pickCard(item,true)).join('') || '<button type="button" class="style-start-collection" data-style-start>收藏你的第一款风格 <span aria-hidden="true">↗</span></button>';
  $('#adjustment-style-status').textContent=state.presetId ? `${presetById(state.presetId)?.name || '当前风格'} · ${state.presetAmount}% 强度`:'原片色彩 · 可直接开始微调';
  renderStyleCollection(ranked);
  $('#preset-controls').hidden = !state.presetId;
  $('#preset-controls label').textContent = state.presetId ? `${presetById(state.presetId)?.name || '当前风格'} · 强度` : '当前风格 · 强度';
  $('#preset-amount').value = state.presetAmount;
  $('#preset-amount-value').textContent = `${state.presetAmount}%`;
}

function sizePhotoStage() {
  if(workspaceSpace==='learn')return;
  if (!state.previewData) return;
  const {width, height} = cropPixelRect(state.crop,state.previewData.width,state.previewData.height);
  const backdrop = $('.photo-backdrop');
  const padding = getComputedStyle(backdrop);
  const availableWidth = backdrop.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
  const availableHeight = window.innerWidth > 960
    ? backdrop.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom)
    : Math.min(window.innerHeight * .65,660);
  const maxHeight = Math.max(140,innerWidth<=960?Math.min(availableHeight,innerHeight*.42):availableHeight);
  const stage = $('#photo-stage');
  stage.classList.toggle('cropped',Boolean(state.crop));
  stage.style.aspectRatio = `${width}/${height}`;
  stage.style.width = '100%';
  stage.style.maxWidth = `${Math.max(1,Math.min(availableWidth,maxHeight * width / height))}px`;
  updateOriginalPreview();renderAnnotations();renderMaskOverlay();
  renderVisionEvidence();
}

async function addPhotoSource(src,name,isDemo=false,activate=true,originalBlob=null,{metadata,signal,strict=false}={}) {
  try {
    const image=await loadPhotoImage(src,{metadata,signal});
  const photo = {
    id:`photo-${nextPhotoId++}`,toolRuns:[],src,image,originalBlob,imageName:name,isDemo,subject:isDemo ? 'landscape' : 'unclassified',subjectSource:isDemo ? 'demo' : 'unclassified',
    creativeIntent:'',analysisIntent:'',previewSource:null,previewData:null,analysis:null,advisorLayers:[],active:new Set(),manual:{...defaults},crop:null,compare:50,annotations:[],
    presetId:null,presetAmount:75,presetThumbs:{},analysisSource:'local',analysisStatus:'idle',analysisError:null,analysisProvenance:null,originalInspection:null,
    originalRecommendations:null,assessment:null,exported:false,history:{past:[],future:[]},conversation:[],versions:[],agentBusy:false,agentFallback:false,agentDraft:'',agentFocusId:null
  };
    // Complete the first pixel read before adding a session. A failure cannot replace current work.
    try {preparePhotoPreview(photo);photo.analysis=onDemandReview(photo);photo.analysisStatus=isDemo?'example':'idle';} catch {throw new PhotoImportError('RESOURCE');}
    if(signal?.aborted)throw new PhotoImportError('CANCELLED');
    photoSessions.push(photo);
    renderPhotoTabs();
    if(activate)activatePhoto(photo.id);
    return photo;
  } catch(error) {
    if(src.startsWith('blob:'))URL.revokeObjectURL(src);
    if(strict)throw error;
    showToast('照片未能打开，请重新选择。当前编辑仍保留。');
    return null;
  }
}

function analyzeLocal(photo=state) {
  return buildBasicReview(photo.originalInspection,{isDemo:photo.isDemo});
}

function humanReviewCategory(value) {
  const text=String(value || '').trim();
  return /[\u4e00-\u9fff]/.test(text) ? text.slice(0,35):({exposure:'光线 · 曝光',color:'色彩 · 氛围',detail:'细节 · 清晰度',composition:'构图 · 画幅'})[text.toLowerCase()] || '画面调整';
}

function normalizeAnalysis(value,generation,photo=state) {
  const local = analyzeLocal(photo);
  if (!value || typeof value !== 'object' || !Array.isArray(value.recommendations)) throw new Error('Invalid review');
  const conclusion = validateReviewDecision(value);
  const observations = normalizeObservations(value.observations);
  const recommendations = Array.isArray(value.recommendations) ? value.recommendations.slice(0, 4).map((item, index) => ({
    id:`ai-${generation}-${index}`, title:String(item.title || '调整建议').slice(0, 35), category:humanReviewCategory(item.category),
    icon:['sun','palette','focus','layers'][index], reason:String(item.reason || '').slice(0, 200),
    goal:String(item.goal || '让主体与整体影调更清楚').slice(0, 140),
    caution:String(item.caution || '留意高光、暗部和肤色是否仍然自然').slice(0, 140),
    lesson:String(item.lesson || '').slice(0, 200),
    observationIds:Array.isArray(item.observationIds) ? item.observationIds.filter(key => Object.hasOwn(observationLabels,key)) : [],
    adjustments:Object.fromEntries(adjustmentKeys.map(key => {
      const value = Number(item.adjustments?.[key]);
      return [key, clamp(Number.isFinite(value) ? value : 0, key === 'exposure' ? -1.5 : ['warmth','tint'].includes(key) ? -75 : ['fade','vignette','grain','monochrome','sharpen','denoise'].includes(key) ? 0 : -50, key === 'exposure' ? 1.5 : ['warmth','tint'].includes(key) ? 75 : 50)];
    }))
  })) : local.recommendations;
  const metric = (key) => {
    const metricValue = Number(valueOrUndefined(value.metrics?.[key]));
    return Number.isFinite(metricValue) ? clamp(metricValue, 0, 100) : local.metrics[key];
  };
  const styleMatches = Array.isArray(value.styleMatches) ? value.styleMatches.filter(item => presetById(item?.id)).slice(0,3).map(item => ({id:item.id,reason:String(item.reason || '').slice(0,180)})).filter((item,index,array) => array.findIndex(other => other.id === item.id) === index) : [];
  const suggestedCrop = value.crop?.needed ? validCrop(value.crop,{suggestion:true}) : null;
  return {
    scene:String(value.scene || local.scene).slice(0, 60),
    subject:validSubject(value.subject),observations,conclusion,metricEvidence:normalizeMetricEvidence(value.metricEvidence),
    summary:String(value.summary || local.summary).slice(0, 320),
    metrics:Object.fromEntries(metricKeys.map(key => [key, metric(key)])),
    recommendedStyle:presetById(value.recommendedStyle) ? value.recommendedStyle : null,
    styleMatches:styleMatches.length ? styleMatches : presetById(value.recommendedStyle) ? [{id:value.recommendedStyle,reason:'视觉模型认为这组风格适合当前画面；请在原片预览中判断。'}] : [],
    cropReason:String(value.crop?.reason || '').slice(0,220),
    cropRecommendation:suggestedCrop ? {reason:String(value.crop.reason || '收紧边缘，让主体更集中。').slice(0,220),rect:suggestedCrop} : null,
    recommendations,
    lessons:Array.isArray(value.lessons) && value.lessons.length ? value.lessons.slice(0, 3).map(item => ({title:String(item.title || '').slice(0, 70),body:String(item.body || '').slice(0, 230)})) : local.lessons,
    insight:String(value.insight || local.insight).slice(0, 250)
  };
}

function valueOrUndefined(value) { return value === null || value === undefined ? undefined : value; }

function renderDiagnosis() {
  if (!state.analysis || !state.originalInspection) return;
  const before = state.assessment?.before || state.analysis.metrics;
  const after = state.assessment?.after;
  const cx = 120, cy = 101, radius = 65;
  const axisKeys = ['light','highlights','detail','contrast','color','shadows'];
  const position = (index, value) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return [cx + Math.cos(angle) * radius * value, cy + Math.sin(angle) * radius * value];
  };
  const points = (values, scale = 1) => axisKeys.map((key,index) => position(index, scale === 1 ? clamp((values[key] || 0) / 100,0,1) : scale).join(',')).join(' ');
  const rings = [.25,.5,.75,1].map(level => `<polygon points="${points(before,level)}" class="radar-ring" />`).join('');
  const spokes = axisKeys.map((_,index) => `<line x1="${cx}" y1="${cy}" x2="${position(index,1)[0]}" y2="${position(index,1)[1]}" class="radar-spoke" />`).join('');
  const labels = axisKeys.map((key,index) => {
    const [x,y] = position(index,1.35);
    return `<text x="${x}" y="${y + 3}" text-anchor="middle" class="radar-label">${escapeHtml(metricLabels[key].slice(0,2))}</text>`;
  }).join('');
  $('#diagnosis-radar').innerHTML = `${rings}${spokes}<polygon points="${points(before)}" class="radar-before" />${after ? `<polygon points="${points(after)}" class="radar-after" />` : ''}${labels}`;
  $('#diagnosis-legend').hidden = !after;
  const evidenceBefore = state.assessment?.beforeEvidence || state.analysis.metricEvidence;
  const evidenceAfter = state.assessment?.afterEvidence;
  const openKey = $('#metric-grid details[open]')?.dataset.metric;
  const visual = state.assessment ? state.assessment.source === 'ai' : state.analysisSource === 'ai';
  $('#diagnosis-scale').textContent = visual ? '视觉评分仅供参考，请结合照片和调整目标判断，不用于比较作品高低。' : '评分来自光色统计，未识别照片内容，分数并非越高越好。';
  $('#metric-grid').innerHTML = metricKeys.map(key => {
    const base = Math.round(before[key] || 0), current = after ? Math.round(after[key] || 0) : null;
    const delta = current === null ? 0 : current - base;
    const detail = item => item ? `<p>${escapeHtml(item.evidence)}</p><small>适用条件 · ${escapeHtml(item.condition)}</small>` : '<p>旧审片未提供此项依据，请重新审片。</p>';
    return `<details class="metric-tile" data-metric="${key}" ${openKey === key ? 'open' : ''}><summary><span>${escapeHtml(metricLabels[key])} <i>⌄</i></span><strong>${current ?? base}</strong>${current === null ? '' : `<small>原片 ${base} · ${delta > 0 ? '+' : ''}${delta}</small>`}</summary><div class="metric-evidence">${after ? '<b>原片</b>' : ''}${detail(evidenceBefore?.[key])}${after ? '<b>当前效果</b>'+detail(evidenceAfter?.[key]) : ''}</div></details>`;
  }).join('');
  const edited = hasEdits();
  $('#reassessment').hidden = !edited && !state.assessment;
  $('#assessment-title').textContent = state.assessmentBusy ? '正在复评当前效果' : state.assessment ? '编辑后复评' : edited ? '效果已变化，值得再看一眼' : '完成调整后再复评';
  $('#reassess-cancel').hidden=!state.assessmentBusy;
  $('#diagnosis-reassess').hidden=state.assessmentBusy;
  const assessment=state.assessment;
  const overview=assessment?.source==='ai' ? assessment.improvements?.[0]?.finding || assessment.preserved?.[0]?.finding || '未确认明确改善，请查看完整复评再决定是否保留。' : assessment?.summary;
  const caution=assessment?.source==='ai' ? assessment.tradeoffs?.[0]?.finding : assessment?.observation;
  $('#assessment-summary').textContent = state.assessmentBusy ? '正在比较原片与当前效果；可以取消，已有调整保留。' : overview || (edited ? '复评会比较原片与当前效果，也会指出调整的代价。' : '应用建议、风格或手动参数后可重新评估。');
  $('#assessment-observation').hidden = state.assessmentBusy || !caution;
  $('#assessment-observation').textContent = caution ? `留意 · ${caution}` : '';
  renderAssessmentExplanation();
  $('#reassess-label').textContent = state.assessmentBusy ? '评估中' : '复评';
  refreshActions();
}

function renderAssessmentExplanation() {
  const assessment=state.assessment,container=$('#assessment-details');
  container.hidden=!assessment;
  if(!assessment) {container.innerHTML='';return;}
  const source=assessment.source==='ai' ? `${assessment.provenance?.model || '视觉模型'} · 双图视觉复评` : assessment.failed ? '视觉复评未完成 · 仅显示光色统计' : '本地光色统计 · 未进行画面识别';
  const facts=assessment.effectFacts ? `<p class="assessment-source">实际调整 · ${formatAdjustmentChips(assessment.effectFacts.settings) || '无全局参数'}${assessment.effectFacts.crop ? ' · 包含裁剪':''} · ${assessment.effectFacts.localCount ? assessment.effectFacts.localCount+' 处局部范围':'无局部调整'}</p>`:'';
  const sections=[['improvements','改善',assessment.source==='ai' ? '没有确认明确改善。' : '统计不能确认画面改善。'],['tradeoffs','可能的不足','未观察到明确代价，仍需放大确认细节。'],['preserved','继续保留',assessment.source==='ai' ? '暂无保留建议。' : '主体、构图和情绪尚未判断。']];
  container.innerHTML=`<details class="assessment-evidence"><summary>完整对比结果</summary><p class="assessment-source">${escapeHtml(source)}${assessment.baselineSource==='original-review' ? ' · 沿用首次原片基准':''}</p>${facts}<p>${escapeHtml(assessment.summary)}</p>${assessment.observation ? `<p><strong>放大检查 · </strong>${escapeHtml(assessment.observation)}</p>`:''}${sections.map(([key,label,empty])=>`<details><summary>${label} · ${assessment[key]?.length || 0}</summary>${assessment[key]?.length ? assessment[key].map(item=>`<article><strong>${escapeHtml(item.finding)}</strong><p>${escapeHtml(item.evidence)}</p><small>适用条件 · ${escapeHtml(item.condition)}</small></article>`).join('') : `<p>${empty}</p>`}</details>`).join('')}</details>`;
}

async function refreshVisionAvailability(signal) {
  const response = await fetch('/api/status',{cache:'no-store',signal});
  if (!response.ok) throw new Error('STATUS_UNAVAILABLE');
  const status = await response.json();
  state.aiAvailable = status.aiAvailable === true;
  state.aiModel = String(status.model || '');
  state.visionConfigurationEditable=status.configurationEditable!==false;
  return status;
}

function renderAnalysisStatus() {
  $('#vision-status').dataset.status=state.analysisStatus;
  const sourceLabel = reviewSourceLabel(state);
  $('#analysis-mode').textContent = sourceLabel;
  $('#analysis-source-button').textContent = sourceLabel;
  $('#analysis-source-button').dataset.source = state.analysisSource;
  $('#analysis-source-button').title = '查看分析来源与模型连接设置';
  const priorVision = state.analysisSource === 'ai';
  $('#analysis-provenance').textContent = state.analyzing ? state.analysisStatus==='queued' ? '等待审片，已有结果与调整保留。':state.analysisStatus === 'checking' ? '正在检查模型连接，当前结果尚未更新。' : '正在通过视觉模型审阅原片，调整不会自动应用。' : priorVision
    ? `${state.analysisProvenance?.model || state.aiModel || '视觉模型'} · 原片视觉审阅${['fallback','unconfigured'].includes(state.analysisStatus) ? ' · 保留上次结果' : ''}`
    : state.isDemo ? '示例讲解与本地光色统计，尚未进行视觉识别。' : '仅测量亮度、色彩和对比度，未识别主体、背景或构图。';
  $('#analysis-provenance').title = priorVision ? `${state.analysisProvenance?.provider || '视觉服务'} · ${state.analysisProvenance?.analyzedAt ? new Date(state.analysisProvenance.analyzedAt).toLocaleString('zh-CN') : ''} · ${state.analysisProvenance?.promptVersion || ''}` : '';
  const panel = $('#vision-status');
  const notice=$('#vision-notice'),noticeKey=`${currentPhotoId}:${state.analyzing ? 'pending':state.analysisStatus}`;
  notice.hidden=!state.analyzing && (state.analysisStatus!=='fallback' && (state.analysisStatus!=='unconfigured' || studioTab!=='diagnosis'));
  panel.hidden=notice.hidden;
  if(notice.dataset.key!==noticeKey){notice.open=state.analysisStatus==='fallback';notice.dataset.key=noticeKey;}
  $('#vision-notice-summary').textContent=state.analyzing ? state.analysisStatus==='queued' ? '等待审片 · 查看进度':'正在审片 · 查看进度':state.analysisStatus==='fallback' ? '这次审片未完成 · 重试':'基础光色 · 尚未连接视觉审片';
  panel.dataset.status = state.analyzing ? 'analyzing' : state.analysisStatus;
  $('#vision-status-title').textContent = state.analyzing ? state.analysisStatus==='queued' ? '这张照片正在等待审片':state.analysisStatus === 'checking' ? '正在准备视觉审片' : '正在审阅这张原片' : state.analysisStatus === 'unconfigured' ? '尚未连接视觉审片' : priorVision ? '这次审片未完成' : '视觉审片未完成 · 当前为基础光色';
  $('#vision-status-message').textContent = state.analyzing ? state.analysisStatus==='queued' ? '前面的照片处理后会自动开始。你可以继续编辑这张照片，或切换查看已就绪的照片。':state.analysisStatus === 'checking' ? '正在检查连接；基础光色只测量像素分布，不识别画面内容。' : '观察主体、背景、光线与构图。你可以继续查看照片，或取消这次审片。' : state.analysisStatus === 'unconfigured'
    ? '基础光色不识别照片内容。连接视觉模型后，可获得有画面依据的修片建议。'
    : `${state.analysisError?.message || '视觉服务暂时不可用。'}${priorVision ? '上次审片结果与已有调整均已保留。' : hasEdits() ? '已有调整保留；本地结果不包含照片内容识别。' : '当前本地结果不包含照片内容识别。'}`;
  $('#vision-retry').hidden = state.analyzing || state.analysisStatus === 'unconfigured' || state.analysisError?.retryable === false;
  $('#vision-open-settings').hidden = state.analyzing;
  $('#vision-open-settings').textContent = !state.visionConfigurationEditable ? '模型连接状态':state.analysisStatus === 'unconfigured' ? '连接视觉审片' : '检查连接';
  $('#vision-cancel').hidden = !state.analyzing;
  renderReviewWait();
  renderVisionObservations();
}
function renderReviewWait() {
  if(!state.analyzing)return;
  const task=latestReviewTask(analysisQueue.tasks,currentPhotoId);
  const elapsed=elapsedReview(task);
  $('#vision-notice-summary').textContent=task?.status==='queued' ? '等待审片 · 可继续编辑':`${task?.message?.includes('自动重试') ? '校对建议 · 自动重试一次':'正在审片'}${elapsed ? ' · '+elapsed:''}`;
}
setInterval(()=>{renderReviewWait();renderAgentProgress();},1000);

function renderReviewConclusion() {
  const analysis = state.analysis;
  const visible = Boolean(analysis) && !state.analyzing;
  $('#review-conclusion').hidden = !visible;
  if (!analysis) return;
  const review = reviewPresentation(analysis);
  $('#review-conclusion').dataset.kind = review.kind;
  $('#review-conclusion-title').textContent = `${hasEdits() ? '原片审阅 · ' : ''}${review.title}`;
  $('#review-conclusion-reason').textContent = review.reason;
  const panel = $('#review-preservation');
  const wasOpen = panel.querySelector('details')?.open;
  panel.hidden = !visible;
  const list = review.preserved.length ? `<ul class="preservation-list">${review.preserved.map(item => `<li><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.finding)}</p></li>`).join('')}</ul>` : '';
  const controls = `<div class="preservation-actions"><button type="button" data-review-action="adjust">继续手动调整 <span aria-hidden="true">↗</span></button><button type="button" data-review-action="styles">试试其他风格 <span aria-hidden="true">↗</span></button>${review.kind === 'keep' && hasEdits() ? '<button type="button" data-review-action="original">恢复原片 · 可撤销</button>' : ''}</div>`;
  panel.hidden = !visible || !list && review.count > 0;
  panel.innerHTML = `<details class="preservation-details" ${wasOpen ? 'open' : ''}><summary>${list ? `值得保留的地方 · ${review.preserved.length} 项`:'其他调整方向'}</summary>${list}${!review.count ? controls : ''}${review.kind === 'keep' && hasEdits() ? '<p class="preservation-edit-note">结论针对原片。已有调整保留，可对照后决定是否恢复。</p>' : ''}</details>`;
}

function renderVisionObservations() {
  const container = $('#vision-observations');
  const observations = state.analysisSource === 'ai' || state.analysis?.observationSource === 'demo' ? state.analysis?.observations : null;
  const wasOpen=container.querySelector('.observation-collection')?.open;
  container.hidden = !observations;
  container.innerHTML = observations ? `<details class="observation-collection" ${wasOpen ? 'open':''}><summary>主体、构图与表达 <span>6 项观察</span></summary>`+ `<div class="vision-observations-heading"><strong>画面关系</strong><span>${state.analysis?.observationSource === 'demo' ? '示例 · 预置讲解' : '原片 · 视觉观察'}</span></div>${Object.entries(observationLabels).map(([key,label]) => {
    const item = observations[key];
    if(!item) return `<article class="vision-observation"><strong>${label}</strong><p>旧审片没有此项观察，请重新审片。</p></article>`;
    return `<article class="vision-observation"><div><strong>${label}</strong><span class="vision-verdict" data-verdict="${item.verdict}">${verdictLabels[item.verdict]}${item.confidence === 'low' && item.verdict !== 'uncertain' ? ' · 需确认' : ''}</span></div><p>${escapeHtml(item.finding)}</p><details><summary>观察依据${item.region ? '' : ' · ' + escapeHtml(item.location)}</summary><p>${escapeHtml(item.evidence)}</p><small>适用条件 · ${escapeHtml(item.condition || '旧结果未说明，请结合表达目标确认。')}</small></details>${item.region ? `<button type="button" data-vision-evidence="${key}" aria-pressed="${selectedEvidenceKey === key}"><span data-icon="focus"></span>${escapeHtml(item.location)} · ${selectedEvidenceKey === key ? '收起范围' : '看近似范围'}</button>` : ''}</article>`;
  }).join('')}${state.analysisSource==='ai' ? '<small class="vision-location-note">位置范围由视觉模型估计，用于查看依据，不是精确蒙版。</small>':''}</details>` : '';
  hydrateIcons(container);
  renderVisionEvidence();
}

function renderVisionEvidence() {
  const layer = $('#vision-evidence-layer');
  const observation = selectedEvidenceKey && state.analysis?.observations?.[selectedEvidenceKey];
  const area = observation?.region && state.analysisSource === 'ai' ? transformRect(observation.region,p=>originalToViewPoint(p,state.crop,state.image.naturalWidth,state.image.naturalHeight)) : null;
  layer.hidden = !area;
  layer.innerHTML = area ? `<div class="vision-evidence-box" style="left:${area.x*100}%;top:${area.y*100}%;width:${area.width*100}%;height:${area.height*100}%"><span>${observationLabels[selectedEvidenceKey]} · 近似范围</span></div><button type="button" id="vision-evidence-close" aria-label="收起视觉观察范围"><span data-icon="close"></span></button>` : '';
  hydrateIcons(layer);
}

function toggleVisionEvidence(key) {
  if (!Object.hasOwn(observationLabels,key)) return;
  selectedEvidenceKey = selectedEvidenceKey === key ? null : key;
  renderVisionObservations();
}

function photoReviewTrials(photo) {
  const source=document.createElement('canvas'),scale=Math.min(1,512/Math.max(photo.previewData.width,photo.previewData.height));
  source.width=Math.max(1,Math.round(photo.previewData.width*scale));source.height=Math.max(1,Math.round(photo.previewData.height*scale));
  const context=source.getContext('2d',{willReadFrequently:true});context.drawImage(photo.previewSource,0,0,source.width,source.height);
  const pixels=context.getImageData(0,0,source.width,source.height).data;
  return photoToolTrials(pixels,source.width,source.height).map(trial=>{context.putImageData(new ImageData(trial.pixels,source.width,source.height),0,0);return {settings:trial.settings,image:source.toDataURL('image/jpeg',.85),metering:photoMetering(trial.pixels,source.width,source.height)};});
}

function analyzeImage(photo=currentPhoto()) {
  if(!photo?.image)return;
  if(photo.id===currentPhotoId)commitPhotoInputs();
  preparePhotoPreview(photo);
  photo.analysis ||= analyzeLocal(photo);
  return analysisQueue.add({key:`analysis:${photo.id}`,label:photo.imageName,photoId:photo.id,kind:'analysis',run:async({signal,progress})=>{
    const controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});
    const analyzedIntent=cleanIntent(photo.creativeIntent);
    const timeout=setTimeout(()=>controller.abort('timeout'),115_000);let analysis=null,provenance=null,failure=null,configured=false;
    try {
      progress('检查模型连接');
      const status=state.aiAvailable ? {aiAvailable:true}:await refreshVisionAvailability(controller.signal);configured=status.aiAvailable;
      if(!configured)failure={code:'AI_NOT_CONFIGURED',message:'尚未配置视觉模型。',retryable:false};
      else {
        progress('视觉模型正在审阅原片');
        const payload={image:photo.previewSource.toDataURL('image/jpeg',.9),creativeIntent:analyzedIntent,photoReference:photoMetering(photo.previewData.data,photo.previewData.width,photo.previewData.height),trials:photoReviewTrials(photo)};
        let response,result;const started=Date.now();
        for(let attempt=0;attempt<2;attempt++){
          response=await fetch('/api/analyze',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,retryReview:attempt===1})});
          result=await readServiceJSON(response);
          if(response.ok || !retryReview(normalizeVisionFailure(result),{attempt,elapsedMs:Date.now()-started,aborted:controller.signal.aborted}))break;
          progress('视觉模型反馈未通过校验，自动重试一次');
        }
        if(!response.ok)failure=normalizeVisionFailure(result);
        else if(result.provenance?.source!=='vision' || typeof result.provenance.model!=='string')failure={code:'INVALID_MODEL_RESPONSE',message:'审片结果缺少有效来源信息，请重试。',retryable:true};
        else {try {analysis=normalizeAnalysis(result.analysis,++analysisGeneration,photo);provenance=result.provenance;}catch {failure={code:'INVALID_MODEL_RESPONSE',message:'审片缺少完整画面依据，请重试。',retryable:true};}}
      }
    } catch(error) {
      if(signal.aborted)throw error;
      failure=requestFailure(error,controller.signal,'视觉审片');
    } finally {clearTimeout(timeout);signal.removeEventListener('abort',abort);}
    signal.throwIfAborted();if(!photoSessions.includes(photo))throw new Error('照片已移出工作区');
    if(photo.id===currentPhotoId)commitPhotoInputs({finish:false});
    if(analyzedIntent!==cleanIntent(photo.creativeIntent))return {mode:'stale'};
    if(analysis) {
      photo.analysisIntent=analyzedIntent;
      photo.originalRecommendations=structuredClone(analysis.recommendations);
      photo.analysis=retainAppliedRecommendations(photo.analysis,analysis,photo.active);
      Object.assign(photo,{analysisSource:'ai',analysisStatus:'ready',analysisProvenance:provenance,analysisError:null});
      if(photo.subjectSource!=='manual' && analysis.subject!=='unclassified'){photo.subject=analysis.subject;photo.subjectSource='ai';}
    } else {photo.analysisError=failure;photo.analysisStatus=!configured && failure?.code==='AI_NOT_CONFIGURED' ? 'unconfigured':'fallback';}
    reflectPhotoAnalysis(photo);scheduleDraftSave();
    if(failure && failure.code!=='AI_NOT_CONFIGURED')throw new Error(failure.message);
    return {mode:analysis ? 'vision':'basic'};
  }});
}
function reflectPhotoAnalysis(photo) {
  if(photo.id!==currentPhotoId)return;
  $('#photo-subject').value=validSubject(photo.subject);selectedEvidenceKey=null;
  renderAnalysis();renderPresets();renderAgent();renderAnalysisStatus();refreshActions();
}

let codexModels=[];
function refreshCodexModelChoices() {
  for(const tier of Object.keys(tierNames)){
    const input=$(`#tier-${tier}-model`),select=$(`#tier-${tier}-choice`),value=input.value;
    select.replaceChildren(...codexModels.map(model=>new Option(model.name,model.id)));
    if(value&&!codexModels.some(m=>m.id===value)){const option=new Option(value+' · 尚未确认可用',value);option.disabled=true;select.add(option);}
    select.value=value;
    refreshTierEfforts(tier);
  }
}
function refreshTierEfforts(tier,value=$(`#tier-${tier}-effort`).value){
  const select=$(`#tier-${tier}-effort`),choices=modelEffortChoices($('#vision-provider').value,$(`#tier-${tier}-model`).value,codexModels);
  const labels={none:'关闭推理',minimal:'最小',low:'低',medium:'中',high:'高',xhigh:'更高',max:'最大',ultra:'极高'};
  select.replaceChildren(...choices.map(effort=>new Option(labels[effort],effort)));
  select.value=choices.includes(value)?value:choices.includes('medium')?'medium':choices[0]||'';
}
for(const tier of Object.keys(tierNames)){
  const input=$(`#tier-${tier}-model`),select=document.createElement('select');select.id=`tier-${tier}-choice`;select.hidden=true;select.setAttribute('aria-label',tierNames[tier]+'档模型');input.after(select);
  select.addEventListener('change',()=>{input.value=select.value;refreshTierEfforts(tier);});
}
function fillModelTiers(tiers) {
  for(const [tier,entry] of Object.entries(tiers)){$(`#tier-${tier}-model`).value=entry.model;refreshTierEfforts(tier,entry.effort);}
  refreshCodexModelChoices();
}
function readModelTiers() {
  return Object.fromEntries(Object.keys(tierNames).map(tier=>[tier,{model:$(`#tier-${tier}-model`).value.trim(),effort:$(`#tier-${tier}-effort`).value}]));
}
async function discoverLocalCodex() {
  $('#codex-use').hidden=true;
  $('#codex-discovery-status').textContent='正在检查本机 Codex…';
  try {
    const response=await fetch('/api/codex-status',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const info=await response.json();if(!response.ok)throw new Error(info.error?.message || '暂时无法读取 Codex 状态。');
    codexModels=info.models;refreshCodexModelChoices();
    $('#vision-model-options').innerHTML=info.models.map(model=>`<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join('');
    $('#codex-discovery-status').textContent=info.authenticated?'已检测到 Codex 的 ChatGPT 登录。':'请先在终端运行 codex login，使用 ChatGPT 登录。';
    $('#codex-use').hidden=!info.authenticated;
  }catch(error){$('#codex-discovery-status').textContent=error.message;}
}
$('#vision-default-tiers').addEventListener('click',()=>fillModelTiers(defaultModelTiers()));
$('#codex-use').addEventListener('click',event=>{
  $('#vision-provider').value='codex';updateVisionProvider();connectVision(event);
});

function updateVisionProvider() {
  const codex = $('#vision-provider').value === 'codex';
  for(const tier of Object.keys(tierNames)){$(`#tier-${tier}-model`).hidden=codex;$(`#tier-${tier}-model`).required=!codex;$(`#tier-${tier}-choice`).hidden=!codex;}
  refreshCodexModelChoices();
  $('#vision-api-key').closest('label').hidden = codex;
  $('#vision-endpoint').closest('details').hidden = codex;
  $('#vision-endpoint').required = !codex;
  $('#vision-codex-note').hidden = !codex;
  $('.vision-remember small').textContent=codex?'仅保存模型与档位；登录信息仍由 Codex 管理。':'密钥保存在本机服务的私有配置中，不进入浏览器存储。';
}
$('#vision-provider').addEventListener('change',updateVisionProvider);

async function openVisionSettings() {
  if ($('#help-dialog').open) $('#help-dialog').close();
  $('#vision-settings-error').hidden = true;
  $('#vision-api-key').value = '';
  $('#vision-remember').checked = false;
  $('#vision-settings-form').hidden=true;
  $('#vision-managed-note').hidden=true;
  $('#vision-settings-dialog').showModal();
  $('#vision-connection-summary').textContent = '正在读取连接状态…';
  try {
    const response = await fetch('/api/vision-config',{cache:'no-store'});
    if (!response.ok) throw new Error('CONFIG_UNAVAILABLE');
    const settings = await response.json();
    const editable=settings.configurationEditable!==false;
    state.visionConfigurationEditable=editable;
    $('#vision-settings-form').hidden=!editable;
    $('#vision-managed-note').hidden=editable;
    $('#vision-settings-title').textContent=editable ? '连接 AI 模型':'视觉审片状态';
    $('#vision-managed-note').textContent=settings.hasKey ? '视觉服务由工作台管理员提供。审片仅发送压缩预览，原片与手动调整仍由你掌握。':'这个工作台尚未启用视觉审片。你可以继续手动调色、裁剪、保存版本与导出；当前诊断只提供基础光色统计。';
    $('#vision-provider').value = settings.provider || 'api';
    updateVisionProvider();
    $('#vision-model').value = settings.model;
    fillModelTiers(settings.tiers || defaultModelTiers());
    $('#codex-discovery').hidden=!editable;
    if(editable)discoverLocalCodex();
    $('#vision-endpoint').value = settings.endpoint;
    $('#vision-api-key').placeholder = settings.hasKey ? '已配置密钥；留空保留' : '仅交给本机服务';
    $('#vision-connection-summary').textContent = settings.connectionStatus === 'ready' ? `连接已验证 · 标准档 ${settings.model}` : settings.connectionStatus === 'error' ? `上次请求未完成 · ${settings.lastError?.message || '请重试'}` : settings.aiAvailable ? `${settings.model} · 已配置，等待验证` : '尚未配置视觉服务';
  } catch {
    $('#vision-connection-summary').textContent = '暂时无法读取连接状态';
    $('#vision-managed-note').textContent='连接状态暂时无法读取，请稍后重试。照片与已有调整均保留。';
    $('#vision-managed-note').hidden=false;
    $('#vision-settings-error').textContent = location.hostname==='localhost'||location.hostname==='127.0.0.1' ? '请确认本机工作台服务正在运行，再重试。':'请检查网络，重新打开工作台后重试。';
    $('#vision-settings-error').hidden = false;
  }
}

function closeVisionSettings() {
  visionConfigController?.abort();
  $('#vision-api-key').value = '';
  $('#vision-settings-dialog').close();
}

async function connectVision(event) {
  event.preventDefault();
  if (visionConfigBusy) return;
  visionConfigBusy = true;
  const controller = new AbortController();
  visionConfigController = controller;
  const button = $('#vision-settings-connect');
  button.disabled = true;
  button.textContent = '正在验证图片识别…';
  $('#quick-codex-connect').disabled=true;$('#quick-codex-connect').textContent='正在连接并校验图片…';
  $('#vision-settings-error').hidden = true;
  const timeout = setTimeout(() => controller.abort('timeout'),95_000);
  try {
    const response = await fetch('/api/vision-config',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:$('#vision-provider').value,model:$('#tier-standard-model').value.trim(),tiers:readModelTiers(),apiKey:$('#vision-api-key').value.trim(),endpoint:$('#vision-endpoint').value.trim(),remember:$('#vision-remember').checked})});
    const result = await response.json();
    if (!response.ok) {
      $('#vision-settings-error').textContent = normalizeVisionFailure(result).message;
      $('#vision-settings-error').hidden = false;
      if(!$('#vision-settings-dialog').open)$('#vision-settings-dialog').showModal();
      return;
    }
    state.aiAvailable = result.aiAvailable;
    state.aiModel = result.model;
    $('#vision-api-key').value = '';
    $('#vision-settings-dialog').close();
    showToast('模型已连接。现在可以描述想改哪里。');
    renderAgent();
  } catch {
    if(!$('#vision-settings-dialog').open)$('#vision-settings-dialog').showModal();
    if ($('#vision-settings-dialog').open) {
      $('#vision-settings-error').textContent = controller.signal.reason === 'timeout' ? '连接验证等待超时，请重试。' : '未能连接本机服务，请检查网络后重试。';
      $('#vision-settings-error').hidden = false;
    }
  } finally {
    clearTimeout(timeout);
    visionConfigBusy = false;
    button.disabled = false;
    button.textContent = '验证并连接';
    $('#quick-codex-connect').disabled=false;$('#quick-codex-connect').textContent='使用本机 Codex';
  }
}

function renderAnalysis() {
  const a = state.analysis;
  if (!a) return;
  const expandedCards = new Map([...document.querySelectorAll('.suggestion-card')].map(card => [card.dataset.id, {
    open:card.querySelector('.suggestion-details')?.open,
    editing:card.classList.contains('editing'),
    lesson:card.classList.contains('expanded')
  }]));
  $('#analysis-scene').textContent = a.scene;
  $('#analysis-summary').textContent = a.summary;
  renderDiagnosis();
  renderCropSuggestion();
  const presentation = reviewPresentation(a);
  $('#suggestion-count').textContent = presentation.count ? `${presentation.count} 项建议` : presentation.retainedCount ? `无需新增调整 · ${presentation.retainedCount} 项已有调整保留` : presentation.kind === 'keep' ? '无需新增调整' : '暂无自动调整建议';
  $('#suggestions').innerHTML = a.recommendations.map(item => `
    <article class="suggestion-card ${state.active.has(item.id) ? 'applied' : ''} ${expandedCards.get(item.id)?.editing ? 'editing' : ''} ${expandedCards.get(item.id)?.lesson ? 'expanded' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="suggestion-top"><span class="suggestion-icon" data-icon="${escapeHtml(item.icon)}"></span><span class="suggestion-title"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.retained ? '已保留的调整 · ' + humanReviewCategory(item.category) : humanReviewCategory(item.category))}</small></span><button class="suggestion-apply" type="button" data-action="apply">${state.active.has(item.id) ? '撤回建议' : '预览建议'}</button></div>
      <p class="suggestion-preview">${escapeHtml(item.reason)}</p>
      ${item.observationIds?.some(key => a.observations?.[key]?.region) ? `<button class="suggestion-evidence-link" type="button" data-vision-evidence="${item.observationIds.find(key => a.observations?.[key]?.region)}">查看对应画面 <span aria-hidden="true">↗</span></button>` : ''}
      <details class="suggestion-details" ${expandedCards.get(item.id)?.open ? 'open' : ''}>
        <summary>依据与参数 <span aria-hidden="true">⌄</span></summary>
        <p class="suggestion-full-reason">${escapeHtml(item.reason)}</p>
        <div class="suggestion-brief"><span><b>目标</b>${escapeHtml(item.goal || '优化当前画面的光色关系')}</span><span><b>留意</b>${escapeHtml(item.caution || '别让调整失去自然感')}</span></div>
        <div class="suggestion-parameters">${formatAdjustmentChips(item.adjustments)}</div>
        <div class="suggestion-actions"><button class="edit-toggle" type="button" data-action="edit">${expandedCards.get(item.id)?.editing ? '收起参数' : '微调参数'}</button><button class="reason-toggle" type="button" data-action="reason">${expandedCards.get(item.id)?.lesson ? '收起原理' : '摄影原理'}</button></div>
        <div class="suggestion-editor">${renderSuggestionControls(item)}</div>
        <div class="suggestion-lesson">${escapeHtml(item.lesson)}</div>
      </details>
    </article>`).join('');
  hydrateIcons($('#suggestions'));
  $('#lesson-list').innerHTML = a.lessons.map((item, index) => `<article class="lesson-item"><span class="lesson-number">0${index+1}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></article>`).join('');
  const allApplied = presentation.fresh.every(item => state.active.has(item.id)) && (!a.cropRecommendation || state.crop);
  const applyLabel = !presentation.count ? '建议保留原片' : allApplied ? '建议已应用' : !presentation.fresh.length && a.cropRecommendation ? '预览裁剪建议' : presentation.count === 1 ? '预览这条建议' : '预览优化';
  $('#apply-all').innerHTML = `<span data-icon="sparkles"></span>${applyLabel}<span data-icon="arrow-right"></span>`;
  hydrateIcons($('#apply-all'));
  renderAnalysisStatus();
  refreshActions();
}

function renderCropSuggestion() {
  const suggestion = state.analysis?.cropRecommendation;
  const container = $('#crop-suggestion');
  container.hidden = !suggestion;
  if (suggestion) {
    const applied = Boolean(state.crop);
    const coverage = Math.round(suggestion.rect.width * suggestion.rect.height * 100);
    const currentCoverage = state.crop ? Math.round(state.crop.width * state.crop.height * 100) : null;
    const matchesSuggestion = applied && ['x','y','width','height'].every(key => Math.abs(state.crop[key] - suggestion.rect[key]) < .002);
    const coverageLabel = currentCoverage === null ? `建议保留约 ${coverage}% 画面` : matchesSuggestion ? `已按建议裁剪 · 保留 ${coverage}%` : `当前保留 ${currentCoverage}% · 建议 ${coverage}%`;
    container.innerHTML = `<article class="suggestion-card crop-suggestion-card ${applied ? 'applied' : ''}">
      <div class="suggestion-top"><span class="suggestion-icon" data-icon="crop"></span><span class="suggestion-title"><strong>收紧构图</strong><small>构图 · 裁剪</small></span><button class="suggestion-apply" type="button" data-crop-action="toggle" ${applied && !matchesSuggestion ? 'disabled' : ''}>${matchesSuggestion ? '撤回裁剪' : applied ? '已手动裁剪' : '预览裁剪'}</button></div>
      <p class="suggestion-preview">${escapeHtml(suggestion.reason)}</p>
      <div class="crop-suggestion-foot"><span>${coverageLabel}</span><button type="button" data-crop-action="edit">预览并微调 <span aria-hidden="true">↗</span></button></div>
    </article>`;
    hydrateIcons(container);
  } else container.innerHTML = '';
  $('#manual-crop-status').textContent = state.crop ? `保留 ${Math.round(state.crop.width * state.crop.height * 100)}% 画面` : '原始构图';
  $('#manual-crop-clear').hidden = !state.crop;
}

function renderSuggestionControls(item) {
  const specs = sliderSpecs.filter(spec => Math.abs(Number(item.adjustments?.[spec.key]) || 0) >= (spec.key === 'exposure' ? .02 : 1)).slice(0,7);
  return `${(specs.length ? specs : sliderSpecs.slice(0,3)).map(spec => `<label class="suggestion-slider"><span>${escapeHtml(spec.label)}<output>${formatSlider(item.adjustments[spec.key] || 0,spec)}</output></span><input type="range" data-key="${spec.key}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${item.adjustments[spec.key] || 0}" /></label>`).join('')}<p>更多参数可在「调整」中继续微调。</p>`;
}

function formatAdjustmentChips(settings) {
  return sliderSpecs.filter(spec => Math.abs(Number(settings?.[spec.key]) || 0) >= .001).slice(0, 4).map(spec => {
    const value = Number(Number(settings[spec.key]).toFixed(2));
    const display = `${value > 0 ? '+' : ''}${value}${spec.unit}`;
    return `<span>${escapeHtml(spec.label)} ${escapeHtml(display)}</span>`;
  }).join('');
}

function renderSliders() {
  const openGroups=new Set([...$('#manual-sliders').querySelectorAll('details[open]')].map(group=>group.dataset.group));
  if(!slidersInitialized){openGroups.add('light');slidersInitialized=true;}
  const focusId=document.activeElement?.closest('#manual-sliders input')?.id;
  $('#manual-sliders').innerHTML = controlGroups.map(group => `<details class="control-group" data-group="${group.id}" ${openGroups.has(group.id) ? 'open':''}>
    <summary><span><strong>${group.name}</strong><small>${group.description}</small></span><span class="group-chevron">⌄</span></summary>
    <div class="control-group-body">${group.id === 'curve' ? '<div class="tone-curve-card"><svg id="tone-curve" viewBox="0 0 240 160" role="img" aria-label="当前影调曲线"></svg><span>当前合成曲线 · 左暗右亮</span></div>' : ''}${sliderSpecs.filter(spec => spec.group === group.id).map(spec => `<div class="slider-row"><div><label for="slider-${spec.key}">${spec.label}</label><output id="output-${spec.key}">${formatSlider(state.manual[spec.key], spec)}</output></div><input id="slider-${spec.key}" data-key="${spec.key}" type="range" min="${Math.min(spec.min,state.manual[spec.key])}" max="${Math.max(spec.max,state.manual[spec.key])}" step="${spec.step}" value="${state.manual[spec.key]}" /><small class="slider-total" id="total-${spec.key}"></small></div>`).join('')}</div>
  </details>`).join('');
  renderToneCurve();
  updateSliderTotals();
  if(focusId)document.getElementById(focusId)?.focus({preventScroll:true});
}

function formatSlider(value, spec) { const number=Number(Number(value).toFixed(2));return `${number > 0 ? '+' : ''}${number}${spec.unit}`; }

function renderToneCurve() {
  const svg = $('#tone-curve');
  if (!svg) return;
  const settings = getAdjustments();
  const curve=buildToneCurve(settings);
  const coordinates = Array.from({length:81},(_,index) => {
    const x=index/80,y=mapTone(curve,x);
    return `${index ? 'L':'M'} ${12+x*216} ${148-y*136}`;
  }).join(' ');
  svg.innerHTML = `<path d="M 12 148 L 228 148 M 12 148 L 12 12" class="curve-edge" />
    <path d="M 12 80 L 228 80 M 120 12 L 120 148" class="curve-grid" />
    <path d="M 12 148 L 228 12" class="curve-baseline" />
    <path d="${coordinates}" class="curve-line" />`;
}

function agentActionMarkup(message,index) {
  const action=message.action;if(!action || action.kind==='none')return '';
  const applied=message.applied || (action.kind==='style' ? state.presetId===action.presetId:action.kind==='crop' ? Boolean(state.crop && ['x','y','width','height'].every(key=>Math.abs(state.crop[key]-action.crop[key])<.001)):state.advisorLayers.some(item=>item.id===message.id));
  const notesChanged=annotationsChanged(message,renderedAnnotations());
  const stale=!applied && (notesChanged || (message.baseSignature && message.baseSignature!==currentEffectSignature()) || cleanIntent(message.baseIntent)!==cleanIntent(state.creativeIntent));
  const unavailable=action.kind==='region' && !state.annotations.some(item=>item.id===action.annotationId);
  const explanation=actionExplanation(action);
  return `<div class="agent-action staged-action"><div class="agent-action-copy"><strong>${escapeHtml(explanation.goal)}</strong><small>${escapeHtml(explanation.scope)}</small><small>${escapeHtml(agentChanges(action))}</small></div><button type="button" data-agent-apply="${index}" ${applied || unavailable || stale ? 'disabled':''}>${unavailable ? '标记已删除':stale ? notesChanged ? '批注已更新 · 请重新提问':'目标或画面已变化 · 请重问':applied ? '已应用':'先预览'}</button></div>`;
}
function toolInputSummary(operation,operations){
  const target=operation.target;
  const scope=target.kind==='image'?'整张':target.kind==='object'?`对象「${target.name}」`:target.kind==='annotation'?'已有标记':target.kind==='output'?`沿用「${operations.find(op=>op.id===target.operationId)?.title||target.operationId}」`:'蒙版范围';
  const params=Object.entries(operation.parameters).map(([key,value])=>{
    if(key==='changes')return value.map(change=>`${settingLabels[change.key]||change.key} ${change.value>0?'+':''}${change.value}${change.key==='exposure'?' EV':''}`).join('、');
    if(key==='mode')return value==='delta'?'增量':'目标值';
    if(key==='angle')return `角度 ${value}°`;
    if(key==='amount')return `强度 ${value}%`;
    if(key==='id')return presetById(value)?.name||value;
    return value===null?'':`${key} ${typeof value==='object'?JSON.stringify(value):value}`;
  }).filter(Boolean).join(' · ');
  return [scope,params,target.mask?.exclude?.length?`排除 ${target.mask.exclude.length} 处`:null].filter(Boolean).join(' · ');
}
function agentChanges(action) {
  if(action.kind==='document')return action.proposal.items.map(item=>item.title).join('；');
  return action.kind==='tools' ? action.operations.map((operation,index)=>`${index+1}. ${operation.title} · ${toolInputSummary(operation,action.operations)}`).join('；'):action.kind==='plan' ? action.steps.map((step,i)=>`${i+1}. ${step.label}${step.kind==='rotate' ? ` ${step.angle>0?'+':''}${step.angle}°`:step.kind==='masked' ? ` · 蒙版${step.exclude.length ? `，排除 ${step.exclude.length} 处`:''}`:''}`).join('；'):action.kind==='style' ? `替换当前风格为「${presetById(action.presetId)?.name}」；其他调整保留`:action.kind==='crop' ? `保留约 ${Math.round(action.crop.width*action.crop.height*100)}% 原画幅；光色参数保持`:action.changes.map(item=>`${settingLabels[item.key] || item.key} ${item.value>0 ? '+':''}${Number(item.value.toFixed(2))}${item.key==='exposure' ? ' EV':''}`).join(' · ');
}

function selectedAnnotation() { return state.annotations.find(item => item.id === selectedAnnotationId); }

function setMarkingPhoto(on) {
  markingPhoto = Boolean(on && currentPhoto() && !state.loading);
  const button = $('#mark-photo');
  button.setAttribute('aria-pressed',String(markingPhoto));
  button.classList.toggle('active',markingPhoto);
  $('#photo-stage').classList.toggle('marking',markingPhoto);
  if (!markingPhoto) { annotationDrag = null; $('#annotation-draft').hidden = true; }
}

function renderAnnotations() {
  const layer = $('#annotation-layer');
  layer.innerHTML = state.annotations.map((item,index) => {
    const locatorRect=item.maskType==='linear' && item.start && item.end ? rectFromPoints(item.start,item.end,.06):item.rect;
    const rect = transformRect(locatorRect,p=>originalToViewPoint(p,state.crop,state.image.naturalWidth,state.image.naturalHeight));
    if (!rect) return '';
    return `<button type="button" class="annotation-box${item.id === selectedAnnotationId ? ' selected' : ''}" data-annotation-id="${item.id}" data-annotation-peek="live" data-note-index="${index}" aria-controls="annotation-peek" aria-expanded="false" style="left:${rect.x*100}%;top:${rect.y*100}%;width:${rect.width*100}%;height:${rect.height*100}%" aria-label="查看标记 ${index+1}${item.note ? `：${escapeHtml(item.note)}` : ''}"><span>${index+1}</span></button>`;
  }).join('');
  const list = $('#annotation-list');
  list.innerHTML = state.annotations.length ? state.annotations.map((item,index) => `<button type="button" class="annotation-list-item${item.id === selectedAnnotationId ? ' selected' : ''}" data-annotation-select="${item.id}" data-annotation-peek="live" data-note-index="${index}" aria-controls="annotation-peek" aria-expanded="false" aria-pressed="${item.id === selectedAnnotationId}"><span>${index+1}</span><em>${escapeHtml(item.note || '添加这处的问题描述')}${item.localSettings || state.advisorLayers.some(layer=>layer.annotationId===item.id) ? item.localEnabled===false ? ' · 效果已暂停':' · 已微调' : ''}</em></button>`).join('') : '';
  $('#annotation-board').classList.toggle('empty',!state.annotations.length);
  $('#annotation-board .annotation-board-head small').textContent=state.annotations.length ? '选择一处标记，继续描述或微调':'有具体位置的问题？在画面上标记';
  const selected = selectedAnnotation();
  const selectedHasEdit=selected && Object.values(renderedAnnotations().find(item=>item.id===selected.id)?.localSettings || {}).some(Boolean);
  $('#annotation-editor').hidden = !selected;
  if (selected) {
    $('#annotation-note-label').textContent = `标记 ${state.annotations.indexOf(selected)+1} · 你的想法`;
    if (document.activeElement !== $('#annotation-note')) $('#annotation-note').value = selected.note;
  }
  $('#annotation-local-controls').hidden = Boolean(state.editDocument)||!selectedHasEdit;
  if (selectedHasEdit) {
    $('#annotation-strength').value = selected.localAmount ?? 100;
    $('#annotation-strength-value').textContent = `${selected.localAmount ?? 100}%`;
  }
  $('#annotation-ask').disabled = !selected?.note.trim() || Boolean(currentPhoto()?.agentBusy) || !state.analysis;
  $('#agent-mark-photo').disabled = !currentPhoto() || state.loading || state.annotations.length >= 8;
  $('#mark-photo').disabled = !currentPhoto() || state.loading || state.annotations.length >= 8 && !markingPhoto;
  renderAgentContext();
  annotationPeek.refresh();
  renderMaskOverlay();
}

function finishAnnotationNote() {
  if (!annotationNoteBefore) return;
  saveEdit(annotationNoteBefore);
  annotationNoteBefore = null;
}

function showAnnotationDraft(rect) {
  const box = $('#annotation-draft');
  box.hidden = false;
  Object.assign(box.style,{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:`${rect.height*100}%`});
}

function pointOnStage(event) {
  const rect = $('#photo-stage').getBoundingClientRect();
  return {x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
}

function addAnnotation(viewRect) {
  if(stackDrawing&&stackDrawing.photoId===currentPhotoId){
    const {shape,stepId,operation}=stackDrawing,W=state.image.naturalWidth,H=state.image.naturalHeight,convert=p=>viewToOriginalPoint(p,state.crop,W,H);let expression;
    if(shape==='brush'){const points=annotationBrushPoints.map(convert),rect=brushBounds(points,.03,W,H);expression={kind:'drawn',mask:{shape,rect,points,radius:.03,feather:.36,exclude:[]}};}
    else if(shape==='linear')expression={kind:'drawn',mask:{shape,rect:{x:0,y:0,width:1,height:1},start:convert(annotationShapeStart),end:convert(annotationShapeEnd),feather:.36,exclude:[]}};
    else{const o=convert({x:viewRect.x,y:viewRect.y}),a=convert({x:viewRect.x+viewRect.width,y:viewRect.y}),b=convert({x:viewRect.x,y:viewRect.y+viewRect.height});expression={kind:'drawn',mask:{shape,rect:{x:0,y:0,width:1,height:1},feather:.36,exclude:[]},basis:{origin:o,xAxis:{x:a.x-o.x,y:a.y-o.y},yAxis:{x:b.x-o.x,y:b.y-o.y}}};}
    const step=state.editDocument.steps.find(step=>step.id===stepId),prior=state.editDocument.masks.find(mask=>mask.id===step?.maskRef?.id&&mask.version===step.maskRef.version);if(prior&&operation&&operation!=='replace')expression={kind:operation,a:structuredClone(prior.expression),b:expression};
    stackDrawing=null;annotationShapeStart=null;annotationShapeEnd=null;annotationBrushPoints=[];setMarkingPhoto(false);editStack.command([{type:'ReplaceStepMask',stepId,mask:{expression,reference:prior&&operation!=='replace'?prior.reference:{kind:'live-input'}}}]);return;
  }
  if (!currentPhoto() || state.annotations.length >= 8) return;
  const before = beforeEdit();
  const W=state.image.naturalWidth,H=state.image.naturalHeight;
  const rect=transformRect(viewRect,p=>viewToOriginalPoint(p,state.crop,W,H));
  if(!rect)return;
  const item = {id:`note-${nextAnnotationId++}`,rect,note:'',maskType:maskTool,feather:.36,localEnabled:true};
  if(maskTool==='linear') {item.start=viewToOriginalPoint(annotationShapeStart || {x:viewRect.x,y:viewRect.y},state.crop,W,H);item.end=viewToOriginalPoint(annotationShapeEnd || {x:viewRect.x,y:viewRect.y+viewRect.height},state.crop,W,H);item.rect={x:0,y:0,width:1,height:1};}
  if(maskTool==='brush') {item.points=(annotationBrushPoints.length ? annotationBrushPoints:[{x:viewRect.x+viewRect.width/2,y:viewRect.y+viewRect.height/2}]).map(p=>viewToOriginalPoint(p,state.crop,W,H));item.brushRadius=.03;item.rect=brushBounds(item.points,item.brushRadius,W,H);}
  state.annotations.push(item);annotationShapeStart=null;annotationShapeEnd=null;annotationBrushPoints=[];
  selectedAnnotationId = item.id;
  saveEdit(before);
  setMarkingPhoto(false);
  renderAnnotations();
  if(localToolCreating) {selectTab('adjust');renderLocalEditor();localToolCreating=false;showToast('范围已保留，调整参数后即可看到效果。');return;}
  currentPhoto().agentFocusId=item.id;
  selectTab('agent');
  $('#agent-annotations').open=true;
  $('#annotation-note').focus();
  $('#annotation-board').scrollIntoView({block:'nearest',behavior:'smooth'});
  showToast('已标记这处画面。写下哪里不满意，顾问会结合它给建议。');
}

function renderAgentContext() {
  const scopePhoto=currentPhoto(),scopeId=scopePhoto?.editView?.scopeStepId,scopeStep=scopePhoto?.editDocument?.steps.find(step=>step.id===scopeId);let chip=$('#agent-step-scope');if(!chip){chip=document.createElement('button');chip.id='agent-step-scope';chip.type='button';chip.addEventListener('click',()=>{if(currentPhoto()?.editView)currentPhoto().editView.scopeStepId=null;renderAgentContext();});$('#agent-form').prepend(chip);}chip.hidden=!scopeStep;chip.textContent=scopeStep?'修改「'+scopeStep.title+'」 · 点击取消指定':'';

  const photo=currentPhoto();
  const context=snapshotAnnotations(renderedAnnotations(),photo?.agentFocusId);
  if(photo)photo.agentFocusId=context.focusId;
  $('#agent-annotation-count').textContent=context.count;
  $('#agent-annotations').hidden=!context.count;
  $('#agent-annotation-sync').textContent=context.notedCount ? `${context.notedCount} 条说明 · 发送时读取最新`:'发送时读取最新内容';
  const attachments=$('#agent-compose-attachments');
  attachments.hidden=!context.count;
  const attachmentKey=JSON.stringify({items:context.items.map(({id,number,note,rect})=>({id,number,note,rect})),focus:context.focusNumber});
  if(attachments.dataset.key!==attachmentKey) {
    attachments.dataset.key=attachmentKey;
    attachments.innerHTML=context.count ? `<span>随消息附带 ${context.count} 处</span><div class="annotation-attachment-row">${attachmentChips(context.items,context.focusNumber,'live')}</div>`:'';
    hydrateIcons(attachments);
  }
  $('#agent-focus').hidden=!context.focusNumber;
  $('#agent-focus-summary').textContent=context.focusNumber ? `重点讨论标记 ${context.focusNumber} · ${context.items.find(item=>item.id===context.focusId)?.note || '暂无描述'}`:'';
  $('#agent-compose-scope').textContent=context.count ? `全部 ${context.count} 处都会发送`:'当前照片';
  $('#agent-context-effect').textContent=hasEdits() ? '读取当前编辑效果':'读取原片画面';
  $('#agent-intent-edit').textContent=cleanIntent(state.creativeIntent) ? '已设目标':'调整目标';
  $('#agent-intent-edit').title=cleanIntent(state.creativeIntent) || '设置这张照片的调整目标';
  $('#agent-intent-edit').disabled=!photo;
  $('#agent-connect-banner').hidden=!photo||state.aiAvailable;
  $('#quick-codex-connect').hidden=state.visionConfigurationEditable===false;
  $('#photo-export-shortcut').disabled=!photo||state.loading||state.renderPending||state.renderFailed;
  $('#agent-export').disabled=!photo || state.loading;
  $('#agent-view-photo').disabled=!photo;
  annotationPeek.refresh();
  for(const button of $('#agent-thread').querySelectorAll('[data-agent-apply]')) {
    const message=photo?.conversation[Number(button.dataset.agentApply)];
    if(message && !message.applied && annotationsChanged(message,renderedAnnotations())) {
      button.disabled=true;button.textContent='批注已更新 · 请重新提问';
    }
  }
}
function resizeAgentInput() {
  const input=$('#agent-input'),minimum=parseFloat(getComputedStyle(input).minHeight)||56;
  input.style.height='0px';input.style.height=`${Math.max(minimum,Math.min(140,input.scrollHeight))}px`;
}
function refreshAgentComposer() {
  const photo=currentPhoto(),busy=Boolean(photo?.agentBusy);
  $('#agent-send').disabled=!photo || !state.analysis || busy || !$('#agent-input').value.trim();
  $('#agent-send').hidden=busy;$('#agent-stop').hidden=!busy;
  $('#agent-input').disabled=!photo;
  $('#agent-composer-hint').textContent=busy ? '正在回复，可先写下一条消息':'Enter 发送 · Shift Enter 换行';
  $('#agent-input').placeholder=!photo ? '先打开一张照片':busy ? '可以先写下一条想法…':'说说你的修图想法，或向顾问提问…';
}
function attachmentChips(items,focusNumber,source,messageIndex='') {
  return items.map((item,index)=>`<button class="annotation-attachment${item.number===focusNumber ? ' is-priority':''}" type="button" data-annotation-peek="${source}" data-message-index="${messageIndex}" data-note-index="${index}" aria-controls="annotation-peek" aria-expanded="false" aria-label="查看${source==='message' ? '附带的':'待发送的'}标记 ${item.number}${item.number===focusNumber ? '，重点讨论':''}：${escapeHtml(item.note || '尚未填写评论')}"><span data-icon="message"></span><b>${item.number}</b>${item.number===focusNumber ? '<em>重点</em>':''}</button>`).join('');
}
function agentMessageContext(message,index) {
  const notes=attachmentContext(message,currentPhoto()?.conversation[index+1]);
  if(!notes.length)return '';
  return `<div class="agent-message-context" role="group" aria-label="这条消息附带的 ${notes.length} 处批注"><span>附带 ${notes.length} 处批注</span><div class="annotation-attachment-row">${attachmentChips(notes,message.context.focusNumber,'message',index)}</div></div>`;
}
const annotationPeek=createAnnotationPeek({
  getEntry(anchor) {
    if(anchor.classList.contains('annotation-box') && markingPhoto)return null;
    if(anchor.dataset.annotationPeek==='message') {
      const index=Number(anchor.dataset.messageIndex),conversation=currentPhoto()?.conversation;
      return attachmentContext(conversation?.[index],conversation?.[index+1])[Number(anchor.dataset.noteIndex)];
    }
    return snapshotAnnotations(renderedAnnotations()).items[Number(anchor.dataset.noteIndex)];
  },
  getImage:()=>state.image,
  highlight(item) {
    const layer=$('#annotation-peek-layer');
    const rect=item?.rect && state.image ? transformRect(item.rect,p=>originalToViewPoint(p,state.crop,state.image.naturalWidth,state.image.naturalHeight)):null;
    layer.hidden=!rect;
    layer.innerHTML=rect ? `<div style="left:${rect.x*100}%;top:${rect.y*100}%;width:${rect.width*100}%;height:${rect.height*100}%"><span>${item.number}</span></div>`:'';
  }
});

function renderAgent({follow=false}={}) {
  annotationPeek.hide();
  const photo = currentPhoto();
  const mode = !state.aiAvailable || photo?.agentFallback && !photo?.agentBusy ? '本地引导' : '视觉对话';
  $('#agent-context-photo').textContent = photo?.imageName || '尚未打开照片';
  $('#agent-mode').textContent = mode;
  $('#agent-mode').dataset.source=mode==='视觉对话' ? 'ai':'local';
  $('#agent-mode').title=mode==='视觉对话' ? '发送当前照片、最新批注与最近对话；点击查看视觉连接':'本地模式仅分析基础光色，不识别画面内容；点击查看服务连接';
  const thumbnail=$('#agent-context-thumb');thumbnail.hidden=!photo;if(photo && thumbnail.getAttribute('src')!==photo.src)thumbnail.src=photo.src;
  $('#agent-privacy').textContent = mode === '视觉对话'
    ? '视觉模式会发送当前照片的压缩预览、标记及最近对话；对话随草稿保存。'
    : '本地引导读取光色与标记区域，不识别具体物体；批注随草稿保存。';
  const thread = $('#agent-thread'),scroller=$('.agent-body');
  const reading=readerPosition({visible:scroller.clientHeight>0,samePhoto:agentThreadPhoto===photo?.id,offset:scroller.scrollTop,
    remaining:scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop,saved:agentReading.get(photo?.id),forceFollow:follow});
  const newestReply=photo?.conversation?.findLast(item=>item.role==='assistant')?.id || '';
  const newReply=newestReply && thread.dataset.reply!==newestReply;
  thread.dataset.reply=newestReply;
  agentThreadPhoto=photo?.id;
  thread.classList.toggle('empty',!photo?.conversation?.length);
  if (!photo?.conversation?.length) {
    thread.innerHTML='';
  } else {
    thread.innerHTML = photo.conversation.map((message,index) => message.role === 'status'
      ? `<div class="agent-request-status" role="status">${escapeHtml(message.text)}${message.requestQuestion ? `<button type="button" data-agent-retry="${index}" ${photo.agentBusy ? 'disabled':''}>继续这条提问</button>`:''}</div>` : message.role === 'user'
      ? `<div class="agent-message user">${escapeHtml(message.text)}${agentMessageContext(message,index)}</div>`
      : `<div class="agent-message assistant" data-reply-id="${escapeHtml(message.id || String(index))}"><div class="agent-message-head"><i class="xiaozhen-message-avatar"><img class="xiaozhen-avatar" src="/assets/xiaozhen-avatar.png?v=1" alt="" /></i>小帧 · ${message.source === 'ai' ? '审美顾问' : message.source === 'local' ? '本地引导':'历史回复'}</div>${message.provenance?.model ? `<small class="agent-model-source">${escapeHtml(message.provenance.model)} · ${escapeHtml(tierNames[message.provenance.tier] || '标准')}</small>`:''}${message.failure ? `<div class="agent-failure"><p>${escapeHtml(message.failure)}</p><button type="button" data-agent-retry="${index}" ${photo.agentBusy || !state.aiAvailable ? 'disabled':''}>用最新批注重试</button></div>`:''}<div class="agent-message-body">${escapeHtml(message.text)}</div>${message.principle ? `<p class="agent-principle"><b>摄影笔记</b> · ${escapeHtml(message.principle)}</p>` : ''}${message.clarification ? `<div class="agent-clarification"><strong>${escapeHtml(message.clarification.question)}</strong>${message.clarification.choices.map(choice=>`<button type="button" data-agent-intent="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join('')}</div>` : ''}${agentActionMarkup(message,index)}</div>`).join('');
  }
  hydrateIcons(thread);
  if (photo?.agentBusy) {thread.insertAdjacentHTML('beforeend','<div class="agent-typing" role="status"><span></span><p class="agent-partial"></p></div>');renderAgentProgress();}
  $('#agent-input').value=photo?.agentDraft || '';
  resizeAgentInput();refreshAgentComposer();
  $('#agent-prompts').querySelectorAll('button').forEach(button => { button.disabled = !photo || !state.analysis || Boolean(photo.agentBusy); });
  $('#agent-prompts').hidden=Boolean(photo?.conversation?.length);
  $('#agent-welcome').hidden=Boolean(photo?.conversation?.length);
  $('.right-panel').classList.toggle('has-conversation',Boolean(photo?.conversation?.length));
  renderAnnotations();renderPanelGuidance();renderPhotoProposal();
  if(newReply && reading.follow){const reply=[...thread.querySelectorAll('[data-reply-id]')].find(item=>item.dataset.replyId===newestReply);reading.offset=reply ? reply.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop:0;reading.follow=false;}
  agentReading.set(photo?.id,reading);
  if(scroller.clientHeight>0)restoreAgentReading();
}
function renderPhotoProposal(){
  const photo=currentPhoto(),messages=photo?.conversation || [];
  const index=messages.findLastIndex(m=>m.source==='ai'&&m.action&&m.action.kind!=='none'&&m.baseSignature===currentEffectSignature()&&cleanIntent(m.baseIntent)===cleanIntent(state.creativeIntent)&&!annotationsChanged(m,renderedAnnotations()));
  const node=$('#photo-proposal');node.hidden=index<0;if(index<0)return;
  const message=messages[index],explanation=actionExplanation(message.action);
  $('#photo-proposal-goal').textContent=explanation.goal;$('#photo-proposal-detail').textContent=explanation.tradeoff || '先比较效果，满意后再应用。';
  $('#photo-proposal-preview').dataset.messageIndex=String(index);
}
$('#photo-proposal-preview').addEventListener('click',event=>applyAgentAction(Number(event.currentTarget.dataset.messageIndex)));
$('#photo-export-shortcut').addEventListener('click',()=>openExportDialog());
$('#run-photo-review').addEventListener('click',()=>{if(!state.aiAvailable)openVisionSettings();else analyzeImage();});
$('#quick-codex-connect').addEventListener('click',async event=>{
  if(visionConfigBusy)return;
  const button=$('#quick-codex-connect');button.disabled=true;
  try{
    const response=await fetch('/api/vision-config',{cache:'no-store'});
    if(!response.ok)throw new Error('暂时无法读取连接配置，请打开连接设置后重试。');
    const settings=await response.json();
    if(settings.configurationEditable===false)throw new Error('当前工作台由管理员提供视觉服务。');
    $('#vision-settings-form').hidden=false;$('#vision-managed-note').hidden=true;$('#vision-provider').value='codex';updateVisionProvider();
    fillModelTiers(settings.provider==='codex'&&settings.tiers?settings.tiers:defaultModelTiers());$('#vision-remember').checked=false;
    await connectVision(event);
  }catch(error){showToast(error.message);}finally{button.disabled=false;}
});

function renderAgentProgress() {
  const photo=currentPhoto(),label=$('.agent-typing span'),partial=$('.agent-partial');
  if(!photo?.agentBusy||!label)return;
  const seconds=Math.floor((Date.now()-photo.agentStartedAt)/1000);
  label.textContent=[photo.agentProgress || '正在准备照片',photo.agentModel,photo.agentTierUsed?tierNames[photo.agentTierUsed]:'',seconds>0?`${seconds} 秒`:''].filter(Boolean).join(' · ');
  if(partial)partial.textContent=photo.agentPartial || '';
}

function restoreAgentReading() {
  const thread=$('#agent-thread'),scroller=$('.agent-body'),reading=agentReading.get(currentPhotoId);
  scroller.scrollTop=thread.classList.contains('empty') ? reading?.offset || 0:reading?.follow===false ? reading.offset:scroller.scrollHeight;
  const reply=thread.querySelector('[data-reply-id]:last-child');
  const atReplyStart=reply && Math.abs(reply.getBoundingClientRect().top-scroller.getBoundingClientRect().top)<12;
  $('#agent-latest').hidden=!reply || atReplyStart || scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop<36;
}

function currentAgentPreview(focusId=null) {
  const source = currentPreviewPixels();
  const output = renderCurrentPixels(source.data,source.width,source.height);
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(output,source.width,source.height),0,0);
  state.annotations.forEach((item,index) => {
    const rect = transformRect(item.rect,p=>originalToViewPoint(p,state.crop,state.image.naturalWidth,state.image.naturalHeight));
    if (!rect) return;
    const x = rect.x*source.width, y = rect.y*source.height;
    context.strokeStyle = item.id === focusId ? '#ffe3b2' : '#f7d2e2';
    context.lineWidth = Math.max(3,source.width/400);
    context.strokeRect(x,y,rect.width*source.width,rect.height*source.height);
    const labelSize = Math.max(23,source.width/40);
    context.fillStyle = '#503441';
    context.fillRect(x,y,labelSize,labelSize);
    context.fillStyle = '#fff';
    context.font = `bold ${Math.round(labelSize*.6)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(index+1),x+labelSize/2,y+labelSize/2);
  });
  return canvas.toDataURL('image/jpeg',.78);
}

function annotationRegionStats(annotation) {
  if (!annotation || !state.previewData) return null;
  const source = currentPreviewPixels();
  const output = renderCurrentPixels(source.data,source.width,source.height);
  const region = transformRect(annotation.rect,p=>originalToViewPoint(p,state.crop,state.image.naturalWidth,state.image.naturalHeight));
  if (!region) return null;
  return {region:measureRegion(output,source.width,source.height,region),whole:measureRegion(output,source.width,source.height,{x:0,y:0,width:1,height:1})};
}

async function askDesignAgent(question, focusId = currentPhoto()?.agentFocusId) {
  const text = String(question || '').trim().slice(0,800);
  const photo = currentPhoto();
  if (!text || !photo || !state.analysis || photo.agentBusy) return;
  if(photo.editSaving||photo.editRetry){showToast('请先保存当前步骤修改，再向顾问提出新的编辑。');return;}
  finishAnnotationNote();
  const request=advisorRequests.start(photo.id);
  const baseSignature=currentEffectSignature(),baseIntent=cleanIntent(state.creativeIntent);
  const capturedAnnotations=structuredClone(renderedAnnotations()),capturedLayers=structuredClone(state.advisorLayers);
  const annotationContext=snapshotAnnotations(capturedAnnotations,focusId);
  const focused = state.annotations.find(item => item.id === focusId);
  const history = photo.conversation.slice(-8).map(item => ({role:item.role,text:item.text}));
  const taste = summarizeTaste(tasteRecords);
  const localContext = {creativeIntent:baseIntent,analysis:state.analysis,source:state.analysisSource,subject:photo.subject,recommendedStyle:collectionRanking()[0]?.preset.id,focusAnnotation:focused ? {...focused,number:state.annotations.indexOf(focused)+1} : null,regionStats:annotationRegionStats(focused),currentAdjustments:getAdjustments()};
  const requestContext = {
    photoReference:photoMetering(renderCurrentPixels(currentPreviewPixels().data,currentPreviewPixels().width,currentPreviewPixels().height),currentPreviewPixels().width,currentPreviewPixels().height),
    creativeIntent:baseIntent,scene:state.analysis.scene,summary:state.analysis.summary,subject:subjectLabel(photo.subject),
    stylePreference:state.stylePreference,appliedStyle:state.presetId || 'none',
    currentAdjustments:getAdjustments(),hasEdits:hasEdits(),currentCrop:state.crop || {x:0,y:0,width:1,height:1},originalDimensions:{width:state.image.naturalWidth,height:state.image.naturalHeight},adjustmentSources:state.advisorLayers.map(item=>({label:item.label,settings:item.settings,region:Boolean(item.annotationId)})),
    reviewConclusion:state.analysis.conclusion,preservedParts:reviewPresentation(state.analysis).preserved.map(item => ({dimension:item.label,finding:item.finding})),
    tasteProfile:{count:taste.count,leadingMood:taste.leadingMood,tendencies:taste.tendencies,practices:taste.practices},
    annotations:annotationContext.items,
    focusAnnotation:annotationContext.focusNumber
  };
  photo.conversation.push({role:'user',text,context:{annotations:structuredClone(annotationContext.items),focusNumber:annotationContext.focusNumber}});
  photo.agentBusy = true;photo.agentStartedAt=Date.now();photo.agentPartial='';photo.agentProgress='正在准备照片';photo.agentModel='';photo.agentTierUsed='';
  scheduleDraftSave();
  $('#agent-annotations').open=false;
  renderAgent({follow:true});
  let answer, source = 'local',deliver=false,failure='';
  try {
    const baseDocument=await editStack.ensure(photo);if(!advisorRequests.active(request)||currentPhotoId!==photo.id)return;
    requestContext.document=baseDocument;requestContext.scopeStepId=photo.editView?.scopeStepId||null;
    if (state.aiAvailable) {
      const response = await fetch('/api/design-chat',{method:'POST',signal:request.controller.signal,headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({
        image:currentAgentPreview(annotationContext.focusId),question:text,history,context:requestContext,sessionKey:photo.projectId || `${draftWorkspaceId}:${photo.id}`,tier:$('#agent-model-tier').value
      })});
      let streamed='';
      const result=await readVisionStream(response,event=>{
        if(!advisorRequests.active(request)||!photoSessions.includes(photo))return;
        if(event.model)photo.agentModel=event.model;
        if(event.tier)photo.agentTierUsed=event.tier;
        if(event.type==='delta'){streamed+=event.delta;photo.agentPartial=partialReply(streamed);}
        if(event.type==='progress')photo.agentProgress=({connecting:'正在连接 Codex',analyzing:'正在分析当前照片',validating:'正在检查建议参数'})[event.stage] || '正在处理';
        if(currentPhoto()===photo)renderAgentProgress();
      });
      if(!response.ok)throw Object.assign(new Error(normalizeVisionFailure(result).message),{visionFailure:normalizeVisionFailure(result)});
      answer={...normalizeDesignReply(result.answer),provenance:result.answer.provenance};
      source = 'ai';
      photo.agentFallback = false;
    } else answer = localDesignReply(text,localContext);
  } catch (error) {
    if(request.controller.signal.aborted && request.controller.signal.reason!=='timeout')return;
    answer = localDesignReply(text,localContext);
    photo.agentFallback = true;
    failure=requestFailure(error,request.controller.signal,'视觉对话').message+' 已切换为本地引导，本次未完成视觉识别。';
    if(currentPhoto()===photo)showToast(failure);
  } finally {
    deliver=advisorRequests.owns(request) && (!request.controller.signal.aborted || request.controller.signal.reason==='timeout');
    advisorRequests.finish(request);
    if(deliver && photoSessions.includes(photo)){photo.agentBusy=false;if(currentPhoto()===photo)renderAgent();}
  }
  if(!deliver || !photoSessions.includes(photo) || !answer)return;
  if (answer.action.kind === 'region') {
    if (focused) answer.action.annotationId = focused.id;
    else answer.action = {kind:'none',label:'',presetId:null,changes:[],crop:null};
  }
  if(source==='local' && answer.action.kind==='region' && focused) {
    const current=capturedAnnotations.find(item=>item.id===focused.id)?.localSettings;
    const remaining=remainingAdjustments(Object.fromEntries(answer.action.changes.map(item=>[item.key,item.value])),current);
    answer.action.changes=answer.action.changes.map(item=>({...item,value:remaining[item.key]})).filter(item=>Math.abs(item.value)>.001);
    if(!answer.action.changes.length) {answer.action.kind='none';answer.reply='此区域已应用对应的局部微调。可先对比当前效果，再说明期望的其他调整。';}
  }
  if(source==='local' && answer.action.kind==='none' && localContext.currentAdjustments && localContext.analysis?.recommendations?.some(item=>Object.values(item.adjustments).some(Boolean)) && /亮|色|层次|对比/.test(text)) answer.reply+=' 已应用的原片建议不会重复叠加；请结合当前效果继续判断。';
  if(source==='local'&&requestContext.scopeStepId&&requestContext.document){const step=requestContext.document.steps.find(step=>step.id===requestContext.scopeStepId);let command;if(/弱|轻一点|减小/.test(text))command={type:'SetStepOpacity',stepId:step.id,opacity:Math.max(0,step.opacity*.7)};else if(/暂停|关闭/.test(text))command={type:'SetStepEnabled',stepId:step.id,enabled:false};else if(/启用|打开/.test(text))command={type:'SetStepEnabled',stepId:step.id,enabled:true};else if(/删除|撤掉/.test(text))command={type:'RemoveStep',stepId:step.id};if(command){answer.action={kind:'document',label:'修改「'+step.title+'」',goal:'修改已选中的原步骤',tradeoff:'其他独立步骤保留，请先比较。',proposal:{baseRevision:requestContext.document.revision,baseHash:documentHash(requestContext.document),items:[{id:'change',title:'修改原步骤',commands:[command]}]}};answer.reply='先预览选中步骤的修改，其他独立步骤保留。';}}
  else if(source==='local'&&/弱一点|撤掉这一步|关闭这一步/.test(text)&&!requestContext.scopeStepId){answer.action={kind:'none'};answer.reply='请先在精修中选中想改的步骤，再点“修改此步骤”，这样可以保留其他调整。';}
  else if(source==='local'&&['adjustment','region','style','crop'].includes(answer.action.kind)&&requestContext.document){try{const proposal=legacyIntentProposal(requestContext.document,answer.action,{id:'intent-'+crypto.randomUUID(),annotations:capturedAnnotations});answer.action={kind:'document',label:answer.action.label,goal:answer.action.goal,tradeoff:answer.action.tradeoff,proposal};}catch{answer.action={kind:'none'};}}
  const actionFingerprint=JSON.stringify({question:text,action:answer.action});
  if(capturedLayers.some(item=>item.fingerprint===actionFingerprint)) {answer.action.kind='none';answer.reply='这组微调已生效。可先对比当前效果；如需继续调整，请具体说明希望保留或改动的部分。';}
  photo.conversation.push({role:'assistant',text:answer.reply,provenance:answer.provenance,principle:answer.principle,action:answer.action,scopeStepId:requestContext.scopeStepId||null,clarification:answer.clarification,source,failure,requestQuestion:text,applied:false,id:crypto.randomUUID(),baseSignature,baseIntent,baseAnnotations:annotationContext.signature,actionFingerprint});
  if (photo.conversation.length > 24) photo.conversation.splice(0,photo.conversation.length - 24);
  scheduleDraftSave();
  if (currentPhoto() === photo) {
    renderAgent();
    const latest=photo.conversation.at(-1);
    if(canPreviewAdvisorResult({source,action:latest.action,photoId:photo.id,currentPhotoId,baseSignature:latest.baseSignature,currentSignature:currentEffectSignature(),baseIntent:latest.baseIntent,currentIntent:cleanIntent(state.creativeIntent),notesChanged:annotationsChanged(latest,renderedAnnotations()),dialogOpen:Boolean(document.querySelector('dialog[open]')),draft:photo.agentDraft || '',tab:workspaceSpace==='studio'?studioTab:'learn'}))applyAgentAction(photo.conversation.length-1);
    $('#agent-live').textContent = `${source === 'ai' ? '审美顾问' : '本地引导'}已回复${answer.action.kind!=='none' ? '，可先预览建议':''}。${annotationsChanged(photo.conversation.at(-1),renderedAnnotations()) ? '批注已更新，请围绕最新内容继续提问。':''}`;
  }
}

function cancelAdvisor() {
  const photo=currentPhoto();if(!photo?.agentBusy)return;
  advisorRequests.cancel(photo.id);photo.agentBusy=false;
  photo.conversation.push({role:'status',text:'本次对话已取消，照片与已有建议保留。可继续输入或重新提问。'});
  renderAgent();scheduleDraftSave();$('#agent-input').focus();
}
function updateAdvisorAccept(){
  const pending=pendingAdvisorPreview,photo=photoSessions.find(p=>p.id===pending?.photoId);
  const disabled=!advisorPreviewReady||Boolean(pending?.toolPending)||Boolean(pending?.toolFailed)||Boolean(pending?.noSteps)||Boolean(pending?.projectFailed)||Boolean(pending?.accepting)||Boolean(photo?.projectId&&(!pending?.projectCandidate||pending?.projectBusy));
  $('#advisor-preview-accept').disabled=disabled;$('#advisor-preview-export').disabled=disabled;
}
async function syncProjectPreview(pending){
  const photo=photoSessions.find(p=>p.id===pending.photoId);if(!photo?.projectId)return;
  const generation=++pending.projectGeneration,previous=pending.projectSync;
  pending.projectBusy=true;pending.projectFailed=false;updateAdvisorAccept();
  const work=(async()=>{
    await previous?.catch(()=>{});
    if(pending!==pendingAdvisorPreview||generation!==pending.projectGeneration)return;
    try{
      if(pending.projectCandidate){await projectWorkspace.discard(photo,pending.projectCandidate);pending.projectCandidate=null;}
      if(pending!==pendingAdvisorPreview||generation!==pending.projectGeneration||pending.noSteps)return;
      const patch=workspacePatch(structuredClone(pending.candidate),{intent:photo.creativeIntent,conversation:photo.conversation});
      const token=pending.documentProposal?(await projectWorkspace.proposeDocument(photo,pending.documentProposal)).token:await projectWorkspace.propose(photo,patch,pending.explanation);
      if(pending!==pendingAdvisorPreview||generation!==pending.projectGeneration){await projectWorkspace.discard(photo,token);return;}
      pending.projectCandidate=token;
      if(pending.documentProposal)await projectWorkspace.renderDocumentPreview(photo,token);
      if(pending!==pendingAdvisorPreview||generation!==pending.projectGeneration){await projectWorkspace.discard(photo,token);return;}
      pending.projectCandidate=token;pending.projectPatch=patch;
    }catch(error){if(pending===pendingAdvisorPreview&&generation===pending.projectGeneration){pending.projectFailed=true;$('#advisor-preview-progress').textContent=error.message;}}
    finally{if(generation===pending.projectGeneration){pending.projectBusy=false;updateAdvisorAccept();}}
  })();
  pending.projectSync=work;return work;
}

function openAdjustmentPreview(before,candidate,explanation,metadata={}) {
  if(!candidate){showToast('这份方案的范围无法完整执行，请重新生成建议。');return;}
  pendingAdvisorPreview={photoId:currentPhotoId,signature:currentEffectSignature(),intent:cleanIntent(state.creativeIntent),before,candidate,fullCandidate:structuredClone(candidate),review:state.analysis,explanation,projectGeneration:0,...metadata};
  const steps=$('#advisor-plan-steps');steps.replaceChildren();steps.hidden=!metadata.planMessage&&!metadata.toolMessage&&!metadata.documentProposal;
  $('#advisor-document-inspector')?.remove();
  if(metadata.documentProposal){
    metadata.documentProposal.items.forEach(item=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.proposalItem=item.id;input.setAttribute('aria-label',item.title);label.append(input,document.createTextNode(item.title));steps.append(label);});
    const disclosure=document.createElement('details');disclosure.id='advisor-document-inspector';const summary=document.createElement('summary');summary.textContent='微调步骤参数与范围';const mount=document.createElement('div');disclosure.append(summary,mount);steps.after(disclosure);const pending=pendingAdvisorPreview;
    pending.documentOriginal=structuredClone(metadata.documentProposal);pending.documentTuning=[];pending.documentSelectedId=candidate.editDocument.steps.at(-1)?.id;
    const tune=commands=>{for(const command of commands){const key=command.type+':'+(command.stepId||'')+':'+Object.keys(command.parameters||{}).join(',');const index=pending.documentTuning.findIndex(value=>value.key===key);if(index>=0)pending.documentTuning[index]={key,command};else pending.documentTuning.push({key,command});}refreshDocumentProposal(pending);};
    pending.documentView=createEditStackView(mount,{catalog:pixelCapabilities(),onSelect:id=>{pending.documentSelectedId=id;pending.documentView.render(pending.candidate.editDocument,{selectedStepId:id});},onCommand:tune,onPreview:tune,onCommit:()=>{},onCancel:()=>{},onView:({stepId,mode})=>{const version=viewerVersion(pending.candidate,'candidate','建议预览');version.maskView=mode==='photo'?undefined:{stepId,mode};advisorViewer.updateVersion('candidate',version);}});
    pending.documentView.render(candidate.editDocument,{selectedStepId:pending.documentSelectedId});
  }
  $('#advisor-tool-status').hidden=!metadata.toolMessage;$('#advisor-tool-status').textContent='';$('#advisor-tool-retry').hidden=true;
  if(metadata.toolMessage){
    pendingAdvisorPreview.toolMessage=metadata.toolMessage;pendingAdvisorPreview.toolPending=true;
    metadata.toolMessage.action.operations.forEach(operation=>{
      const label=document.createElement('label'),input=document.createElement('input'),status=document.createElement('small');input.type='checkbox';input.checked=true;input.dataset.operationId=operation.id;input.setAttribute('aria-label',operation.title);status.dataset.operationStatus=operation.id;status.textContent='待执行';
      label.append(input,document.createTextNode(operation.title),status);steps.append(label);
    });
  }
  $('#advisor-mask-toggle').hidden=!metadata.planMessage?.action.steps.some(s=>s.kind==='masked')&&!metadata.toolMessage?.action.operations.some(op=>op.target.kind!=='image');$('#advisor-mask-toggle').textContent='查看蒙版';$('#advisor-mask-toggle').setAttribute('aria-pressed','false');
  if(metadata.planMessage){
    pendingAdvisorPreview.planMessage=metadata.planMessage;
    metadata.planMessage.action.steps.forEach((step,index)=>{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.step=index;
      label.append(input,document.createTextNode(step.label+(step.kind==='masked'&&step.exclude.length?` · 排除 ${step.exclude.length} 处`:'')));steps.append(label);
    });
  }
  $('#advisor-preview-goal').textContent=explanation.goal;
  $('#advisor-preview-scope').textContent=`范围 · ${explanation.scope}`;
  $('#advisor-preview-changes').textContent=`变化 · ${explanation.changes}`;
  $('#advisor-preview-tradeoff').textContent=`留意 · ${explanation.tradeoff}`;
  $('#advisor-preview-accept').textContent='应用调整';
  $('#advisor-preview-strength-row').hidden=Boolean(metadata.planMessage||metadata.toolMessage||metadata.documentProposal)||!scalablePreview(before,candidate);
  $('#advisor-preview-strength').value=100;$('#advisor-preview-strength-value').textContent='100%';
  advisorViewer.open(state.image,[viewerVersion(before,'before','当前版本'),viewerVersion(candidate,'candidate','建议预览')],'before','candidate');
  if(!metadata.toolMessage)syncProjectPreview(pendingAdvisorPreview);
}
function previewSuggestions(ids,{crop=false}={}) {
  if(!state.analysis || state.loading)return;
  const before=beforeEdit(),items=state.analysis.recommendations.filter(item=>ids.includes(item.id) && !state.active.has(item.id));
  const suggestedCrop=crop && !state.crop ? state.analysis.cropRecommendation:null;
  const candidate=suggestionCandidate(before,{ids:items.map(item=>item.id),crop:suggestedCrop?.rect});
  const names=items.map(item=>item.title);if(suggestedCrop)names.push('收紧构图');
  const details=items.map(item=>sliderSpecs.filter(spec=>Math.abs(item.adjustments[spec.key] || 0)>.001).map(spec=>`${spec.label} ${formatSlider(item.adjustments[spec.key],spec)}`).join('、'));
  if(suggestedCrop)details.push(`裁剪保留约 ${Math.round(suggestedCrop.rect.width*suggestedCrop.rect.height*100)}% 画面`);
  openAdjustmentPreview(before,candidate,{goal:names.join(' · '),scope:suggestedCrop ? '整张光色与画幅；保留已有调整':'整张光色；保留手动裁剪、风格与局部调整',changes:details.join('；'),tradeoff:[...new Set(items.map(item=>item.caution).filter(Boolean)),...(suggestedCrop ? ['裁剪会减少场景信息，请检查主体、光源与边缘。']:[])].join(' ') || '请放大检查细节与亮暗关系，满意后再应用。'});
}
async function applyAgentAction(index) {
  const photo=currentPhoto(),message=photo?.conversation[index];
  if(!message?.action || state.loading)return;
  if(annotationsChanged(message,renderedAnnotations())){showToast('批注已更新，请重新向顾问提问以获取建议。');return;}
  const preview={photoId:photo.id,signature:message.baseSignature,intent:cleanIntent(message.baseIntent)};
  if(!previewStillValid(preview,{photoId:currentPhotoId,signature:currentEffectSignature(),intent:state.creativeIntent})){showToast('目标或画面已变化，请顾问根据当前效果重新建议。');return;}
  finishRangeEdit();finishAnnotationNote();
  const before=editSnapshot();
  if(message.action.kind==='document'){
    try{const base=await editStack.ensure(photo),action=validatePlannerAction(base,message.action,{scopeStepId:message.scopeStepId||null}),compiled=compileDocumentProposal(base,action.proposal),candidate={...structuredClone(before),editDocument:compiled.document,crop:compiled.document.geometry.crop};
      openAdjustmentPreview(before,candidate,{goal:action.goal||action.label,scope:'当前配方中的独立步骤',changes:agentChanges(action),tradeoff:action.tradeoff||'请核对范围与细节，满意后再应用。'},{messageId:message.id,documentProposal:action.proposal,baseDocument:base});return;
    }catch(error){showToast(error.message);return;}
  }
  if(message.action.kind==='tools'){
    openAdjustmentPreview(before,structuredClone(before),{...actionExplanation(message.action),changes:agentChanges(message.action)},{messageId:message.id,toolMessage:message,toolPending:true});
    runAdvisorTools(pendingAdvisorPreview);return;
  }
  const candidate=advisorCandidate(before,message,{width:state.image.naturalWidth,height:state.image.naturalHeight,amount:rememberedStyleAmount(tasteRecords,message.action.presetId,photo.subject) ?? state.presetAmount});
  const explanation=actionExplanation(message.action);
  openAdjustmentPreview(before,candidate,{...explanation,changes:agentChanges(message.action)+(message.action.kind==='style' ? ` · 强度 ${candidate?.presetAmount}%`:'')},{messageId:message.id,...(message.action.kind==='plan'?{planMessage:message}:{})});
}
const advisorSteps=document.createElement('div');advisorSteps.id='advisor-plan-steps';advisorSteps.className='advisor-steps';advisorSteps.hidden=true;$('#advisor-preview-goal').after(advisorSteps);
function refreshDocumentProposal(pending){
  if(pending!==pendingAdvisorPreview)return;const selected=[...advisorSteps.querySelectorAll('[data-proposal-item]:checked')].map(input=>input.dataset.proposalItem),proposal=structuredClone(pending.documentOriginal),ids=new Set([...pending.baseDocument.steps.map(step=>step.id),...proposal.items.filter(item=>selected.includes(item.id)).flatMap(item=>item.commands.filter(command=>command.type==='AddStep').map(command=>command.step.id))]);
  const tuning=pending.documentTuning.map(value=>value.command).filter(command=>!command.stepId||ids.has(command.stepId));if(tuning.length&&selected.length){proposal.items.push({id:'preview-tuning',title:'预览微调',commands:tuning,dependsOn:[...selected]});selected.push('preview-tuning');}
  proposal.selectedItemIds=selected;
  try{const compiled=compileDocumentProposal(pending.baseDocument,proposal,selected);pending.toolFailed=false;pending.documentProposal=proposal;pending.noSteps=compiled.noChange;pending.candidate={...structuredClone(pending.before),editDocument:compiled.document,crop:compiled.document.geometry.crop};pending.fullCandidate=structuredClone(pending.candidate);pending.documentView.render(compiled.document,{selectedStepId:pending.documentSelectedId});advisorViewer.updateVersion('candidate',viewerVersion(pending.candidate,'candidate','建议预览'));if(currentPhoto()?.projectId){clearTimeout(pending.projectTimer);pending.projectBusy=true;pending.projectTimer=setTimeout(()=>syncProjectPreview(pending),200);}updateAdvisorAccept();}catch(error){pending.toolFailed=true;pending.documentView.setMessage(error.message);updateAdvisorAccept();}
}
const maskToggle=document.createElement('button');maskToggle.type='button';maskToggle.id='advisor-mask-toggle';maskToggle.hidden=true;maskToggle.textContent='查看蒙版';$('#advisor-preview-dialog .viewer-controls').append(maskToggle);maskToggle.addEventListener('click',()=>{const on=maskToggle.getAttribute('aria-pressed')!=='true';maskToggle.setAttribute('aria-pressed',String(on));maskToggle.textContent=on?'隐藏蒙版':'查看蒙版';advisorViewer.showMasks(on);});
const toolStatus=document.createElement('p');toolStatus.id='advisor-tool-status';toolStatus.setAttribute('role','status');toolStatus.hidden=true;advisorSteps.after(toolStatus);
const toolRetry=document.createElement('button');toolRetry.id='advisor-tool-retry';toolRetry.type='button';toolRetry.textContent='重试执行';toolRetry.hidden=true;toolStatus.after(toolRetry);toolRetry.addEventListener('click',()=>{if(pendingAdvisorPreview?.toolMessage)runAdvisorTools(pendingAdvisorPreview);});
async function runAdvisorTools(pending){
  if(!pending?.toolMessage)return;
  const generation=(pending.toolGeneration||0)+1;pending.toolGeneration=generation;pending.toolController?.abort();
  const controller=new AbortController();pending.toolController=controller;pending.toolPending=true;pending.toolFailed=false;toolRetry.hidden=true;
  const photo=photoSessions.find(p=>p.id===pending.photoId),operations=pending.toolMessage.action.operations;
  const selectedItemIds=[...advisorSteps.querySelectorAll('input[data-operation-id]:checked')].map(i=>i.dataset.operationId);
  pending.noSteps=!selectedItemIds.length;updateAdvisorAccept();toolStatus.textContent=selectedItemIds.length?'正在准备工具组合…':'未选择编辑步骤。';
  const current=()=>pending===pendingAdvisorPreview&&generation===pending.toolGeneration&&!controller.signal.aborted;
  try{
    if(pending.projectCandidate){const old=pending.projectCandidate;pending.projectCandidate=null;await projectWorkspace.discard(photo,old);}
    if(!current())return;
    if(!selectedItemIds.length){pending.candidate=structuredClone(pending.before);advisorViewer.updateVersion('candidate',viewerVersion(pending.candidate,'candidate','建议预览'));return;}
    const onEvent=event=>{if(!current()||event.type!=='tool')return;
      const label=[...advisorSteps.querySelectorAll('[data-operation-status]')].find(el=>el.dataset.operationStatus===event.operationId);if(label)label.textContent=event.stage==='completed'?'已准备':'执行中';
      toolStatus.textContent=event.stage==='completed'?`${event.title}已完成 · ${event.index}/${event.total}`:`正在执行：${event.title}`;
    };
    let run,token;
    const namespace=pending.toolMessage.id||crypto.randomUUID();
    if(photo.projectId){const made=await projectWorkspace.proposeTools(photo,{operations,namespace,selectedItemIds,name:pending.toolMessage.action.label,goal:pending.explanation.goal,tradeoff:pending.explanation.tradeoff},{signal:controller.signal,onEvent});run=made.run;token=made.token;}
    else run=await requestToolRun({operations,namespace,selectedItemIds,state:toolStateFromSnapshot(pending.before),source:{width:photo.image.naturalWidth,height:photo.image.naturalHeight},notes:pending.before.annotations,image:photo.previewSource.toDataURL('image/jpeg',.9)},{signal:controller.signal,onEvent});
    if(!current()){if(token)await projectWorkspace.discard(photo,token);return;}
    if(!previewStillValid(pending,{photoId:currentPhotoId,signature:currentEffectSignature(),intent:state.creativeIntent}))throw new Error('照片或目标已变化，请重新生成工具方案。');
    for(const record of run.records){const status=[...advisorSteps.querySelectorAll('[data-operation-status]')].find(el=>el.dataset.operationStatus===record.id);if(status)status.textContent='已准备';}
    pending.candidate=toolRunCandidate(pending.before,run,{label:run.label||pending.toolMessage.action.label});pending.fullCandidate=structuredClone(pending.candidate);pending.toolRun=run;pending.noSteps=run.noChange;
    pending.projectCandidate=token||null;pending.projectPatch=workspacePatch(pending.candidate,{intent:photo.creativeIntent,conversation:photo.conversation});
    toolStatus.textContent=run.noChange?'所选步骤没有改变画面。':`${run.records.length} 个工具步骤已完成，正在生成比较预览。`;
    advisorViewer.updateVersion('candidate',viewerVersion(pending.candidate,'candidate','建议预览'));
  }catch(error){if(current()){pending.toolFailed=true;toolStatus.textContent=error.message;toolRetry.hidden=false;}}
  finally{if(current()){pending.toolPending=false;updateAdvisorAccept();}}
}
advisorSteps.addEventListener('change',event=>{
  const pending=pendingAdvisorPreview;
  if(pending?.documentProposal){const chosen=new Map([...advisorSteps.querySelectorAll('[data-proposal-item]')].map(input=>[input.dataset.proposalItem,input]));if(event.target.checked){const include=id=>{for(const dependency of pending.documentOriginal.items.find(item=>item.id===id).dependsOn||[]){chosen.get(dependency).checked=true;include(dependency);}};include(event.target.dataset.proposalItem);}else for(const item of pending.documentOriginal.items)if((item.dependsOn||[]).some(id=>!chosen.get(id).checked))chosen.get(item.id).checked=false;refreshDocumentProposal(pending);return;}
  if(pending?.toolMessage){
    const inputs=[...advisorSteps.querySelectorAll('input[data-operation-id]')],operations=pending.toolMessage.action.operations,chosen=new Map(inputs.map(i=>[i.dataset.operationId,i]));
    const changed=event.target.dataset.operationId,operation=operations.find(op=>op.id===changed);
    if(event.target.checked){const include=op=>{for(const id of op.dependsOn){chosen.get(id).checked=true;include(operations.find(x=>x.id===id));}};include(operation);}
    else{let updated;do{updated=false;for(const op of operations)if(chosen.get(op.id).checked&&op.dependsOn.some(id=>!chosen.get(id).checked)){chosen.get(op.id).checked=false;updated=true;}}while(updated);}
    for(const i of inputs){const label=[...advisorSteps.querySelectorAll('[data-operation-status]')].find(el=>el.dataset.operationStatus===i.dataset.operationId);if(label)label.textContent=i.checked?'待执行':'未选';}
    runAdvisorTools(pending);return;
  }
  if(!pending?.planMessage)return;
  const selectedSteps=[...advisorSteps.querySelectorAll('input:checked')].map(i=>Number(i.dataset.step));
  pending.noSteps=!selectedSteps.length;
  pending.candidate=advisorCandidate(pending.before,pending.planMessage,{selectedSteps,width:state.image.naturalWidth,height:state.image.naturalHeight});
  pending.fullCandidate=structuredClone(pending.candidate);
  advisorViewer.updateVersion('candidate',viewerVersion(pending.candidate,'candidate','建议预览'));
  if(currentPhoto()?.projectId){pending.projectGeneration++;pending.projectBusy=true;clearTimeout(pending.projectTimer);pending.projectTimer=setTimeout(()=>syncProjectPreview(pending),250);}updateAdvisorAccept();
});
$('#advisor-preview-strength').addEventListener('input',()=>{
  const pending=pendingAdvisorPreview;if(!pending)return;
  const amount=Number($('#advisor-preview-strength').value);
  pending.candidate=scalePreview(pending.before,pending.fullCandidate,amount);
  $('#advisor-preview-strength-value').textContent=`${amount}%`;
  const a=snapshotSettings(pending.before),b=snapshotSettings(pending.candidate);
  $('#advisor-preview-changes').textContent='变化 · '+sliderSpecs.filter(spec=>Math.abs(b[spec.key]-a[spec.key])>.001).map(spec=>`${spec.label} ${formatSlider(b[spec.key]-a[spec.key],spec)}`).join('、');
  advisorViewer.updateVersion('candidate',viewerVersion(pending.candidate,'candidate','建议预览'));
  if(currentPhoto()?.projectId){pending.projectGeneration++;pending.projectBusy=true;clearTimeout(pending.projectTimer);pending.projectTimer=setTimeout(()=>syncProjectPreview(pending),200);updateAdvisorAccept();}
});
$('#advisor-preview-cancel').addEventListener('click',()=>$('#advisor-preview-dialog').close());
$('#advisor-preview-dialog').addEventListener('close',()=>{const pending=pendingAdvisorPreview;if(pending){pending.toolController?.abort();clearTimeout(pending.projectTimer);if(!pending.projectAccepted&&!pending.projectAccepting)projectWorkspace.discard(photoSessions.find(p=>p.id===pending.photoId),pending.projectCandidate);}pendingAdvisorPreview=null;});
async function acceptAdvisorPreview(exportAfter=false){
  const pending=pendingAdvisorPreview;if(!pending||pending.accepting||pending.toolPending||pending.toolFailed||pending.noSteps||!advisorPreviewReady)return;
  if(pending?.review!==state.analysis || !previewStillValid(pending,{photoId:currentPhotoId,signature:currentEffectSignature(),intent:state.creativeIntent})){showToast('照片或目标已变化，请重新预览。');$('#advisor-preview-dialog').close();return;}
  const message=pending.messageId ? currentPhoto().conversation.find(item=>item.id===pending.messageId):null;
  if(pending.messageId && !message)return;
  if(message && annotationsChanged(message,renderedAnnotations())){showToast('批注已更新，请重新提问与预览。');$('#advisor-preview-dialog').close();return;}
  const photo=currentPhoto();
  if(photo.projectId&&(!pending.projectCandidate||pending.projectBusy))return;
  pending.accepting=true;updateAdvisorAccept();
  if(photo.projectId){
    pending.projectAccepting=true;$('#advisor-preview-accept').disabled=true;
    try{
      const data=await projectWorkspace.accept(photo,pending.projectCandidate,pending.projectPatch);pending.projectAccepted=true;
      if(currentPhotoId!==photo.id){applySharedProject(photo,data,{force:true});projectWorkspace.schedule(photo);showToast('已应用文件项目中的调整。');return;}
    }catch(error){$('#advisor-preview-progress').textContent=error.message;pending.projectAccepting=false;pending.accepting=false;updateAdvisorAccept();return;}
  }
  restoreEdit(pending.candidate,{gesture:true});if(message)message.applied=true;saveEdit(pending.before);
  $('#advisor-preview-dialog').close();renderAgent();buildPresetThumbs(state.image);renderPresets();
  showToast('已应用调整，可继续微调或撤销。');
  if(exportAfter){exportAfterPreview={photoId:photo.id,signature:currentEffectSignature()};if(!state.renderPending&&!state.renderFailed){exportAfterPreview=null;openExportDialog();}}
}
$('#advisor-preview-accept').addEventListener('click',()=>acceptAdvisorPreview());
$('#advisor-preview-export').addEventListener('click',()=>acceptAdvisorPreview(true));

function selectTab(name) {
  annotationPeek.hide();
  endStyleAudition();
  if(name==='learn'){showWorkspaceSpace('learn');return;}
  const scroller=$('.panel-scroll'),previous=studioTab;
  if(previous!=='agent')inspectorPositions[previous]=scroller.scrollTop;
  studioTab=editorTab(name);showWorkspaceSpace('studio');
  $('.right-panel').dataset.view=studioTab;
  const headings={diagnosis:'审阅照片',adjust:'精修照片',presets:'风格库',agent:'审美顾问'};
  document.querySelectorAll('.panel-tab').forEach(tab=>{
    const selected=tab.dataset.tab===studioTab;
    tab.classList.toggle('active',selected);tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected ? 0:-1;
  });
  for(const [id,mode] of [['inspector-review','diagnosis'],['inspector-adjust','adjust'],['tab-presets','presets'],['tab-agent','agent']]){const selected=studioTab===mode;const pane=$(`#${id}`);pane.hidden=!selected;pane.classList.toggle('active',selected);}
  $('#tab-adjust').classList.toggle('active',studioTab==='adjust');
  $('.right-panel').classList.toggle('agent-active',studioTab==='agent');$('.panel-heading h2').textContent=headings[studioTab];
  $('#inspector-description').textContent=studioTab==='adjust' ? '微调光色、构图与细节，保留已有建议和风格。':studioTab==='presets' ? '先试看片，再选择强度；应用后仍可继续精修。':'看看分析结果，试试调整效果。';
  $('#analysis-source-button').hidden=studioTab!=='diagnosis';
  $('#analysis-mode').hidden=studioTab!=='diagnosis';
  if(studioTab==='presets'){buildPresetThumbs(state.image);renderPresets();}
  if(studioTab==='agent')renderAgent();
  renderAnalysisStatus();refreshActions();
  scroller.scrollTop=studioTab==='agent' ? 0:inspectorPositions[studioTab] || 0;
  if(studioTab==='agent')restoreAgentReading();
  if(name==='presets'){$('#style-discovery').open=true;$('#tab-presets').scrollIntoView({block:'nearest',behavior:'instant'});}
  if(name==='suggestions')$('#tab-suggestions').scrollIntoView({block:'nearest',behavior:'instant'});
  if(state.image)sizePhotoStage();
}

function cancelReassessment(reason='cancelled') {
  if(!reassessmentRequest)return;
  reassessmentRequests.cancel(reassessmentRequest.id,reason);reassessmentRequest=null;
  reassessGeneration++;state.assessmentBusy=false;
  if(reason==='cancelled'){renderDiagnosis();showToast('复评已取消，已有调整与结果保留。');}
}
$('#reassess-cancel').addEventListener('click',()=>cancelReassessment());
async function reassessPhoto() {
  endStyleAudition();
  if (!state.image || !state.analysis || !hasEdits() || state.assessmentBusy) return;
  const image = state.image;
  const request=reassessmentRequests.start(currentPhotoId);reassessmentRequest=request;
  const generation = ++reassessGeneration;
  const signature = currentEffectSignature(),assessedIntent=cleanIntent(state.creativeIntent);
  state.assessmentBusy = true;
  renderDiagnosis();
  try {
    const source = currentPreviewPixels();
    const {width,height} = source;
    const output = renderCurrentPixels(source.data,width,height);
    const currentInspection = inspectPixels(output,width,height);
    const assessedContext=reviewContext({settings:getAdjustments(),crop:state.crop,localCount:renderedAnnotations().filter(item=>item.localEnabled!==false && Object.values(item.localSettings || {}).some(Boolean)).length,originalMetering:photoMetering(state.previewData.data,state.previewData.width,state.previewData.height),editedMetering:photoMetering(output,width,height)});
    let assessment;
    if (state.aiAvailable) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(output,width,height),0,0);
      const response = await fetch('/api/reassess',{method:'POST',signal:request.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({
        original:state.previewSource.toDataURL('image/jpeg',.8),
        edited:canvas.toDataURL('image/jpeg',.9),creativeIntent:assessedIntent,
        context:assessedContext,
        baseline:state.analysisSource==='ai' && state.analysisIntent===assessedIntent ? reviewBaseline({metrics:state.analysis.metrics,evidence:state.analysis.metricEvidence}):null
      })});
      const result=await readServiceJSON(response,'视觉复评');
      if(!response.ok)throw Object.assign(new Error(normalizeVisionFailure(result).message),{visionFailure:normalizeVisionFailure(result)});
      assessment = {...normalizeAssessment(result.assessment),baselineSource:result.assessment.baselineSource,source:'ai',provenance:result.provenance};
    } else {
      assessment = buildStatisticalAssessment(state.originalInspection,currentInspection,{crop:state.crop});
    }
    if (state.image !== image || generation !== reassessGeneration || signature !== currentEffectSignature() || assessedIntent!==cleanIntent(state.creativeIntent)) return;
    state.assessment = {...assessment,effectFacts:assessedContext};
    showToast(assessment.source === 'ai' ? '已完成当前效果的视觉复评。' : '已更新调整前后的光色统计。');
  } catch (error) {
    if(request.controller.signal.aborted && request.controller.signal.reason!=='timeout')return;
    if (state.image === image && generation === reassessGeneration && signature === currentEffectSignature() && assessedIntent===cleanIntent(state.creativeIntent)) {
      const source = currentPreviewPixels();
      state.assessment = buildStatisticalAssessment(state.originalInspection,inspectPixels(renderCurrentPixels(source.data,source.width,source.height),source.width,source.height),{crop:state.crop,failed:true});
      showToast(request.controller.signal.reason==='timeout' ? '视觉复评等待超时，当前只显示本地指标，可重试。':error.visionFailure?.message || '视觉复评暂时不可用，当前只显示本地指标。');
    }
  } finally {
    reassessmentRequests.finish(request);if(reassessmentRequest===request)reassessmentRequest=null;
    if (generation === reassessGeneration) {
      state.assessmentBusy = false;
      renderDiagnosis();scheduleDraftSave();
    }
  }
}

function openExportDialog(ids) {
  endStyleAudition();
  if (!state.image || state.loading) return;
  if((!Array.isArray(ids)||ids.includes(currentPhotoId))&&(state.renderPending||state.renderFailed)){showToast(state.renderFailed?'先重试预览，确认效果后再导出。':'正在更新效果，完成后即可导出。');return;}
  commitPhotoInputs();exportPhotoIds=Array.isArray(ids) ? ids.filter(id=>photoSessions.some(photo=>photo.id===id)):[currentPhotoId];
  if(!exportPhotoIds.length)return;
  $('#export-title').textContent=exportPhotoIds.length>1 ? `导出 ${exportPhotoIds.length} 张照片`:'导出这张照片';
  $('#confirm-export-label').textContent=pendingCloseAfterExportId ? '生成后导出并移出':exportPhotoIds.length>1 ? '加入导出队列':'生成并下载';
  $('#export-remember-row').hidden=exportPhotoIds.length>1;
  $('#export-remember').disabled=state.isDemo;$('#export-remember').checked=false;
  $('#export-remember-hint').textContent=state.isDemo ? '示例照片不参与个人偏好学习':'只记录此次导出的版本，继续编辑不会影响它';
  $('#export-author').value=personalProfile.name || '';updateExportInfo();$('#export-dialog').showModal();
}
function exportOptions() {
  return {maxSide:Number($('#export-size').value),format:document.querySelector('input[name="export-format"]:checked')?.value || 'jpeg',quality:Number($('#export-quality').value),dpi:Number($('#export-dpi').value),
    includeArtwork:$('#export-metadata').value==='artwork',author:$('#export-author').value.trim(),copyright:$('#export-copyright').value.trim()};
}
function updateExportInfo() {
  const options=exportOptions(),photos=exportPhotoIds.map(id=>photoSessions.find(photo=>photo.id===id)).filter(Boolean);
  $('#export-quality-row').hidden=options.format==='png';$('#export-artwork').hidden=!options.includeArtwork;
  $('#export-dimensions').innerHTML=photos.map(photo=>{const g=outputGeometry(photo.crop,photo.image.naturalWidth,photo.image.naturalHeight,options.maxSide);return `<li><span>${escapeHtml(photo.imageName)}</span><strong>${g.width} × ${g.height}<small>${g.original ? '裁剪后原尺寸':'已缩小'}${options.dpi>=240 ? ` · ${printCentimeters(g.width,options.dpi).toFixed(1)} × ${printCentimeters(g.height,options.dpi).toFixed(1)} cm`:''}</small></strong></li>`;}).join('');
  $('#export-info').textContent=photos.length>1 ? '每张照片保留各自的裁剪与调整。完成后可打包下载，失败照片可单独重试。':'调整写入新文件，原片保留。生成期间可以继续编辑。';
  if(photos.length===1&&photos[0].projectId)$('#export-info').textContent+=' 成片也会保存在 '+photos[0].projectPath+'/exports/。';
}
function triggerDownload(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);
}
function registerExport(task) {
  if(!task.result)return;
  const photo=photoSessions.find(item=>item.id===task.photoId);if(!photo)return;
  if(photo.id===currentPhotoId)commitPhotoInputs({finish:false});
  const {snapshot,signature}=task;
  photo.versions ||= [];
  rememberExportVersion(photo,snapshot,signature,{projectVersionId:task.result.projectVersionId});
  photo.lastExportSignature=signature;photo.exported=snapshotAcceptanceSignature(photoSnapshot(photo))===signature;
  if(task.remember && !photo.isDemo && photo.originalInspection) {
    const record=createAcceptedRecord({id:photo.acceptedRecordId || crypto.randomUUID(),acceptedAt:new Date().toISOString(),subject:photo.subject,originalStats:photo.originalInspection.stats,finalStats:task.result.stats,editDocument:snapshot.editDocument,presetId:snapshot.presetId,presetAmount:snapshot.presetAmount,adjustments:snapshotSettings(snapshot),crop:snapshot.crop,localCount:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers).filter(item=>item.localEnabled!==false && Object.values(item.localSettings || {}).some(Boolean)).length,recommendationCount:snapshot.active.length});
    tasteRecords=[...tasteRecords.filter(item=>item.id!==record.id),record].slice(-60);persistTasteRecords();photo.acceptedRecordId=record.id;photo.acceptedSignature=signature;
  }
  task.downloaded=true;
  if(photo.id===currentPhotoId){state.exported=photo.exported;refreshActions();renderVersions();renderEditions();}
  scheduleDraftSave();
}
const makeExport=createPhotoExporter({
  exportVersion:(...args)=>projectWorkspace.exportVersion(...args),
  getRetainedBytes:()=>exportQueue.tasks.reduce((bytes,task)=>bytes+(task.result?.blob?.size||0),0)
});
async function exportPhoto() {
  if(!exportPhotoIds.length || state.loading)return;
  commitPhotoInputs();const ids=[...exportPhotoIds],options=exportOptions(),group=++exportGroup,closeId=pendingCloseAfterExportId;
  const remember=ids.length===1 && $('#export-remember').checked;
  $('#export-dialog').close();if($('#library-dialog').open)$('#library-dialog').close();
  for(const [index,id] of ids.entries()) {
    const photo=photoSessions.find(item=>item.id===id);if(!photo)continue;
    const projectId=photo.projectId,snapshot=photoSnapshot(photo),signature=snapshotAcceptanceSignature(snapshot);
    let projectVersionId=null;
    if(photo.projectId){try{const saved=await projectWorkspace.flush(photo);const version=saved.versions.slice().reverse().find(version=>snapshot.editDocument?version.document&&documentHash(version.document)===documentHash(snapshot.editDocument):snapshotAcceptanceSignature(snapshotFromProject({...saved,current:version.state,document:version.document,toolRuns:version.toolRuns,notes:version.notes}))===signature);if(!version)throw new Error('导出前的配方尚未保存，请完成保存后重试。');projectVersionId=version.id;}catch(error){showToast(error.message);continue;}}
    if(!photoSessions.includes(photo)||photo.projectId!==projectId)continue;
    preparePhotoPreview(photo);
    exportQueue.add({key:`export:${id}:${signature}:${JSON.stringify(options)}`,kind:'export',photoId:id,label:photo.imageName,group,snapshot,signature,remember,closeId:ids.length===1 ? closeId:null,automatic:ids.length===1,name:safeFilename(photo.imageName,options.format==='png' ? 'png':'jpg',ids.length>1 ? String(index+1).padStart(2,'0'):''),run:context=>makeExport(photo,snapshot,options,context,projectVersionId)});
  }
  showToast(ids.length>1 ? '已加入导出队列；完成的照片可随时打包下载。':'正在生成成片，你可以继续编辑。');
  if(ids.length>1){renderTasks();$('#tasks-dialog').showModal();}
}
for(const id of ['export-size','export-quality','export-dpi','export-metadata'])$(`#${id}`).addEventListener('change',updateExportInfo);
$('#export-purpose').addEventListener('click',event=>{const purpose=event.target.closest('[data-export-purpose]')?.dataset.exportPurpose;if(!purpose)return;const spec=exportPresets[purpose];document.querySelector(`input[name="export-format"][value="${spec.format}"]`).checked=true;$('#export-size').value=String(spec.maxSide);$('#export-quality').value=String(spec.quality);$('#export-dpi').value=String(spec.dpi);for(const button of $('#export-purpose').children)button.setAttribute('aria-pressed',String(button.dataset.exportPurpose===purpose));updateExportInfo();});

function renderImportStatus() {
  const successes=importRows.filter(row=>row.status==='success').length;
  const failed=importRows.filter(row=>row.status==='failed').length;
  const done=successes+failed,total=importRows.length;
  const entry=$('#import-status-open');entry.hidden=!total || !importingFiles && !failed;
  entry.classList.toggle('has-failures',failed>0);
  $('#import-status-label').textContent=importingFiles ? `导入 ${done} / ${total}`:failed ? `${failed} 张未加入`:`已加入 ${successes} 张`;
  entry.setAttribute('aria-label',importingFiles ? `照片导入进度 ${done}/${total}，查看详情`:failed ? `${successes} 张已加入，${failed} 张未加入，查看原因与恢复操作`:`已加入 ${successes} 张照片，查看导入结果`);
  $('#import-result-summary').textContent=importingFiles ? `正在读取 ${done+1} / ${total} 张照片`:`${successes} 张已加入${failed ? ` · ${failed} 张未加入`:''}`;
  $('#import-result-note').textContent=importingFiles ? '已就绪的照片可以继续编辑。取消仅会停止导入剩余照片。':failed ? '已加入的照片和原有编辑都保留。逐张处理后，可以重新选择或重试。':'照片方向已按文件信息读取，每张的编辑会分别保留。';
  const displayed=importingFiles ? importRows:failed ? importRows.filter(row=>row.status==='failed'):importRows;
  $('#import-results').innerHTML=displayed.map(row=>`<article class="import-result" data-import-state="${row.status}"><span class="import-result-icon" data-icon="${row.status==='success' ? 'check':row.status==='failed' ? 'image':'upload'}"></span><div><strong>${escapeHtml(row.file.name || '未命名照片')}</strong><span>${row.status==='success' ? `${row.metadata.displayWidth} × ${row.metadata.displayHeight} px · 已加入${row.metadata.convertedFrom?' · HEIC 已转换':''}`:row.status==='failed' ? escapeHtml(row.problem.reason):row.status==='reading' ? '正在检查格式、尺寸与方向…':'等待读取'}</span>${row.problem ? `<p>${escapeHtml(row.problem.action)}</p>${row.problem.detail ? `<small>${escapeHtml(row.problem.detail)}</small>`:''}`:''}</div>${row.problem?.retryable ? `<button type="button" data-import-retry="${row.id}" ${importingFiles ? 'disabled':''}>重试</button>`:''}</article>`).join('');
  hydrateIcons($('#import-results'));
  $('#import-retry-all').hidden=!failed || !importRows.some(row=>row.problem?.retryable);
  $('#import-retry-all').disabled=importingFiles;
  $('#import-choose').disabled=importingFiles || state.loading;
  $('#import-cancel').hidden=!importingFiles;
  $('#import-dismiss').hidden=importingFiles;
  $('#import-details-done').textContent=importingFiles ? '继续编辑':'完成';
}
async function processImportRows(rows) {
  if(importingFiles || state.loading)return;
  importingFiles=true;importController=new AbortController();
  const startedPhotoId=currentPhotoId,newPhotos=[];
  if($('#import-dialog').open && $('#import-results').contains(document.activeElement))$('#import-details-done').focus({preventScroll:true});
  renderImportStatus();refreshActions();
  try {
    await runImportBatch(rows,{
      signal:importController.signal,
      prepare:(file,signal)=>preparePhotoFile(file,{signal}),
      capacity:()=>({count:photoSessions.length,pixels:photoSessions.reduce((sum,photo)=>sum+photo.image.naturalWidth*photo.image.naturalHeight,0)}),
      commit:async(file,metadata,signal,original)=>{
        // Keep original bytes separately when a HEIC working copy was converted.
        const blob=file.slice(0,file.size,metadata.mime),url=URL.createObjectURL(blob);
        const photo=await addPhotoSource(url,file.name.replace(/\.[^.]+$/,''),false,false,blob,{metadata,signal,strict:true});
        photo.originalFileName=original.name;
        if(original!==file)photo.sourceOriginalBlob=original;
        newPhotos.push(photo);scheduleDraftSave();
        return {id:photo.id,width:photo.image.naturalWidth,height:photo.image.naturalHeight};
      },
      onChange:renderImportStatus
    });
  } finally {
    importingFiles=false;importController=null;
    // Stay on the photo if the user switched or edited while imports were reading.
    if(newPhotos.length && currentPhotoId===startedPhotoId && (!currentPhoto() || !photoHasEdits(currentPhoto()) && !photoHasNotes(currentPhoto())))activatePhoto(newPhotos[0].id);
    else if(newPhotos.length && !currentPhotoId)activatePhoto(newPhotos[0].id);
    renderImportStatus();refreshActions();
    if($('#import-dialog').open && document.activeElement.id==='import-cancel')$('#import-details-done').focus({preventScroll:true});
    if(newPhotos.length)scheduleDraftSave();
  }
  const failures=rows.filter(row=>row.status==='failed').length;
  if(failures) {if(!document.querySelector('dialog[open]') && !editableTarget(document.activeElement)){$('#import-dialog').showModal();$('#import-choose').focus({preventScroll:true});}showToast(`${newPhotos.length} 张已加入，${failures} 张未加入，可查看原因。`);}
  else if(newPhotos.length)showToast(`已加入 ${newPhotos.length} 张照片。可在顶部标签切换。`);
}
function importFiles(files) {
  if(importingFiles || state.loading){showToast('上一批照片仍在读取，请完成或取消后再添加。');return;}
  if(!files?.length)return;
  importRows=[...files].map(file=>({id:`import-${++importSequence}`,file,status:'queued',problem:null}));
  processImportRows(importRows);
}
$('#import-status-open').addEventListener('click',()=>{renderImportStatus();$('#import-dialog').showModal();});
for(const id of ['import-dialog-close','import-details-done'])$(`#${id}`).addEventListener('click',()=>$('#import-dialog').close());
$('#import-results').addEventListener('click',event=>{const id=event.target.closest('[data-import-retry]')?.dataset.importRetry;const row=importRows.find(item=>item.id===id);if(row?.problem?.retryable)processImportRows([row]);});
$('#import-retry-all').addEventListener('click',()=>processImportRows(importRows.filter(row=>row.problem?.retryable)));
$('#import-cancel').addEventListener('click',()=>importController?.abort());
$('#import-dismiss').addEventListener('click',()=>{importRows=[];renderImportStatus();$('#import-dialog').close();});
$('#import-choose').addEventListener('click',()=>{$('#import-dialog').close();fileInput.click();});

fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files || [])];
  fileInput.value = '';
  importFiles(files);
});
document.querySelectorAll('[data-editor-action="upload"]').forEach(button => button.addEventListener('click', () => fileInput.click()));
$('#photo-tabs').addEventListener('click', event => {
  const close = event.target.closest('[data-photo-close]');
  if (close) { requestClosePhoto(close.dataset.photoClose); return; }
  const select = event.target.closest('[data-photo-select]');
  if (select) {showWorkspaceSpace('studio');activatePhoto(select.dataset.photoSelect);}
});
$('#nav-library').addEventListener('click', () => {
  renderLibrary();
  $('#library-dialog').showModal();
  renderSpaceNavigation();
});
$('#library-dialog').addEventListener('click', event => {
  const filter = event.target.closest('[data-library-filter]');
  if (filter) { libraryFilter = filter.dataset.libraryFilter; renderLibrary(); return; }
  const select = event.target.closest('[data-library-select]');
  if (select) {
    if(librarySelecting){const id=select.dataset.librarySelect;selectedPhotos.has(id) ? selectedPhotos.delete(id):selectedPhotos.add(id);renderLibrary();return;}
    showWorkspaceSpace('studio');activatePhoto(select.dataset.librarySelect);
    selectTab('diagnosis');
    $('#library-dialog').close();
  } else if (event.target === $('#library-dialog')) $('#library-dialog').close();
});
$('#library-dialog').addEventListener('close', () => {
  renderSpaceNavigation();
});
$('#close-library').addEventListener('click', () => $('#library-dialog').close());
$('#library-add').addEventListener('click', () => { $('#library-dialog').close(); fileInput.click(); });
$('#nav-studio').addEventListener('click', () => showWorkspaceSpace('studio'));
function openPersonalProfile() {
  renderPersonalProfile();
  $('#profile-save-status').hidden=true;
  $('#personal-content').scrollTop=0;
  $('#profile-dialog').showModal();
  renderSpaceNavigation();
}
function setProfileView(view) {
  if(!['overview','preferences','growth'].includes(view))return;
  profileView = view;
  renderPersonalProfile();
  $('#personal-content').scrollTop=0;
}
for(const view of ['overview','preferences','growth'])$(`#profile-${view}-tab`).addEventListener('click',()=>setProfileView(view));
$('.profile-view-switch').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=[...$('.profile-view-switch').querySelectorAll('[role="tab"]')],index=tabs.indexOf(event.target);
  if(index<0)return;event.preventDefault();
  const next=event.key==='Home' ? 0:event.key==='End' ? tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next].click();tabs[next].focus({preventScroll:true});
});
$('#profile-dialog').addEventListener('click',event=>{
  const view=event.target.closest('[data-profile-view]')?.dataset.profileView;
  if(view){setProfileView(view);$(`#profile-${view}-tab`).focus({preventScroll:true});}
  if(event.target.closest('#personal-resume-photo')){$('#profile-dialog').close();showWorkspaceSpace('studio');}
  if(event.target.closest('#personal-add-photo')){$('#profile-dialog').close();fileInput.click();}
});
$('#personal-open-library').addEventListener('click',()=>{
  $('#profile-dialog').close();
  const entry=matchMedia('(max-width:960px)').matches ? $('.mobile-spaces [data-space="library"]'):$('#nav-library');
  entry.focus({preventScroll:true});entry.click();
});
$('#profile-start-practice').addEventListener('click',()=>{$('#profile-dialog').close();showWorkspaceSpace('learn');});
$('#profile-accept-current').addEventListener('click', async () => {
  const result = await acceptCurrentVersion();
  if (result.status === 'saved' || result.status === 'updated') showToast(result.persisted ? '这版已记入偏好记录。下次推荐会参考你的选择。' : '这版只在当前页面暂存；浏览器存储不可用。');
});
$('#taste-timeline').addEventListener('click', event => {
  const id = event.target.closest('[data-taste-remove]')?.dataset.tasteRemove;
  if (!id) return;
  tasteRecords = tasteRecords.filter(item => item.id !== id);
  for (const photo of photoSessions) if (photo.acceptedRecordId === id) { photo.acceptedRecordId = null;photo.acceptedSignature = null; }
  persistTasteRecords();
  renderPersonalProfile();
  if (state.image) renderPresets();
  refreshActions();showToast('这条定稿已从偏好记录移除。');
});
for(const id of ['nav-profile','style-profile-link'])$(`#${id}`).addEventListener('click',()=>{profileView='preferences';openPersonalProfile();});
for (const id of ['profile-button','mobile-profile-button']) $( `#${id}` ).addEventListener('click',()=>{profileView='overview';openPersonalProfile();});
function closePersonalProfile() { $('#profile-dialog').close(); }
$('#close-profile').addEventListener('click', closePersonalProfile);
$('#profile-done').addEventListener('click', closePersonalProfile);
$('#profile-dialog').addEventListener('click', event => { if (event.target === $('#profile-dialog')) closePersonalProfile(); });
$('#profile-dialog').addEventListener('close', () => {
  renderSpaceNavigation();refreshActions();
});
$('#profile-name').addEventListener('input', event => {
  personalProfile.name = event.target.value.trim().slice(0,20);
  $('#account-name').textContent = '我的';
  renderAccountAvatar();
  showProfileSaveStatus(persistPersonalProfile());
});
$('#profile-subjects').addEventListener('click', event => {
  const subject = event.target.closest('[data-profile-subject]')?.dataset.profileSubject;
  if (!subject) return;
  personalProfile.subjects = personalProfile.subjects.includes(subject) ? personalProfile.subjects.filter(item => item !== subject) : [...personalProfile.subjects,subject];
  const saved=persistPersonalProfile();renderPersonalProfile();renderPresets();showProfileSaveStatus(saved);
});
$('#profile-styles').addEventListener('click', event => {
  const preference = event.target.closest('[data-profile-style]')?.dataset.profileStyle;
  if (!stylePreferences.some(item => item.id === preference)) return;
  state.stylePreference = preference;
  let saved=true;try { localStorage.setItem('guangjian-style-preference',preference); } catch { saved=false; }
  renderPersonalProfile();renderPresets();showProfileSaveStatus(saved);
});
$('#photo-subject').addEventListener('change', event => {
  const photo = currentPhoto();
  if (!photo) return;
  photo.subject = validSubject(event.target.value);
  photo.subjectSource = 'manual';
  scheduleDraftSave();
  renderPresets();
  if ($('#library-dialog').open) renderLibrary();
  if ($('#profile-dialog').open) renderPersonalProfile();
});
function photoTaskLabel(photo) {
  const jobs=[...analysisQueue.tasks,...exportQueue.tasks].filter(task=>task.photoId===photo.id);
  const pending=jobs.findLast(task=>['queued','running'].includes(task.status));
  if(pending)return `${pending.kind==='analysis' ? '分析':'导出'}${pending.status==='queued' ? '排队中':'处理中'}`;
  const last=jobs.at(-1);return last?.status==='failed' ? '处理失败 · 可重试':last?.status==='cancelled' ? '已取消':last?.kind==='export' && last.status==='done' && !last.downloaded ? '成片可下载':'';
}
function taskChanged(task) {
  if(task?.kind==='analysis') {
    const photo=photoSessions.find(item=>item.id===task.photoId);
    if(photo && latestReviewTask(analysisQueue.tasks,photo.id)===task) {
      if(['queued','running'].includes(task.status)) {photo.analysisStatus=task.status==='queued' ? 'queued':task.message.includes('视觉模型') ? 'analyzing':'checking';photo.analysisError=null;}
      else if(task.status==='cancelled'){photo.analysisStatus='fallback';photo.analysisError={code:'CANCELLED',message:'这次审片已取消，已有结果和调整保留。',retryable:true};}
      if(photo.id===currentPhotoId){state.analyzing=analysisQueue.tasks.some(item=>item.photoId===photo.id && ['queued','running'].includes(item.status));reflectPhotoAnalysis(photo);}
      if(['done','failed','cancelled'].includes(task.status))scheduleDraftSave();
    }
  }
  if(task?.kind==='export' && task.status==='done' && !task.result.url)task.result.url=URL.createObjectURL(task.result.blob);
  if(task?.kind==='export' && task.status==='done' && task.automatic && !task.downloaded) {
    triggerDownload(task.result.blob,task.name);registerExport(task);
    if(task.closeId){const photo=photoSessions.find(item=>item.id===task.photoId);if(photo && snapshotAcceptanceSignature(photoSnapshot(photo))===task.signature)removePhoto(task.photoId);else showToast('成片已开始下载；生成期间新增的调整保留，照片没有移出。');task.closeId=null;}
    else showToast(task.result?.projectPath ? '成片已保存到 '+task.result.projectPath+'，并已开始下载。':'成片已开始下载。生成时的版本已保留。');
  }
  if(task?.kind==='export' && task.status==='failed')showToast(`「${task.label}」导出未完成，可在任务中重试。`);
  if($('#tasks-dialog').open)renderTasks();
  const all=[...analysisQueue.tasks,...exportQueue.tasks],pending=all.filter(task=>['queued','running'].includes(task.status)).length,failed=all.filter(task=>unresolvedFailure(task)).length;
  $('#task-count').textContent=pending ? `任务 ${pending}`:failed ? `待重试 ${failed}`:all.some(task=>task.kind==='export' && task.status==='done' && !task.downloaded) ? '成片就绪':'任务';
  $('#open-tasks').hidden=!all.length;
  $('#open-tasks').classList.toggle('has-pending',pending>0);syncPhotoTabs();
}
let taskFilter='all';
function renderTasks() {
  const tasks=[...analysisQueue.tasks,...exportQueue.tasks],visible=tasks.filter(task=>taskFilter==='all' || task.kind===taskFilter);
  const running=tasks.filter(task=>['queued','running'].includes(task.status)).length,failures=tasks.filter(task=>unresolvedFailure(task)).length;
  $('#task-summary').textContent=`${running} 项等待或处理中 · ${tasks.filter(task=>task.status==='done').length} 项完成${failures ? ` · ${failures} 项失败`:''}`;
  $('#task-list').innerHTML=visible.slice().reverse().map(task=>{
    const status=task.supersededBy ? '已由新审片替代 · '+(task.error || '目标已更新'):task.status==='done' ? task.kind==='analysis' ? task.result?.mode==='vision' ? '视觉审片完成':'基础光色就绪 · 未进行视觉识别':task.downloaded ? '已发起下载':'成片就绪':task.status==='queued' ? '等待处理':task.status==='running' ? task.message || '正在处理':task.status==='cancelled' ? task.cancelReason==='superseded' ? '目标已更新 · 已切换到新审片':task.controller ? '正在停止':'已取消':task.error;
    return `<article class="task-row" data-task-state="${task.status}"><div class="task-photo"><span>${task.kind==='analysis' ? '审片':'成片'}</span></div><div class="task-copy"><strong>${escapeHtml(task.label)}</strong><small>${escapeHtml((task.released ? '照片已移出 · ':'')+status)}</small>${task.kind==='export' && task.result ? `<small>${task.result.width} × ${task.result.height} px · ${(task.result.blob.size/1024/1024).toFixed(1)} MB</small>`:''}</div><div class="task-actions">${['queued','running'].includes(task.status) ? `<button type="button" data-job-action="cancel" data-job-id="${task.id}" data-job-kind="${task.kind}">取消</button>`:['failed','cancelled'].includes(task.status) && !task.released && !task.supersededBy && task.cancelReason!=='superseded' ? `<button type="button" data-job-action="retry" data-job-id="${task.id}" data-job-kind="${task.kind}" ${task.controller ? 'disabled':''}>重试</button>`:task.kind==='export' && task.result ? `<a href="${task.result.url}" download="${escapeHtml(task.name)}" data-job-action="download" data-job-id="${task.id}" data-job-kind="export">下载</a>`:''}${photoSessions.some(photo=>photo.id===task.photoId) ? `<button type="button" data-job-action="view" data-job-id="${task.id}" data-job-kind="${task.kind}">查看</button>`:''}</div></article>`;
  }).join('') || '<p class="task-empty">暂无任务。导入照片后会自动分析，导出进度也会显示在这里。</p>';
  $('#tasks-download').disabled=!exportQueue.tasks.some(task=>task.status==='done');
  $('#tasks-clear').disabled=!tasks.some(task=>['done','cancelled'].includes(task.status) && !task.controller);
}
$('#open-tasks').addEventListener('click',()=>{renderTasks();$('#tasks-dialog').showModal();});
$('#tasks-close').addEventListener('click',()=>$('#tasks-dialog').close());
$('#task-filters').addEventListener('click',event=>{const filter=event.target.closest('[data-task-filter]');if(!filter)return;taskFilter=filter.dataset.taskFilter;for(const button of $('#task-filters').children)button.setAttribute('aria-pressed',String(button===filter));renderTasks();});
$('#task-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-job-action]');if(!button)return;
  const queue=button.dataset.jobKind==='analysis' ? analysisQueue:exportQueue,task=queue.tasks.find(item=>item.id===button.dataset.jobId);if(!task)return;
  const action=button.dataset.jobAction;
  if(action==='cancel')queue.cancel(task.id);
  if(action==='retry') {if(!photoSessions.some(photo=>photo.id===task.photoId)){showToast('照片已移出工作区，请重新加入后处理。');return;}queue.retry(task.id);}
  if(action==='download'){event.preventDefault();triggerDownload(task.result.blob,task.name);registerExport(task);renderTasks();}
  if(action==='view'){$('#tasks-dialog').close();activatePhoto(task.photoId);}
});
$('#tasks-clear').addEventListener('click',()=>{for(const task of exportQueue.tasks)if(task.status==='done' && task.result?.url)URL.revokeObjectURL(task.result.url);analysisQueue.clear();exportQueue.clear();});
$('#tasks-download').addEventListener('click',async()=>{
  const ready=exportQueue.tasks.filter(task=>task.status==='done'),names=new Set();
  const files=ready.map(task=>{let name=task.name;if(names.has(name))name=name.replace(/(\.[^.]+)$/,`-${task.id}$1`);names.add(name);return {name,blob:task.result.blob};});
  $('#tasks-download').disabled=true;
  try {const archive=await createPhotoArchive(files);triggerDownload(archive,'帧好成片.zip');for(const task of ready)registerExport(task);showToast(`已开始下载 ${ready.length} 张成片的压缩包。`);}
  catch(error){showToast(error.message);}finally{renderTasks();}
});
$('#library-select-mode').addEventListener('click',()=>{librarySelecting=!librarySelecting;if(!librarySelecting)selectedPhotos.clear();$('#library-select-all').hidden=!librarySelecting;renderLibrary();});
$('#library-select-all').addEventListener('click',()=>{for(const photo of photoSessions.filter(photo=>libraryFilter==='all' || validSubject(photo.subject)===libraryFilter))selectedPhotos.add(photo.id);renderLibrary();});
$('#library-grid').addEventListener('change',event=>{const id=event.target.dataset.batchSelect;if(!id)return;event.target.checked ? selectedPhotos.add(id):selectedPhotos.delete(id);renderLibrary();});
$('#library-selection-actions').addEventListener('click',event=>{
  const action=event.target.closest('[data-batch-action]')?.dataset.batchAction;if(!action)return;
  commitPhotoInputs();
  if(action==='series'){$('#library-dialog').close();seriesWorkspace.open([...selectedPhotos]);return;}
  if(action==='export'){openExportDialog([...selectedPhotos]);return;}
  if(action==='analysis'){for(const id of selectedPhotos)analyzeImage(photoSessions.find(photo=>photo.id===id));$('#library-dialog').close();renderTasks();$('#tasks-dialog').showModal();return;}
  openBatch(action);
});
let batchMode='sync',batchStyleId=presets[0].id;const batchDocuments=new Map();
async function openBatch(mode) {
  batchMode=mode;commitPhotoInputs();batchDocuments.clear();if(photoSessions.some(photo=>photo.editDocument)){try{for(const photo of photoSessions)batchDocuments.set(photo.id,await editStack.ensure(photo));}catch(error){showToast(error.message);return;}}
  $('#batch-title').textContent=mode==='sync' ? '同步一组照片':'批量应用风格';
  $('#batch-intro').textContent=mode==='sync' ? batchDocuments.size?'按原顺序复制所选操作，追加到目标照片的配方；已有步骤保留，范围可逐张修改。':'将参考照片叠加后的参数复制到所选照片，未勾选的参数不变。参考照片保持原样。':'为所选照片应用同一款风格，保留各自的原片和其他调整。';
  $('#batch-sync-view').hidden=mode!=='sync';$('#batch-style-view').hidden=mode!=='style';
  $('#batch-source').innerHTML=photoSessions.map(photo=>`<option value="${photo.id}">${escapeHtml(photo.imageName)}${photo.id===currentPhotoId ? ' · 当前照片':''}</option>`).join('');$('#batch-source').value=currentPhotoId;
  $('#batch-parameters').innerHTML=syncGroups.map(group=>`<details ${['light','color'].includes(group.id) ? 'open':''}><summary><label><input type="checkbox" data-sync-group="${group.id}" ${['light','color'].includes(group.id) ? 'checked':''} />${group.label}</label><span>${group.keys.length} 项</span></summary><div>${group.keys.map(key=>`<label><input type="checkbox" data-sync-key="${key}" ${['light','color'].includes(group.id) ? 'checked':''} /><span>${settingLabels[key] || (key==='monochrome' ? '黑白':'参数')}</span><output data-sync-value="${key}"></output></label>`).join('')}</div></details>`).join('');
  $('#batch-exposure').checked=false;$('#batch-crop').checked=false;$('#batch-local').checked=false;
  $('#batch-style-category').innerHTML=styleCategories.filter(item=>item.id!=='favorites').map(item=>`<option value="${item.id}">${item.label}</option>`).join('');
  renderBatchStyles();updateBatchPlan();$('#batch-dialog').showModal();
}
function renderBatchStyles() {
  const category=$('#batch-style-category').value,visible=presets.filter(preset=>category==='all' || preset.groups.includes(category));
  if(!visible.some(item=>item.id===batchStyleId))batchStyleId=visible[0]?.id;
  $('#batch-styles').innerHTML=visible.map(preset=>`<button type="button" data-batch-style="${preset.id}" aria-pressed="${preset.id===batchStyleId}"><span class="style-swatch" style="--style-warmth:${(preset.adjustments.warmth || 0)*2}deg"></span><strong>${preset.name}</strong><small>${preset.mood}</small></button>`).join('');
}
function batchPlans() {
  const source=photoSessions.find(photo=>photo.id===$('#batch-source').value);
  if(!source)return [];preparePhotoPreview(source);const sourceSnapshot=photoSnapshot(source);if(batchDocuments.has(source.id))sourceSnapshot.editDocument=source.editDocument||batchDocuments.get(source.id);
  const keys=[...document.querySelectorAll('[data-sync-key]:checked')].map(input=>input.dataset.syncKey);
  return [...selectedPhotos].filter(id=>batchMode==='style' || id!==source.id).map(id=>{
    const photo=photoSessions.find(item=>item.id===id);if(!photo)return null;preparePhotoPreview(photo);const before={...photoSnapshot(photo),projectVersionId:photo.projectCurrentId};if(batchDocuments.has(photo.id))before.editDocument=photo.editDocument||batchDocuments.get(photo.id);
    const plan=batchMode==='style' ? {snapshot:planStyle(before,batchStyleId,Number($('#batch-style-amount').value))}:planSync(sourceSnapshot,before,{keys,matchExposure:$('#batch-exposure').checked,sourceHistogram:source.originalInspection.histogram,targetHistogram:photo.originalInspection.histogram,crop:$('#batch-crop').checked,local:$('#batch-local').checked});
    if(batchMode==='style'&&before.editDocument){plan.commands=presetCommands(batchStyleId,Number($('#batch-style-amount').value),{groupId:'look-'+crypto.randomUUID()});plan.snapshot={...before,editDocument:applyCommands(before.editDocument,plan.commands).next};}
    return {photo,before,...plan};
  }).filter(Boolean);
}
function updateBatchPlan() {
  const source=photoSessions.find(photo=>photo.id===$('#batch-source').value);if(!source)return;
  const settings=snapshotSettings(photoSnapshot(source));
  for(const value of document.querySelectorAll('[data-sync-value]')){const key=value.dataset.syncValue;value.textContent=source.editDocument?'按步骤复制':key==='exposure' ? `${settings[key].toFixed(2)} EV`:Math.round(settings[key]);}
  const exposureSelected=Boolean(document.querySelector('[data-sync-key="exposure"]:checked'));$('#batch-exposure').disabled=!exposureSelected;
  let plans;try{plans=batchPlans();}catch(error){$('#batch-plan').textContent=error.message;$('#batch-apply').disabled=true;return;}const keyCount=document.querySelectorAll('[data-sync-key]:checked').length;
  if(batchMode==='style' && plans[0])renderBatchStylePreview(plans[0]);
  $('#batch-plan').innerHTML=`<strong>${plans.length} 张目标照片${batchMode==='sync' ? ` · ${keyCount} 项参数`:''}</strong>${plans.map(plan=>`<div><span>${escapeHtml(plan.photo.imageName)}</span><small>${batchMode==='style' ? `${escapeHtml(presetById(batchStyleId).name)} · ${$('#batch-style-amount').value}%`:plan.snapshot.editDocument ? `追加 ${plan.commands?.filter(command=>command.type==='AddStep').length||0} 个独立步骤`:exposureSelected ? `合成曝光 ${snapshotSettings(plan.snapshot).exposure.toFixed(2)} EV${plan.exposure ? plan.exposure.limited ? ' · 适配受限，请检查':' · 逐张适配':''}`:'保留曝光'}${batchMode==='sync' && $('#batch-crop').checked ? ' · 同步裁剪':''}${batchMode==='sync' && $('#batch-local').checked ? ' · 替换局部':''}</small></div>`).join('')}${!plans.length ? '<p>请选择参考照片以外的目标照片。</p>':''}`;
  $('#batch-apply').disabled=!plans.length || batchMode==='sync' && !keyCount && !$('#batch-crop').checked && !$('#batch-local').checked;
}
function renderBatchStylePreview(plan) {
  const {photo,snapshot}=plan,canvas=$('#batch-style-canvas'),rect=cropPixelRect(snapshot.crop,photo.image.naturalWidth,photo.image.naturalHeight),scale=Math.min(1,380/rect.width,180/rect.height);
  const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale));canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'});drawPhotoSource(context,photo.image,snapshot.crop,width,height,rect);
  const pixels=renderPhotoPixels({pixels:context.getImageData(0,0,width,height).data,width,height,settings:snapshotSettings(snapshot),document:snapshot.editDocument,annotations:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers),crop:snapshot.crop,frame:{fullWidth:photo.image.naturalWidth,fullHeight:photo.image.naturalHeight,sourceRect:rect,angle:snapshot.crop?.angle || 0}});
  context.putImageData(new ImageData(pixels,width,height),0,0);$('#batch-style-preview-label').textContent=`${photo.imageName} · ${presetById(batchStyleId).name} ${snapshot.presetAmount}% · 其他照片使用各自原片`;
}
function commitPhotoSnapshot(photo,snapshot,before) {
  if(JSON.stringify(before)===JSON.stringify(snapshot))return false;
  if(photo.id===currentPhotoId){restoreEdit(snapshot);saveEdit(before);commitPhotoInputs();}
  else {
    photo.history ||= {past:[],future:[]};photo.history.past.push(structuredClone(before));photo.history.past=photo.history.past.slice(-30);photo.history.future=[];
    Object.assign(photo,{editDocument:structuredClone(snapshot.editDocument||null),manual:{...snapshot.manual},active:new Set(snapshot.active),advisorLayers:structuredClone(snapshot.advisorLayers),crop:structuredClone(snapshot.crop),annotations:structuredClone(snapshot.annotations),presetId:snapshot.presetId,presetAmount:snapshot.presetAmount,assessment:null,exported:false,presetThumbs:{}});
    if(photo.analysis && snapshot.recommendations)photo.analysis.recommendations=structuredClone(snapshot.recommendations);
  }
  return true;
}
$('#batch-apply').addEventListener('click',async()=>{
  commitPhotoInputs();const plans=batchPlans(),changed=[];
  $('#batch-apply').disabled=true;for(const plan of plans){const before={...photoSnapshot(plan.photo),projectVersionId:plan.photo.projectCurrentId};const applied=plan.commands?await editStack.command(plan.commands,plan.photo):commitPhotoSnapshot(plan.photo,plan.snapshot,plan.before);if(applied)changed.push({id:plan.photo.id,before,after:photoSnapshot(plan.photo)});}
  if(changed.length)lastBatch=changed;
  scheduleDraftSave();renderPhotoTabs();$('#batch-dialog').close();showToast(changed.length ? `已调整 ${changed.length} 张照片，可逐张查看或在图库撤销。`:'这些照片已是相同设置。');
});
$('#library-undo-batch').addEventListener('click',async()=>{
  if(!lastBatch)return;commitPhotoInputs();let restored=0,skipped=0;
  for(const item of lastBatch){const photo=photoSessions.find(photo=>photo.id===item.id);if(!photo)continue;const current=photoSnapshot(photo);if(JSON.stringify(current)!==JSON.stringify(item.after)){skipped++;continue;}if(photo.projectId&&item.before.projectVersionId){try{await projectWorkspace.restoreEdition(photo,item.before.projectVersionId);restored++;}catch(error){showToast(error.message);skipped++;}}else if(commitPhotoSnapshot(photo,item.before,current))restored++;}
  lastBatch=null;scheduleDraftSave();renderPhotoTabs();showToast(`已撤销 ${restored} 张的批量调整${skipped ? `；${skipped} 张有后续编辑，已保留`:''}。`);
});
$('#batch-dialog').addEventListener('change',event=>{
  const group=event.target.dataset.syncGroup;if(group){const keys=syncGroups.find(item=>item.id===group).keys;for(const key of keys)document.querySelector(`[data-sync-key="${key}"]`).checked=event.target.checked;}
  for(const spec of syncGroups){const input=document.querySelector(`[data-sync-group="${spec.id}"]`);if(!input)continue;const count=spec.keys.filter(key=>document.querySelector(`[data-sync-key="${key}"]`).checked).length;input.checked=count===spec.keys.length;input.indeterminate=count>0 && count<spec.keys.length;}
  if(event.target.id==='batch-style-category')renderBatchStyles();updateBatchPlan();
});
$('#batch-styles').addEventListener('click',event=>{const id=event.target.closest('[data-batch-style]')?.dataset.batchStyle;if(!id)return;batchStyleId=id;renderBatchStyles();updateBatchPlan();});
$('#batch-style-amount').addEventListener('input',()=>{$('#batch-style-value').textContent=`${$('#batch-style-amount').value}%`;updateBatchPlan();});
for(const id of ['batch-close','batch-cancel'])$(`#${id}`).addEventListener('click',()=>$('#batch-dialog').close());

$('#cancel-replace').addEventListener('click', () => { pendingCloseId = null; $('#replace-dialog').close(); });
$('#confirm-replace').addEventListener('click', () => {
  const id = pendingCloseId;
  pendingCloseId = null;
  $('#replace-dialog').close();
  if (id) removePhoto(id);
});
$('#export-before-replace').addEventListener('click', () => {
  const id = pendingCloseId;
  pendingCloseId = null;
  $('#replace-dialog').close();
  if (id && id !== currentPhotoId) activatePhoto(id);
  pendingCloseAfterExportId = id;
  openExportDialog();
});
$('#replace-dialog').addEventListener('close', () => { pendingCloseId = null; });
$('#compare-slider').addEventListener('input', event => setCompare(event.target.value));
window.addEventListener('resize', () => { sizePhotoStage(); if ($('#crop-dialog').open) sizeCropEditor(); });
$('#mark-photo').addEventListener('click', () => {
  if (state.annotations.length >= 8 && !markingPhoto) { showToast('一张照片最多标记 8 处，可先整理已有批注。'); return; }
  maskTool='rectangle';localToolCreating=false;annotationBrushPoints=[];annotationShapeStart=null;annotationShapeEnd=null;setMarkingPhoto(!markingPhoto);
  if (markingPhoto) showToast('在照片上拖出范围；点一下也可快速标记。');
});
$('#agent-mark-photo').addEventListener('click', () => { maskTool='rectangle';localToolCreating=false;setMarkingPhoto(true); $('#photo-stage').scrollIntoView({block:'center',behavior:'smooth'}); });
$('#annotation-layer').addEventListener('click', event => {
  const button = event.target.closest('[data-annotation-id]');
  if (!button || markingPhoto) return;
  selectedAnnotationId = button.dataset.annotationId;
  const localEditing=$('#tab-adjust').classList.contains('active');
  if(!localEditing){currentPhoto().agentFocusId=selectedAnnotationId;scheduleDraftSave();}
  selectTab(localEditing ? 'adjust':'agent');
  renderAnnotations();renderLocalEditor();
  if(localEditing){$('.local-control-group').open=true;$('#local-editor').scrollIntoView({block:'nearest',behavior:'smooth'});}
  else {$('#agent-annotations').open=true;$('#annotation-board').scrollIntoView({block:'nearest',behavior:'smooth'});}
});
$('#annotation-list').addEventListener('click', event => {
  const id = event.target.closest('[data-annotation-select]')?.dataset.annotationSelect;
  if (!id) return;
  finishAnnotationNote();
  selectedAnnotationId = id;
  currentPhoto().agentFocusId=id;scheduleDraftSave();
  renderAnnotations();
  $('#annotation-note').focus();
});
$('#annotation-note').addEventListener('focus', () => { annotationNoteBefore = editSnapshot(); });
$('#annotation-note').addEventListener('input', event => {
  const selected = selectedAnnotation();
  if (!selected) return;
  selected.note = event.target.value.slice(0,300);
  scheduleDraftSave();
  renderAgentContext();
  $('#annotation-ask').disabled = !selected.note.trim() || Boolean(currentPhoto()?.agentBusy) || !state.analysis;
});
$('#annotation-note').addEventListener('change', () => { finishAnnotationNote(); renderAnnotations(); });
$('#annotation-note').addEventListener('blur', finishAnnotationNote);
$('#annotation-delete').addEventListener('click', () => {
  if (!selectedAnnotation()) return;
  finishAnnotationNote();
  const before = beforeEdit();
  state.advisorLayers=state.advisorLayers.filter(item=>item.annotationId!==selectedAnnotationId);
  state.annotations = state.annotations.filter(item => item.id !== selectedAnnotationId);
  selectedAnnotationId = state.annotations.at(-1)?.id || null;
  saveEdit(before);
  renderAnnotations();
  scheduleRender();markAssessmentStale();renderAgent();
  showToast('标记已删除，可以撤销。');
});
$('#annotation-strength').addEventListener('input', event => {
  const selected = selectedAnnotation();
  if (!selected) return;
  beginRangeEdit(`region:${selected.id}`);
  selected.localAmount = Number(event.target.value);
  $('#annotation-strength-value').textContent = `${selected.localAmount}%`;
  scheduleRender();
  markAssessmentStale();
});
$('#annotation-strength').addEventListener('change', finishRangeEdit);
$('#annotation-local-clear').addEventListener('click', () => {
  const selected = selectedAnnotation();
  if (!selected) return;
  const before = beforeEdit();
  const removed=state.advisorLayers.filter(item=>item.annotationId===selected.id);
  state.advisorLayers=state.advisorLayers.filter(item=>item.annotationId!==selected.id);
  currentPhoto()?.conversation.forEach(message=>{if(removed.some(item=>item.id===message.id)) message.applied=false;});
  selected.localSettings = null;
  selected.localAmount = 100;
  saveEdit(before);
  scheduleRender();
  markAssessmentStale();
  renderAnnotations();
  showToast('已移除这处局部调整，可撤销。');
});
$('#annotation-ask').addEventListener('click', () => {
  finishAnnotationNote();
  const selected = selectedAnnotation();
  if (!selected?.note.trim()) return;
  const number = state.annotations.indexOf(selected)+1;
  askDesignAgent(`请看我标记的第 ${number} 处：${selected.note}`,selected.id);
});
$('#photo-stage').addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('#style-audition-strip')) return;
  if (event.target.closest('.annotation-box') && !markingPhoto) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  if (markingPhoto) {
    event.preventDefault();
    annotationDrag = {pointerId:event.pointerId,start:pointOnStage(event)};annotationBrushPoints=[annotationDrag.start];annotationShapeStart=annotationDrag.start;
    showAnnotationDraft(rectFromPoints(annotationDrag.start,annotationDrag.start));
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  setCompare((event.clientX - rect.left) / rect.width * 100);
});
$('#photo-stage').addEventListener('pointermove', event => {
  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
  if (annotationDrag?.pointerId === event.pointerId) {
    const point=pointOnStage(event);if(maskTool==='brush' && annotationBrushPoints.length<600)annotationBrushPoints.push(point);
    const rect = rectFromPoints(annotationDrag.start,point);
    if (rect) {showAnnotationDraft(rect);if(localToolCreating && maskTool==='brush') {const W=state.image.naturalWidth,H=state.image.naturalHeight,points=annotationBrushPoints.map(p=>viewToOriginalPoint(p,state.crop,W,H));renderMaskOverlay({maskType:'brush',points,brushRadius:.03,rect:brushBounds(points,.03,W,H),feather:.36});}}
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  setCompare((event.clientX - rect.left) / rect.width * 100);
});
$('#photo-stage').addEventListener('pointerup', event => {
  if (annotationDrag?.pointerId !== event.pointerId) return;
  const rect = rectFromPoints(annotationDrag.start,pointOnStage(event));
  annotationShapeEnd=pointOnStage(event);
  annotationDrag = null;
  $('#annotation-draft').hidden = true;
  if (rect) addAnnotation(rect);
});
$('#photo-stage').addEventListener('pointercancel', () => { annotationDrag = null; $('#annotation-draft').hidden = true;renderMaskOverlay(); });
$('#photo-stage').addEventListener('keydown', event => {
  if (!markingPhoto || !['Enter',' '].includes(event.key)) return;
  event.preventDefault();
  addAnnotation(rectFromPoints({x:.5,y:.5},{x:.5,y:.5}));
});
const holdCompare = $('#hold-compare');
let suppressCompareClick = false;
holdCompare.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  suppressCompareClick = true;
  event.currentTarget.setPointerCapture(event.pointerId);
  showComparisonPopover();
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) holdCompare.addEventListener(type, () => {
  hideComparisonPopover();
  setTimeout(() => { suppressCompareClick = false; },350);
});
holdCompare.addEventListener('click', () => {
  if (suppressCompareClick) { suppressCompareClick = false; return; }
  if ($('#compare-popover').hidden) showComparisonPopover(); else hideComparisonPopover();
});
holdCompare.addEventListener('blur', hideComparisonPopover);
window.addEventListener('blur', hideComparisonPopover);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { hideComparisonPopover();setMarkingPhoto(false); } });

let localToolCreating=false,annotationBrushPoints=[],annotationShapeStart=null,annotationShapeEnd=null;
let draftCrop = null;
let cropDrag = null;
function sizeCropEditor() {
  if (!state.image || !$('#crop-dialog').open) return;
  const ratio = state.image.naturalWidth / state.image.naturalHeight;
  const width = Math.min(650,$('#crop-dialog').clientWidth - 50,window.innerWidth - 55,Math.max(130,window.innerHeight - (window.innerWidth<600 ? 470:430)) * ratio);
  $('#crop-editor-media').style.width = `${Math.max(40,width)}px`;
  $('#crop-editor-media').style.height = `${Math.max(40,width) / ratio}px`;
}
function showDraftCrop() {
  if (!draftCrop) return;
  const frame = $('#crop-editor-frame');
  frame.style.left = `${draftCrop.x * 100}%`;
  frame.style.top = `${draftCrop.y * 100}%`;
  frame.style.width = `${draftCrop.width * 100}%`;
  frame.style.height = `${draftCrop.height * 100}%`;
  const angle=draftCrop.angle || 0,W=state.image.naturalWidth,H=state.image.naturalHeight,{scale}=straightenTransform(W,H,angle);
  $('#crop-editor-image').style.transform=`rotate(${angle}deg) scale(${scale})`;
  $('#crop-candidates').querySelectorAll('[data-crop-candidate]').forEach(button=>{const target=button.dataset.cropCandidate==='original' ? {x:0,y:0,width:1,height:1}:button.dataset.cropCandidate==='light' ? {x:.025,y:.025,width:.95,height:.95}:state.analysis?.cropRecommendation?.rect;const active=target && ['x','y','width','height'].every(key=>Math.abs(target[key]-draftCrop[key])<.0001) && !angle;button.classList.toggle('active',Boolean(active));button.setAttribute('aria-pressed',String(Boolean(active)));});
  $('#crop-angle-value').textContent=`${angle.toFixed(1)}°`;
  $('#crop-coverage').textContent=`画幅保留 ${Math.round(draftCrop.width*draftCrop.height*100)}%${angle ? ` · 拉直后原片面积约 ${Math.round(draftCrop.width*draftCrop.height/scale**2*100)}%`:''}`;
  const protectedKeys=cropProtectedRegions(draftCrop,state.analysisSource==='ai' ? state.analysis?.observations:null,W,H);
  $('#crop-review-note').textContent=protectedKeys.length ? `注意：可能切到${protectedKeys.map(key=>observationLabels[key]).join('、')}的近似范围，请确认边界。` : state.analysisSource==='ai' ? '标记位置仅供参考。裁剪时请检查主体、光源和周围环境，也可以试试其他比例。' : '这些裁剪范围仅按比例生成，未识别照片内容；请确认没有裁掉人物、光源或其他重要内容。';
}
function openCropEditor(suggestedRect = null) {
  if (!state.image || state.loading) return;
  draftCrop = {...(validCrop(suggestedRect,{suggestion:true}) || state.crop || {x:0,y:0,width:1,height:1})};
  $('#crop-editor-image').src = state.image.src;
  $('#crop-editor-image').alt = `${state.imageName}的原始画面`;
  $('#crop-restore-suggestion').hidden = !state.analysis?.cropRecommendation;
  $('#crop-ratio').value='free';$('#crop-angle').value=draftCrop.angle || 0;$('#crop-ai-candidate').hidden=!state.analysis?.cropRecommendation;
  $('#crop-dialog').showModal();
  sizeCropEditor();
  showDraftCrop();
}
function applyCrop(next) {
  let clean = next ? validCrop(next) : null;
  if(clean && clean.x===0 && clean.y===0 && clean.width===1 && clean.height===1 && !clean.angle)clean=null;
  if (next && !clean) return;
  if (JSON.stringify(state.crop) === JSON.stringify(clean)) return;
  if(state.editDocument){editStack.command([{type:'UpdateGeometry',geometry:{crop:clean}}]);return;}
  const before = beforeEdit();
  state.crop = clean;
  saveEdit(before);
  buildPresetThumbs(state.image);
  renderAnalysis();
  renderPresets();
  sizePhotoStage();
  scheduleRender();
  markAssessmentStale();
  setCompare(clean ? Math.max(state.compare,68) : 50);
  showToast(clean ? '裁剪已应用；可打开构图工具继续微调。' : '已恢复原始构图。');
}
$('#crop-suggestion').addEventListener('click', event => {
  const action = event.target.closest('[data-crop-action]')?.dataset.cropAction;
  if (action === 'edit') openCropEditor();
  if (action === 'toggle') {if(state.crop)applyCrop(null);else previewSuggestions([],{crop:true});}
});
$('#manual-crop-open').addEventListener('click',()=>openCropEditor());
$('#manual-crop-clear').addEventListener('click', () => applyCrop(null));
$('#crop-restore-suggestion').addEventListener('click', () => { draftCrop = {...state.analysis.cropRecommendation.rect}; showDraftCrop(); });
$('#crop-cancel').addEventListener('click', () => $('#crop-dialog').close());
$('#crop-close').addEventListener('click', () => $('#crop-dialog').close());
$('#crop-dialog').addEventListener('click', event => { if (event.target === $('#crop-dialog')) $('#crop-dialog').close(); });
$('#crop-apply-dialog').addEventListener('click', () => { applyCrop(draftCrop); $('#crop-dialog').close(); });
$('#crop-editor-frame').addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  cropDrag = {clientX:event.clientX,clientY:event.clientY,initial:{...draftCrop},handle:event.target.closest('[data-crop-handle]')?.dataset.cropHandle || 'move'};
});
$('#crop-editor-frame').addEventListener('pointermove', event => {
  if (!cropDrag) return;
  const media = $('#crop-editor-media').getBoundingClientRect();
  const dx = (event.clientX - cropDrag.clientX) / media.width;
  const dy = (event.clientY - cropDrag.clientY) / media.height;
  const box = cropDrag.initial;
  if (cropDrag.handle === 'move') {
    draftCrop = {...box,x:clamp(box.x + dx,0,1 - box.width),y:clamp(box.y + dy,0,1 - box.height)};
  } else {
    let left = box.x, top = box.y, right = box.x + box.width, bottom = box.y + box.height;
    if (cropDrag.handle.includes('w')) left = clamp(box.x + dx,0,right - .05);
    if (cropDrag.handle.includes('e')) right = clamp(box.x + box.width + dx,left + .05,1);
    if (cropDrag.handle.includes('n')) top = clamp(box.y + dy,0,bottom - .05);
    if (cropDrag.handle.includes('s')) bottom = clamp(box.y + box.height + dy,top + .05,1);
    draftCrop = {...box,x:left,y:top,width:right-left,height:bottom-top};
    const ratio=cropRatio();if(ratio)draftCrop=resizeRatioCrop(box,cropDrag.handle,dx,dy,ratio,state.image.naturalWidth,state.image.naturalHeight);
  }
  showDraftCrop();
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) $('#crop-editor-frame').addEventListener(type, () => { cropDrag = null; });
$('#crop-editor-frame').addEventListener('keydown', event => {
  const movement = {ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]}[event.key];
  if (!movement) return;
  event.preventDefault();
  if (event.shiftKey) {
    const right = clamp(draftCrop.x + draftCrop.width + movement[0],draftCrop.x + .05,1);
    const bottom = clamp(draftCrop.y + draftCrop.height + movement[1],draftCrop.y + .05,1);
    draftCrop = {...draftCrop,width:right - draftCrop.x,height:bottom - draftCrop.y};
  } else draftCrop = {...draftCrop,x:clamp(draftCrop.x + movement[0],0,1 - draftCrop.width),y:clamp(draftCrop.y + movement[1],0,1 - draftCrop.height)};
  const ratio=cropRatio();if(ratio)draftCrop=ratioCrop(ratio,state.image.naturalWidth,state.image.naturalHeight,draftCrop);
  showDraftCrop();
});
$('#suggestions').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.suggestion-card');
  if (button.dataset.action === 'reason') { card.classList.toggle('expanded'); button.textContent = card.classList.contains('expanded') ? '收起原理' : '摄影原理'; return; }
  if (button.dataset.action === 'edit') { card.classList.toggle('editing'); button.textContent = card.classList.contains('editing') ? '收起参数' : '微调参数'; return; }
  if(!state.active.has(card.dataset.id)){previewSuggestions([card.dataset.id]);return;}
  const before = beforeEdit();
  state.active.delete(card.dataset.id);
  saveEdit(before);
  renderAnalysis(); scheduleRender(); markAssessmentStale(); setCompare(Math.max(state.compare, 62));
});
$('#suggestions').addEventListener('input', event => {
  const input = event.target.closest('.suggestion-slider input');
  if (!input) return;
  const card = input.closest('.suggestion-card');
  const item = state.analysis?.recommendations.find(candidate => candidate.id === card.dataset.id);
  if (!item) return;
  beginRangeEdit(`suggestion:${item.id}:${input.dataset.key}`);
  item.adjustments[input.dataset.key] = Number(input.value);
  input.closest('label').querySelector('output').textContent = formatSlider(input.value,sliderSpecs.find(spec => spec.key === input.dataset.key));
  state.active.add(item.id);
  card.classList.add('applied');
  card.querySelector('.suggestion-apply').textContent = '撤回建议';
  card.querySelector('.suggestion-parameters').innerHTML = formatAdjustmentChips(item.adjustments);
  scheduleRender();
  markAssessmentStale();
  setCompare(Math.max(state.compare,62));
});
$('#suggestions').addEventListener('change', event => { if (event.target.matches('.suggestion-slider input')) finishRangeEdit(); });
$('#style-categories').addEventListener('click', event => {
  const id = event.target.closest('[data-category]')?.dataset.category;
  if (!styleCategories.some(item => item.id === id)) return;
  state.styleCategory = id;
  renderPresets();
});
function togglePreset(id) {
  if (!presetById(id)) return;
  if(state.editDocument){editStack.command(presetCommands(id,state.presetAmount||75,{groupId:'look-'+crypto.randomUUID()}));return;}
  const before = beforeEdit();
  const next = state.presetId !== id;
  state.presetId = next ? id : null;
  if (next) state.presetAmount = rememberedStyleAmount(tasteRecords,id,currentPhoto()?.subject) ?? state.presetAmount;
  saveEdit(before);
  renderPresets();
  scheduleRender();
  markAssessmentStale();
  setCompare(Math.max(state.compare, 68));
  showToast(state.presetId ? '风格已叠加在当前原片上，可继续调整强度。' : '已移除风格，原片保留。');
}
$('#tab-presets').addEventListener('click',event=>{const button=event.target.closest('.style-preview-open');if(button)openStyleCollection(button.closest('[data-preset]').dataset.preset);});
const canHoverStyles=()=>innerWidth>600 && matchMedia('(hover:hover) and (pointer:fine)').matches;
document.addEventListener('pointerdown',event=>{
  keyboardInteraction=false;
  if(!event.target.closest('.curated-style-card,#style-audition-strip'))endStyleAudition();
},true);
document.addEventListener('pointermove',event=>{if(event.pointerType==='mouse')keyboardInteraction=false;},true);
$('#tab-presets').addEventListener('pointerover',event=>{
  const card=event.target.closest('.curated-style-card');
  if(!canHoverStyles() || !card || card.contains(event.relatedTarget) || styleAudition.active?.mode==='tap')return;
  clearTimeout(auditionTimer);auditionTimer=setTimeout(()=>startStyleAudition(card.dataset.preset,'hover'),120);
});
$('#tab-presets').addEventListener('pointerout',event=>{
  const card=event.target.closest('.curated-style-card');
  if(card && !card.contains(event.relatedTarget) && styleAudition.active?.mode!=='tap')endStyleAudition();
});
$('#tab-presets').addEventListener('focusin',event=>{
  const button=event.target.closest('.style-audition-toggle');
  if(canHoverStyles() && keyboardInteraction && button)startStyleAudition(button.closest('[data-preset]').dataset.preset,'focus');
});
$('#tab-presets').addEventListener('focusout',event=>{
  const card=event.target.closest('.curated-style-card');
  if(card && !card.contains(event.relatedTarget) && styleAudition.active?.mode==='focus')endStyleAudition();
});
$('#tab-presets').addEventListener('click',event=>{
  const button=event.target.closest('.style-audition-toggle');if(!button)return;
  const id=button.closest('[data-preset]').dataset.preset;
  if(styleAudition.active?.styleId===id && styleAudition.active.mode==='tap')endStyleAudition();
  else {startStyleAudition(id,'tap');if(innerWidth<=960 && styleAudition.active)$('#photo-stage').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant':'smooth'});}
});
$('#style-audition-restore').addEventListener('click',()=>{const id=styleAudition.active?.styleId;endStyleAudition();keyboardInteraction=false;document.querySelector(`.curated-style-card[data-preset="${id}"] .style-audition-toggle`)?.focus({preventScroll:true});});
$('#style-audition-open').addEventListener('click',()=>{const id=styleAudition.active?.styleId;endStyleAudition();openStyleCollection(id);});
window.addEventListener('blur',endStyleAudition);
window.addEventListener('resize',()=>{endStyleAudition();revealCurrentPhotoTab();$('#style-audition-help').textContent=innerWidth<=600 ? '点缩略图预览，再点恢复；「调整与应用」可选择强度，应用后才保存。':'悬停或聚焦缩略图，临时预览；点击可停留查看。只有「应用」会保存调整。';});
document.addEventListener('visibilitychange',()=>{if(document.hidden)endStyleAudition();});
const auditionDialogs=new MutationObserver(records=>{if(records.some(record=>record.target.open))endStyleAudition();});
document.querySelectorAll('dialog').forEach(dialog=>auditionDialogs.observe(dialog,{attributes:true,attributeFilter:['open']}));
$('.agent-body').addEventListener('scroll',()=>{const scroller=$('.agent-body'),thread=$('#agent-thread');if(!scroller.clientHeight || agentThreadPhoto!==currentPhotoId)return;const follow=scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop<36;agentReading.set(currentPhotoId,{offset:scroller.scrollTop,follow});const reply=thread.querySelector('[data-reply-id]:last-child');$('#agent-latest').hidden=!reply || Math.abs(reply.getBoundingClientRect().top-scroller.getBoundingClientRect().top)<12 || follow;});
$('#agent-latest').addEventListener('click',()=>{const scroller=$('.agent-body'),reply=$('#agent-thread').querySelector('[data-reply-id]:last-child');scroller.scrollTop=reply ? reply.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop:scroller.scrollHeight;});
$('#preset-amount').addEventListener('input', event => {
  if(state.editDocument){editStack.preview([{type:'ReplaceLegacyBase',state:{...structuredClone(state.editDocument.base.state),style:state.presetId?{id:state.presetId,amount:Number(event.target.value)}:null}}]);return;}
  beginRangeEdit('preset-amount');
  state.presetAmount = Number(event.target.value);
  $('#preset-amount-value').textContent = `${state.presetAmount}%`;
  $('#adjustment-style-status').textContent = `${presetById(state.presetId)?.name || '当前风格'} · ${state.presetAmount}% 强度`;
  scheduleRender();
  markAssessmentStale();
});
$('#preset-amount').addEventListener('change',()=>{if(state.editDocument){editStack.commit([]);return;}finishRangeEdit();buildPresetThumbs(state.image);renderPresets();});
$('#remove-preset').addEventListener('click', () => {
  if(state.editDocument){editStack.command([{type:'ReplaceLegacyBase',state:{...structuredClone(state.editDocument.base.state),style:null}}]);return;}
  const before = beforeEdit();
  state.presetId = null;
  saveEdit(before);
  renderPresets();
  scheduleRender();
  markAssessmentStale();
  showToast('风格已移除。');
});
document.querySelectorAll('.panel-tab').forEach(tab=>{tab.addEventListener('click',()=>selectTab(tab.dataset.tab));tab.addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('.panel-tab')];let index=tabs.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%tabs.length;else if(event.key==='ArrowLeft')index=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=tabs.length-1;else return;event.preventDefault();selectTab(tabs[index].dataset.tab);tabs[index].focus();});});
$('#render-retry').addEventListener('click',scheduleRender);
$('#agent-form').addEventListener('submit', event => { event.preventDefault(); const input = $('#agent-input'); const question = input.value.trim(); if (!question || !currentPhoto() || !state.analysis || currentPhoto().agentBusy) return; currentPhoto().agentDraft='';input.value = '';scheduleDraftSave();askDesignAgent(question); });
$('#agent-input').addEventListener('input',()=>{const photo=currentPhoto();if(photo){photo.agentDraft=$('#agent-input').value.slice(0,800);scheduleDraftSave();}resizeAgentInput();refreshAgentComposer();});
$('#agent-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#agent-form').requestSubmit(); } });
$('#agent-stop').addEventListener('click',cancelAdvisor);
$('#agent-mode').addEventListener('click',openVisionSettings);
$('#agent-export').addEventListener('click',()=>$('#export-button').click());
$('#agent-intent-edit').addEventListener('click',()=>$('#photo-intent-open').click());
$('#agent-view-photo').addEventListener('click',()=>$('#photo-stage').scrollIntoView({block:'center',behavior:'smooth'}));
$('#agent-focus-clear').addEventListener('click',()=>{const photo=currentPhoto();if(photo){photo.agentFocusId=null;scheduleDraftSave();}renderAgentContext();$('#agent-input').focus({preventScroll:true});});
$('#agent-prompts').addEventListener('click', event => { const prompt = event.target.closest('[data-agent-prompt]'); if (prompt) askDesignAgent(prompt.dataset.agentPrompt); });
$('#layer-list').addEventListener('click',event=>{const button=event.target.closest('[data-layer-remove]');if(button) removeAdjustmentLayer(button.dataset.layerRemove);});
$('#agent-thread').addEventListener('click', event => { if(event.target.closest('[data-agent-cancel]')){cancelAdvisor();return;} const retry=event.target.closest('[data-agent-retry]');if(retry){const message=currentPhoto()?.conversation[Number(retry.dataset.agentRetry)];askDesignAgent(message?.requestQuestion);return;} const choice=event.target.closest('[data-agent-intent]');if(choice){setCreativeIntent(choice.dataset.agentIntent);askDesignAgent('请围绕这一张的调整目标给我建议。');return;} const button = event.target.closest('[data-agent-apply]'); if (button) applyAgentAction(Number(button.dataset.agentApply)); });
$('#manual-sliders').addEventListener('input', event => {
  const key = event.target.dataset.key;
  if (!key) return;
  if(state.editDocument){const base=structuredClone(state.editDocument.base.state);base.settings[key]=Number(event.target.value);editStack.preview([{type:'ReplaceLegacyBase',state:base}]);$(`#output-${key}`).textContent=formatSlider(state.manual[key],sliderSpecs.find(s=>s.key===key));return;}
  beginRangeEdit(`manual:${key}`);
  state.manual[key] = Number(event.target.value);
  updateSliderTotals();
  $(`#output-${key}`).textContent = formatSlider(state.manual[key], sliderSpecs.find(s => s.key === key));
  scheduleRender();
  markAssessmentStale();
});
$('#manual-sliders').addEventListener('change', event => { if(state.editDocument){editStack.commit([]);return;}if (event.target.matches('input[type="range"]')) finishRangeEdit(); });
$('#clear-manual').addEventListener('click', async () => {
  if(state.editDocument){
    const base=structuredClone(state.editDocument.base.state);
    base.settings={...defaults};
    if(await editStack.command([{type:'ReplaceLegacyBase',state:base}])){renderSliders();showToast('手动参数已重置。');}
    return;
  }
  const before=beforeEdit();state.manual={...defaults};saveEdit(before);renderSliders();scheduleRender();markAssessmentStale();showToast('手动参数已重置。');
});
function resetAllEdits() {
  if(state.editDocument){editStack.command([{type:'ClearSteps'},{type:'ReplaceLegacyBase',state:{settings:defaults,style:null,crop:null,locals:[]}},{type:'UpdateGeometry',geometry:{crop:null}}]);return;}
  const before = beforeEdit();
  const hadCrop = Boolean(state.crop);
  state.active.clear();
  state.advisorLayers = [];
  state.manual = {...defaults};
  state.crop = null;
  state.presetId = null;
  state.annotations = state.annotations.map(item => ({...item,localSettings:null}));
  state.exported = false;
  currentPhoto()?.conversation.forEach(message => { message.applied = false; });
  if (state.originalRecommendations) state.analysis.recommendations = structuredClone(state.originalRecommendations);
  state.assessment = null;
  saveEdit(before);
  if (hadCrop) buildPresetThumbs(state.image);
  renderSliders(); renderAnalysis(); renderPresets(); renderAgent(); sizePhotoStage(); scheduleRender(); updateWorkflow(); setCompare(50);
  showToast('已重置全部调整。可以点「撤销」恢复。');
}
document.querySelectorAll('[data-editor-action="reset"]').forEach(button => button.addEventListener('click', resetAllEdits));
$('#apply-all').addEventListener('click',()=>previewSuggestions(state.analysis?.recommendations.filter(item=>!item.retained).map(item=>item.id) || [],{crop:true}));
document.querySelectorAll('[data-editor-action="undo"]').forEach(button => button.addEventListener('click', undoEdit));
document.querySelectorAll('[data-editor-action="redo"]').forEach(button => button.addEventListener('click', redoEdit));
document.addEventListener('keydown',()=>{keyboardInteraction=true;},true);
document.addEventListener('keydown', event => {
  if(event.defaultPrevented)return;
  if(event.key==='Escape' && styleAudition.active){event.preventDefault();endStyleAudition();return;}
  const action=shortcutAction(event,{typing:editableTarget(event.target),range:Boolean(event.target.matches?.('input[type="range"]')),loading:state.loading,dialog:Boolean(document.querySelector('dialog[open]')),learning:workspaceSpace==='learn'});
  if(!action)return;
  event.preventDefault();endStyleAudition();
  if(action==='undo')undoEdit();else if(action==='redo')redoEdit();
  else if(action.endsWith('-photo')) {
    const index=photoNavigationIndex(action,photoSessions.findIndex(photo=>photo.id===currentPhotoId),photoSessions.length);
    if(index>=0){activatePhoto(photoSessions[index].id);document.querySelector(`.photo-tab-main[data-photo-select="${currentPhotoId}"]`)?.focus();}
  } else if(action==='viewer')openPhotoViewer();
  else if(action==='help')$('#help-button').click();
  else {selectTab(action);document.querySelector(`.panel-tab[data-tab="${editorTab(action)}"]`)?.focus();}
});
$('#photo-tabs').addEventListener('keydown',event=>{
  const button=event.target.closest('.photo-tab-main');if(!button || state.loading)return;
  const index=photoNavigationIndex(event.key,photoSessions.findIndex(photo=>photo.id===button.dataset.photoSelect),photoSessions.length);
  if(index>=0){event.preventDefault();activatePhoto(photoSessions[index].id);document.querySelector(`.photo-tab-main[data-photo-select="${currentPhotoId}"]`)?.focus();}
  else if(event.key==='Delete'){event.preventDefault();requestClosePhoto(button.dataset.photoSelect);}
});
document.querySelectorAll('[data-editor-action="reassess"]').forEach(button => button.addEventListener('click', reassessPhoto));
$('#export-button').addEventListener('click',()=>openExportDialog());
$('#confirm-export').addEventListener('click', exportPhoto);
$('#cancel-export').addEventListener('click', () => $('#export-dialog').close());
$('#close-export').addEventListener('click', () => $('#export-dialog').close());
$('#export-dialog').addEventListener('cancel',event=>{if(state.loading && state.loadingPurpose==='export') event.preventDefault();});
$('#export-dialog').addEventListener('click', event => { if (!state.loading && event.target === $('#export-dialog')) $('#export-dialog').close(); });
$('#export-dialog').addEventListener('close', () => { pendingCloseAfterExportId = null; });
document.querySelectorAll('input[name="export-format"]').forEach(input=>input.addEventListener('change',updateExportInfo));
document.querySelectorAll('[data-help-open]').forEach(button => button.addEventListener('click', () => {
  $('#help-mode-note').textContent = state.analysis
    ? state.analysisSource === 'ai' ? '当前照片：视觉模型分析' : '当前照片：基础光色分析'
    : state.aiAvailable ? '已连接视觉模型' : '当前使用基础光色分析';
  $('#help-dialog').showModal();
}));
$('#analysis-source-button').addEventListener('click',openVisionSettings);
$('#vision-open-settings').addEventListener('click',openVisionSettings);
$('#help-vision-settings').addEventListener('click',openVisionSettings);
$('#vision-retry').addEventListener('click',() => analyzeImage());
$('#vision-cancel').addEventListener('click',()=>{const task=analysisQueue.tasks.find(item=>item.photoId===currentPhotoId && ['queued','running'].includes(item.status));if(task)analysisQueue.cancel(task.id);});
$('#vision-settings-form').addEventListener('submit',connectVision);
$('#vision-settings-close').addEventListener('click',closeVisionSettings);
$('#vision-settings-cancel').addEventListener('click',closeVisionSettings);
$('#vision-settings-dialog').addEventListener('cancel',() => { visionConfigController?.abort();$('#vision-api-key').value = ''; });
$('#vision-settings-dialog').addEventListener('close',() => { $('#vision-api-key').value = ''; });
document.addEventListener('click',event => {
  const reviewAction = event.target.closest('[data-review-action]')?.dataset.reviewAction;
  if (reviewAction === 'adjust') selectTab('adjust');
  if (reviewAction === 'styles') selectTab('presets');
  if (reviewAction === 'original') resetAllEdits();
  const evidence = event.target.closest('[data-vision-evidence]');
  if (evidence) toggleVisionEvidence(evidence.dataset.visionEvidence);
  if (event.target.closest('#vision-evidence-close')) { selectedEvidenceKey = null;renderVisionObservations(); }
});
$('#close-help').addEventListener('click', () => $('#help-dialog').close());
$('#help-dialog').addEventListener('click', event => { if (event.target === $('#help-dialog')) $('#help-dialog').close(); });

const dropZone = $('#drop-zone');
for (const type of ['dragenter','dragover']) dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragging'); });
for (const type of ['dragleave','drop']) dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragging'); });
dropZone.addEventListener('drop', event => {
  importFiles(event.dataTransfer.files);
});
window.addEventListener('pagehide',()=>{finishAnnotationNote();finishRangeEdit();flushDraftSave();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden') {finishAnnotationNote();finishRangeEdit();flushDraftSave();}});
window.addEventListener('beforeunload',event=>{finishAnnotationNote();finishRangeEdit();projectWorkspace.schedule(currentPhoto());const draft=draftAutosave.status;if(projectWorkspace.hasPending() || draft.dirty || draft.failed || draft.saving || [...analysisQueue.tasks,...exportQueue.tasks].some(task=>['queued','running'].includes(task.status) || task.kind==='export' && task.status==='done' && !task.downloaded)) {flushDraftSave();event.preventDefault();event.returnValue='';}});

async function captureVersion(kind,label) {
  finishRangeEdit();finishAnnotationNote();
  const photo=currentPhoto();if(!photo)return false;
  photo.versions ||= [];
  if(photo.projectId){try{await projectWorkspace.saveEdition(photo,label,kind);return true;}catch(error){showToast(error.message);return false;}}
  const signature=currentAcceptanceSignature();
  if(kind!=='manual' && photo.versions.some(item=>item.kind===kind && item.signature===signature))return true;
  if(photo.versions.length>=40){showToast('已达到 40 个版本，现有方案均已保留。');return false;}
  photo.versions.push({id:crypto.randomUUID(),kind,label:label.slice(0,40),at:new Date().toISOString(),signature,snapshot:editSnapshot()});
  renderVersions();renderEditions();scheduleDraftSave();return true;
}
function renderVersions() {
  const photo=currentPhoto();
  $('#draft-versions').hidden=!photo || photo.isDemo || Boolean(photo.projectId);
  $('#version-items').innerHTML=(photo?.versions || []).slice().reverse().map(item=>`<article class="draft-item"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(new Date(item.at).toLocaleString('zh-CN'))}</small></div><button type="button" data-version-restore="${escapeHtml(item.id)}">恢复这一版</button></article>`).join('') || '<p class="draft-empty">保存喜欢的版本，或在导出、定稿时自动留下一版。</p>';
}
$('#save-version').addEventListener('click',async()=>{finishRangeEdit();finishAnnotationNote();if(!await captureVersion('manual',$('#version-name').value.trim() || '手动版本'))return;$('#version-name').value='';showToast('当前版本已保存。');});
$('#version-items').addEventListener('click',event=>{
  const id=event.target.closest('[data-version-restore]')?.dataset.versionRestore;
  const version=currentPhoto()?.versions?.find(item=>item.id===id);if(!version) return;
  const before=beforeEdit();restoreEdit(version.snapshot);saveEdit(before);
  state.exported=currentPhoto().versions.some(item=>item.kind==='export' && item.signature===currentAcceptanceSignature());
  refreshActions();scheduleDraftSave();$('#draft-dialog').close();showToast('已恢复这一版，可撤销这次恢复。');
});

function renderDraftStatus() {
  if(currentPhoto()?.projectId){$('#draft-status').textContent='其他草稿';$('#draft-status').title='查看保存在此浏览器中的其他照片草稿。';$('#draft-status').classList.remove('save-failed');return;}
  const own=Boolean(currentPhoto() && !currentPhoto().isDemo);
  const {savedAt:draftSavedAt,dirty:draftDirty,saving:draftSaving}=draftAutosave.status,draftFailed=draftAutosave.status.failed||draftListFailed;
  $('#draft-status').textContent=draftFailed ? '保存失败 · 重试':draftSaving || draftDirty ? '正在保存草稿…':draftSavedAt && own ? '草稿已保存在此浏览器':own ? '草稿等待保存':'草稿';
  $('#draft-status').classList.toggle('save-failed',draftFailed);
  $('#draft-status').title=draftFailed ? '本次修改尚未保存；点击可重试或导出照片':draftSavedAt ? `上次保存 ${new Date(draftSavedAt).toLocaleString('zh-CN')}`:'查看、继续编辑或清理草稿';
}
function scheduleDraftSave() {
  for(const photo of photoSessions)if(photo.projectId)projectWorkspace.schedule(photo);
  if(draftRestoring || (!draftAutosave.status.savedAt && !photoSessions.some(photo=>!photo.isDemo&&(!photo.projectId||photo.projectPending)))) return;
  draftAutosave.request();
}
function captureDraftSnapshot() {
  commitPhotoInputs({finish:false});
  const snapshot=buildDraftWorkspace(draftWorkspaceId,photoSessions,currentPhotoId,seriesWorkspace.draft());
  const pendingBefore=editHistory.range?.before || annotationNoteBefore,active=snapshot.photos.find(item=>item.id===currentPhotoId);
  if(active && pendingBefore && JSON.stringify(pendingBefore)!==JSON.stringify(editSnapshot()))active.history.past=[...active.history.past,pendingBefore].slice(-30);
  return snapshot;
}
function flushDraftSave(){return draftAutosave.flush();}
async function refreshDraftList() {
  try {draftList=(await draftStore.list()).filter(item=>supportedDraftVersions.includes(item.version) && item.photos?.length).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));draftListFailed=false;}
  catch {draftList=[];draftListFailed=true;}
  renderDraftStatus();
  renderDraftList();
}
function renderDraftList() {
  renderVersions();
  const active=draftList.filter(item=>!item.deletedAt && item.id!==draftWorkspaceId);
  $('#draft-recovery').hidden=!active.length;
  $('#draft-recovery-message').textContent=`有 ${active.reduce((sum,item)=>sum+item.photos.length,0)} 张照片的草稿可继续编辑`;
  $('#draft-items').innerHTML=draftList.map(item=>`<article class="draft-item"><div><strong>${escapeHtml(item.photos.map(photo=>photo.imageName).slice(0,3).join(' · '))}</strong><small>${item.photos.length} 张 · ${escapeHtml(new Date(item.savedAt).toLocaleString('zh-CN'))}${item.deletedAt ? ' · 已清理，可恢复':item.id===draftWorkspaceId ? ' · 当前工作区':''}</small></div><div>${item.deletedAt ? `<button type="button" data-draft-restore="${escapeHtml(item.id)}">恢复草稿</button><button type="button" data-draft-purge="${escapeHtml(item.id)}">永久删除</button>`:`<button type="button" data-draft-continue="${escapeHtml(item.id)}" ${item.id===draftWorkspaceId ? 'disabled':''}>继续编辑</button><button type="button" data-draft-clean="${escapeHtml(item.id)}">清理</button>`}</div></article>`).join('') || '<p class="draft-empty">导入照片后，调整、裁剪、批注与撤销记录会自动保存。</p>';
}
async function continueDraft(id) {
  if(importingFiles) {showToast('请先完成或取消照片导入，再恢复草稿。已打开的照片可以继续编辑。');return;}
  if(draftTransition || state.loading) return;
  draftTransition=true;setLoading(true,'photo');
  const loaded=[];
  try {
    finishAnnotationNote();finishRangeEdit();
    if(!await flushDraftSave()){showToast('当前草稿尚未保存，请重试保存或导出后再切换。当前照片仍保留。');return;}
    const saved=await draftStore.get(id);
    if(!saved || !supportedDraftVersions.includes(saved.version) || !saved.photos?.length) throw new Error('草稿不可用');
    // Decode every source before replacing a working workspace; a broken draft never discards current work.
    for(const item of saved.photos) {
      const values=restoreDraftPhoto(item),src=URL.createObjectURL(item.originalBlob);let image;
      try {image=await loadPhotoImage(src);}
      catch(error) {URL.revokeObjectURL(src);throw error;}
      loaded.push({...values,id:item.id,src,image,originalBlob:item.originalBlob,isDemo:false,previewData:null,previewSource:null,presetThumbs:{},originalInspection:null,agentBusy:false});
    }
    // Analysis may finish while sources decode. Persist those last changes before replacing the workspace.
    if(!await flushDraftSave())throw new Error('当前草稿尚未保存');
    draftRestoring=true;
    for(const queue of [analysisQueue,exportQueue])for(const photo of photoSessions)queue.releasePhoto(photo.id);
    for(const photo of photoSessions)projectWorkspace.release(photo);
    advisorRequests.cancelAll('restored');cancelReassessment('restored');
    selectedPhotos.clear();lastBatch=null;analysisController?.abort();analysisGeneration++;reassessGeneration++;
    for(const photo of photoSessions) if(photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src);
    photoSessions.splice(0,photoSessions.length,...loaded);
    currentPhotoId=null;seriesWorkspace.restore(saved.series);draftWorkspaceId=id;draftStore.adopt(saved);draftAutosave.reset(saved.savedAt);
    nextPhotoId=Math.max(nextPhotoId,...loaded.map(photo=>Number(photo.id.replace('photo-',''))+1).filter(Number.isFinite));
    nextAnnotationId=Math.max(nextAnnotationId,...loaded.flatMap(photo=>photo.annotations.map(item=>Number(String(item.id).replace('note-',''))+1)).filter(Number.isFinite));
    setLoading(false);activatePhoto(loaded.some(photo=>photo.id===saved.currentPhotoId) ? saved.currentPhotoId:loaded[0].id);
    if($('#draft-dialog').open) $('#draft-dialog').close();
    showToast('草稿已恢复，可以继续调整或撤销。');
  } catch(error) {
    loaded.forEach(photo=>URL.revokeObjectURL(photo.src));
    showToast('这份草稿未能完整打开；当前照片仍保留。');
  } finally {draftRestoring=false;draftTransition=false;setLoading(false);await refreshDraftList();}
}
$('#draft-status').addEventListener('click',async()=>{if(draftTransition)return;if(draftAutosave.status.failed){draftAutosave.request();await flushDraftSave();}await refreshDraftList();$('#draft-dialog').showModal();});
$('#draft-recovery-continue').addEventListener('click',()=>{const item=draftList.find(item=>!item.deletedAt && item.id!==draftWorkspaceId);if(item) continueDraft(item.id);});
$('#draft-recovery-manage').addEventListener('click',async()=>{await refreshDraftList();$('#draft-dialog').showModal();});
$('#close-drafts').addEventListener('click',()=>$('#draft-dialog').close());
$('#draft-items').addEventListener('click',async event=>{
  const button=event.target.closest('[data-draft-continue],[data-draft-clean],[data-draft-restore],[data-draft-purge]');if(!button) return;
  if(button.dataset.draftPurge) {pendingDraftDeleteId=button.dataset.draftPurge;$('#draft-delete-dialog').showModal();return;}
  if(button.dataset.draftContinue) {await continueDraft(button.dataset.draftContinue);return;}
  if(draftTransition || state.loading)return;
  const id=button.dataset.draftClean || button.dataset.draftRestore,cleanCurrent=id===draftWorkspaceId && Boolean(button.dataset.draftClean);
  if(cleanCurrent){draftTransition=true;setLoading(true,'photo');}
  try {
    if(cleanCurrent){finishAnnotationNote();finishRangeEdit();if(!await flushDraftSave()){showToast('当前草稿尚未保存，请重试保存后再清理。');return;}draftRestoring=true;}
    await draftStore.setDeleted(id,Boolean(button.dataset.draftClean));
    if(cleanCurrent){draftWorkspaceId=crypto.randomUUID();draftAutosave.reset();}
    await refreshDraftList();
    showToast(button.dataset.draftClean ? '草稿已清理，可在这里恢复。当前照片仍可继续编辑。':'草稿已恢复到列表。');
  } catch {showToast('草稿列表未能更新，请重试。');}
  finally{if(cleanCurrent){draftRestoring=false;draftTransition=false;setLoading(false);}}
});

$('#cancel-draft-delete').addEventListener('click',()=>{$('#draft-delete-dialog').close();pendingDraftDeleteId=null;});
$('#confirm-draft-delete').addEventListener('click',async()=>{
  if(!pendingDraftDeleteId || !draftList.some(item=>item.id===pendingDraftDeleteId && item.deletedAt)) return;
  const button=$('#confirm-draft-delete');button.disabled=true;
  try {await draftStore.purge(pendingDraftDeleteId);$('#draft-delete-dialog').close();pendingDraftDeleteId=null;await refreshDraftList();showToast('已永久删除这份草稿，原片文件仍保留。');}
  catch {showToast('删除没有完成，请重试。');}
  finally {button.disabled=false;}
});

async function initialize() {
  renderSliders();
  renderPersonalProfile();
  setCompare(50);
  // Opening the workspace must not wait for a remote service's cold start.
  // The source remains local/example until an actual visual review succeeds.
  const statusController=new AbortController();
  const statusTimeout=setTimeout(()=>statusController.abort(),10_000);
  refreshVisionAvailability(statusController.signal).then(()=>renderAgent())
    .catch(()=>{}).finally(()=>clearTimeout(statusTimeout));
  renderAgent();
  const capabilities=await projectWorkspace.capabilities();
  $('#empty-projects').hidden=!capabilities.local;
  document.querySelector('[data-workspace-tool="projects"]').hidden=!capabilities.local;
  const userStartedWork=()=>photoSessions.length>0||importingFiles||state.loading||draftTransition;
  const linkedProject=new URL(location.href).searchParams.get('project');
  if(linkedProject&&!userStartedWork()){try{const loaded=await projectWorkspace.load(linkedProject);if(!loaded)showEmptyWorkspace();return;}catch(error){showToast(error.message);}}
  await refreshDraftList();
  // Startup discovery can finish after the first upload or draft restore. It
  // must not replace an active editor with the initial empty-workspace state.
  if(userStartedWork())return;
  if(draftList.some(item=>!item.deletedAt)){showEmptyWorkspace();renderDraftList();}
  else showEmptyWorkspace();
}
initialize();

function updateOriginalPreview() {
  if(!state.image)return;
  if(!state.crop){originalImage.src=state.image.src;return;}
  const rect=cropPixelRect(state.crop,state.image.naturalWidth,state.image.naturalHeight),scale=Math.min(1,1400/Math.max(state.image.naturalWidth,state.image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(rect.width*scale));canvas.height=Math.max(1,Math.round(rect.height*scale));
  drawPhotoSource(canvas.getContext('2d'),state.image,state.crop,canvas.width,canvas.height,rect);originalImage.src=canvas.toDataURL();
}
function viewerVersion(snapshot,id,label) {
  return {id,label,crop:snapshot.crop,document:snapshot.editDocument,settings:globalAdjustments({manual:snapshot.manual,recommendations:snapshot.recommendations,active:snapshot.active,preset:presetById(snapshot.presetId),amount:snapshot.presetAmount,advisorLayers:snapshot.advisorLayers}),annotations:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers)};
}
function openPhotoViewer(a='original',b='current') {
  endStyleAudition();
  if(!state.image||state.loading)return;
  finishRangeEdit();finishAnnotationNote();
  const choices=[{id:'original',label:'原片',crop:null,settings:defaults,annotations:[]},viewerVersion(editSnapshot(),'current','当前编辑'),...(currentPhoto()?.versions || []).filter(item=>item.supported!==false).map(item=>viewerVersion(item.snapshot,item.id,item.label))];
  if($('#versions-dialog').open)$('#versions-dialog').close();
  const single=!hasEdits() && a==='original' && b==='current';
  $('#viewer-title').textContent=single ? '照片细节':'照片对照';
  $('#viewer-close').setAttribute('aria-label',single ? '关闭照片细节':'关闭照片对照');
  $('#viewer-dialog .viewer-pane').setAttribute('aria-label',single ? '原片细节；拖动或方向键平移':'版本 A；拖动或方向键平移');
  photoViewer.open(state.image,choices,a,b,{single});
}
$('#viewer-open').addEventListener('click',()=>openPhotoViewer());
function renderEditions() {
  const photo=currentPhoto(),versions=photo?.versions || [];
  versionSelections=versionSelections.filter(id=>versions.some(item=>item.id===id));
  $('#edition-items').innerHTML=versions.slice().reverse().map(item=>`<article class="edition-row"><input type="checkbox" data-edition-select="${escapeHtml(item.id)}" aria-label="选择${escapeHtml(item.label)}进行对比" ${versionSelections.includes(item.id)?'checked':''} ${item.supported===false?'disabled':''}/><div class="edition-copy"><strong>${escapeHtml(item.label)}${item.signature===currentAcceptanceSignature() ? ' · 当前':''}</strong><small>${escapeHtml(new Date(item.at).toLocaleString('zh-CN'))} · ${item.supported===false?'请在 Skill 中编辑':item.snapshot.crop ? '含裁剪':'原画幅'}</small></div><button type="button" data-edition-rename="${escapeHtml(item.id)}">命名</button><button type="button" data-edition-restore="${escapeHtml(item.id)}" ${item.supported===false?'disabled':''}>恢复</button></article>`).join('') || '<p class="draft-empty">保存一版满意的方案，再安心尝试新的方向。</p>';
  $('#edition-comparison').hidden=!inspectionVisibility({versions:versions.length}).versionComparison;
  $('#edition-compare').disabled=versionSelections.length!==2;
  $('#edition-storage-note').textContent=photo?.isDemo ? '示例版本仅在当前页面暂存；导入照片后的版本随草稿自动保存。' : photo?.projectId ? '命名版本保存到文件项目，网页与 Skill 共用；比较不会改变当前编辑。' : '版本随照片草稿保存；恢复可撤销，不会修改原始文件。';
}
async function openEditions(photo=currentPhoto()){
  if(!state.image||photo!==currentPhoto())return;finishRangeEdit();finishAnnotationNote();
  try{if(photo.projectId)await projectWorkspace.flush(photo);if(currentPhotoId!==photo.id)return;renderEditions();$('#versions-dialog').showModal();}catch(error){showToast(error.message);}
}
$('#versions-open').addEventListener('click',()=>openEditions());
$('#versions-close').addEventListener('click',()=>$('#versions-dialog').close());
$('#edition-save').addEventListener('click',async()=>{const button=$('#edition-save');button.disabled=true;try{if(await captureVersion('manual',$('#edition-name').value.trim() || `方案 ${currentPhoto().versions.length+1}`)){$('#edition-name').value='';showToast('已保存独立版本，可以继续尝试。');}}finally{button.disabled=false;}});
$('#edition-items').addEventListener('change',event=>{const id=event.target.dataset.editionSelect;if(!id)return;versionSelections=versionSelections.filter(value=>value!==id);if(event.target.checked)versionSelections.push(id);versionSelections=versionSelections.slice(-2);renderEditions();});
$('#edition-items').addEventListener('click',async event=>{
  const restore=event.target.closest('[data-edition-restore]')?.dataset.editionRestore;
  const rename=event.target.closest('[data-edition-rename]')?.dataset.editionRename;
  const item=currentPhoto()?.versions?.find(item=>item.id===(restore || rename));if(!item)return;
  const photo=currentPhoto();
  if(restore&&photo.projectId){try{await projectWorkspace.restoreEdition(photo,item.id);renderEditions();$('#versions-dialog').close();showToast(`已恢复「${item.label}」。其他版本仍保留。`);}catch(error){showToast(error.message);}return;}
  if(restore){const before=beforeEdit();restoreEdit(item.snapshot);saveEdit(before);renderEditions();scheduleDraftSave();$('#versions-dialog').close();showToast(`已恢复「${item.label}」，可撤销；其他版本保留。`);}
  if(rename){const copy=event.target.closest('.edition-row').querySelector('.edition-copy');copy.replaceChildren();const input=document.createElement('input');input.value=item.label;input.maxLength=40;input.setAttribute('aria-label','修改版本名称');copy.append(input);input.focus();input.select();const commit=async()=>{const name=input.value.trim()||item.label;if(photo.projectId){try{await projectWorkspace.renameEdition(photo,item.id,name);}catch(error){showToast(error.message);}}else{item.label=name;scheduleDraftSave();}renderEditions();renderVersions();};input.addEventListener('blur',commit,{once:true});input.addEventListener('keydown',e=>{if(!['Enter','Escape'].includes(e.key))return;e.preventDefault();e.stopPropagation();if(e.key==='Escape')input.value=item.label;input.blur();});}
});
$('#edition-compare').addEventListener('click',()=>{if(versionSelections.length===2)openPhotoViewer(...versionSelections);});
function cropRatio(){return $('#crop-ratio').value==='original' ? state.image.naturalWidth/state.image.naturalHeight:Number($('#crop-ratio').value)||0;}
$('#crop-candidates').addEventListener('click',event=>{
  const candidate=event.target.closest('[data-crop-candidate]')?.dataset.cropCandidate;if(!candidate)return;
  draftCrop=candidate==='ai' ? {...state.analysis.cropRecommendation.rect}:candidate==='light' ? {x:.025,y:.025,width:.95,height:.95}:{x:0,y:0,width:1,height:1};
  $('#crop-angle').value=0;$('#crop-ratio').value='free';showDraftCrop();
});
$('#crop-ratio').addEventListener('change',()=>{const ratio=cropRatio();if(ratio)draftCrop=ratioCrop(ratio,state.image.naturalWidth,state.image.naturalHeight,{x:0,y:0,width:1,height:1,angle:draftCrop.angle});showDraftCrop();});
$('#crop-angle').addEventListener('input',event=>{draftCrop={...draftCrop,angle:Number(event.target.value)};showDraftCrop();});
const localSpecs=sliderSpecs.filter(item=>['exposure','highlights','shadows','warmth','saturation','clarity','sharpen','denoise'].includes(item.key));
function renderLocalEditor() {
  const item=selectedAnnotation();$('#local-editor').hidden=!item;
  $('#local-select').replaceChildren(...state.annotations.map((item,index)=>{const option=document.createElement('option');option.value=item.id;option.textContent=`${maskTypes[item.maskType || 'rectangle']} ${index+1}${item.note ? ' · '+item.note.slice(0,16):''}`;return option;}));
  if(!item){renderMaskOverlay();return;}
  $('#local-select').value=item.id;$('#local-enabled').checked=item.localEnabled!==false;$('#local-show-mask').checked=showLocalMask;
  $('#local-feather').setAttribute('aria-label',item.maskType==='linear' ? '渐变过渡柔和度':'局部羽化');
  $('#local-feather').closest('label').firstChild.textContent=item.maskType==='linear' ? '过渡柔和度':'羽化';
  $('#local-feather').value=Math.round((item.feather ?? .36)*100);$('#local-feather-value').textContent=`${Math.round((item.feather ?? .36)*100)}%`;
  $('#local-brush-size-label').hidden=item.maskType!=='brush';$('#local-brush-size').value=(item.brushRadius ?? .03)*100;$('#local-brush-size-value').textContent=`${((item.brushRadius ?? .03)*100).toFixed(1)}%`;
  $('#local-sliders').innerHTML=localSpecs.map(spec=>`<label class="local-slider">${spec.label}<output>${formatSlider(item.localSettings?.[spec.key] || 0,spec)}</output><input type="range" data-local-setting="${spec.key}" aria-label="局部${spec.label}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${item.localSettings?.[spec.key] || 0}" /></label>`).join('');
  renderMaskOverlay();
}
function renderMaskOverlay(draft=null) {
  const canvas=$('#local-mask-overlay'),item=draft || selectedAnnotation();canvas.hidden=(!draft && !showLocalMask) || !item || !state.image;
  if(canvas.hidden)return;
  const ratio=$('#photo-stage').clientWidth/Math.max(1,$('#photo-stage').clientHeight);canvas.width=320;canvas.height=Math.max(1,Math.round(320/ratio));
  const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {const i=(y*canvas.width+x)*4,p=viewToOriginalPoint({x:(x+.5)/canvas.width,y:(y+.5)/canvas.height},state.crop,state.image.naturalWidth,state.image.naturalHeight),weight=maskWeight({...item,localEnabled:true},p,state.image.naturalWidth,state.image.naturalHeight);data.data[i]=223;data.data[i+1]=164;data.data[i+2]=109;data.data[i+3]=Math.round(weight*100);}
  ctx.putImageData(data,0,0);
}
$('#local-tools').addEventListener('click',event=>{const type=event.target.closest('[data-mask-tool]')?.dataset.maskTool;if(!maskTypes[type])return;if(state.annotations.length>=8){showToast('最多保留 8 个局部范围，请先整理已有范围。');return;}maskTool=type;localToolCreating=true;setMarkingPhoto(true);$('#local-tool-hint').textContent=type==='linear' ? '从效果最强的位置，拖向效果逐渐消失的位置。':type==='brush' ? '拖动绘制笔迹；完成后可调整半径与羽化。':'拖出范围，再调整曝光、颜色与细节。';$('#local-tools').querySelectorAll('button').forEach(button=>button.classList.toggle('active',button.dataset.maskTool===type));showToast(`在照片上拖动绘制${maskTypes[type]}范围。`);});
$('#local-select').addEventListener('change',event=>{selectedAnnotationId=event.target.value;renderAnnotations();renderLocalEditor();});
$('#local-show-mask').addEventListener('change',event=>{showLocalMask=event.target.checked;renderMaskOverlay();});
$('#local-enabled').addEventListener('change',event=>{const item=selectedAnnotation();if(!item)return;const before=beforeEdit();item.localEnabled=event.target.checked;saveEdit(before);scheduleRender();markAssessmentStale();});
$('#local-editor').addEventListener('input',event=>{
  const item=selectedAnnotation();if(!item)return;
  const key=event.target.dataset.localSetting;
  if(key){beginRangeEdit(`local:${item.id}:${key}`);item.localSettings={...item.localSettings,[key]:Number(event.target.value)};event.target.closest('label').querySelector('output').textContent=formatSlider(item.localSettings[key],localSpecs.find(spec=>spec.key===key));}
  else if(event.target.id==='local-feather'){beginRangeEdit(`local:${item.id}:feather`);item.feather=Number(event.target.value)/100;$('#local-feather-value').textContent=`${event.target.value}%`;}
  else if(event.target.id==='local-brush-size'){beginRangeEdit(`local:${item.id}:radius`);item.brushRadius=Number(event.target.value)/100;item.rect=brushBounds(item.points,item.brushRadius,state.image.naturalWidth,state.image.naturalHeight);$('#local-brush-size-value').textContent=`${event.target.value}%`;}
  else return;
  scheduleRender();markAssessmentStale();renderMaskOverlay();renderAnnotations();
});
$('#local-editor').addEventListener('change',event=>{if(event.target.type==='range')finishRangeEdit();});
$('#local-delete').addEventListener('click',()=>{$('#annotation-delete').click();renderLocalEditor();});

function snapshotAcceptanceSignature(snapshot) {
  if(snapshot.editDocument)return JSON.stringify({renderingVersion,recipe:renderHash(snapshot.editDocument)});
  const values=viewerVersion(snapshot,'','');
  return JSON.stringify({renderingVersion,presetId:snapshot.presetId,presetAmount:snapshot.presetAmount,effect:adjustmentSignature(values.settings,values.crop,values.annotations,{includeNotes:false})});
}

// A photo's creative goal lives with its draft, independently of the personal profile.
function renderCreativeIntent() {
  const value=cleanIntent(state.creativeIntent);
  $('#photo-intent-value').textContent=value || '说说想改哪里，或保留什么';
  $('#photo-intent-open').classList.toggle('has-intent',Boolean(value));
  $('#photo-intent-open').disabled=!state.image;
  $('#photo-intent-open').title=value || '设置这张照片的调整目标';
}
function setCreativeIntent(value) {
  const photo=currentPhoto();if(!photo)return;
  commitPhotoInputs({finish:false});
  const next=cleanIntent(value);if(next===cleanIntent(state.creativeIntent))return;
  state.creativeIntent=next;photo.creativeIntent=next;
  cancelReassessment('intent');
  if(photo.agentBusy){advisorRequests.cancel(photo.id,'intent');photo.agentBusy=false;photo.conversation.push({role:'status',text:'调整目标已更新，请围绕新目标继续对话。'});}
  for(const task of analysisQueue.tasks.filter(item=>item.photoId===photo.id && ['queued','running'].includes(item.status)))analysisQueue.cancel(task.id,'superseded');
  reassessGeneration++;state.assessmentBusy=false;state.assessment=null;
  renderCreativeIntent();renderPresets();renderAgent();renderDiagnosis();scheduleDraftSave();
  photo.analysis=onDemandReview(photo,{keepApplied:true});photo.analysisSource='local';photo.analysisStatus='idle';photo.analysisProvenance=null;photo.originalRecommendations=null;photo.analysisIntent=next;reflectPhotoAnalysis(photo);
  $('#agent-live').textContent=next ? `这张照片的调整目标：${next}。顾问将优先考虑这一目标。`:'已清除这张照片的调整目标。';
}
function renderIntentQuestion() {
  const intent=describeIntent($('#intent-input').value);
  $('#intent-clarification').hidden=!intent.vague;
  $('#intent-question').textContent=intent.question;
  $('#intent-choices').innerHTML=intent.choices.map(choice=>`<button type="button" data-intent-choice="${escapeHtml(choice)}">${escapeHtml(choice)}</button>`).join('');
  $('#intent-save').disabled=intent.vague;
}
$('#photo-intent-open').addEventListener('click',()=>{$('#intent-input').value=cleanIntent(state.creativeIntent);renderIntentQuestion();$('#intent-dialog').showModal();$('#intent-input').focus();});
$('#intent-close').addEventListener('click',()=>$('#intent-dialog').close());
$('#intent-input').addEventListener('input',renderIntentQuestion);
$('#intent-dialog').addEventListener('click',event=>{const choice=event.target.closest('[data-intent-example],[data-intent-choice]');if(choice){$('#intent-input').value=choice.dataset.intentExample || choice.dataset.intentChoice;renderIntentQuestion();}});
$('#intent-save').addEventListener('click',()=>{if(describeIntent($('#intent-input').value).vague)return;setCreativeIntent($('#intent-input').value);$('#intent-dialog').close();showToast('目标已保存，已有编辑保留。下次提问将参考新目标。');});
$('#intent-clear').addEventListener('click',()=>{setCreativeIntent('');$('#intent-dialog').close();});

function renderStyleCollection(ranked) {
  const focused=document.activeElement?.closest('#preset-list [data-preset]'),focusedId=focused?.dataset.preset,focusedFavorite=document.activeElement?.classList.contains('favorite-button');
  const query=$('#style-search').value.trim().toLowerCase();
  const allowed=new Set(filterStyles(state.styleCategory,[...state.favoritePresets]).map(item=>item.id));
  const filtered=ranked.filter(({preset})=>allowed.has(preset.id) && (!query || [preset.name,preset.category,preset.mood,preset.inspiration].join(' ').toLowerCase().includes(query)));
  if(filtered.length && !filtered.some(item=>item.preset.id===collectionPresetId))collectionPresetId=filtered[0].preset.id;
  $('.style-detail').hidden=!filtered.length;
  $('#library-count').textContent=`${filtered.length} 款`;
  $('#preset-list').innerHTML=filtered.map(({preset})=>`<article class="preset-card collection-card ${collectionPresetId===preset.id ? 'selected':''}" data-preset="${escapeHtml(preset.id)}"><button type="button" class="collection-select" tabindex="${collectionPresetId===preset.id ? 0:-1}" aria-label="预览${escapeHtml(preset.name)}" aria-pressed="${collectionPresetId===preset.id}"><img class="preset-photo" src="${state.presetThumbs[preset.id] || state.image?.src || ''}" alt="${escapeHtml(preset.name)}在当前照片上的预览" /><span class="collection-card-copy"><small>${escapeHtml(preset.category)}</small><strong>${escapeHtml(preset.name)}</strong><span>${escapeHtml(preset.mood)}</span></span></button><button tabindex="${collectionPresetId===preset.id ? 0:-1}" class="favorite-button ${state.favoritePresets.has(preset.id) ? 'saved':''}" type="button" aria-label="${state.favoritePresets.has(preset.id) ? '取消收藏':'收藏'}${escapeHtml(preset.name)}" aria-pressed="${state.favoritePresets.has(preset.id)}"><span data-icon="heart"></span></button></article>`).join('') || '<p class="style-empty">没有匹配的风格。试试其他关键词或分类。</p>';
  hydrateIcons($('#preset-list'));
  if(focusedId)$('#preset-list').querySelector(`[data-preset="${focusedId}"] ${focusedFavorite ? '.favorite-button':'.collection-select'}`)?.focus({preventScroll:true});
  if($('#style-collection-dialog').open && filtered.length)renderCollectionDetail(ranked);
}
function collectionRanking() {
  const demoMatches = [
    {id:'golden-hour',reason:'示例照片的朝霞与远山适合保留暖光，再收住天空高光。',source:'demo'},
    {id:'open-road',reason:'示例照片中远山与云海的空间感，适合轻柔的低对比色彩。',source:'demo'},
    {id:'misty-air',reason:'示例照片的云海与晨雾，适合试试更安静的留白感。',source:'demo'}
  ];
  const styleMatches = state.analysisSource === 'ai' ? state.analysis?.styleMatches : state.isDemo ? demoMatches : [];
  return rankStyles({inspection:state.originalInspection,preference:state.stylePreference,favorites:[...state.favoritePresets],aiMatches:styleMatches,subject:currentPhoto()?.subject,preferredSubjects:personalProfile.subjects,tasteRecords,creativeIntent:state.creativeIntent});
}

function openStyleCollection(id=null,category='all') {
  if(!state.image)return;
  finishRangeEdit();finishAnnotationNote();
  state.styleCategory=category;$('#style-search').value='';
  collectionPresetId=id || state.presetId || collectionRanking()[0]?.preset.id;collectionHolding=false;collectionHoverId=null;
  buildPresetThumbs(state.image);$('#style-collection-dialog').showModal();renderPresets();$('.style-detail-scroll').scrollTop=0;$('#preset-list').scrollTop=0;
}
function renderCollectionDetail(ranked=collectionRanking()) {
  const preset=presetById(collectionHoverId || collectionPresetId);if(!preset)return;
  const amount=collectionAmounts.get(preset.id) ?? (state.presetId===preset.id ? state.presetAmount:rememberedStyleAmount(tasteRecords,preset.id,currentPhoto()?.subject) ?? 75);
  $('#style-detail-name').textContent=preset.name;$('#style-detail-subject').textContent=`适用 · ${preset.category}`;
  $('#style-detail-mood').textContent=preset.mood;
  $('#style-detail-reason').textContent=ranked.find(item=>item.preset.id===preset.id)?.reason || '';
  $('#style-detail-amount').value=amount;$('#style-detail-amount-value').textContent=`${amount}%`;
  $('#style-detail-amount').disabled=Boolean(collectionHoverId);
  $('#style-detail-favorite').disabled=Boolean(collectionHoverId);
  $('#style-detail-favorite').classList.toggle('saved',state.favoritePresets.has(preset.id));
  $('#style-detail-favorite').setAttribute('aria-pressed',String(state.favoritePresets.has(preset.id)));
  $('#style-detail-favorite').setAttribute('aria-label',`${state.favoritePresets.has(preset.id) ? '取消收藏':'收藏'}${preset.name}`);
  $('#style-detail-inspiration').innerHTML=preset.source ? `<a href="${escapeHtml(preset.source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(preset.inspiration)} ↗</a>`:escapeHtml(preset.inspiration);
  renderCollectionPreview();
}
let collectionDocumentTrial=null;
async function renderCollectionPreview() {
  if(!$('#style-collection-dialog').open || !state.image)return;
  const token=++collectionGeneration,preset=presetById(collectionHoverId || collectionPresetId),canvas=$('#style-detail-canvas'),image=state.image;
  if(!preset)return;
  let snapshot=editSnapshot();const baseDocument=snapshot.editDocument,amount=Number($('#style-detail-amount').value);
  const commands=!collectionHolding&&baseDocument?presetCommands(preset.id,amount,{groupId:'look-'+crypto.randomUUID()}):null;collectionDocumentTrial=null;
  const trial=commands?presetTrial(baseDocument,preset.id,amount,{groupId:commands[0].group.id}):null;
  if(trial)snapshot={...snapshot,editDocument:trial.document};else if(!collectionHolding)snapshot=planStyle(snapshot,preset.id,amount);
  const version=viewerVersion(snapshot,'style','风格预览'),rect=cropPixelRect(snapshot.crop,image.naturalWidth,image.naturalHeight),scale=Math.min(1,960/Math.max(rect.width,rect.height));
  const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale)),source=document.createElement('canvas');source.width=width;source.height=height;
  const ctx=source.getContext('2d',{willReadFrequently:true});drawPhotoSource(ctx,image,snapshot.crop,width,height);
  $('#style-detail-apply').disabled=true;
  $('#style-detail-status').textContent=collectionHolding ? '当前版本':'正在预览…';
  try {
    const task=collectionPixels.then(()=>token===collectionGeneration && $('#style-collection-dialog').open ? renderPresetTrial(collectionRenderer,{pixels:ctx.getImageData(0,0,width,height).data,width,height,settings:version.settings,annotations:version.annotations,crop:snapshot.crop,document:version.document,frame:{fullWidth:image.naturalWidth,fullHeight:image.naturalHeight,sourceRect:rect,angle:snapshot.crop?.angle || 0}},trial):null);
    collectionPixels=task.catch(()=>{});
    const output=await task;
    if(token!==collectionGeneration || !$('#style-collection-dialog').open)return;
    canvas.width=width;canvas.height=height;canvas.getContext('2d').putImageData(new ImageData(output,width,height),0,0);
    $('#style-detail-status').textContent=trial?.canApply===false ? '步骤或分组已达上限 · 仍可试片，整理步骤后再应用':collectionHolding ? '当前版本':`${collectionHoverId ? '临时预览 · ':''}${preset.name} · ${amount}% · 当前编辑未变`;
    if(commands&&trial.canApply)collectionDocumentTrial={photoId:currentPhotoId,baseHash:documentHash(baseDocument),presetId:preset.id,amount,commands};
    $('#style-detail-apply').disabled=trial?.canApply===false || collectionHolding || Boolean(collectionHoverId);
  } catch {if(token===collectionGeneration)$('#style-detail-status').textContent='预览未完成，请重新选择风格重试。';}
}
function toggleStyleFavorite(id) {
  if(!presetById(id))return;
  if(state.favoritePresets.has(id))state.favoritePresets.delete(id);else state.favoritePresets.add(id);
  try {localStorage.setItem('guangjian-style-favorites',JSON.stringify([...state.favoritePresets]));}catch{}
  renderPresets();
}
$('#style-library-open').addEventListener('click',()=>openStyleCollection());
$('#style-favorites-more').addEventListener('click',()=>openStyleCollection(null,'favorites'));
$('#favorite-style-picks').addEventListener('click',event=>{if(event.target.closest('[data-style-start]'))openStyleCollection();});
$('#style-collection-close').addEventListener('click',()=>$('#style-collection-dialog').close());
$('#style-collection-dialog').addEventListener('close',()=>{collectionGeneration++;collectionHolding=false;collectionHoverId=null;});
$('#style-search').addEventListener('input',()=>renderStyleCollection(collectionRanking()));
$('#preset-list').addEventListener('click',event=>{const card=event.target.closest('[data-preset]');if(!card)return;collectionHoverId=null;if(event.target.closest('.favorite-button')){toggleStyleFavorite(card.dataset.preset);return;}if(event.target.closest('.collection-select')){collectionPresetId=card.dataset.preset;renderStyleCollection(collectionRanking());if(window.innerWidth<=600)$('.style-detail').scrollIntoView({block:'start',behavior:'smooth'});}});
function auditionCollectionCard(card) {
  if(!card || !canHoverStyles())return;
  if(card.dataset.preset===collectionPresetId){restoreCollectionSelection();return;}
  if(collectionHoverId===card.dataset.preset)return;
  collectionHoverId=card.dataset.preset;collectionHolding=false;renderCollectionDetail();
}
function restoreCollectionSelection(){if(!collectionHoverId)return;collectionHoverId=null;renderCollectionDetail();}
// Replacing cards beneath a stationary pointer must not override a keyboard selection.
$('#preset-list').addEventListener('pointerover',event=>{const card=event.target.closest('[data-preset]');if(!keyboardInteraction && card && !card.contains(event.relatedTarget))auditionCollectionCard(card);});
$('#preset-list').addEventListener('pointermove',event=>{if(!keyboardInteraction)auditionCollectionCard(event.target.closest('[data-preset]'));});
$('#preset-list').addEventListener('pointerout',event=>{const card=event.target.closest('[data-preset]');if(!keyboardInteraction && card && card.dataset.preset===collectionHoverId && !card.contains(event.relatedTarget))restoreCollectionSelection();});
$('#preset-list').addEventListener('focusin',event=>{if(keyboardInteraction && event.target.matches('.collection-select'))auditionCollectionCard(event.target.closest('[data-preset]'));});
$('#preset-list').addEventListener('focusout',event=>{const card=event.target.closest('[data-preset]');if(card && !card.contains(event.relatedTarget))restoreCollectionSelection();});
$('#preset-list').addEventListener('keydown',event=>{
  const focused=event.target.closest('.collection-select');if(!focused)return;
  const buttons=[...$('#preset-list').querySelectorAll('.collection-select')],current=buttons.indexOf(focused);
  let index=photoNavigationIndex(event.key,current,buttons.length);
  if(['ArrowUp','ArrowDown'].includes(event.key))index=(current+(event.key==='ArrowUp' ? -2:2)+buttons.length)%buttons.length;
  if(index<0)return;event.preventDefault();
  buttons.forEach((button,i)=>{button.tabIndex=i===index ? 0:-1;button.closest('[data-preset]').querySelector('.favorite-button').tabIndex=i===index ? 0:-1;});
  buttons[index].focus();
});
$('#style-collection-dialog').addEventListener('keydown',event=>{if(event.key==='Escape' && collectionHoverId){event.preventDefault();restoreCollectionSelection();}});
$('#style-detail-favorite').addEventListener('click',()=>toggleStyleFavorite(collectionPresetId));
let collectionRenderTimer;
$('#style-detail-amount').addEventListener('input',event=>{collectionAmounts.set(collectionPresetId,Number(event.target.value));$('#style-detail-apply').disabled=true;$('#style-detail-status').textContent='正在预览…';$('#style-detail-amount-value').textContent=`${event.target.value}%`;clearTimeout(collectionRenderTimer);collectionRenderTimer=setTimeout(renderCollectionPreview,80);});
$('#style-detail-apply').addEventListener('click',()=>{
  if(collectionHoverId || !presetById(collectionPresetId))return;
  if(state.editDocument){const trial=collectionDocumentTrial;if(!trial||trial.photoId!==currentPhotoId||trial.baseHash!==documentHash(state.editDocument)||trial.presetId!==collectionPresetId||trial.amount!==Number($('#style-detail-amount').value)){showToast('当前编辑或风格强度已变化，请重新预览。');return;}editStack.command(trial.commands);$('#style-collection-dialog').close();return;}
  const before=beforeEdit();state.presetId=collectionPresetId;state.presetAmount=Number($('#style-detail-amount').value);
  saveEdit(before);$('#style-collection-dialog').close();buildPresetThumbs(state.image);renderPresets();renderAgent();scheduleRender();markAssessmentStale();setCompare(68);showToast('已应用所选风格与强度，其他调整保留。');
});
const holdStyleButton=$('#style-detail-original');
function setCollectionHold(value){if(collectionHolding===value)return;collectionHolding=value;holdStyleButton.setAttribute('aria-pressed',String(value));renderCollectionPreview();}
holdStyleButton.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();holdStyleButton.setPointerCapture(event.pointerId);setCollectionHold(true);});
for(const type of ['pointerup','pointercancel','lostpointercapture','blur'])holdStyleButton.addEventListener(type,()=>setCollectionHold(false));
holdStyleButton.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)){event.preventDefault();setCollectionHold(true);}});
holdStyleButton.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key))setCollectionHold(false);});


// Explicit project exchange keeps the existing workspace and imports a new photo.
function portableVersion(snapshot,id,name){
  if(snapshot.annotations?.some(a=>a.maskType==='brush'))throw new Error('这份版本含画笔范围，请在原工作空间继续；交换不会删除或改写画笔。');
  const rendered=viewerVersion(snapshot,id,name);
  if(snapshot.editDocument){const recipe=structuredClone(snapshot.editDocument);return {id,name,role:id==='current'?'working':'edit',recipe,state:{...structuredClone(recipe.base.state),crop:structuredClone(recipe.geometry.crop),textOverlays:[]}};}
  return {id,name,role:id==='current'?'working':'edit',...(snapshot.editDocument?{recipe:structuredClone(snapshot.editDocument)}:{}),state:{settings:rendered.settings,style:null,crop:rendered.crop,locals:rendered.annotations.filter(a=>Object.values(a.localSettings||{}).some(Boolean)).map(a=>({...a,maskType:a.maskType||'rectangle',feather:a.feather??.36,localAmount:a.localAmount??100,localEnabled:a.localEnabled!==false})),textOverlays:[]}};
}
const exchangeStatus=message=>{$('#project-exchange-status').textContent=message;};
async function digestPhoto(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
$('#project-export').addEventListener('click',async()=>{
  endStyleAudition();commitPhotoInputs();const photo=currentPhoto();
  if(!photo?.originalBlob||photo.isDemo){exchangeStatus('请先加入自己的照片，再下载编辑项目。');return;}
  const button=$('#project-export');button.disabled=true;
  try{
    if(photo.projectId||photo.sourceOriginalBlob)throw new Error('文件项目或 HEIC 原片请通过项目文件夹继续共享；这里的便携快照用于普通浏览器草稿。');
    if(photo.originalBlob.size>30*1024*1024)throw new Error('原片超过项目交换的 30 MB 限制，请先转换。');
    const bytes=new Uint8Array(await photo.originalBlob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    const versions=[{id:'original',name:'原片',role:'original',state:{settings:defaults,style:null,crop:null,locals:[]}},...(photo.versions||[]).map(v=>portableVersion(v.snapshot,v.id,v.label)),portableVersion(photoSnapshot(photo),'current','当前编辑')];
    const value=validateExchange({schema:exchangeFormatFor(versions),renderingVersion,source:{name:photo.imageName,mime:photo.originalBlob.type,bytes:bytes.length,checksum:await digestPhoto(bytes),width:photo.image.naturalWidth,height:photo.image.naturalHeight,data:btoa(binary)},intent:photo.creativeIntent||'',notes:photo.annotations.map(a=>({id:a.id,rect:a.rect,note:a.note||'',protect:Boolean(a.protect)})),versions,currentId:'current'});
    triggerDownload(new Blob([JSON.stringify(value)],{type:'application/json'}),safeFilename(photo.imageName,'frameyn.json'));
    exchangeStatus('已下载照片与编辑项目。把文件交给你的 Agent，即可继续精调；原工作区保留。');
  }catch(e){exchangeStatus(e.message||'项目未能下载，已有编辑保留。');}finally{button.disabled=false;}
});
$('#project-import').addEventListener('click',()=>$('#project-file').click());
$('#project-file').addEventListener('change',async()=>{
  const file=$('#project-file').files[0];$('#project-file').value='';if(!file)return;
  if(importingFiles||state.loading){exchangeStatus('照片正在导入，请完成后重试。');return;}
  const button=$('#project-import');button.disabled=true;importingFiles=true;refreshActions();
  let added=null;const previousPhotoId=currentPhotoId;
  try{
    if(file.size>48*1024*1024)throw new Error('项目文件过大，请在 Agent 暗房继续。');
    const pack=validateExchange(JSON.parse(await file.text()));
    if(pack.intent.length>180)throw new Error('意图超过网页的 180 字限制，请在 Agent 暗房继续或先明确精简。');
    if(pack.versions.filter(v=>v.role==='edit').length>40)throw new Error('网页最多保存 40 个命名版本，请先在 Agent 暗房整理。');
    const binary=atob(pack.source.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    if(bytes.length!==pack.source.bytes||await digestPhoto(bytes)!==pack.source.checksum)throw new Error('原片数据损坏，请重新导出项目。');
    const photoFile=new File([bytes],pack.source.name,{type:pack.source.mime}),rows=[{id:crypto.randomUUID(),file:photoFile,status:'queued'}];
    await runImportBatch(rows,{capacity:()=>({count:photoSessions.length,pixels:photoSessions.reduce((sum,p)=>sum+p.image.naturalWidth*p.image.naturalHeight,0)}),commit:async(f,metadata,signal)=>{
      if(metadata.mime!==pack.source.mime)throw new Error('原片实际格式与项目记录不符。');
      if(metadata.displayWidth!==pack.source.width||metadata.displayHeight!==pack.source.height)throw new Error('正向照片尺寸与项目记录不一致。');
      const blob=f.slice(0,f.size,metadata.mime),url=URL.createObjectURL(blob);
      added=await addPhotoSource(url,pack.source.name,false,false,blob,{metadata,signal,strict:true});
      Object.assign(added,restoreWebExchange(pack,analyzeLocal(added)),{active:new Set()});
      return {id:added.id,width:added.image.naturalWidth,height:added.image.naturalHeight};
    }});
    if(!added||rows.some(r=>r.status==='failed'))throw new Error(rows.find(r=>r.problem)?.problem?.reason||'项目未能加入，请检查原片格式与空间限制。');
    nextAnnotationId=Math.max(nextAnnotationId,...added.annotations.map(n=>Number(String(n.id).replace('note-',''))+1).filter(Number.isFinite));
    activatePhoto(added.id);scheduleDraftSave();renderEditions();exchangeStatus('已新增照片项目，原有照片仍保留。导入版本不自动记为个人偏好。');
  }catch(e){if(added){for(const task of analysisQueue.tasks.filter(t=>t.photoId===added.id&&['queued','running'].includes(t.status)))analysisQueue.cancel(task.id,'removed');const i=photoSessions.indexOf(added);if(i>=0)photoSessions.splice(i,1);URL.revokeObjectURL(added.src);if(currentPhotoId===added.id){currentPhotoId=null;if(previousPhotoId)activatePhoto(previousPhotoId);}renderPhotoTabs();}exchangeStatus(e.message||'项目未能导入，已有工作保留。');}
  finally{importingFiles=false;button.disabled=false;refreshActions();}
});
