import test from 'node:test';
import assert from 'node:assert/strict';
import { rectFromPoints,viewToImageRect,imageToViewRect,measureRegion } from '../../apps/studio/public/annotations.js';
import { renderRegionEdits } from '../../apps/studio/public/region-edits.js';

test('annotation stays anchored to the original image when crop changes', () => {
  const view = rectFromPoints({x:.2,y:.2},{x:.6,y:.5});
  const crop = {x:.1,y:.1,width:.8,height:.8};
  const original = viewToImageRect(view,crop);
  const roundTrip = imageToViewRect(original,crop);
  for (const key of ['x','y','width','height']) assert.ok(Math.abs(roundTrip[key]-view[key])<1e-10);
  const otherCrop = {x:.4,y:.1,width:.6,height:.8};
  const clipped = imageToViewRect(original,otherCrop);
  assert.ok(clipped.x >= 0 && clipped.width > 0);
  assert.equal(imageToViewRect(original,{x:.8,y:.1,width:.2,height:.8}),null);
  const tap = rectFromPoints({x:.98,y:.98},{x:.98,y:.98});
  assert.equal(tap.x+tap.width,1);
  assert.equal(tap.y+tap.height,1);
});

test('region measurement and feathered edit affect only marked pixels', () => {
  const width=20,height=20;
  const base = new Uint8ClampedArray(width*height*4);
  for (let i=0;i<base.length;i+=4) { base[i]=90;base[i+1]=90;base[i+2]=90;base[i+3]=255; }
  const rect={x:.25,y:.25,width:.5,height:.5};
  assert.ok(measureRegion(base,width,height,rect).mean > .3);
  const output = renderRegionEdits(base,width,height,[{rect,localSettings:{exposure:.4},localAmount:100}]);
  const pixel = (data,x,y) => data[(y*width+x)*4];
  assert.equal(pixel(output,0,0),90);
  assert.ok(pixel(output,10,10)>pixel(base,10,10));
  assert.ok(pixel(output,5,5)<pixel(output,10,10));
  assert.deepEqual(renderRegionEdits(base,width,height,[{rect,localSettings:{exposure:.4},localAmount:0}]),base);
});
