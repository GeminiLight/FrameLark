import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDraftAutosave} from '../../apps/studio/public/draft-autosave.js';

const source=await readFile(new URL('../../apps/website/public/app.js',import.meta.url),'utf8');
const saving=source.slice(source.indexOf('function scheduleDraftSave()'),source.indexOf('async function refreshDraftList()'));
const continuing=source.slice(source.indexOf('async function continueDraft(id)'),source.indexOf("$('#draft-status').addEventListener",source.indexOf('async function continueDraft(id)')));
const cleaning=source.slice(source.indexOf("$('#draft-items').addEventListener('click'"),source.indexOf("$('#cancel-draft-delete').addEventListener"));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// Exercise the actual website coordination functions. Browser decoding and
// storage failures are the adapter boundaries; no transition logic is copied.
function fixture({save=async()=>{},load=async()=>({}),setDeleted=async()=>{}}={}){
  const nodes=new Map(),writes=[],revoked=[],messages=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{open:false,addEventListener(_type,fn){this.handler=fn;},close(){this.open=false;}});return nodes.get(id);};
  const context={Blob,structuredClone,JSON,Math,Number,crypto,setTimeout:()=>1,clearTimeout(){},
    draftTimer:null,draftSaving:false,draftRequested:false,draftRestoring:false,draftTransition:false,draftDirty:false,draftFailed:false,draftSavedAt:'previous',draftListFailed:false,draftWorkspaceId:'current',draftVersion:1,
    importingFiles:false,state:{loading:false},editHistory:{},annotationNoteBefore:null,
    photoSessions:[{id:'photo-1',src:'blob:original',isDemo:false,manual:{exposure:.9},annotations:[]}],currentPhotoId:'photo-1',
    nextPhotoId:2,nextAnnotationId:1,analysisGeneration:0,reassessGeneration:0,analysisController:null,selectedPhotos:new Set(),lastBatch:null,
    analysisQueue:{releasePhoto(){}},exportQueue:{releasePhoto(){}},advisorRequests:{cancelAll(){}},finishAnnotationNote(){},finishRangeEdit(){},renderDraftStatus(){},saveCurrentPhoto(){},
    buildDraftWorkspace(id,photos){return {id,photos:structuredClone(photos),savedAt:'attempt'};},editSnapshot:()=>({}),seriesWorkspace:{draft(){},restore(){}},
    draftStore:{adopt(){},async save(snapshot){writes.push(snapshot);return save(snapshot);},async get(id){return {id,version:1,photos:[{id:'photo-2',originalBlob:new Blob(['other photo']),annotations:[],manual:{exposure:0}}],currentPhotoId:'photo-2',savedAt:'restored'};},setDeleted},
    showToast:message=>messages.push(message),restoreDraftPhoto:item=>({...item}),URL:{createObjectURL:()=> 'blob:other',revokeObjectURL:url=>revoked.push(url)},loadPhotoImage:load,cancelReassessment(){},$:node,refreshDraftList:async()=>{}
  };
  context.currentPhoto=()=>context.photoSessions.find(photo=>photo.id===context.currentPhotoId);
  context.setLoading=value=>{context.state.loading=value;};context.activatePhoto=id=>{context.currentPhotoId=id;};
  context.draftAutosave=createDraftAutosave({capture:()=>context.captureDraftSnapshot(),save:snapshot=>context.draftStore.save(snapshot),onState:context.renderDraftStatus,setTimer:()=>1,clearTimer(){}});
  vm.createContext(context);vm.runInContext(saving+'\n'+continuing+'\n'+cleaning,context);
  const status=()=>({...context.draftAutosave.status,dirty:context.draftAutosave.status.dirty||context.draftDirty,failed:context.draftAutosave.status.failed||context.draftFailed});
  const clean=()=>node('#draft-items').handler({target:{closest:()=>({dataset:{draftClean:'current'}})}});
  return {context,writes,revoked,messages,status,clean};
}

for(const code of ['STALE_DRAFT','QuotaExceededError'])test(`website draft switching preserves the current edit after ${code}`,async()=>{
  const env=fixture({save:async()=>{throw Object.assign(Error(code),{code});}});env.context.scheduleDraftSave();
  await env.context.continueDraft('other');
  assert.equal(env.context.photoSessions[0].id,'photo-1');assert.equal(env.context.photoSessions[0].manual.exposure,.9);assert.equal(env.context.draftWorkspaceId,'current');
  assert.equal(env.status().dirty,true);assert.equal(env.status().failed,true);assert.ok(!env.revoked.includes('blob:original'));
});

test('website switching awaits an already running write and stops when it fails',async()=>{
  const pending=deferred(),env=fixture({save:()=>pending.promise});env.context.scheduleDraftSave();
  const saving=env.context.flushDraftSave();await tick();let switched=false;
  const switching=env.context.continueDraft('other').then(()=>{switched=true;});await tick();
  assert.equal(switched,false);assert.equal(env.context.photoSessions[0].id,'photo-1');
  pending.reject(Error('storage failed'));await saving;await switching;assert.equal(env.context.photoSessions[0].id,'photo-1');
});

test('website switching saves background edits received while the target photo decodes',async()=>{
  const decoding=deferred(),env=fixture({load:()=>decoding.promise});env.context.scheduleDraftSave();
  const switching=env.context.continueDraft('other');await tick();
  env.context.photoSessions[0].manual.exposure=.7;env.context.scheduleDraftSave();decoding.resolve({});await switching;
  assert.deepEqual(env.writes.map(write=>write.photos[0].manual.exposure),[.9,.7]);assert.equal(env.context.photoSessions[0].id,'photo-2');
});

test('cleaning the current website draft stops before cleanup when saving fails',async()=>{
  let cleaned=0;const env=fixture({save:async()=>{throw Error('save failed');},setDeleted:async()=>{cleaned++;}});env.context.scheduleDraftSave();await env.clean();
  assert.equal(cleaned,0);assert.equal(env.context.draftWorkspaceId,'current');assert.equal(env.context.photoSessions[0].manual.exposure,.9);assert.equal(env.status().dirty,true);
});

test('a failed cleanup keeps the current website draft association',async()=>{
  const env=fixture({setDeleted:async()=>{throw Error('cleanup failed');}});env.context.scheduleDraftSave();await env.clean();
  assert.equal(env.context.draftWorkspaceId,'current');assert.equal(env.context.photoSessions[0].id,'photo-1');
});
