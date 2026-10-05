import test from 'node:test';
import assert from 'node:assert/strict';
import {bindActivePhotoState} from '../../apps/studio/public/photo-state.js';
import {photoSnapshot} from '../../apps/studio/public/batch-edits.js';
import {neutralSettings} from '../../apps/studio/public/editor-engine.js';

const photo=(id)=>({id,manual:neutralSettings(),active:new Set(),advisorLayers:[],annotations:[],crop:null,presetId:null,presetAmount:75,creativeIntent:'',analysis:null});

test('editing the active photo is immediately visible to snapshots without a copy/save step',()=>{
  const a=photo('a'),b=photo('b');let active=a;
  const editor=bindActivePhotoState({loading:false,manual:neutralSettings(),creativeIntent:''},()=>active);
  editor.manual.exposure=.35;editor.crop={x:.1,y:.1,width:.8,height:.8};editor.creativeIntent='保留安静';
  assert.deepEqual(photoSnapshot(a),photoSnapshot(editor));assert.equal(a.creativeIntent,'保留安静');
  active=b;editor.manual.exposure=-.2;
  assert.equal(a.manual.exposure,.35);assert.equal(b.manual.exposure,-.2);
  active=a;assert.equal(editor.manual.exposure,.35);assert.equal(editor.creativeIntent,'保留安静');
});

test('a background update stays on its photo and becomes visible when that photo is selected',()=>{
  const a=photo('a'),b=photo('b');let active=a;
  const editor=bindActivePhotoState({loading:false},()=>active);
  b.manual={...neutralSettings(),exposure:.4};b.analysis={conclusion:'保留'};
  assert.equal(editor.manual.exposure,0);assert.equal(editor.analysis,null);
  active=b;assert.equal(editor.manual.exposure,.4);assert.equal(editor.analysis.conclusion,'保留');
  b.manual={...neutralSettings(),exposure:.2};assert.equal(editor.manual.exposure,.2);
});

test('clearing the workspace and changing UI flags do not mutate the previous photograph',()=>{
  const a=photo('a');let active=a;
  const editor=bindActivePhotoState({loading:false,manual:neutralSettings(),image:null},()=>active);
  editor.manual.exposure=.3;active=null;editor.manual=neutralSettings();editor.loading=true;
  assert.equal(a.manual.exposure,.3);assert.equal(a.loading,undefined);assert.equal(editor.image,null);
  active=a;assert.equal(editor.manual.exposure,.3);assert.equal(editor.loading,true);
});

test('a captured export/version snapshot remains independent of later edits and selection changes',()=>{
  const a=photo('a'),b=photo('b');let active=a;
  const editor=bindActivePhotoState({},()=>active);editor.manual.exposure=.1;
  const saved=photoSnapshot(editor);editor.manual.exposure=.4;active=b;editor.manual.exposure=-.3;
  assert.equal(saved.manual.exposure,.1);assert.equal(a.manual.exposure,.4);assert.equal(b.manual.exposure,-.3);
});
