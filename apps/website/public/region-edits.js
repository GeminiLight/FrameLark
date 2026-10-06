import { renderPixels } from './editor-engine.js';
import {maskWeight} from './local-masks.js';
import {viewToOriginalPoint,originalToViewPoint,transformRect} from './photo-geometry.js';
import {resolveRenderFrame} from './render-frame.js';

const clamp = (value,min,max) => Math.max(min,Math.min(max,value));

export function renderRegionEdits(base,width,height,annotations,crop = null,options={}) {
  const frame=resolveRenderFrame(width,height,options);
  let output = base;
  for (const item of annotations || []) {
    if (item.localEnabled===false || !item.localSettings || !Object.values(item.localSettings).some(value => Math.abs(value) > .001)) continue;
    const rect = item.maskType==='linear' ? {x:0,y:0,width:1,height:1}:transformRect(item.rect,p=>originalToViewPoint(p,crop,frame.fullWidth,frame.fullHeight));
    if (!rect) continue;
    const left = clamp(Math.floor(rect.x*width),0,width-1);
    const top = clamp(Math.floor(rect.y*height),0,height-1);
    const right = clamp(Math.ceil((rect.x+rect.width)*width),left+1,width);
    const bottom = clamp(Math.ceil((rect.y+rect.height)*height),top+1,height);
    const patchWidth = right-left, patchHeight = bottom-top;
    const patch = new Uint8ClampedArray(patchWidth*patchHeight*4);
    for (let y=0;y<patchHeight;y++) patch.set(output.subarray(((top+y)*width+left)*4,((top+y)*width+right)*4),y*patchWidth*4);
    const amount = clamp(Number.isFinite(item.localAmount) ? item.localAmount : 100,0,150)/100;
    if (amount <= 0) continue;
    const settings = Object.fromEntries(Object.entries(item.localSettings).map(([key,value]) => [key,value*amount]));
    const patchFrame={fullWidth:frame.fullWidth,fullHeight:frame.fullHeight,angle:frame.angle,sourceRect:{
      x:frame.sourceRect.x+left/width*frame.sourceRect.width,y:frame.sourceRect.y+top/height*frame.sourceRect.height,
      width:patchWidth/width*frame.sourceRect.width,height:patchHeight/height*frame.sourceRect.height}};
    const adjusted = renderPixels(patch,patchWidth,patchHeight,settings,patchFrame);
    if (output === base) output = new Uint8ClampedArray(base);
    for (let y=0;y<patchHeight;y++) for (let x=0;x<patchWidth;x++) {
      const p=viewToOriginalPoint({x:(left+x+.5)/width,y:(top+y+.5)/height},crop,frame.fullWidth,frame.fullHeight);
      const weight = maskWeight(item,p,frame.fullWidth,frame.fullHeight);
      const from = (y*patchWidth+x)*4;
      const to = ((top+y)*width+left+x)*4;
      for (let channel=0;channel<3;channel++) output[to+channel] = output[to+channel]*(1-weight)+adjusted[from+channel]*weight;
    }
  }
  return output;
}
