import test from 'node:test';import assert from 'node:assert/strict';
import {buildDraftWorkspace,restoreDraftPhoto} from '../../apps/studio/public/draft-store.js';
const photo=()=>({id:'photo-2',isDemo:false,originalBlob:new Blob(['original bytes'],{type:'image/png'}),imageName:'人物',active:new Set(['light']),manual:{exposure:.12},crop:{x:.1,y:0,width:.8,height:1},annotations:[{id:'note-1',note:'保留肤色',rect:{x:.2,y:.2,width:.2,height:.2}}],advisorLayers:[{id:'a',settings:{saturation:-5}}],history:{past:[{active:[],manual:{exposure:0},annotations:[]}],future:[]},conversation:[{role:'assistant',text:'轻调',id:'a',applied:true}],exported:true,acceptedSignature:'accepted',versions:[{kind:'manual',label:'保留气氛',snapshot:{active:[],manual:{exposure:.12},annotations:[]}}]});
test('unsynchronized file edits keep a browser recovery copy until the project confirms saving',async()=>{
  const source={...photo(),projectId:'project',projectPending:true,sourceOriginalBlob:new Blob(['raw JPEG bytes'],{type:'image/jpeg'}),originalFileName:'original.jpg'};
  const pending=buildDraftWorkspace('draft',[source],source.id);assert.equal(pending.photos.length,1);
  const recovered=restoreDraftPhoto(pending.photos[0]);assert.equal(recovered.manual.exposure,.12);assert.equal(recovered.versions[0].label,'保留气氛');assert.equal(recovered.projectId,undefined);
  assert.equal(await recovered.sourceOriginalBlob.text(),'raw JPEG bytes');assert.equal(recovered.originalFileName,'original.jpg');
  source.projectPending=false;assert.equal(buildDraftWorkspace('draft',[source],source.id).photos.length,0);
});
test('drafts recover original bytes, crop, notes, sources, history and lifecycle states',async()=>{
  const original=photo(),workspace=buildDraftWorkspace('draft',[original,{...photo(),isDemo:true}],'photo-2');
  assert.equal(workspace.photos.length,1);
  const restored=restoreDraftPhoto(workspace.photos[0]);
  assert.equal(await workspace.photos[0].originalBlob.text(),'original bytes');
  assert.deepEqual([...restored.active],['light']);assert.equal(restored.crop.width,.8);assert.equal(restored.annotations[0].note,'保留肤色');
  assert.equal(restored.advisorLayers[0].settings.saturation,-5);assert.equal(restored.history.past.length,1);assert.equal(restored.versions[0].label,'保留气氛');assert.equal(restored.exported,true);assert.equal(restored.acceptedSignature,'accepted');
  original.annotations[0].note='later edit';assert.equal(restored.annotations[0].note,'保留肤色');
  assert.equal('image' in workspace.photos[0],false);assert.equal('previewData' in workspace.photos[0],false);
});
test('damaged source cannot masquerade as a recoverable draft; missing optional old fields are safe',()=>{
  const saved=buildDraftWorkspace('draft',[photo()],'photo-2').photos[0];
  assert.throws(()=>restoreDraftPhoto({...saved,originalBlob:null}),/不完整/);
  assert.throws(()=>restoreDraftPhoto({...saved,history:{past:[{manual:{}}]}}),/历史记录不完整/);
  const restored=restoreDraftPhoto({...saved,advisorLayers:undefined,history:undefined});
  assert.deepEqual(restored.advisorLayers,[]);assert.deepEqual(restored.history.past,[]);
});
test('advisor drafts and focus follow their photo, and older saved workspaces restore safely',()=>{
  const original=photo();original.agentDraft='继续讨论这里的光线';original.agentFocusId='note-1';
  const saved=buildDraftWorkspace('draft',[original],'photo-2').photos[0];
  const restored=restoreDraftPhoto(saved);assert.equal(restored.agentDraft,original.agentDraft);assert.equal(restored.agentFocusId,'note-1');
  const older=restoreDraftPhoto({...saved,agentDraft:undefined,agentFocusId:'removed'});assert.equal(older.agentDraft,'');assert.equal(older.agentFocusId,null);
});
test('an interrupted advisor request restores its question with an honest continuation state',()=>{
  const original=photo();original.conversation.push({role:'user',text:'请结合最新批注再看一次'});
  const saved=buildDraftWorkspace('draft',[original],'photo-2').photos[0];
  const restored=restoreDraftPhoto(saved);assert.equal(restored.conversation.at(-1).role,'status');
  assert.equal(restored.conversation.at(-1).requestQuestion,'请结合最新批注再看一次');
  assert.match(restored.conversation.at(-1).text,/未完成/);
  assert.equal(saved.conversation.at(-1).role,'user');
  const again=restoreDraftPhoto({...saved,conversation:restored.conversation});assert.equal(again.conversation.length,restored.conversation.length);
});

test('named snapshots retain crop angle, feather, brush path and disabled local effect independently',()=>{
 const original=photo();original.crop.angle=4;original.annotations[0]={...original.annotations[0],maskType:'brush',points:[{x:.25,y:.25},{x:.3,y:.3}],brushRadius:.04,feather:.7,localEnabled:false,localSettings:{exposure:.2}};
 original.versions[0].snapshot.annotations=structuredClone(original.annotations);
 const saved=buildDraftWorkspace('draft',[original],'photo-2').photos[0],restored=restoreDraftPhoto(saved);
 assert.equal(restored.crop.angle,4);assert.equal(restored.annotations[0].localEnabled,false);assert.equal(restored.versions[0].snapshot.annotations[0].feather,.7);
 original.annotations[0].points[0].x=.8;assert.equal(restored.versions[0].snapshot.annotations[0].points[0].x,.25);
 const invalid=structuredClone(saved);invalid.annotations[0].points[0].x=2;assert.throws(()=>restoreDraftPhoto(invalid),/不完整/);
});
