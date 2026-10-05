const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=v=>{const t=clamp(v);return t*t*(3-2*t);};
export const maskTypes={rectangle:'矩形',linear:'渐变',radial:'径向',brush:'画笔'};
// Exclusion cores remain untouched; the transition lies outside each core.
export function maskWeight(item,p,width=1,height=1) {
  let weight=baseMaskWeight(item,p,width,height);
  for(const r of item.exclude || []){
    const dx=Math.max(r.x-p.x,0,p.x-r.x-r.width),dy=Math.max(r.y-p.y,0,p.y-r.y-r.height);
    const distance=Math.hypot(dx*width,dy*height),fade=Math.max(1,Math.min(r.width*width,r.height*height)*.2);
    weight*=smooth(distance/fade);
  }
  return weight;
}
function baseMaskWeight(item,p,width=1,height=1) {
  const r=item.rect;if(!r || item.localEnabled===false)return 0;
  const feather=Math.max(0,Math.min(1,Number.isFinite(item.feather)?item.feather:.36));
  const type=item.maskType || 'rectangle';
  if(type==='linear') {
    const a=item.start || {x:r.x,y:r.y},b=item.end || {x:r.x,y:r.y+r.height};
    const dx=(b.x-a.x)*width,dy=(b.y-a.y)*height,den=dx*dx+dy*dy;
    if(den<1e-10)return 0;
    const t=clamp(((p.x-a.x)*width*dx+(p.y-a.y)*height*dy)/den);
    return 1-((1-feather)*t+feather*smooth(t));
  }
  if(type==='brush') {
    const points=item.points || [];if(!points.length)return 0;
    const scale=Math.min(width,height),radius=Math.max(.001,Number(item.brushRadius)||.03)*scale;
    const x=p.x*width,y=p.y*height;let distance=Infinity;
    for(let i=0;i<points.length;i++) {
      const a=points[Math.max(0,i-1)],b=points[i],ax=a.x*width,ay=a.y*height,dx=(b.x-a.x)*width,dy=(b.y-a.y)*height;
      const t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy || 1));distance=Math.min(distance,Math.hypot(x-ax-t*dx,y-ay-t*dy));
    }
    return feather===0 ? +(distance<=radius):smooth((radius-distance)/(radius*feather));
  }
  if(type==='radial') {
    const distance=Math.hypot((p.x-r.x-r.width/2)/(r.width/2),(p.y-r.y-r.height/2)/(r.height/2));
    return feather===0 ? +(distance<=1):smooth((1-distance)/feather);
  }
  const x=(p.x-r.x)/r.width,y=(p.y-r.y)/r.height;
  if(x<0||y<0||x>1||y>1)return 0;
  return feather===0 ? 1:smooth(Math.min(x,1-x,y,1-y)/(feather/2));
}
export function brushBounds(points,radius,width,height) {
  const rx=radius*Math.min(width,height)/width,ry=radius*Math.min(width,height)/height;
  const x=Math.max(0,Math.min(...points.map(p=>p.x))-rx),y=Math.max(0,Math.min(...points.map(p=>p.y))-ry);
  const right=Math.min(1,Math.max(...points.map(p=>p.x))+rx),bottom=Math.min(1,Math.max(...points.map(p=>p.y))+ry);
  return {x,y,width:right-x,height:bottom-y};
}
