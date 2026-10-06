import {renderPixels,combineSettings} from './editor-engine.js';
import {renderRegionEdits} from './region-edits.js';
import {presetById} from './presets.js';
import {renderStackPixels,createStackRenderCache} from './edit-stack/render.js';

export function renderPhotoPixels({pixels,width,height,settings,annotations,crop,frame,document,signal,maskView,stackCache}) {
  if(document){const base=document.base.state;settings=combineSettings({settings:base.settings},{settings:presetById(base.style?.id)?.adjustments,amount:(base.style?.amount||0)/100});annotations=base.locals;}
  const legacy=renderRegionEdits(renderPixels(pixels,width,height,settings,frame),width,height,annotations,crop,frame);
  return document?renderStackPixels({pixels:legacy,originalPixels:pixels,width,height,document,frame,signal,maskView,cache:stackCache}).pixels:legacy;
}

export function createPhotoRenderer() {
  let worker=null,id=0,disposed=false;
  const pending=new Map(),stackCache=createStackRenderCache();
  function ensureWorker(){
    if(worker||disposed)return;
    try{if(typeof Worker!=='undefined')worker=new Worker(new URL('./photo-render-worker.js',import.meta.url),{type:'module'});}catch{/* Same pipeline without workers. */}
    if(!worker)return;
    const owned=worker;
    owned.onmessage=({data})=>{
      const job=pending.get(data.id);if(!job) return;
      pending.delete(data.id);
      data.error ? job.reject(new Error('照片效果处理失败')):job.resolve(new Uint8ClampedArray(data.pixels));
    };
    owned.onerror=()=>{
      if(worker!==owned)return;owned.terminate();worker=null;
      for(const job of pending.values()) job.reject(new Error('照片处理线程暂时不可用'));
      pending.clear();
    };
  }
  function cancel(force=false){if(!force&&!pending.size)return;if(worker){worker.terminate();worker=null;}for(const job of pending.values())job.reject(new DOMException('Cancelled','AbortError'));pending.clear();}
  ensureWorker();
  return {cancel,dispose() {disposed=true;stackCache.clear();cancel(true);},async render(job) {
    if(disposed)throw new DOMException('Cancelled','AbortError');
    ensureWorker();
    if(!worker) return renderPhotoPixels({...job,stackCache});
    const request=++id;
    const pixels=new Uint8ClampedArray(job.pixels);
    try {
      return await new Promise((resolve,reject)=>{pending.set(request,{resolve,reject});worker.postMessage({...job,pixels,id:request},[pixels.buffer]);});
    } catch(error) {
      if(disposed||error.name==='AbortError')throw error;
      if(!worker) return renderPhotoPixels({...job,stackCache});
      throw error;
    }
  }};
}
