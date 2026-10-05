import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {renderPixels} from '../../apps/studio/public/editor-engine.js';
function fixture(name) {
 const bytes=readFileSync(new URL(`./fixtures/calibration/${name}.ppm`,import.meta.url));
 const header=/^P6\n(\d+) (\d+)\n255\n/.exec(bytes.toString('latin1'));
 const width=Number(header[1]),height=Number(header[2]),rgb=bytes.subarray(header[0].length);
 assert.equal(rgb.length,width*height*3,'fixture is complete');
 return {width,height,pixels:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3 ? 255:rgb[Math.floor(i/4)*3+i%4])};
}
function hue(r,g,b) {
 const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 if(!d)return 0;
 return ((max===r ? (g-b)/d:max===g ? (b-r)/d+2:(r-g)/d+4)*60+360)%360;
}
test('portrait calibration preserves hue and avoids excessive saturation in the selected face region',()=>{
 const {width,height,pixels}=fixture('portrait');
 const edited=renderPixels(pixels,width,height,{exposure:.1,highlights:-10,shadows:8,warmth:3,vibrance:8,sharpen:12,denoise:12});
 let sum=0,count=0,maxSaturationDelta=0;
 for(let y=106;y<153;y++) for(let x=193;x<254;x++) {
  const i=(y*width+x)*4,[r,g,b]=pixels.slice(i,i+3),[a,c,d]=edited.slice(i,i+3);
  if(r<=g || g<=b || r<130 || r>235)continue;
  const delta=Math.abs(((hue(a,c,d)-hue(r,g,b)+540)%360)-180);
  sum+=delta;count++;
  maxSaturationDelta=Math.max(maxSaturationDelta,(Math.max(a,c,d)-Math.min(a,c,d))/Math.max(a,c,d)-(r-b)/r);
 }
 assert.ok(count>400);assert.ok(sum/count<5,`mean face hue shift ${sum/count}`);assert.ok(maxSaturationDelta<.08);
});
test('reference recipes do not add a material fraction of clipped endpoint channels',()=>{
 const recipes={portrait:{exposure:.1,warmth:3,vibrance:8,denoise:12,sharpen:12,highlights:-10,shadows:8},backlight:{exposure:.05,highlights:-20,shadows:14,denoise:8,sharpen:15},night:{exposure:.12,highlights:-15,shadows:10,warmth:-2,denoise:30,sharpen:12},sky:{highlights:-15,denoise:10},'high-contrast':{exposure:.1,highlights:-15,shadows:15,sharpen:25,denoise:12}};
 for(const [name,settings] of Object.entries(recipes)) {
  const {pixels,width,height}=fixture(name),output=renderPixels(pixels,width,height,settings);
  const count=data=>data.reduce((sum,v,i)=>sum+(i%4!==3 && (v===0 || v===255) ? 1:0),0);
  assert.ok((count(output)-count(pixels))/(width*height*3)<.0003,`${name} added clipped channels`);
 }
});
