const full={x:0,y:0,width:1,height:1};
export function straightenTransform(width,height,angle=0) {
  const radians=(Number(angle)||0)*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return {c,s,scale:Math.max(Math.abs(c)+Math.abs(s)*height/width,Math.abs(c)+Math.abs(s)*width/height)};
}
// Crop coordinates belong to the straightened canvas; annotations remain anchored to the original.
export function viewToOriginalPoint(point,crop,width,height) {
  const area=crop || full,{c,s,scale}=straightenTransform(width,height,crop?.angle);
  const x=(area.x+point.x*area.width-.5)*width/scale,y=(area.y+point.y*area.height-.5)*height/scale;
  return {x:.5+(c*x+s*y)/width,y:.5+(-s*x+c*y)/height};
}
export function originalToViewPoint(point,crop,width,height) {
  const area=crop || full,{c,s,scale}=straightenTransform(width,height,crop?.angle);
  const x=(point.x-.5)*width,y=(point.y-.5)*height;
  return {x:(.5+scale*(c*x-s*y)/width-area.x)/area.width,y:(.5+scale*(s*x+c*y)/height-area.y)/area.height};
}
export function transformRect(rect,transform) {
  const points=[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x,y:rect.y+rect.height},{x:rect.x+rect.width,y:rect.y+rect.height}].map(transform);
  const x=Math.max(0,Math.min(...points.map(p=>p.x))),y=Math.max(0,Math.min(...points.map(p=>p.y)));
  const right=Math.min(1,Math.max(...points.map(p=>p.x))),bottom=Math.min(1,Math.max(...points.map(p=>p.y)));
  return right>x && bottom>y ? {x,y,width:right-x,height:bottom-y}:null;
}
export function drawPhotoSource(context,image,crop,width,height,sourceRect=null) {
  const W=image.naturalWidth,H=image.naturalHeight,area=crop || full;
  const rect=sourceRect || {x:area.x*W,y:area.y*H,width:area.width*W,height:area.height*H};
  const {c,s,scale}=straightenTransform(W,H,crop?.angle);
  context.save();context.clearRect(0,0,width,height);
  context.scale(width/rect.width,height/rect.height);context.translate(-rect.x,-rect.y);
  context.translate(W/2,H/2);context.transform(scale*c,scale*s,-scale*s,scale*c,0,0);context.translate(-W/2,-H/2);
  context.drawImage(image,0,0);context.restore();
}
export function ratioCrop(ratio,width,height,base=full) {
  const r=Number(ratio);if(!Number.isFinite(r)||r<=0)return {...base};
  const normalized=r*height/width;
  let w=base.width,h=base.height;
  if(w/h>normalized)w=h*normalized;else h=w/normalized;
  return {...base,x:base.x+(base.width-w)/2,y:base.y+(base.height-h)/2,width:w,height:h};
}
export function cropProtectedRegions(crop,observations,width,height) {
  if(!crop)return [];
  return ['subject','light'].flatMap(key=>{
    const region=observations?.[key]?.region;if(!region)return [];
    const projected=transformRect(region,p=>originalToViewPoint(p,{angle:crop.angle,x:0,y:0,width:1,height:1},width,height));
    if(!projected)return [key];
    const overlap=Math.max(0,Math.min(crop.x+crop.width,projected.x+projected.width)-Math.max(crop.x,projected.x))*Math.max(0,Math.min(crop.y+crop.height,projected.y+projected.height)-Math.max(crop.y,projected.y));
    return overlap/(projected.width*projected.height)<.95 ? [key]:[];
  });
}
export function resizeRatioCrop(box,handle,dx,dy,ratio,width,height) {
  const r=ratio*height/width,west=handle.includes('w'),north=handle.includes('n');
  const ax=west?box.x+box.width:box.x,ay=north?box.y+box.height:box.y;
  const maxW=west?ax:1-ax,maxH=north?ay:1-ay,minW=.05*Math.max(1,r),limit=Math.min(maxW,maxH*r);
  if(limit<minW)return {...box};
  const rawW=Math.abs((west?box.x+dx:box.x+box.width+dx)-ax),rawH=Math.abs((north?box.y+dy:box.y+box.height+dy)-ay);
  const target=Math.abs(dx)/box.width>=Math.abs(dy)/box.height ? rawW:rawH*r;
  const w=Math.max(minW,Math.min(limit,target)),h=w/r;
  return {...box,x:west?ax-w:ax,y:north?ay-h:ay,width:w,height:h};
}
