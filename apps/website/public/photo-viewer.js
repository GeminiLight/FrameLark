import {drawPhotoSource,viewToOriginalPoint,originalToViewPoint} from './photo-geometry.js';
import {createPhotoRenderer} from './photo-rendering.js';
import {shortcutAction,editableTarget,pinchTransform} from './editor-navigation.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// A view is rendered from source pixels at the requested magnification, never enlarged from the editor thumbnail.
export function createPhotoViewer(dialog,{prefix="viewer",onState=()=>{}}={}) {
  const element=name=>dialog.querySelector(`#${prefix}-${name}`);
  const renderer=createPhotoRenderer(),panes=[...dialog.querySelectorAll('.viewer-pane')];
  let busy=false,requested=false,single=false;
  let image,choices=[],zoom=1,center={x:.5,y:.5},generation=0,drag=null,fitZoom=1;
  const pointers=new Map();
  const select=[element('a'),element('b')];
  const current=()=>select.slice(0,single ? 1:2).map(el=>choices.find(item=>item.id===el.value));
  const activePanes=()=>single ? panes.slice(0,1):panes;
  function fit() {
    if(!image)return;
    const W=image.naturalWidth,H=image.naturalHeight;
    // Use a common scale and original-coordinate anchor for both versions, even when their crops differ.
    const bounds=current().flatMap(version=>[{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}].map(p=>viewToOriginalPoint(p,version.crop,W,H)));
    const left=Math.min(...bounds.map(p=>p.x)),right=Math.max(...bounds.map(p=>p.x)),top=Math.min(...bounds.map(p=>p.y)),bottom=Math.max(...bounds.map(p=>p.y));
    center={x:(left+right)/2,y:(top+bottom)/2};
    fitZoom=Math.min(...activePanes().map((pane,i)=>{const version=current()[i],points=[{x:left,y:top},{x:right,y:top},{x:left,y:bottom},{x:right,y:bottom}].map(p=>originalToViewPoint(p,{x:0,y:0,width:1,height:1,angle:version.crop?.angle},W,H));return Math.min(pane.clientWidth/((Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)))*W),pane.clientHeight/((Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)))*H));}))*.94;
    zoom=fitZoom;render();
  }
  async function render() {
    if(!image||!dialog.open)return;
    const token=++generation;onState('rendering');
    if(busy){requested=true;return;}busy=true;requested=false;
    const sourceImage=image,W=image.naturalWidth,H=image.naturalHeight;
    element('scale').textContent=`${Math.round(zoom*100)}%`;
    element('progress').textContent='正在读取原片细节…';
    const selected=current();
    try {
      await Promise.all(activePanes().map(async(pane,i)=>{
        const version=selected[i];if(!version)return;
        const canvas=pane.querySelector('canvas'),width=Math.max(1,Math.round(pane.clientWidth)),height=Math.max(1,Math.round(pane.clientHeight));
        // CSS pixel size is explicit: 100% means one source pixel per CSS pixel on both panes.
        const anchor=originalToViewPoint(center,{x:0,y:0,width:1,height:1,angle:version.crop?.angle},W,H);
        const pad=32/Math.min(1,1400/Math.max(W,H));
        const rect={x:anchor.x*W-width/zoom/2-pad,y:anchor.y*H-height/zoom/2-pad,width:width/zoom+2*pad,height:height/zoom+2*pad};
        const rw=Math.ceil(rect.width*zoom),rh=Math.ceil(rect.height*zoom);
        const source=document.createElement('canvas');source.width=rw;source.height=rh;
        const ctx=source.getContext('2d',{willReadFrequently:true});
        drawPhotoSource(ctx,sourceImage,version.crop,rw,rh,rect);
        const output=await renderer.render({pixels:ctx.getImageData(0,0,rw,rh).data,width:rw,height:rh,settings:version.settings,annotations:version.annotations,
          crop:{x:rect.x/W,y:rect.y/H,width:rect.width/W,height:rect.height/H,angle:version.crop?.angle || 0},frame:{fullWidth:W,fullHeight:H,sourceRect:rect,angle:version.crop?.angle || 0}});
        if(token!==generation||!dialog.open)return;
        ctx.putImageData(new ImageData(output,rw,rh),0,0);
        canvas.width=width;canvas.height=height;
        const out=canvas.getContext('2d');out.fillStyle='#161a1c';out.fillRect(0,0,width,height);
        const crop=version.crop || {x:0,y:0,width:1,height:1};
        out.save();out.beginPath();out.rect((crop.x-anchor.x)*W*zoom+width/2,(crop.y-anchor.y)*H*zoom+height/2,crop.width*W*zoom,crop.height*H*zoom);out.clip();
        out.drawImage(source,pad*zoom,pad*zoom,width,height,0,0,width,height);out.restore();
      }));
      if(token===generation){element('progress').textContent=single ? '原片细节 · 双击查看该处 · 拖动平移':'两侧共享位置与倍率 · 双击查看该处细节 · 拖动平移';onState('ready');}
    } catch {if(token===generation){element('progress').textContent='细节未能读取，请降低倍率重试。';onState('failed');}}
    finally {busy=false;if(requested && dialog.open){requested=false;render();}}
  }
  function scale(value) {zoom=clamp(value,Math.min(fitZoom,.05),4);render();}
  function startGesture(pane,i) {
    const points=[...pointers.values()],version=current()[i];
    if(points.length===1)drag={x:points[0].x,y:points[0].y,center:{...center},version,pane:i};
    else if(points.length===2) {
      const bounds=pane.getBoundingClientRect();
      drag={pinch:true,pane:i,version,startZoom:zoom,startDistance:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),
        startMidpoint:{x:(points[0].x+points[1].x)/2-bounds.left,y:(points[0].y+points[1].y)/2-bounds.top},
        anchor:originalToViewPoint(center,{x:0,y:0,width:1,height:1,angle:version.crop?.angle},image.naturalWidth,image.naturalHeight)};
    }
  }
  panes.forEach((pane,i)=>{
    pane.addEventListener('dblclick',event=>{
      if(!image)return;const version=current()[i];if(!version)return;
      if(Math.abs(zoom-1)<.01){fit();return;}
      const bounds=pane.getBoundingClientRect(),W=image.naturalWidth,H=image.naturalHeight;
      const anchor=originalToViewPoint(center,{x:0,y:0,width:1,height:1,angle:version.crop?.angle},W,H);
      const point=viewToOriginalPoint({x:anchor.x+(event.clientX-bounds.left-pane.clientWidth/2)/zoom/W,y:anchor.y+(event.clientY-bounds.top-pane.clientHeight/2)/zoom/H},{x:0,y:0,width:1,height:1,angle:version.crop?.angle},W,H);
      center={x:clamp(point.x,0,1),y:clamp(point.y,0,1)};scale(1);
    });
    pane.addEventListener('wheel',event=>{event.preventDefault();if(!image)return;scale(zoom*Math.exp(-event.deltaY*.002));},{passive:false});
    pane.addEventListener('pointerdown',event=>{if(!image || event.button!==0 || drag && drag.pane!==i || pointers.size>=2)return;pane.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});startGesture(pane,i);});
    pane.addEventListener('pointermove',event=>{
      if(!drag || !image || !pointers.has(event.pointerId) || !pane.hasPointerCapture(event.pointerId))return;
      pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      const W=image.naturalWidth,H=image.naturalHeight;
      if(drag.pinch && pointers.size===2) {
        const points=[...pointers.values()],bounds=pane.getBoundingClientRect();
        const next=pinchTransform({...drag,fitZoom,width:pane.clientWidth,height:pane.clientHeight,sourceWidth:W,sourceHeight:H,
          distance:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y),midpoint:{x:(points[0].x+points[1].x)/2-bounds.left,y:(points[0].y+points[1].y)/2-bounds.top}});
        zoom=next.zoom;const point=viewToOriginalPoint(next.point,{x:0,y:0,width:1,height:1,angle:drag.version.crop?.angle},W,H);
        center={x:clamp(point.x,0,1),y:clamp(point.y,0,1)};render();return;
      }
      const anchor=originalToViewPoint(drag.center,{x:0,y:0,width:1,height:1,angle:drag.version.crop?.angle},W,H);
      const next=viewToOriginalPoint({x:anchor.x-(event.clientX-drag.x)/zoom/W,y:anchor.y-(event.clientY-drag.y)/zoom/H},{x:0,y:0,width:1,height:1,angle:drag.version.crop?.angle},W,H);
      center={x:clamp(next.x,0,1),y:clamp(next.y,0,1)};render();
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])pane.addEventListener(type,event=>{if(!pointers.delete(event.pointerId))return;if(pointers.size && image)startGesture(pane,i);else drag=null;});
    pane.addEventListener('keydown',event=>{const delta={ArrowLeft:[-.05,0],ArrowRight:[.05,0],ArrowUp:[0,-.05],ArrowDown:[0,.05]}[event.key];if(delta){event.preventDefault();center={x:clamp(center.x+delta[0]/zoom,0,1),y:clamp(center.y+delta[1]/zoom,0,1)};render();}});
  });
  dialog.addEventListener('keydown',event=>{
    const action=shortcutAction(event,{viewer:true,typing:editableTarget(event.target)});
    if(!action)return;event.preventDefault();event.stopPropagation();
    if(action==='fit')fit();else scale(action==='actual' ? 1:action==='zoom-in' ? zoom*1.25:zoom/1.25);
  });
  select.forEach(el=>el.addEventListener('change',render));
  element('fit').addEventListener('click',fit);
  element('actual').addEventListener('click',()=>scale(1));
  element('minus').addEventListener('click',()=>scale(zoom/1.25));
  element('plus').addEventListener('click',()=>scale(zoom*1.25));
  element('close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{generation++;image=null;choices=[];pointers.clear();drag=null;onState('closed');});
  window.addEventListener('resize',()=>{if(dialog.open)fit();});
  return {updateVersion(id,version) {choices=choices.map(item=>item.id===id ? {...version,id}:item);render();},open(source,versions,a='original',b='current',options={}) {
    image=source;choices=versions;single=options.single===true;
    dialog.classList.toggle('single-view',single);panes[1].hidden=single;dialog.querySelector('.viewer-choices').hidden=single;
    select.forEach((el,i)=>{el.replaceChildren(...versions.map(version=>{const option=document.createElement('option');option.value=version.id;option.textContent=version.label;return option;}));el.value=i?b:a;});
    dialog.showModal();fit();
  }};
}
