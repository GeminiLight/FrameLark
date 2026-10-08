import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createPhotoRequests} from '../../apps/studio/public/photo-requests.js';
import {normalizeDesignReply} from '../../apps/studio/public/design-agent.js';
import {readVisionStream} from '../../apps/studio/public/vision-stream.js';
import {createDocument} from '../../apps/studio/public/edit-stack/document.js';
import {applyCommands} from '../../apps/studio/public/edit-stack/commands.js';
import {renderHash} from '../../apps/studio/public/edit-stack/identity.js';
import {snapshotAnnotations,annotationsChanged} from '../../apps/studio/public/advisor-context.js';

const source=await readFile(new URL('../../apps/studio/public/app.js',import.meta.url),'utf8');
const start=source.indexOf('async function askDesignAgent('),actualFunction=source.slice(start,source.indexOf('\nfunction cancelAdvisor()',start));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const reply=()=>new Response(JSON.stringify({answer:{reply:'A 的确定性回复',principle:'协议夹具',clarification:{question:'',choices:[]},action:{kind:'none'}}}),{headers:{'Content-Type':'application/json'}});

// Execute the real advisor coordinator; browser rendering and project transport
// are controlled adapters so the awaited save can be held at a precise boundary.
function fixture(t,{transport=async()=>reply()}={}){
  const flush=deferred(),atFlush=deferred(),sent=[];
  const a={id:'A',projectId:'project-A',projectRevision:3,conversation:[],advisorLayers:[],agentDraft:'A 的未发送输入'},b={id:'B',conversation:[],advisorLayers:[],agentDraft:'B 的未发送输入'};
  const requests=createPhotoRequests({setTimer:()=>1,clearTimer(){}});t.after(()=>requests.cancelAll());
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'standard',open:false,textContent:''});return nodes.get(id);};
  const document=createDocument({documentId:'doc-A',source:{assetId:'image-A',contentHash:'a'.repeat(64),width:64,height:48},base:{settings:{},locals:[]}});
  const context={crypto,AbortController,Date,JSON,Math,Number,structuredClone,document:{querySelector:()=>null},photoSessions:[a,b],currentPhotoId:a.id,
    state:{editDocument:document,analysis:{scene:'A夹具',summary:'A'},creativeIntent:'A 的目标',annotations:[],advisorLayers:[],stylePreference:'natural',image:{naturalWidth:64,naturalHeight:48},aiAvailable:true},
    advisorRequests:requests,finishAnnotationNote(){},cleanIntent:v=>String(v||''),snapshotAnnotations,summarizeTaste:()=>({count:0}),tasteRecords:[],collectionRanking:()=>[{preset:{id:'fixture'}}],annotationRegionStats:()=>({}),getAdjustments:()=>({}),photoMetering:()=>({}),renderCurrentPixels:p=>p,currentPreviewPixels:()=>({data:new Uint8ClampedArray(4),width:1,height:1}),subjectLabel:()=> '夹具',hasEdits:()=>false,reviewPresentation:()=>({preserved:[]}),scheduleDraftSave(){},renderAgent(){},$:node,
    normalizeDesignReply,readVisionStream,canPreviewAdvisorResult:()=>false,workspaceSpace:'studio',studioTab:'suggestions',annotationsChanged,showToast(){},
    editStack:{ensure:async()=>document},projectWorkspace:{flush:async()=>{atFlush.resolve();await flush.promise;}},
    fetch:async(_url,options)=>{const payload=JSON.parse(options.body);sent.push(payload);return transport(payload,options);}
  };
  context.currentPhoto=()=>context.photoSessions.find(photo=>photo.id===context.currentPhotoId);
  context.currentEffectSignature=()=>renderHash(context.state.editDocument);context.renderedAnnotations=()=>context.state.annotations;
  context.currentAgentPreview=()=>`preview-of-${context.currentPhotoId}`;
  vm.createContext(context);vm.runInContext(actualFunction,context);
  return {a,b,context,requests,sent,atFlush:atFlush.promise,finishFlush:flush.resolve};
}

test('switching photos during project save never sends the new photo with the old project context',async t=>{
  const env=fixture(t),pending=env.context.askDesignAgent('检查 A 的暗部');await env.atFlush;
  env.context.currentPhotoId='B';env.finishFlush();await pending;
  assert.equal(env.sent.length,0,'the request has not started and its photo is no longer selected');
  assert.equal(env.context.currentPhotoId,'B');assert.equal(env.a.conversation[0].text,'检查 A 的暗部');assert.equal(env.b.agentDraft,'B 的未发送输入');assert.equal(env.a.agentBusy,false);
});

test('cancelling during project save never starts a model request afterwards',async t=>{
  const env=fixture(t),pending=env.context.askDesignAgent('检查 A');await env.atFlush;
  env.requests.cancel('A');env.a.agentBusy=false;env.finishFlush();await pending;
  assert.equal(env.sent.length,0);assert.equal(env.a.conversation[0].text,'检查 A');
});
for(const change of ['effect','intent','annotations'])test(`a changed ${change} during the save cannot be mixed with the captured advisor context`,async t=>{
  const env=fixture(t),pending=env.context.askDesignAgent('检查 A');await env.atFlush;
  if(change==='effect')env.context.state.editDocument=applyCommands(env.context.state.editDocument,[{type:'AddStep',step:{id:'light',title:'提亮',tool:'exposure',toolVersion:2,parameters:{ev:.4}}}]).next;
  if(change==='intent')env.context.state.creativeIntent='保留低调光线';
  if(change==='annotations')env.context.state.annotations=[{id:'note',note:'改为保留这里',rect:{x:0,y:0,width:.2,height:.2}}];
  env.finishFlush();await pending;assert.equal(env.sent.length,0);assert.equal(env.a.conversation[0].text,'检查 A');
});
test('a metadata-only save still sends the unchanged photo and context at the new project revision',async t=>{
  const env=fixture(t),pending=env.context.askDesignAgent('检查 A');await env.atFlush;
  env.a.projectRevision++;env.finishFlush();await pending;
  assert.equal(env.sent.length,1);assert.equal(env.sent[0].image,'preview-of-A');assert.equal(env.sent[0].context.projectRevision,4);assert.equal(env.a.conversation.at(-1).text,'A 的确定性回复');
});

test('an already started request still delivers only to its original photo after switching',async t=>{
  const answer=deferred(),started=deferred(),env=fixture(t,{transport:async()=>{started.resolve();return answer.promise;}});
  const pending=env.context.askDesignAgent('检查 A');await env.atFlush;env.finishFlush();await started.promise;
  env.context.currentPhotoId='B';answer.resolve(reply());await pending;
  assert.equal(env.sent.length,1);assert.equal(env.sent[0].image,'preview-of-A');assert.equal(env.sent[0].context.projectId,'project-A');
  assert.equal(env.a.conversation.at(-1).text,'A 的确定性回复');assert.equal(env.b.conversation.length,0);assert.equal(env.b.agentDraft,'B 的未发送输入');assert.equal(env.context.currentPhotoId,'B');
});
