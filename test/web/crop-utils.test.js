import test from 'node:test';
import assert from 'node:assert/strict';
import { validCrop, cropPixelRect, cropPixels } from '../../public/crop-utils.js';

test('image-aware crop suggestions reject unsafe or non-crops', () => {
  assert.equal(validCrop({x:.1,y:.1,width:.15,height:.8},{suggestion:true}),null);
  assert.equal(validCrop({x:.1,y:.1,width:.92,height:.9},{suggestion:true}),null);
  assert.equal(validCrop({x:.05,y:.05,width:.8,height:.8},{suggestion:true})?.width,.8);
  assert.equal(validCrop({x:0,y:0,width:1,height:1},{suggestion:true}),null);
});

test('crop pixels and export geometry select the same source area', () => {
  const data = Uint8ClampedArray.from(Array.from({length:4 * 3 * 4},(_,index) => index));
  const crop = {x:.25,y:0,width:.5,height:2/3};
  assert.deepEqual(cropPixelRect(crop,4,3),{x:1,y:0,width:2,height:2});
  const result = cropPixels(data,4,3,crop);
  assert.deepEqual({width:result.width,height:result.height},{width:2,height:2});
  assert.deepEqual([...result.data],[...data.subarray(4,12),...data.subarray(20,28)]);
  assert.equal(cropPixels(data,4,3,null).data,data);
});
