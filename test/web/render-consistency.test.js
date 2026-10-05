import test from 'node:test';import assert from 'node:assert/strict';
import {renderPhotoPixels,createPhotoRenderer} from '../../apps/studio/public/photo-rendering.js';
import {cropPixelRect} from '../../apps/studio/public/crop-utils.js';
const image=(w,h,fn)=>Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3 ? 255:fn(Math.floor(i/4)%w,Math.floor(i/4/w),i%4));
test('grain stays anchored to the same original pixels after cropping',()=>{
  const frame={fullWidth:100,fullHeight:80},settings={grain:30,exposure:.2};
  const full=renderPhotoPixels({pixels:image(100,80,()=>110),width:100,height:80,settings,frame});
  const crop=renderPhotoPixels({pixels:image(40,30,()=>110),width:40,height:30,settings,frame:{...frame,sourceRect:{x:25,y:20,width:40,height:30}}});
  for(let y=0;y<30;y++) for(let x=0;x<40;x++) assert.equal(crop[(y*40+x)*4],full[((y+20)*100+x+25)*4]);
});
test('light, color and feathering agree at corresponding preview/export positions',()=>{
  const annotations=[{id:'r',rect:{x:.2,y:.2,width:.6,height:.6},localSettings:{exposure:.2,shadows:14}}];
  const settings={exposure:.2,highlights:-20,warmth:5},frame={fullWidth:3200,fullHeight:2400};
  const sample=(x,y,c)=>80+x*.15+[15,0,-12][c];
  const preview=renderPhotoPixels({pixels:image(140,105,(x,y,c)=>sample((x+.5)*2-.5,y,c)),width:140,height:105,settings,annotations,frame});
  const exported=renderPhotoPixels({pixels:image(280,210,sample),width:280,height:210,settings,annotations,frame});
  let error=0,count=0,max=0;
  for(let y=5;y<100;y++) for(let x=5;x<135;x++) for(let c=0;c<3;c++) {
    const average=[0,1].flatMap(dy=>[0,1].map(dx=>exported[((2*y+dy)*280+2*x+dx)*4+c])).reduce((a,b)=>a+b)/4;
    const diff=Math.abs(preview[(y*140+x)*4+c]-average);error+=diff;count++;max=Math.max(max,diff);
  }
  assert.ok(error/count<.8,`mean RGB error ${error/count}`);assert.ok(max<=2,`maximum RGB error ${max}`);
});
test('background renderer uses the same pipeline and preserves the caller source',async()=>{
  const source=image(25,20,x=>80+x*3),before=new Uint8ClampedArray(source);
  const job={pixels:source,width:25,height:20,settings:{sharpen:25,denoise:20,grain:15},frame:{fullWidth:25,fullHeight:20}};
  assert.deepEqual(await createPhotoRenderer().render(job),renderPhotoPixels(job));assert.deepEqual(source,before);
});
test('export crop sizes are bounded, integer and retain their described aspect',()=>{
  const rect=cropPixelRect({x:.12,y:.13,width:.73,height:.69},6000,4000);
  assert.equal(rect.width,4380);assert.equal(rect.height,2760);
  const scale=Math.min(1,2048/Math.max(rect.width,rect.height)),w=Math.round(rect.width*scale),h=Math.round(rect.height*scale);
  assert.equal(w,2048);assert.ok(Math.abs(w/h-rect.width/rect.height)<.002);
});

test('detail kernels keep their physical radius when the full export has twice the preview density',()=>{
  const frame={fullWidth:2800,fullHeight:50},settings={sharpen:30,denoise:20,clarity:15};
  const field=x=>110+30*Math.sin(x/22)+25*Math.tanh((x-800)/5);
  const high=renderPhotoPixels({pixels:image(2800,50,x=>field(x+.5)),width:2800,height:50,settings,frame});
  const low=renderPhotoPixels({pixels:image(1400,25,x=>field((x+.5)*2)),width:1400,height:25,settings,frame});
  let error=0,max=0;
  for(let x=3;x<1397;x++) {
    const expected=(high[(24*2800+x*2)*4]+high[(24*2800+x*2+1)*4])/2;
    const diff=Math.abs(low[(12*1400+x)*4]-expected);error+=diff;max=Math.max(max,diff);
  }
  assert.ok(error/1394<1);assert.ok(max<=3);
});
