import {outputGeometry,exportLimits} from './export-settings.js';
import {drawPhotoSource} from './photo-geometry.js';
import {loadPhotoImage} from './photo-import.js';
import {snapshotSettings} from './batch-edits.js';
import {effectiveAnnotations} from './adjustment-layers.js';
import {inspectPixels} from './diagnostics.js';
import {createPhotoRenderer} from './photo-rendering.js';
import {writeImageMetadata} from './export-files.js';

const cacheLimit=()=>Object.assign(new Error('成片缓存超过 128 MB，请下载并清理已完成任务后重试。'),{code:'EXPORT_CACHE_LIMIT'});

export function remainingExportBytes(retainedBytes){
  if(!Number.isFinite(retainedBytes)||retainedBytes<0)throw new TypeError('Invalid retained export size');
  const remaining=exportLimits.archiveBytes-retainedBytes;
  if(remaining<=0)throw cacheLimit();
  return remaining;
}

// File-project downloads have the same budget as browser-encoded photographs.
// Stop a response as soon as it exceeds the available cache; do not read it all
// first. Cancellation also interrupts a pending stream read.
export async function readExportDownload(response,{maxBytes=exportLimits.archiveBytes,signal}={}){
  if(!Number.isFinite(maxBytes)||maxBytes<0)throw new TypeError('Invalid export download budget');
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>maxBytes){await response.body?.cancel();throw cacheLimit();}
  if(!response.body){const blob=await response.blob();signal?.throwIfAborted();if(blob.size>maxBytes)throw cacheLimit();return blob;}
  const reader=response.body.getReader(),chunks=[];let size=0;
  const cancel=()=>{reader.cancel(signal.reason).catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  try{
    while(true){
      signal?.throwIfAborted();const {done,value}=await reader.read();signal?.throwIfAborted();
      if(done)break;
      size+=value.byteLength;if(size>maxBytes)throw cacheLimit();chunks.push(value);
    }
    return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
}

export function createPhotoExporter({exportVersion,getRetainedBytes=()=>0}){
  const check=size=>{if(size>remainingExportBytes(getRetainedBytes()))throw cacheLimit();};
  return async function makeExport(photo,snapshot,options,{signal,progress},projectVersionId=null){
    signal.throwIfAborted();remainingExportBytes(getRetainedBytes());
    if(projectVersionId){
      progress('正在生成成片并保存到项目');
      const result=await exportVersion(photo,projectVersionId,options,signal);
      signal.throwIfAborted();const response=await fetch(result.download,{signal});
      if(!response.ok)throw new Error('成片已生成，但下载未完成。可以在文件项目中查看。');
      const blob=await readExportDownload(response,{signal,maxBytes:remainingExportBytes(getRetainedBytes())});check(blob.size);
      const url=URL.createObjectURL(blob);let canvas;
      try{
        const image=await loadPhotoImage(url,{signal}),scale=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight));canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
        const stats=inspectPixels(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height).stats;
        return {blob,width:result.width,height:result.height,stats,projectPath:result.path};
      }finally{URL.revokeObjectURL(url);if(canvas){canvas.width=0;canvas.height=0;}}
    }
    progress('准备输出尺寸');
    const {rect,width,height}=outputGeometry(snapshot.crop,photo.image.naturalWidth,photo.image.naturalHeight,options.maxSide);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true,colorSpace:'srgb'}),renderer=createPhotoRenderer();
    const stop=()=>renderer.dispose();signal.addEventListener('abort',stop,{once:true});
    try{
      drawPhotoSource(context,photo.image,snapshot.crop,width,height,rect);progress('处理原片光色与细节');
      const pixels=await renderer.render({pixels:context.getImageData(0,0,width,height).data,width,height,settings:snapshotSettings(snapshot),annotations:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers),crop:snapshot.crop,document:snapshot.editDocument,frame:{fullWidth:photo.image.naturalWidth,fullHeight:photo.image.naturalHeight,sourceRect:rect,angle:snapshot.crop?.angle||0}});
      signal.throwIfAborted();context.putImageData(new ImageData(pixels,width,height),0,0);progress('编码成片与作品信息');
      const encoded=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('导出失败，请尝试使用分享尺寸')),options.format==='png'?'image/png':'image/jpeg',options.quality));
      signal.throwIfAborted();check(encoded.size);
      const bytes=writeImageMetadata(await encoded.arrayBuffer(),options.format,{...options,title:photo.imageName});check(bytes.length);
      return {blob:new Blob([bytes],{type:encoded.type}),width,height,stats:inspectPixels(pixels,width,height).stats};
    }finally{signal.removeEventListener('abort',stop);renderer.dispose();canvas.width=0;canvas.height=0;}
  };
}
