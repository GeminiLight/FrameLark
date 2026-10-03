import test from 'node:test';
import assert from 'node:assert/strict';
import {globalAdjustments,effectiveAnnotations,remainingAdjustments,adjustmentSignature} from '../../public/adjustment-layers.js';
import {presetById} from '../../public/presets.js';
import {localDesignReply} from '../../public/design-agent.js';

test('removing one source preserves other suggestions, style, advisor and manual values',()=>{
  const input={manual:{exposure:.1,saturation:-4},recommendations:[{id:'light',adjustments:{exposure:.2}},{id:'color',adjustments:{saturation:8}}],active:new Set(['light','color']),preset:presetById('open-road'),amount:60,advisorLayers:[{id:'advice',settings:{shadows:7}}]};
  const both=globalAdjustments(input),removed=globalAdjustments({...input,active:new Set(['color'])});
  assert.ok(Math.abs(both.exposure-removed.exposure-.2)<1e-10);
  for(const key of Object.keys(removed)) if(key!=='exposure') assert.equal(removed[key],both[key]);
  assert.deepEqual(globalAdjustments({...input,active:new Set(['light','light','color'])}),both);
  assert.equal(input.manual.exposure,.1);
});
test('regional advisor layers are applied once, and withdrawal preserves manual region adjustments',()=>{
  const notes=[{id:'note-1',rect:{x:.1,y:.1,width:.3,height:.3},localSettings:{shadows:5},localAmount:70}];
  const advice=[{id:'a',annotationId:'note-1',settings:{exposure:.08,shadows:12}},{id:'b',settings:{exposure:.2}}];
  const current=effectiveAnnotations(notes,advice)[0];
  assert.equal(current.localSettings.shadows,17);assert.equal(current.localSettings.exposure,.08);assert.equal(current.localAmount,70);
  assert.equal(effectiveAnnotations(notes,[])[0].localSettings.shadows,5);
  assert.equal(globalAdjustments({advisorLayers:advice}).exposure,.2);
});
test('a local guide does not compensate the same original exposure or saturation twice',()=>{
  assert.equal(remainingAdjustments({exposure:.2,saturation:10},{exposure:.3,saturation:10}).exposure,0);
  const context={analysis:{summary:'暗部可读性需要确认',recommendations:[{id:'light',reason:'轻提阴影',adjustments:{exposure:.2,shadows:20}}]},currentAdjustments:{exposure:.2,shadows:20}};
  assert.equal(localDesignReply('更亮一点',context).action.kind,'none');
  assert.equal(localDesignReply('更亮一点',{...context,currentAdjustments:{exposure:.1,shadows:10}}).action.kind,'adjustment');
});
test('proposal freshness includes crop, region strength and user note changes',()=>{
  const note={id:'1',rect:{x:0,y:0,width:.2,height:.2},localSettings:{shadows:10},localAmount:100,note:'太暗'};
  const signature=adjustmentSignature({exposure:.2},null,[note]);
  assert.notEqual(signature,adjustmentSignature({exposure:.2},null,[{...note,localAmount:50}]));
  assert.notEqual(signature,adjustmentSignature({exposure:.2},null,[{...note,note:'太亮'}]));
});

test('local geometry and enable changes invalidate proposals while note-only changes do not invalidate an exported edition',()=>{
 const region={id:'r',rect:{x:.1,y:.1,width:.3,height:.3},localSettings:{exposure:.1},note:'first'};
 const a=adjustmentSignature({},null,[region]);assert.notEqual(a,adjustmentSignature({},null,[{...region,feather:.8}]));assert.notEqual(a,adjustmentSignature({},null,[{...region,localEnabled:false}]));
 assert.equal(adjustmentSignature({},null,[region],{includeNotes:false}),adjustmentSignature({},null,[{...region,note:'second'}],{includeNotes:false}));
});

test('disabled or zero-strength local edits are stored, but no longer count as a visible effect',async()=>{
 const {hasLocalEffects}=await import('../../public/adjustment-layers.js');
 const item={id:'x',rect:{x:0,y:0,width:1,height:1},localSettings:{exposure:.2}};
 assert.equal(hasLocalEffects([item]),true);assert.equal(hasLocalEffects([{...item,localEnabled:false}]),false);assert.equal(hasLocalEffects([{...item,localAmount:0}]),false);
 assert.equal(hasLocalEffects([{...item,localSettings:null}],[{annotationId:'x',settings:{shadows:10}}]),true);
});
