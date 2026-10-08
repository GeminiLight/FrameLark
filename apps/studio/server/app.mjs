import {analysisAdapterInstructions,reassessmentAdapterInstructions} from './ai/review-prompts.mjs';
import {reviewProject} from './ai/project-review.mjs';
import {analysisDiagnosis,auditContentSchema,normalizeAuditContent} from '../public/edit-stack/review-protocol.js';
import {loadRetouchPolicy,policyTopics} from '../../../skills/photo-retouch/scripts/retouch-policy.mjs';
import {prepareAdvisorRequest,finishAdvisorReply} from './ai/advisor-policy.mjs';
import {handlePhotoToolRoutes} from './tools/routes.mjs';
import {ProjectBridge} from './projects/bridge.mjs';
import {handleProjectRoutes} from './projects/routes.mjs';
import {CollectionBridge} from './projects/collection-bridge.mjs';
import {handleCollectionRoutes} from './projects/collection-routes.mjs';
import {responseLanguage} from '../public/response-language.js';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanIntent} from '../public/creative-intent.js';
import { presets } from '../public/presets.js';
import { agentAdjustmentKeys } from '../public/design-agent.js';
import { createVisionService, VisionError } from './ai/vision.mjs';
import {strictProviderSchema} from '../public/edit-stack/planner.js';
import {documentHash} from '../public/edit-stack/identity.js';
import {validateDocument} from '../public/edit-stack/document.js';
import {normalizeMetricEvidence,normalizeAssessment} from '../public/diagnosis-explanation.js';
import {normalizeObservations} from '../public/vision-review.js';
import { validateReviewDecision } from '../public/review-policy.js';
import {controlReferencePrompt} from '../public/control-reference.js';
import {validPhotoMetering,meteringPrompt} from '../public/photo-metering.js';
import {reviewContext,reviewContextPrompt,reviewBaseline,anchoredAssessment} from '../public/review-context.js';
import {validReviewTrials,trialPrompt} from '../public/review-calibration.js';
import {reviewPhotoSeries} from './ai/series.mjs';

export const port = Number(process.env.PORT || 3177);
export const host = process.env.HOST || '127.0.0.1';
const publicDir = fileURLToPath(new URL('../public/',import.meta.url)).replace(/[\\/]$/,'');
const cloudDeployment=process.env.VERCEL==='1';
const vision = await createVisionService();
const projects = new ProjectBridge();
const collections = new CollectionBridge({projects});
const analysisPromptVersion = 'photo-review-2026-10-03-color-v4';
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};

function sendJson(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(value));
}

export async function readBody(request, maxBytes) {
  // Vercel can provide an already-read body; local Node requests remain streams.
  if(request.body!==undefined && request.body!==null){
    const value=request.body;
    const bytes=Buffer.isBuffer(value) ? value:Buffer.from(typeof value==='string' ? value:request.headers['content-type']?.startsWith('application/x-www-form-urlencoded') ? new URLSearchParams(value).toString():JSON.stringify(value));
    if(bytes.length>maxBytes)throw Object.assign(new Error('Image too large'),{status:413});
    return bytes;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Image too large'), {status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, maxBytes = 8_000_000) {
  return JSON.parse((await readBody(request, maxBytes)).toString('utf8'));
}

const adjustmentProperties = {
  exposure:{type:'number'},contrast:{type:'number'},highlights:{type:'number'},shadows:{type:'number'},
  whites:{type:'number'},blacks:{type:'number'},vibrance:{type:'number'},saturation:{type:'number'},
  warmth:{type:'number'},tint:{type:'number'},fade:{type:'number'},vignette:{type:'number'},
  curveShadows:{type:'number'},curveMidtones:{type:'number'},curveHighlights:{type:'number'},
  texture:{type:'number'},clarity:{type:'number'},dehaze:{type:'number'},sharpen:{type:'number'},denoise:{type:'number'}
};
Object.entries(adjustmentProperties).forEach(([key,schema]) => Object.assign(schema,{minimum:key === 'exposure' ? -1.5 : ['warmth','tint'].includes(key) ? -75 : ['fade','vignette','sharpen','denoise'].includes(key) ? 0 : -50,maximum:key === 'exposure' ? 1.5 : ['warmth','tint'].includes(key) ? 75 : 50}));
const metricProperties = {
  light:{type:'number'},highlights:{type:'number'},shadows:{type:'number'},
  color:{type:'number'},contrast:{type:'number'},detail:{type:'number'}
};
Object.values(metricProperties).forEach(schema => Object.assign(schema,{minimum:0,maximum:100}));
const metricSchema = {type:'object',additionalProperties:false,properties:metricProperties,required:Object.keys(metricProperties)};
const evidenceItem={type:'object',additionalProperties:false,properties:{evidence:{type:'string',minLength:1},condition:{type:'string',minLength:1}},required:['evidence','condition']};
const metricEvidenceSchema={type:'object',additionalProperties:false,properties:Object.fromEntries(Object.keys(metricProperties).map(key=>[key,evidenceItem])),required:Object.keys(metricProperties)};
const findingList={type:'array',maxItems:4,items:{type:'object',additionalProperties:false,properties:{finding:{type:'string',minLength:1},...evidenceItem.properties},required:['finding','evidence','condition']}};
const cropSchema = {type:'object',additionalProperties:false,properties:{
  needed:{type:'boolean'},reason:{type:'string'},x:{type:'number'},y:{type:'number'},width:{type:'number'},height:{type:'number'}
},required:['needed','reason','x','y','width','height']};
const presetIds = presets.map(preset => preset.id);
const styleCatalog = presets.map(preset => `${preset.id}（${preset.name}，${preset.category}，${preset.mood}）`).join('；');
const observationSchema = {
  type:'object',additionalProperties:false,
  properties:{finding:{type:'string',minLength:1},evidence:{type:'string',minLength:1},location:{type:'string',minLength:1},condition:{type:'string',minLength:1},
    verdict:{type:'string',enum:['keep','improve','uncertain']},confidence:{type:'string',enum:['high','medium','low']},
    region:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{x:{type:'number',minimum:0,maximum:1},y:{type:'number',minimum:0,maximum:1},width:{type:'number',minimum:0,maximum:1},height:{type:'number',minimum:0,maximum:1}},required:['x','y','width','height']}]}
  },required:['finding','evidence','location','verdict','confidence','region','condition']
};
const observationKeys = ['subject','background','light','composition','order','emotion'];
// A whole-frame mood has no precise location. Keep all keys required for strict providers.
const emotionObservationSchema={...observationSchema,properties:{...observationSchema.properties,location:{type:['string','null']}}};
const analysisSchema = {
  type:'object',additionalProperties:false,
  properties:{
    scene:{type:'string',minLength:1},subject:{type:'string',enum:['landscape','portrait','street','architecture','night','other']},summary:{type:'string',minLength:1},insight:{type:'string',minLength:1},
    observations:{type:'object',additionalProperties:false,properties:Object.fromEntries(observationKeys.map(key => [key,key==='emotion'?emotionObservationSchema:observationSchema])),required:observationKeys},
    conclusion:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['keep','adjust','uncertain']},reason:{type:'string',minLength:1}},required:['kind','reason']},
    recommendedStyle:{type:'string',enum:['none',...presetIds]},
    styleMatches:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',enum:presetIds},reason:{type:'string'}},required:['id','reason']}},
    metrics:metricSchema,metricEvidence:metricEvidenceSchema,
    crop:cropSchema,
    recommendations:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,properties:{
      title:{type:'string',minLength:1},category:{type:'string'},reason:{type:'string',minLength:1},goal:{type:'string'},caution:{type:'string'},lesson:{type:'string'},
      observationIds:{type:'array',minItems:1,maxItems:4,items:{type:'string',enum:observationKeys}},
      adjustments:{type:'object',additionalProperties:false,properties:adjustmentProperties,required:Object.keys(adjustmentProperties)}
    },required:['title','category','reason','goal','caution','lesson','observationIds','adjustments']}},
    lessons:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},body:{type:'string'}},required:['title','body']}}
  },required:['scene','subject','summary','insight','observations','conclusion','recommendedStyle','styleMatches','metrics','metricEvidence','crop','recommendations','lessons']
};
const reassessmentSchema = {
  type:'object',additionalProperties:false,
  properties:{audit:strictProviderSchema(auditContentSchema),summary:{type:'string'},before:metricSchema,after:metricSchema,observation:{type:'string',minLength:1},beforeEvidence:metricEvidenceSchema,afterEvidence:metricEvidenceSchema,improvements:findingList,tradeoffs:findingList,preserved:findingList},
  required:['audit','summary','before','after','observation','beforeEvidence','afterEvidence','improvements','tradeoffs','preserved']
};
function reviewEffort() {
  const endpoint=new URL(vision.publicConfiguration().endpoint);
  return /(^|\.)(kimi\.(com|ai)|moonshot\.(cn|ai))$/.test(endpoint.hostname) ? 'low':'medium';
}

async function converseWithDesignAgent({image,question,history,context,signal,sessionKey,onEvent,tier}) {
  const packet=await prepareAdvisorRequest({image,question,history,context});
  const result=await vision.request(packet.payload,{signal,sessionKey,onEvent,tier,task:'advisor'});
  try{return finishAdvisorReply(packet,result);}catch(error){throw new VisionError('INCONSISTENT_REVIEW',error.message,{retryable:true});}
}

async function analyzeWithAI(image,signal,creativeIntent='',photoReference=null,trials=[],repair=false) {
  const policy=await loadRetouchPolicy({task:'diagnosis',topics:policyTopics({intent:creativeIntent})});
  const result = await vision.request({
        max_output_tokens:7000,reasoning:{effort:reviewEffort()},
        instructions:responseLanguage+policy.instructions+'\n'+analysisAdapterInstructions({styleCatalog,adjustmentProperties}),
        input:[{role:'user',content:[{type:'input_text',text:`请先说清楚这张原片哪些部分已经成立，再决定是否有必要调整。构图与光色合适时明确建议保留，返回零条调整；只有一处问题就只提一条，不凑数量。不确定时说明依据不足。裁剪与调色分别判断；没有明确边缘干扰就保留原画幅。风格探索可省略，不把不同口味当成原片缺陷。 ${repair ? '上次输出未通过一致性检查：observations 只能包含 subject/background/light/composition/order/emotion，禁止新增键；逐项核对 conclusion.kind 与非零动作、observationIds 引用的 improve/medium-high 依据一致；keep/uncertain 必须零动作；裁剪不可切到主体或光源的观察范围。依据不足宁可明确不自动调整，禁止为了通过校验编造改善观察。':''} ${meteringPrompt(photoReference)} ${controlReferencePrompt()} 当前创作意图：${cleanIntent(creativeIntent) || "未设定"}。意图是表达目标，不是画面事实；优先于一般审美口味，不为符合目标而编造缺陷。`},{type:'input_image',image_url:image,detail:'high'},...trials.flatMap((trial,index)=>[{type:'input_text',text:trialPrompt(trial,index)},{type:'input_image',image_url:trial.image,detail:'high'}])]}],
        text:{format:{type:'json_schema',name:'photo_analysis',strict:true,schema:analysisSchema}}
  },{signal});
  try { validateReviewDecision(result.value);normalizeObservations(result.value.observations);normalizeMetricEvidence(result.value.metricEvidence); }
  catch(error) { throw new VisionError('INCONSISTENT_REVIEW',`审片建议未通过校验：${error.message} 可重新审片，已有编辑保留。`,{retryable:true}); }
  return {analysis:result.value,diagnosis:{...analysisDiagnosis(result.value,cleanIntent(creativeIntent)),authority:'draft-preview'},provenance:{...result.provenance,promptVersion:analysisPromptVersion,policy:policy.provenance,creativeIntent:cleanIntent(creativeIntent)}};
}

async function reassessWithAI(original, edited,signal,creativeIntent='',context={},baseline=null) {
  const policy=await loadRetouchPolicy({task:'audit',topics:policyTopics({intent:creativeIntent})});
  const reference=reviewBaseline(baseline);
  const baselinePrompt=reference ? `原片基准分来自本张照片同一创作意图下的首次视觉审片，保持 before=${JSON.stringify(reference.metrics)}，不要重写原片基线。after 沿用这个标尺；可以下降，不为了显得成功而提高。原片依据在界面沿用首次审片，本次聚焦实际改善与代价。`:'没有首次视觉审片基准；本次双图使用同一标尺。';
  const result = await vision.request({
        max_output_tokens:5500,reasoning:{effort:reviewEffort()},
        instructions:responseLanguage+policy.instructions+'\n'+reassessmentAdapterInstructions,
        input:[{role:'user',content:[
          {type:'input_text',text:`本次复评的表达目标：${cleanIntent(creativeIntent) || "保留原有表达，检查实际改善与代价"}。原片与当前效果使用这个相同目标；目标不是图像证据。${reviewContextPrompt(context)} ${baselinePrompt} ${meteringPrompt(context.originalMetering)} 原片：`}, {type:'input_image',image_url:original,detail:'high'},
          {type:'input_text',text:`当前调整后的照片：${meteringPrompt(context.editedMetering)}`} , {type:'input_image',image_url:edited,detail:'high'}
        ]}],
        text:{format:{type:'json_schema',name:'photo_reassessment',strict:true,schema:reassessmentSchema}}
  },{signal});
  try {return {assessment:anchoredAssessment(normalizeAssessment(result.value),reference),audit:result.value.audit?{...normalizeAuditContent(result.value.audit),authority:'draft-preview'}:null,provenance:{...result.provenance,promptVersion:analysisPromptVersion+'-compare',policy:policy.provenance,creativeIntent:cleanIntent(creativeIntent)}};}
  catch {throw new VisionError('INVALID_MODEL_RESPONSE','复评缺少完整依据或得失说明，请重试。',{retryable:true});}
}

function sendVisionFailure(response,error) {
  const failure = error instanceof VisionError ? error : error.status === 413
    ? new VisionError('IMAGE_TOO_LARGE','照片预览过大，请换一张照片重试。',{status:413})
    : error instanceof SyntaxError ? new VisionError('INVALID_REQUEST','请求内容无法读取。',{status:400})
    : new VisionError('VISION_REQUEST_FAILED','视觉服务暂时未能完成请求，请重试。',{retryable:true});
  console.warn('Vision request failed: ' + failure.code);
  return sendJson(response,failure.status,{error:failure.toJSON()});
}

function canAccessLocalFiles(request,write=false) {
  if(cloudDeployment)return false;
  const localPort=request.socket?.localPort||port,authorities=['localhost:'+localPort,'127.0.0.1:'+localPort,'[::1]:'+localPort],origins=authorities.map(h=>'http://'+h);
  if(!authorities.includes(request.headers.host)||request.headers['sec-fetch-site']==='cross-site')return false;
  if(request.headers.origin&&!origins.includes(request.headers.origin))return false;
  return !write || origins.includes(request.headers.origin)&&['application/json','application/octet-stream'].some(type=>request.headers['content-type']?.startsWith(type));
}

function canConfigureVision(request) {
  if(cloudDeployment)return false;
  const localPort=request.socket?.localPort||port,authorities = ['localhost:' + localPort,'127.0.0.1:' + localPort,'[::1]:' + localPort];
  const origins = authorities.map(authority => 'http://' + authority);
  return authorities.includes(request.headers.host) && origins.includes(request.headers.origin) && request.headers['content-type']?.startsWith('application/json');
}

function cancelOnDisconnect(response) {
  const controller = new AbortController();
  response.once('close',() => { if (!response.writableEnded) controller.abort(); });
  return controller.signal;
}

export async function handleRequest(request, response) {
  try { await routeRequest(request,response); }
  catch(error) {
    if(response.destroyed || response.writableEnded)return;
    if(response.headersSent){response.destroy();return;}
    const invalidUrl=error instanceof URIError || error.code==='ERR_INVALID_URL';
    const code=invalidUrl?'INVALID_REQUEST_URL':'REQUEST_FAILED';
    if(!invalidUrl)console.warn('Request failed: '+code);
    return sendJson(response,invalidUrl?400:500,{error:{code,message:invalidUrl?'页面地址无法读取，请从工作台首页重新打开。':'这次请求未完成，请重试。已有编辑仍保留。',retryable:!invalidUrl}});
  }
}

async function routeRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const localVisionCalls=['/api/analyze','/api/reassess','/api/design-chat','/api/series-review'];
  if(!cloudDeployment && request.method==='POST' && localVisionCalls.includes(url.pathname) &&
    (!canAccessLocalFiles(request) || request.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')) {
    return sendJson(response,403,{error:{code:'FORBIDDEN_ORIGIN',message:'请从本机工作台发起视觉请求。',retryable:false}});
  }
  if(await handlePhotoToolRoutes(request,response,url,{readBody,allowed:canAccessLocalFiles,cloud:cloudDeployment,review:(id,kind,value,options)=>reviewProject(projects,vision,id,kind,value,options)}))return;
  if(await handleCollectionRoutes(request,response,url,{collections,readBody,allowed:canAccessLocalFiles,cloud:cloudDeployment,review:(id,kind,value,options)=>reviewProject(projects,vision,id,kind,value,options)}))return;
  if(await handleProjectRoutes(request,response,url,{bridge:projects,readBody,allowed:canAccessLocalFiles,cloud:cloudDeployment,review:(id,kind,value,options)=>reviewProject(projects,vision,id,kind,value,options)}))return;
  if(url.pathname==='/api/codex-status' && request.method==='POST'){
    if(!canConfigureVision(request))return sendJson(response,403,{error:{code:'FORBIDDEN_ORIGIN',message:'请在本机工作台中检查 Codex 登录。'}});
    try{return sendJson(response,200,await vision.discoverCodex());}catch(error){return sendVisionFailure(response,error);}
  }
  if (url.pathname === '/api/status' && request.method === 'GET') {
    return sendJson(response, 200, {...vision.status(),...(cloudDeployment ? {configurationEditable:false}:{})});
  }
  if (url.pathname === '/api/vision-config' && request.method === 'GET') {
    return sendJson(response,200,{...vision.publicConfiguration(),...(cloudDeployment ? {configurationEditable:false}:{})});
  }
  if (url.pathname === '/api/vision-config' && request.method === 'POST') {
    if (!canConfigureVision(request)) return sendJson(response,403,{error:{code:'FORBIDDEN_ORIGIN',message:cloudDeployment ? '视觉审片由工作台管理员配置。':'请在本机工作台中设置模型连接。',retryable:false}});
    try {
      const signal = cancelOnDisconnect(response);
      const body = await readJson(request,12_000);
      const status = await vision.connect(body,{signal});
      return sendJson(response,200,status);
    } catch (error) { return sendVisionFailure(response,error); }
  }
  if (url.pathname === '/api/analyze' && request.method === 'POST') {
    if (!vision.isConfigured()) return sendJson(response,503,{error:new VisionError('AI_NOT_CONFIGURED','尚未连接视觉审片。当前只能测量本地光色，不识别照片内容。',{status:503}).toJSON()});
    try {
      const signal = cancelOnDisconnect(response);
      const body = await readJson(request);
      if (typeof body.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) return sendJson(response, 400, {error:'INVALID_IMAGE'});
      const review = await analyzeWithAI(body.image,signal,cleanIntent(body.creativeIntent),validPhotoMetering(body.photoReference),validReviewTrials(body.trials),body.retryReview===true);
      return sendJson(response,200,review);
    } catch (error) {
      return sendVisionFailure(response,error);
    }
  }
  if (url.pathname === '/api/series-review' && request.method === 'POST') {
    if(!vision.isConfigured())return sendJson(response,503,{error:new VisionError('AI_NOT_CONFIGURED','尚未连接视觉模型；可以先整理组图，连接后再一起审片。',{status:503}).toJSON()});
    try{return sendJson(response,200,await reviewPhotoSeries(vision,await readJson(request,3_800_000),cancelOnDisconnect(response)));}
    catch(error){return sendVisionFailure(response,error);}
  }
  if (url.pathname === '/api/design-chat' && request.method === 'POST') {
    if (!vision.isConfigured()) return sendJson(response,503,{error:new VisionError('AI_NOT_CONFIGURED','尚未连接视觉审片。当前只能测量本地光色，不识别照片内容。',{status:503}).toJSON()});
    try {
      const body = await readJson(request, 9_000_000);
      const imagePattern = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
      if (typeof body.image !== 'string' || !imagePattern.test(body.image)) return sendJson(response, 400, {error:'INVALID_IMAGE'});
      if (typeof body.question !== 'string' || !body.question.trim() || body.question.length > 800) return sendJson(response, 400, {error:'INVALID_QUESTION'});
      const history = Array.isArray(body.history) ? body.history.slice(-8).filter(item => ['user','assistant'].includes(item?.role) && typeof item.text === 'string').map(item => ({role:item.role,text:item.text.slice(0,700)})) : [];
      const raw = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {};
      const context = Object.fromEntries(['scene','summary','subject','stylePreference','appliedStyle','currentAdjustments','hasEdits','tasteProfile','reviewConclusion','preservedParts','currentCrop','originalDimensions','adjustmentSources'].map(key => [key,JSON.stringify(raw[key] ?? '').slice(0,1000)]));
      context.currentAdjustments=reviewContext({settings:raw.currentAdjustments}).settings;
      context.creativeIntent=cleanIntent(raw.creativeIntent);
      if(raw.document){if(JSON.stringify(raw.document).length>1024*1024)return sendJson(response,400,{error:'INVALID_DOCUMENT'});context.document=validateDocument(raw.document);context.scopeStepId=typeof raw.scopeStepId==='string'?raw.scopeStepId:null;}
      if(raw.projectId){if(cloudDeployment||!canAccessLocalFiles(request,false))throw new VisionError('FORBIDDEN_ORIGIN','文件项目上下文仅在本机可用。',{status:403});const project=await projects.get(raw.projectId);if(project.revision!==raw.projectRevision||context.document&&documentHash(project.documentContext)!==documentHash(context.document))throw new VisionError('STALE_REVISION','项目已变化，请重新读取后提问。',{status:409});context.diagnosis=project.diagnosis;context.methodCapabilities=project.capabilities;}
      context.photoReference=validPhotoMetering(raw.photoReference);
      context.annotations = Array.isArray(raw.annotations) ? raw.annotations.slice(0,8).map((item,index) => ({
        id:typeof item?.id==='string'&&/^[-a-zA-Z0-9_]{1,80}$/.test(item.id)?item.id:'',number:index+1,
        rect:Object.fromEntries(['x','y','width','height'].map(key => [key,Number.isFinite(item?.rect?.[key]) ? Math.max(0,Math.min(1,item.rect[key])) : 0])),
        exclude:Array.isArray(item?.exclude)?item.exclude.slice(0,8).filter(r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))).map(r=>Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.max(0,Math.min(1,r[k]))]))):[],
        maskType:['rectangle','linear','radial','brush'].includes(item?.maskType) ? item.maskType:'rectangle',
        localEnabled:item?.localEnabled!==false,feather:Number.isFinite(item?.feather)?Math.max(0,Math.min(1,item.feather)):.36,
        currentAdjustments:item?.currentAdjustments && typeof item.currentAdjustments==='object' ? Object.fromEntries(agentAdjustmentKeys.map(key=>[key,Number(item.currentAdjustments[key])||0])):{},
        amount:Number.isFinite(item?.amount) ? Math.max(0,Math.min(150,item.amount)):100,
        note:typeof item?.note === 'string' ? item.note.slice(0,300) : ''
      })) : [];
      context.focusAnnotation = Number.isInteger(raw.focusAnnotation) && raw.focusAnnotation >= 1 && raw.focusAnnotation <= context.annotations.length ? raw.focusAnnotation : null;
      if(body.sessionKey!==undefined && (typeof body.sessionKey!=='string'||!/^[-a-zA-Z0-9_:]{1,160}$/.test(body.sessionKey)))return sendJson(response,400,{error:'INVALID_SESSION'});
      const signal=cancelOnDisconnect(response),stream=!cloudDeployment && request.headers.accept?.includes('application/x-ndjson');
      const emit=event=>{if(!response.destroyed&&!response.writableEnded)response.write(JSON.stringify(event)+'\n');};
      if(stream)response.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
      try {
        const answer=await converseWithDesignAgent({image:body.image,question:body.question.trim(),history,context,signal,
          sessionKey:body.sessionKey?'photo:'+body.sessionKey:undefined,tier:body.tier || 'auto',onEvent:stream?emit:undefined});
        if(stream){emit({type:'result',value:{answer}});response.end();return;}
        return sendJson(response,200,{answer});
      }catch(error){
        if(!stream)throw error;
        const failure=error instanceof VisionError?error:new VisionError('VISION_REQUEST_FAILED','视觉对话未完成，请重试。',{retryable:true});
        emit({type:'error',error:failure.toJSON()});response.end();return;
      }
    } catch (error) {
      return sendVisionFailure(response,error);
    }
  }
  if (url.pathname === '/api/reassess' && request.method === 'POST') {
    if (!vision.isConfigured()) return sendJson(response,503,{error:new VisionError('AI_NOT_CONFIGURED','尚未连接视觉审片。当前只能测量本地光色，不识别照片内容。',{status:503}).toJSON()});
    try {
      const body = await readJson(request, 16_000_000);
      const imagePattern = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
      if (typeof body.original !== 'string' || typeof body.edited !== 'string' || !imagePattern.test(body.original) || !imagePattern.test(body.edited)) return sendJson(response, 400, {error:'INVALID_IMAGE'});
      return sendJson(response, 200, await reassessWithAI(body.original, body.edited,cancelOnDisconnect(response),cleanIntent(body.creativeIntent),reviewContext(body.context),reviewBaseline(body.baseline)));
    } catch (error) {
      return sendVisionFailure(response,error);
    }
  }
  if (url.pathname === '/api/export' && request.method === 'POST') {
    try {
      const allowedOrigins = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
      if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) return sendJson(response, 403, {error:'FORBIDDEN_ORIGIN'});
      const form = new URLSearchParams((await readBody(request, 80_000_000)).toString('utf8'));
      const image = form.get('image');
      const match = image?.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return sendJson(response, 400, {error:'INVALID_IMAGE'});
      const format = match[1];
      const bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > 60_000_000) return sendJson(response, 413, {error:'IMAGE_TOO_LARGE'});
      const validJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
      const validPng = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.subarray(-8).equals(Buffer.from([73,69,78,68,174,66,96,130]));
      if (format === 'jpeg' ? !validJpeg : !validPng) return sendJson(response, 400, {error:'INVALID_IMAGE'});
      const extension = format === 'png' ? 'png' : 'jpg';
      const filename = `${(form.get('filename') || 'photo-帧好精修').replace(/[\r\n/\\]/g, '_').replace(/\.(jpg|jpeg|png)$/i,'').slice(0, 112)}.${extension}`;
      response.writeHead(200, {
        'Content-Type':format === 'png' ? 'image/png' : 'image/jpeg',
        'Content-Disposition':`attachment; filename="edited-photo.${extension}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`,
        'Content-Length':bytes.length,
        'Cache-Control':'no-store'
      });
      return response.end(bytes);
    } catch (error) {
      console.error('Export failed:', error);
      return sendJson(response, error.status || 500, {error:'EXPORT_FAILED'});
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, {error:'METHOD_NOT_ALLOWED'});
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = resolve(publicDir, `.${requestedPath}`);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + sep)) return sendJson(response, 403, {error:'FORBIDDEN'});
  try {
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) throw new Error('Not a file');
    const file = await readFile(filePath);
    response.writeHead(200, {'Content-Type':mime[extname(filePath)] || 'application/octet-stream','Cache-Control':['.html','.js','.css'].includes(extname(filePath)) ? 'no-cache' : 'public, max-age=3600'});
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch { sendJson(response, 404, {error:'NOT_FOUND'}); }
}

export function closeServices(){vision.close();projects.close();collections.close();}
