import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPixels} from '../../public/editor-engine.js';

const row = values => new Uint8ClampedArray(values.flatMap(value => [value,value,value,255]));
const values = pixels => Array.from({length:pixels.length/4},(_,i) => pixels[i*4]);
const deviation = list => { const mean=list.reduce((a,b)=>a+b,0)/list.length;return Math.sqrt(list.reduce((sum,value)=>sum+(value-mean)**2,0)/list.length); };

test('exposure works in linear light and retains a gradual highlight shoulder',() => {
  assert.ok(Math.abs(renderPixels(row([50]),1,1,{exposure:1})[0]-71) <= 3,'one EV in a dark tone is approximately twice the linear intensity');
  const ramp = row(Array.from({length:56},(_,i)=>200+i));
  const output = values(renderPixels(ramp,56,1,{exposure:.5}));
  assert.ok(new Set(output).size >= 25,'bright tones cannot all become a clipped white plateau');
  assert.ok(output.every((value,i)=>!i || value >= output[i-1]));
});

test('white balance preserves black and does not paint a color offset into shadows',() => {
  const source = new Uint8ClampedArray([0,0,0,255,12,12,12,255,128,128,128,255]);
  const output=renderPixels(source,3,1,{warmth:30,tint:10});
  assert.deepEqual([...output.slice(0,4)],[0,0,0,255]);
  assert.ok(output[6] > 0,'a warm adjustment must not erase the blue channel in dim neutral tones');
  assert.ok(output[8] > output[10]);
});

test('tone adjustments remain monotone and retain distinct shadow and highlight levels',() => {
  const source=row(Array.from({length:256},(_,i)=>i));
  for (const settings of [{highlights:-40},{shadows:35},{contrast:35},{shadows:30,highlights:-35,contrast:15},{curveShadows:25,curveHighlights:-25}]) {
    const out=values(renderPixels(source,256,1,settings));
    assert.ok(out.every((value,i)=>!i || value >= out[i-1]),JSON.stringify(settings));
    assert.ok(new Set(out.slice(8,65)).size >= 35,'keep readable dark gradations');
    assert.ok(new Set(out.slice(190,251)).size >= 30,'keep gradual highlights');
  }
});

test('sharpening and clarity do not create bright or dark halos around a hard edge',() => {
  const width=64,height=24,source=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) source.set([x<32?35:220,x<32?35:220,x<32?35:220,255],(y*width+x)*4);
  for(const settings of [{sharpen:50},{clarity:40},{sharpen:40,clarity:25,texture:20}]) {
    const out=values(renderPixels(source,width,height,settings));
    assert.ok(Math.min(...out) >= 35 && Math.max(...out) <= 220,'no overshoot beyond the two neighboring tones');
  }
});

test('denoising reduces flat-region noise while preserving a thin dark feature',() => {
  const width=80,height=48,source=new Uint8ClampedArray(width*height*4);
  let seed=9217;
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const noise=(seed/4294967296-.5)*24;
    const value=(x===39 || x===40 ? 48:138)+noise;
    source.set([value,value,value,255],(y*width+x)*4);
  }
  const output=renderPixels(source,width,height,{denoise:35});
  const flat=data=>Array.from({length:24*30},(_,i)=>data[((10+Math.floor(i/30))*width+5+i%30)*4]);
  assert.ok(deviation(flat(output)) < deviation(flat(source))*.8,'reduce random noise by at least 20%');
  const feature=Array.from({length:32},(_,i)=>output[((8+i)*width+39)*4]).reduce((a,b)=>a+b,0)/32;
  assert.ok(feature < 65,'a narrow detail must not be smeared into its background');
});

test('spatial processing respects alpha and ignores invisible colors outside the photo',() => {
  const source = new Uint8ClampedArray([255,0,255,0,100,100,100,255,100,100,100,255]);
  const output=renderPixels(source,3,1,{denoise:40,sharpen:30});
  assert.equal(output[3],0);
  assert.deepEqual([...output.slice(4,8)],[100,100,100,255]);
});
