import {renderPixels} from './editor-engine.js';
import {renderRegionEdits} from './region-edits.js';

export function renderPhotoPixels({pixels,width,height,settings,annotations,crop,frame}) {
  return renderRegionEdits(renderPixels(pixels,width,height,settings,frame),width,height,annotations,crop,frame);
}

export function createPhotoRenderer() {
  let worker=null,id=0,disposed=false;
  const pending=new Map();
  try {
    if(typeof Worker!=='undefined') worker=new Worker(new URL('./photo-render-worker.js',import.meta.url),{type:'module'});
  } catch { /* Same pixel pipeline remains available without workers. */ }
  if(worker) {
    worker.onmessage=({data})=>{
      const job=pending.get(data.id);if(!job) return;
      pending.delete(data.id);
      data.error ? job.reject(new Error('照片效果处理失败')):job.resolve(new Uint8ClampedArray(data.pixels));
    };
    worker.onerror=()=>{
      worker.terminate();worker=null;
      for(const job of pending.values()) job.reject(new Error('照片处理线程暂时不可用'));
      pending.clear();
    };
  }
  return {dispose() {disposed=true;if(worker){worker.terminate();worker=null;}for(const job of pending.values())job.reject(new DOMException('Cancelled','AbortError'));pending.clear();},async render(job) {
    if(disposed)throw new DOMException('Cancelled','AbortError');
    if(!worker) return renderPhotoPixels(job);
    const request=++id;
    const pixels=new Uint8ClampedArray(job.pixels);
    try {
      return await new Promise((resolve,reject)=>{pending.set(request,{resolve,reject});worker.postMessage({...job,pixels,id:request},[pixels.buffer]);});
    } catch(error) {
      if(disposed)throw error;
      if(!worker) return renderPhotoPixels(job);
      throw error;
    }
  }};
}
