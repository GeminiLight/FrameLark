import {viewToOriginalPoint} from './photo-geometry.js';
// All spatial effects use a common 1400-pixel reference, anchored to the original photo.
export function resolveRenderFrame(width,height,options={}) {
  const fullWidth=options.fullWidth || width,fullHeight=options.fullHeight || height;
  const sourceRect=options.sourceRect || {x:0,y:0,width:fullWidth,height:fullHeight};
  const referenceScale=Math.min(1,1400/Math.max(fullWidth,fullHeight));
  return {fullWidth,fullHeight,sourceRect,referenceScale,angle:options.angle || 0,
    scaleX:width/(sourceRect.width*referenceScale),scaleY:height/(sourceRect.height*referenceScale)};
}

function noise(x,y) {
  let hash=Math.imul(x+1,73856093)^Math.imul(y+1,19349663);
  hash=Math.imul(hash^(hash>>>13),1274126177);
  return (((hash>>>0)&1023)/1023-.5);
}

export function grainAt(x,y,frame,width,height) {
  const p=viewToOriginalPoint({x:(x+.5)/width,y:(y+.5)/height},{x:frame.sourceRect.x/frame.fullWidth,y:frame.sourceRect.y/frame.fullHeight,width:frame.sourceRect.width/frame.fullWidth,height:frame.sourceRect.height/frame.fullHeight,angle:frame.angle},frame.fullWidth,frame.fullHeight);
  const px=p.x*frame.fullWidth*frame.referenceScale-.5,py=p.y*frame.fullHeight*frame.referenceScale-.5;
  const left=Math.floor(px),top=Math.floor(py),dx=px-left,dy=py-top;
  return (noise(left,top)*(1-dx)+noise(left+1,top)*dx)*(1-dy)
    +(noise(left,top+1)*(1-dx)+noise(left+1,top+1)*dx)*dy;
}
