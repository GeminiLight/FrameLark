import test from 'node:test';import assert from 'node:assert/strict';
import {maskWeight,brushBounds} from '../../public/local-masks.js';import {renderRegionEdits} from '../../public/region-edits.js';
import {viewToOriginalPoint,originalToViewPoint,ratioCrop,straightenTransform,cropProtectedRegions} from '../../public/photo-geometry.js';
import {grainAt,resolveRenderFrame} from '../../public/render-frame.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('rectangle, radial, gradient and brush weights respect feathering and independent enable switch',()=>{
 const item={rect:{x:.1,y:.1,width:.8,height:.8},feather:.5};
 assert.equal(maskWeight(item,{x:.5,y:.5}),1);assert.equal(maskWeight(item,{x:.05,y:.5}),0);assert.ok(maskWeight(item,{x:.2,y:.5})<1);
 assert.equal(maskWeight({...item,maskType:'radial'},{x:.1,y:.1}),0);assert.equal(maskWeight({...item,maskType:'radial'},{x:.5,y:.5}),1);
 const linear={...item,maskType:'linear',start:{x:0,y:0},end:{x:1,y:0}};near(maskWeight(linear,{x:.5,y:.5}),.5);assert.equal(maskWeight(linear,{x:0,y:1}),1);assert.equal(maskWeight(linear,{x:1,y:1}),0);
 near(maskWeight({...linear,feather:0},{x:.25,y:.5}),.75);near(maskWeight({...linear,feather:1},{x:.25,y:.5}),.84375);
 const brush={...item,maskType:'brush',points:[{x:.2,y:.5},{x:.8,y:.5}],brushRadius:.05};assert.equal(maskWeight(brush,{x:.5,y:.5},800,400),1);assert.equal(maskWeight(brush,{x:.5,y:.7},800,400),0);
 assert.equal(maskWeight({...brush,localEnabled:false},{x:.5,y:.5}),0);
 const bounds=brushBounds(brush.points,.05,800,400);near(bounds.x,.175);near(bounds.height,.1);
});
test('straightened crop and original positions round-trip, remain inside source, and honor target aspect',()=>{
 const crop={x:.1,y:.08,width:.8,height:.85,angle:12},W=1200,H=800;
 for(const point of [{x:0,y:0},{x:.35,y:.72},{x:1,y:1}]){const original=viewToOriginalPoint(point,crop,W,H),back=originalToViewPoint(original,crop,W,H);near(back.x,point.x);near(back.y,point.y);assert.ok(original.x>=0&&original.x<=1&&original.y>=0&&original.y<=1);}
 const ratio=ratioCrop(2/3,W,H);near(ratio.width*W/(ratio.height*H),2/3);assert.equal(ratio.angle,undefined);
 assert.ok(straightenTransform(W,H,15).scale>1);assert.deepEqual(cropProtectedRegions({x:.3,y:0,width:.7,height:1},{subject:{region:{x:.1,y:.3,width:.3,height:.3}}},W,H),['subject']);
});
test('local effects and grain follow original positions across rotated/cropped viewports and export density',()=>{
 const fullWidth=200,fullHeight=160,crop={x:.15,y:.1,width:.7,height:.8,angle:10};
 const area={rect:{x:.05,y:.05,width:.9,height:.9},maskType:'radial',feather:.6,localSettings:{exposure:.25}};
 const render=(width,height)=>{const frame={fullWidth,fullHeight,angle:crop.angle,sourceRect:{x:crop.x*fullWidth,y:crop.y*fullHeight,width:crop.width*fullWidth,height:crop.height*fullHeight}};const base=Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:100);return renderRegionEdits(base,width,height,[area],crop,frame);};
 const a=render(70,64),b=render(140,128);for(const [x,y] of [[20,20],[35,32],[60,50]]){const i=(y*70+x)*4,j=((y*2)*140+x*2)*4;assert.ok(Math.abs(a[i]-b[j])<=1);}
 const point=viewToOriginalPoint({x:(35+.5)/70,y:(32+.5)/64},crop,fullWidth,fullHeight),f=resolveRenderFrame(70,64,{fullWidth,fullHeight,angle:crop.angle,sourceRect:{x:30,y:16,width:140,height:128}}),g=resolveRenderFrame(fullWidth,fullHeight,{fullWidth,fullHeight});
 near(grainAt(35,32,f,70,64),grainAt(point.x*fullWidth-.5,point.y*fullHeight-.5,g,fullWidth,fullHeight));
 assert.deepEqual(renderRegionEdits(new Uint8ClampedArray([100,100,100,255]),1,1,[{...area,localEnabled:false}]),new Uint8ClampedArray([100,100,100,255]));
});

test('a ratio-locked corner resize retains the opposite anchor and exact source aspect',async()=>{
 const {resizeRatioCrop}=await import('../../public/photo-geometry.js');
 const box={x:.1,y:.1,width:.6,height:.8,angle:3},next=resizeRatioCrop(box,'nw',.05,.02,1.5,1200,800);
 near(next.x+next.width,box.x+box.width);near(next.y+next.height,box.y+box.height);near(next.width*1200/(next.height*800),1.5);assert.equal(next.angle,3);
});
