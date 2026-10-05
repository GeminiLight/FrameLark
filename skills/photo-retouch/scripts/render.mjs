import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createCanvas,loadImage,ImageData} from '@napi-rs/canvas';
import {loadProject,findVersion,hash,fail,cleanRect} from './project.mjs';
import {drawPhotoSource,originalToViewPoint,transformRect} from './engine/photo-geometry.js';
import {renderPhotoPixels} from './engine/photo-rendering.js';
import {combineSettings,neutralSettings} from './engine/editor-engine.js';
import {presetById} from './engine/presets.js';
import {outputGeometry,safeFilename} from './engine/export-settings.js';
import {photoMetering} from './engine/photo-metering.js';
import {writeImageMetadata} from './engine/export-files.js';
import {drawTextOverlays} from './text-overlays.mjs';
let cached=null;
async function sourceImage(folder,p) {
  const file=path.join(folder,'source','normalized.png');let bytes,original;
  try{bytes=await readFile(file);original=await readFile(path.join(folder,'source','original.bin'));}catch(error){if(error.code==='ENOENT')fail('SOURCE_MISSING','项目原片文件未找到。请让 Agent 检查并恢复项目源图，再重试预览；已有编辑保留。');throw error;}
  if(hash(bytes)!==p.source.normalizedChecksum || hash(original)!==p.source.checksum)fail('SOURCE_CHANGED','项目源图已改变。请恢复原片备份，或作为新项目重新加入。');
  if(cached?.key===p.source.normalizedChecksum)return cached.image;
  const image=await loadImage(bytes);
  cached={key:p.source.normalizedChecksum,image};return image;
}
// Rendering identities include the complete pinned state and matching output grid.
import {pipelineVersion,versionPipeline,versionStateHash} from './engine/edit-identity.js';
import {guardsOf} from './engine/edit-guards.js';
import {equal} from './engine/edit-values.js';
import {compositeProtectedRegions} from './engine/protected-regions.js';
import {readReferenceSnapshot,validateReferences} from './reference-store.mjs';

function freezeSnapshot(value) {
  if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freezeSnapshot(child);}
  return value;
}
// An operation pins one immutable project and verified source. Reuse final RGBA
// across note crops; never re-render a crop with different grain/filter geometry.
export async function createRenderSession(folder, project) {
  const p=freezeSnapshot(structuredClone(project??await loadProject(folder)));
  const W=p.source.width,H=p.source.height,source={width:W,height:H};
  const cache=new Map(),snapshots=new Map(),proofs=new Set();
  let imagePromise;
  async function snapshotPixels(snapshot){if(!snapshots.has(snapshot.path))snapshots.set(snapshot.path,await readReferenceSnapshot(folder,snapshot));return snapshots.get(snapshot.path);}
  async function renderVersion(v,g,renderCrop,options,stack=[]){
    const withoutText=Boolean(options.withoutText),image=await imagePromise;
    const owner=p.versions.indexOf(v);validateReferences(p,v.state,owner<0?p.versions.length:owner);
    if(stack.includes(v.id))fail('REFERENCE_CYCLE','保护参考形成循环，无法安全生成图片。');
    const cacheKey=hash({state:v.state,recipe:v.recipe,geometry:g,crop:renderCrop,withoutText,original:options.original,maskView:options.maskView});
    if(cache.has(cacheKey))return cache.get(cacheKey);
    const {rect,width,height}=g,canvas=createCanvas(width,height),context=canvas.getContext('2d');
    // Use the actual rounded source rectangle everywhere, including masks and grain.
    const actualCrop={x:rect.x/W,y:rect.y/H,width:rect.width/W,height:rect.height/H,angle:renderCrop?.angle||0};
    drawPhotoSource(context,image,actualCrop,width,height,rect);
    const original=context.getImageData(0,0,width,height).data;
    const settings=options.original?neutralSettings():combineSettings({settings:v.state.settings},{settings:presetById(v.state.style?.id)?.adjustments,amount:(v.state.style?.amount||0)/100});
    let pixels=renderPhotoPixels({pixels:original,width,height,settings,annotations:options.original?[]:v.state.locals,crop:actualCrop,document:options.original?undefined:v.recipe,maskView:options.maskView,frame:{fullWidth:W,fullHeight:H,sourceRect:rect,angle:renderCrop?.angle||0}});
    if(options.maskView){const result={pixels,textLayout:[]};cache.set(cacheKey,result);return result;}
    context.putImageData(new ImageData(pixels,width,height),0,0);
    const textLayout=drawTextOverlays(context,options.original||withoutText?[]:v.state.textOverlays,{width,height,compositionRect:outputGeometry(renderCrop,W,H,8192).rect,sourceRect:rect});
    if(textLayout.length)pixels=context.getImageData(0,0,width,height).data;
    const regions=options.original?[]:guardsOf(v.state).regions,references=new Map();
    for(const region of regions){
      const reference=p.versions.find(r=>r.id===region.referenceVersionId),snapshot=withoutText?region.cleanSnapshot:region.snapshot;
      const stored=await snapshotPixels(snapshot);
      if(references.has(reference.id))continue;
      if(width===snapshot.width&&height===snapshot.height)references.set(reference.id,stored);
      else {
        // Replays at other sizes are permitted only while the saved-size replay
        // still proves that this renderer (including installed fonts) is compatible.
        const proofKey=reference.id+':'+withoutText;
        if(!proofs.has(proofKey)){
          const savedGeometry=outputGeometry(reference.state.crop,W,H,snapshot.maxSide||1400);
          const proof=await renderVersion(reference,savedGeometry,reference.state.crop,options,[...stack,v.id]);
          if(hash(Buffer.from(proof.pixels))!==snapshot.pixelHash)fail('REFERENCE_REPLAY_CHANGED','当前渲染器或字体不能复现无损参考。请使用保存的参考图重新确认保护。');
          proofs.add(proofKey);
        }
        const replay=await renderVersion(reference,g,renderCrop,options,[...stack,v.id]);references.set(reference.id,replay.pixels);
      }
    }
    pixels=compositeProtectedRegions(pixels,width,height,regions,references,actualCrop,source);
    const result={pixels,textLayout};cache.set(cacheKey,result);return result;
  }
  async function renderFrame(key='current',options={}) {
    const version=findVersion(p,key);
    imagePromise??=sourceImage(folder,p);
    await imagePromise;
  if(options.revision!==undefined&&options.revision!==p.revision)fail('STALE_REVISION','预览请求的项目已更新，请重新读取。');
  if(options.selectionHash!==undefined&&options.selectionHash!==version.selectionHash)fail('STALE_SELECTION','预览请求与当前勾选组合不一致。');
  const crop=options.referenceCrop!==undefined?options.referenceCrop:version.state.crop;
  if(guardsOf(version.state).regions.length&&!equal(crop,version.state.crop))fail('PROTECTED_GEOMETRY','已保护版本不能换用另一裁剪网格对照。');
  const maxSide=Math.max(512,Math.min(8192,Number(options.maxSide)||1400));
  const geometry=outputGeometry(crop,W,H,maxSide);
  const frameSpec={sourceRect:geometry.rect,width:geometry.width,height:geometry.height,angle:crop?.angle||0,pixelCenters:'half',pipeline:options.original?pipelineVersion:versionPipeline(version),...(options.maskView?{maskView:options.maskView}:{})};
  const withoutText=Boolean(options.withoutText);
  const rendered=await renderVersion(version,geometry,crop,options);
  let pixels=rendered.pixels,width=geometry.width,height=geometry.height,sourceRect=geometry.rect,regionPixels;
  if(options.region){
    const r=cleanRect(options.region),actualCrop={x:geometry.rect.x/W,y:geometry.rect.y/H,width:geometry.rect.width/W,height:geometry.rect.height/H,angle:crop?.angle||0};
    const view=transformRect(r,point=>originalToViewPoint(point,actualCrop,W,H));
    if(!view)fail('REGION_OUTSIDE','这处范围不在当前画幅内。');
    const left=Math.max(0,Math.floor(view.x*width)),top=Math.max(0,Math.floor(view.y*height));
    const right=Math.min(width,Math.ceil((view.x+view.width)*width)),bottom=Math.min(height,Math.ceil((view.y+view.height)*height));
    regionPixels={left,top,width:right-left,height:bottom-top};
    const extracted=new Uint8ClampedArray(regionPixels.width*regionPixels.height*4);
    for(let y=0;y<regionPixels.height;y++)extracted.set(pixels.subarray(((top+y)*width+left)*4,((top+y)*width+right)*4),y*regionPixels.width*4);
    sourceRect={x:geometry.rect.x+left/width*geometry.rect.width,y:geometry.rect.y+top/height*geometry.rect.height,width:regionPixels.width/width*geometry.rect.width,height:regionPixels.height/height*geometry.rect.height};
    pixels=extracted;width=regionPixels.width;height=regionPixels.height;
  }
  // Encode raw final RGBA, avoiding a second canvas premultiplication round-trip.
  let png=await sharp(Buffer.from(pixels),{raw:{width,height,channels:4}}).png().toBuffer();
  if(options.showNotes){
    const canvas=createCanvas(width,height),context=canvas.getContext('2d');context.putImageData(new ImageData(pixels,width,height),0,0);
    const noteCrop={x:sourceRect.x/W,y:sourceRect.y/H,width:sourceRect.width/W,height:sourceRect.height/H,angle:crop?.angle||0};
    for(const n of p.notes){const r=transformRect(n.rect,x=>originalToViewPoint(x,noteCrop,W,H));if(!r)continue;context.strokeStyle='#ffe5b8';context.lineWidth=2;context.strokeRect(r.x*width,r.y*height,r.width*width,r.height*height);context.fillStyle='#dfcfb5';context.fillRect(r.x*width,r.y*height,24,23);context.fillStyle='#242829';context.font='14px sans-serif';context.fillText(String(n.number),r.x*width+7,r.y*height+17);}
    png=canvas.toBuffer('image/png');
  }
  const pixelHash=hash(Buffer.from(pixels));
  return {png,pixels,width,height,sourceRect,limited:geometry.limited,versionId:version.id,revision:p.revision,selectionHash:version.selectionHash||null,stateHash:versionStateHash(version),frameSpec,frameSpecHash:hash(frameSpec),regionPixels,regionMode:options.region?'crop-final-frame':undefined,stats:photoMetering(pixels,width,height),textLayout:rendered.textLayout,withoutText,pipeline:frameSpec.pipeline,pixelHash,renderPixelHash:pixelHash};
}
  async function previewPhoto(key='current',options={}) {
  const frame=await renderFrame(key,options);const name=`${frame.versionId}-${hash({options,stateHash:frame.stateHash,selectionHash:frame.selectionHash,frameSpec:frame.frameSpec}).slice(0,20)}.png`,file=path.join(path.resolve(folder),'previews',name);
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,frame.png,{mode:0o600});
  const {png,pixels,...metadata}=frame;return {path:file,...metadata};
}
  return {project:p,renderFrame,previewPhoto};
}
export async function renderFrame(folder,key='current',options={}) {
  return (await createRenderSession(folder)).renderFrame(key,options);
}
export async function previewPhoto(folder,key='current',options={}) {
  return (await createRenderSession(folder)).previewPhoto(key,options);
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
  return {path:output,versionId:v.id,width:frame.width,height:frame.height,limited:frame.limited,format,dpi,quality,bytes:bytes.length,pipeline:frame.pipeline,pixelHash:frame.pixelHash,renderPixelHash:frame.pixelHash,fileHash:hash(bytes),pixelGuarantee:format==='png'?'decoded-rgba':'before-lossy-encoding',frameSpec:frame.frameSpec,withoutText:frame.withoutText};
}
