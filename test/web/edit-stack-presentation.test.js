import test from 'node:test';
import assert from 'node:assert/strict';
import {parameterSections,changedParameterCount} from '../../apps/studio/public/edit-stack-view.js';
import {pixelCapabilities} from '../../apps/studio/public/edit-stack/tools.js';

test('folding parameters retains every executable field exactly once',()=>{
  for(const tool of pixelCapabilities().tools){
    const sections=parameterSections(tool),fields=sections.flatMap(section=>section.keys);
    assert.deepEqual([...fields].sort(),Object.keys(tool.parameters.properties).sort(),tool.id);
    assert.equal(new Set(fields).size,fields.length,tool.id);
    assert.equal(changedParameterCount(tool.defaults,tool,fields),0,tool.id);
  }
  const custom={id:'custom',parameters:{properties:{amount:{type:'number'},mode:{type:'string'}}}};
  assert.deepEqual(parameterSections(custom),[{id:'basic',keys:['amount','mode']}]);
});

test('collapsed curve and color controls report actual non-default adjustments',()=>{
  const tone=pixelCapabilities().tools.find(tool=>tool.id==='tone'),color=pixelCapabilities().tools.find(tool=>tool.id==='color');
  const curve=parameterSections(tone).find(section=>section.id==='curve'),mix=parameterSections(color).find(section=>section.id==='color-mix');
  assert.equal(changedParameterCount({...tone.defaults,contrast:9},tone,curve.keys),0);
  assert.equal(changedParameterCount({...tone.defaults,curveShadows:-9},tone,curve.keys),1);
  assert.equal(changedParameterCount({...color.defaults,orangeHue:5,blueLuminance:-4},color,mix.keys),2);
});
