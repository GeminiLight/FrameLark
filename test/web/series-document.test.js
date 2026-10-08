import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as series from '../../apps/studio/public/photo-series.js';
const {seriesCandidate}=series;
import {createDocument} from '../../apps/studio/public/edit-stack/document.js';
import {applyCommands} from '../../apps/studio/public/edit-stack/commands.js';
import {renderPhotoPixels} from '../../apps/studio/public/photo-rendering.js';
import {photoSnapshot,snapshotSettings} from '../../apps/studio/public/batch-edits.js';
import {neutralSettings} from '../../apps/studio/public/editor-engine.js';
import {cleanIntent} from '../../apps/studio/public/creative-intent.js';

const photo=()=>({id:'A',manual:neutralSettings(),active:new Set(),annotations:[],advisorLayers:[],analysis:{recommendations:[]},crop:null,presetId:null,presetAmount:75,conversation:[],
  editDocument:applyCommands(createDocument({documentId:'A',source:{assetId:'A',contentHash:'a'.repeat(64),width:2,height:2},base:{settings:{},locals:[]}}),[
    {type:'AddStep',step:{id:'existing',title:'保留现有曝光',tool:'exposure',toolVersion:2,parameters:{ev:.4}}}
  ]).next});
const review=(changes=[],presetId='none')=>({title:'安静组图',sharedStyle:{presetId,amount:35},photos:[{id:'A',changes}]});
const pixels=new Uint8ClampedArray([55,60,70,255,80,70,65,255,105,90,80,255,120,100,85,255]);
const render=snapshot=>renderPhotoPixels({pixels,width:2,height:2,document:snapshot.editDocument,settings:snapshotSettings(snapshot),annotations:snapshot.annotations,crop:snapshot.crop});

test('series deltas change document pixels through replayable steps and preserve the existing recipe',()=>{
  const original=photo(),before=structuredClone(original.editDocument);
  const trial=seriesCandidate(original,review([{key:'exposure',value:.2},{key:'highlights',value:-8}]),{layerId:'series-trial'});
  assert.notDeepEqual(render(trial.candidate),render(trial.before),'accepted series deltas must reach the same document renderer as single-photo editing');
  assert.ok(trial.commands?.length,'document series edits must use the existing command persistence boundary');
  assert.deepEqual(applyCommands(before,trial.commands).next,trial.candidate.editDocument);
  assert.deepEqual(trial.candidate.editDocument.steps[0],before.steps[0]);
  assert.deepEqual(original.editDocument,before);
  assert.deepEqual(trial.candidate.advisorLayers,trial.before.advisorLayers,'document changes cannot hide in ignored legacy layers');
});

test('document series preservation and optional styles keep the same current pixels',()=>{
  const original=photo(),trial=seriesCandidate(original,review());
  assert.deepEqual(trial.candidate,trial.before);
  assert.deepEqual(render(trial.candidate),render(trial.before));
  const styled=seriesCandidate(original,review([{key:'shadows',value:5}],'daily-soft'));
  assert.ok(styled.commands?.some(c=>c.type==='AddGroup'));
  assert.deepEqual(applyCommands(original.editDocument,styled.commands).next,styled.candidate.editDocument);
  const noStyle=seriesCandidate(original,review([{key:'shadows',value:5}],'daily-soft'),{useStyle:false});
  assert.equal(noStyle.candidate.editDocument.groups.length,original.editDocument.groups.length);
});

test('series image preparation supplies the exact document used by editor and export',async()=>{
  const source=await readFile(new URL('../../apps/studio/public/series-workspace.js',import.meta.url),'utf8');
  const start=source.indexOf('  async function pixels('),end=source.indexOf('\n  async function renderGallery(',start);
  assert.ok(start>=0&&end>start);
  let submitted;
  const canvas={width:0,height:0,getContext:()=>({getImageData:()=>({data:pixels}),putImageData(){}})};
  const context={document:{createElement:()=>canvas},cropPixelRect:()=>({x:0,y:0,width:2,height:2}),drawPhotoSource(){},snapshotSettings,
    effectiveAnnotations:annotations=>annotations,renderer:{render:async job=>{submitted=job;return renderPhotoPixels(job);}},ImageData:class {},Math};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const original=photo();original.image={naturalWidth:2,naturalHeight:2};const snapshot=photoSnapshot(original);
  await context.pixels(original,snapshot,800);
  assert.deepEqual(submitted.document,snapshot.editDocument,'model images and gallery previews must include all saved steps');
  assert.deepEqual(renderPhotoPixels(submitted),render(snapshot));
});

test('browser series excludes projects whose current effects or unsaved native input require the shared collection editor',()=>{
  assert.equal(typeof series.seriesPhotos,'function');
  const browser=photo(),supported={...photo(),id:'supported',projectId:'p',projectData:{supported:true}},native={...supported,id:'native',preferNativeEditor:true},advanced={...supported,id:'advanced',projectData:{supported:false}},pending={...supported,id:'pending',projectNativePending:true};
  const photos=[browser,supported,native,advanced,pending];
  assert.deepEqual(series.seriesPhotos(photos),[browser,supported]);
  assert.equal(photos.length,5,'the source workspace and native projects remain available');
});

test('series acceptance waits for persistence before claiming the group is applied',async()=>{
  const source=await readFile(new URL('../../apps/studio/public/series-workspace.js',import.meta.url),'utf8');
  const start=source.indexOf("  $('series-accept').addEventListener('click'"),end=source.indexOf("\n  $('series-export').addEventListener",start);
  let listener,release,started;const gate=new Promise(r=>release=r),atSave=new Promise(r=>started=r),nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:''});return nodes.get(id);};
  const p=photo(),value=review([{key:'exposure',value:.2}]);node('series-export').disabled=true;
  const context={review:value,renderReady:true,accepted:false,accepting:false,generation:1,viewGeneration:1,base:'same',saved:{},members:()=>[p],seriesSignature:()=> 'same',seriesCandidate,
    $:node,crypto,dialog:{open:true,querySelector:()=>({textContent:''})},onAccept:async()=>{started();await gate;},status(){},notify(){},render(){},invalidate(){}};
  node('series-accept').addEventListener=(_event,fn)=>listener=fn;
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const pending=listener();await atSave;
  assert.equal(context.accepted,false,'a pending disk save is not a completed application');
  assert.equal(node('series-accept').disabled,true,'a double click cannot submit a second application');
  assert.equal(node('series-export').disabled,true);
  release();await pending;assert.equal(context.accepted,true);assert.equal(node('series-export').disabled,false);
});

for(const change of ['redraw','close'])test(`a pending series application keeps ownership across ${change}`,async()=>{
  const source=await readFile(new URL('../../apps/studio/public/series-workspace.js',import.meta.url),'utf8');
  const start=source.indexOf("  $('series-accept').addEventListener('click'"),end=source.indexOf("\n  $('series-export').addEventListener",start);
  let listener,release,started;const gate=new Promise(r=>release=r),atSave=new Promise(r=>started=r),nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:''});return nodes.get(id);};
  const context={review:review([{key:'exposure',value:.2}]),renderReady:true,accepted:false,accepting:false,generation:1,viewGeneration:1,base:'same',saved:{},members:()=>[photo()],seriesSignature:()=> 'same',seriesCandidate,
    $:node,crypto,dialog:{open:true,querySelector:()=>({textContent:''})},onAccept:async()=>{started();await gate;},status(){},notify(){},render(){},invalidate(){}};
  node('series-accept').addEventListener=(_event,fn)=>listener=fn;vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const pending=listener();await atSave;context.generation++;
  if(change==='close'){context.viewGeneration++;context.dialog.open=false;}
  release();await pending;assert.equal(context.accepted,change==='redraw','redrawing the same group is not a new application context');
  assert.equal(context.accepting,false);
});

test('the studio persists document series commands through the existing owned-photo edit controller',async()=>{
  const source=await readFile(new URL('../../apps/studio/public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  onAccept:',source.indexOf('const seriesWorkspace=')),end=source.indexOf('\n});',start);
  const p=photo();p.projectId='project-A';p.projectData={supported:true};p.projectCurrentId='before';const plan={photo:p,...seriesCandidate(p,review([{key:'exposure',value:.2}]))};
  // On the unfixed branch, supply the intended executable edit to isolate the
  // application boundary independently of the planner defect above.
  plan.commands ||= [{type:'AddStep',step:{id:'series-edit',title:'组图',tool:'exposure',toolVersion:2,parameters:{ev:.2}}}];
  const calls=[],context={photoSessions:[p],lastBatch:null,commitPhotoInputs(){},photoSnapshot,seriesPhotos:series.seriesPhotos,cleanIntent,crypto,structuredClone,editStack:{command:async(commands,owner)=>{calls.push(owner.id);owner.editDocument=applyCommands(owner.editDocument,commands).next;return true;}},
    commitPhotoSnapshot(owner,snapshot){Object.assign(owner,snapshot);return true;},snapshotAcceptanceSignature:()=> 'test-signature',scheduleDraftSave(){},renderPhotoTabs(){},showToast(){},JSON,Error};
  vm.createContext(context);vm.runInContext('applySeries='+source.slice(start+'  onAccept:'.length,end).trim(),context);
  await context.applySeries([plan]);
  assert.deepEqual(calls,['A'],'file-backed document edits must preserve the command retry and persistence contract');
  assert.equal(context.lastBatch[0].before.projectVersionId,'before','shared-version undo retains its saved baseline');
});

test('editing another photo target during a group save preserves completed work and stops the stale remaining edit',async()=>{
  const source=await readFile(new URL('../../apps/studio/public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  onAccept:',source.indexOf('const seriesWorkspace=')),end=source.indexOf('\n});',start);
  const a=photo(),b={...photo(),id:'B'},plans=[a,b].map(p=>({photo:p,...seriesCandidate(p,{...review([{key:'exposure',value:.2}]),photos:[{id:p.id,changes:[{key:'exposure',value:.2}]}]})}));
  let release,started;const gate=new Promise(r=>release=r),atSave=new Promise(r=>started=r),calls=[];
  const context={photoSessions:[a,b],lastBatch:null,commitPhotoInputs(){},photoSnapshot,seriesPhotos:series.seriesPhotos,cleanIntent,crypto,structuredClone,
    editStack:{command:async(commands,owner)=>{calls.push(owner.id);if(owner===a){started();await gate;}owner.editDocument=applyCommands(owner.editDocument,commands).next;return true;}},
    snapshotAcceptanceSignature:()=> 'test-signature',scheduleDraftSave(){},renderPhotoTabs(){},showToast(){},JSON,Error};
  vm.createContext(context);vm.runInContext('applySeries='+source.slice(start+'  onAccept:'.length,end).trim(),context);
  const pending=context.applySeries(plans);await atSave;b.creativeIntent='新的表达目标';release();
  await assert.rejects(pending,/更新/);
  assert.deepEqual(calls,['A']);assert.equal(context.lastBatch.length,1,'already saved work remains undoable');
  assert.deepEqual(b.editDocument,plans[1].before.editDocument);
});
