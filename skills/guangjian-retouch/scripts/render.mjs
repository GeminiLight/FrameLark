import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createCanvas,loadImage,ImageData} from '@napi-rs/canvas';
import {loadProject,findVersion,hash,fail,cleanRect} from './project.mjs';
import {drawPhotoSource,originalToViewPoint,transformRect} from './engine/photo-geometry.js';
import {renderPhotoPixels} from './engine/photo-rendering.js';
import {combineSettings,neutralSettings,renderingVersion} from './engine/editor-engine.js';
import {presetById} from './engine/presets.js';
import {outputGeometry,safeFilename} from './engine/export-settings.js';
import {photoMetering} from './engine/photo-metering.js';
import {writeImageMetadata} from './engine/export-files.js';
import {drawTextOverlays,letteringVersion} from './text-overlays.mjs';
let cached=null;
async function sourceImage(folder,p) {
  const file=path.join(folder,'source','normalized.png');const bytes=await readFile(file);
  if(hash(bytes)!==p.source.normalizedChecksum || hash(await readFile(path.join(folder,'source','original.bin')))!==p.source.checksum)fail('SOURCE_CHANGED','项目源图已改变。请恢复原片备份，或作为新项目重新加入。');
  if(cached?.key===p.source.normalizedChecksum)return cached.image;
  const image=await loadImage(bytes);
  cached={key:p.source.normalizedChecksum,image};return image;
}
export async function renderFrame(folder,key='current',options={}) {
  const p=await loadProject(folder),version=findVersion(p,key),image=await sourceImage(folder,p);
  const state=version.state,W=p.source.width,H=p.source.height,crop=options.referenceCrop!==undefined?options.referenceCrop:state.crop;
  let geometry=outputGeometry(crop,W,H,Math.max(512,Math.min(8192,Number(options.maxSide)||1400)));
  let frameCrop=crop;
  if(options.region){const r=cleanRect(options.region),view=transformRect(r,x=>originalToViewPoint(x,{x:0,y:0,width:1,height:1,angle:crop?.angle},W,H));
    if(!view)fail('REGION_OUTSIDE','这处范围不在照片内。');const rect={x:view.x*W,y:view.y*H,width:view.width*W,height:view.height*H};
    const scale=Math.min(1,Math.max(512,Math.min(4096,Number(options.maxSide)||1600))/Math.max(rect.width,rect.height));
    geometry={rect,width:Math.max(1,Math.round(rect.width*scale)),height:Math.max(1,Math.round(rect.height*scale)),limited:scale<1};frameCrop={...view,angle:crop?.angle||0};
  }
  const {rect,width,height}=geometry,canvas=createCanvas(width,height),context=canvas.getContext('2d');
  drawPhotoSource(context,image,frameCrop,width,height,rect);
  const source=context.getImageData(0,0,width,height).data;
  const settings=options.original?neutralSettings():combineSettings({settings:state.settings},{settings:presetById(state.style?.id)?.adjustments,amount:(state.style?.amount||0)/100});
  const pixels=renderPhotoPixels({pixels:source,width,height,settings,annotations:options.original?[]:state.locals,crop:frameCrop,frame:{fullWidth:W,fullHeight:H,sourceRect:rect,angle:crop?.angle||0}});
  context.putImageData(new ImageData(pixels,width,height),0,0);
  const textLayout=drawTextOverlays(context,options.original||options.withoutText?[]:state.textOverlays,{width,height,compositionRect:outputGeometry(crop,W,H,8192).rect,sourceRect:rect});
  const composedPixels=textLayout.length?context.getImageData(0,0,width,height).data:pixels;
  if(options.showNotes){for(const n of p.notes){const r=transformRect(n.rect,x=>originalToViewPoint(x,frameCrop,W,H));if(!r)continue;context.strokeStyle='#ffe5b8';context.lineWidth=2;context.strokeRect(r.x*width,r.y*height,r.width*width,r.height*height);context.fillStyle='#dfcfb5';context.fillRect(r.x*width,r.y*height,24,23);context.fillStyle='#242829';context.font='14px sans-serif';context.fillText(String(n.number),r.x*width+7,r.y*height+17);}}
  return {png:canvas.toBuffer('image/png'),pixels:composedPixels,width,height,sourceRect:rect,limited:geometry.limited,versionId:version.id,stats:photoMetering(pixels,width,height),textLayout,withoutText:Boolean(options.withoutText),pipeline:renderingVersion+(textLayout.length?'+'+letteringVersion:''),pixelHash:hash(Buffer.from(composedPixels))};
}
export async function previewPhoto(folder,key='current',options={}) {
  const frame=await renderFrame(folder,key,options);const name=`${frame.versionId}-${hash(options).slice(0,12)}.png`,file=path.join(path.resolve(folder),'previews',name);
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,frame.png,{mode:0o600});
  const {png,pixels,...metadata}=frame;return {path:file,...metadata};
}
export async function exportPhoto(folder,key='current',options={}) {
  const p=await loadProject(folder),v=findVersion(p,key);if(!p.versions.some(x=>x.id===v.id))fail('UNACCEPTED_EXPORT','请先接受候选，再导出成片。');
  const preset=options.preset||'original',format=options.format||(preset==='original'?'png':'jpeg');if(!['png','jpeg'].includes(format))fail('EXPORT_FORMAT','成片支持 PNG 或 JPEG。');
  const maxSide=options.maxSide??({share:2048,print:6000,original:8192}[preset]);if(!Number.isFinite(maxSide)||maxSide<512||maxSide>8192)fail('EXPORT_SIZE','最长边应为 512～8192；总像素最多 1600 万。');
  const quality=options.quality??(preset==='print'?98:90);if(!Number.isFinite(quality)||quality<60||quality>100)fail('EXPORT_QUALITY','JPEG 画质应为 60～100。');
  const dpi=options.dpi??(preset==='share'?96:300);if(!Number.isInteger(dpi)||dpi<72||dpi>1200)fail('EXPORT_DPI','像素密度应为 72～1200 ppi。');
  const frame=await renderFrame(folder,v.id,{maxSide,withoutText:Boolean(options.withoutText)});let bytes=frame.png;
  if(format==='jpeg')bytes=await sharp(bytes).flatten({background:'#ffffff'}).jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer();
  bytes=Buffer.from(writeImageMetadata(bytes,format,{dpi,includeArtwork:Boolean(options.includeArtwork),title:options.title||'',author:options.author||'',copyright:options.copyright||''}));
  const output=options.output?path.resolve(options.output):path.join(path.resolve(folder),'exports',safeFilename(p.source.name,format==='jpeg'?'jpg':'png',`${v.name}${options.withoutText?'-无字':''}-${Date.now()}`));
  const rel=path.relative(path.resolve(folder),output);if(rel==='project.json'||rel.startsWith('source'+path.sep)||rel.startsWith('previews'+path.sep))fail('OUTPUT_PROTECTED','成片不能写到源图或项目记录目录，请换一个输出位置。');
  try{await writeFile(output,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')fail('OUTPUT_EXISTS','输出文件已存在。请换一个名称，保留已有成片。');throw error;}
  return {path:output,versionId:v.id,width:frame.width,height:frame.height,limited:frame.limited,format,dpi,quality,bytes:bytes.length,pipeline:frame.pipeline,pixelHash:frame.pixelHash,withoutText:frame.withoutText};
}
