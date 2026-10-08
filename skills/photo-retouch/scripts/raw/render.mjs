import {open,readFile,writeFile,stat,readdir,rm,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import sharp from 'sharp';
import {createCanvas} from '@napi-rs/canvas';
import {rawSource,displayPixels} from './source.mjs';
import {rawHash,rawError} from './contract.mjs';
import {viewToOriginalPoint} from '../engine/photo-geometry.js';
import {renderStackPixels} from '../engine/edit-stack/render.js';
import {createDocument} from '../engine/edit-stack/document.js';
import {applyCommands} from '../engine/edit-stack/commands.js';
import {splitSettings,pixelTool} from '../engine/edit-stack/tools.js';
import {hash,versionStateHash} from '../engine/edit-identity.js';
import {validateReferences,readReferenceSnapshot} from '../reference-store.mjs';
import {neutralSettings,combineSettings} from '../engine/editor-engine.js';
import {presetById} from '../engine/presets.js';
import {drawTextOverlays} from '../text-overlays.mjs';
import {srgbToLinear} from '../engine/tone-processing.js';
import {protectionWeight} from '../engine/protected-regions.js';

const cacheMetadataLimit=1024,cachePngLimit=80*1024*1024,cacheBudget=256*1024*1024;
async function boundedCacheBytes(file,limit){
  let fd;try{fd=await open(file,'r');}catch(error){if(error.code==='ENOENT')return null;throw error;}
  try{
    const info=await fd.stat();if(!info.isFile()||info.size<1||info.size>limit)return null;
    const bytes=Buffer.alloc(info.size+1);let offset=0;
    while(offset<bytes.length){const read=await fd.read(bytes,offset,bytes.length-offset,null);if(!read.bytesRead)break;offset+=read.bytesRead;}
    return offset===info.size?bytes.subarray(0,offset):null;
  }finally{await fd.close();}
}
async function readFrameCache(cache,key,g){
  const metadataBytes=await boundedCacheBytes(cache.replace(/\.png$/,'.json'),cacheMetadataLimit);if(!metadataBytes)return null;
  let metadata;try{metadata=JSON.parse(metadataBytes.toString('utf8'));}catch(error){if(error instanceof SyntaxError)return null;throw error;}
  if(!metadata||metadata.schema!==1||metadata.key!==key||metadata.width!==g.width||metadata.height!==g.height||!Number.isSafeInteger(metadata.bytes)||metadata.bytes<1||metadata.bytes>cachePngLimit||typeof metadata.fileHash!=='string'||! /^[a-f0-9]{64}$/.test(metadata.fileHash))return null;
  const png=await boundedCacheBytes(cache,cachePngLimit);
  if(!png||png.length!==metadata.bytes||rawHash(png)!==metadata.fileHash||png.length<33||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)!==g.width||png.readUInt32BE(20)!==g.height)return null;
  let decoded;
  try{decoded=await sharp(png,{limitInputPixels:g.width*g.height,failOn:'error'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});}
  catch(error){
    // Buffer decoding has no filesystem access. Only corrupt PNG input is a
    // regeneratable miss; memory/resource failures and file IO still surface.
    if(!error.code&&!/memory|allocation|resource/i.test(error.message)&&/^Input buffer|\bpngload(?:_buffer)?\b|^vipspng:\s*libpng read error$/i.test(error.message))return null;
    throw error;
  }
  if(decoded.info.width!==g.width||decoded.info.height!==g.height||decoded.info.channels!==4||decoded.data.length!==g.width*g.height*4)return null;
  return {png,pixels:new Uint8ClampedArray(decoded.data),cached:true,cachePath:cache};
}
async function publishFrameCache(cache,key,g,png){
  if(png.length>cachePngLimit)return false;
  const metadata=cache.replace(/\.png$/,'.json'),token=randomUUID(),imageTemp=cache+'.'+token+'.tmp',metadataTemp=metadata+'.'+token+'.tmp';
  try{
    await writeFile(imageTemp,png,{flag:'wx',mode:0o600});
    await writeFile(metadataTemp,JSON.stringify({schema:1,key,width:g.width,height:g.height,bytes:png.length,fileHash:rawHash(png)}),{flag:'wx',mode:0o600});
    // Two atomic files are not an atomic pair. Readers require matching bytes,
    // so a interrupted/concurrent publication can only cause another render.
    await rename(imageTemp,cache);await rename(metadataTemp,metadata);return true;
  }finally{await rm(imageTemp,{force:true});await rm(metadataTemp,{force:true});}
}
async function cacheStat(file){try{return await stat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function pruneFrameCaches(folder,current){
  const directory=join(folder,'previews'),names=await readdir(directory),entries=[];
  for(const name of names)if(/^raw-[a-f0-9]{64}\.png$/.test(name)){
    const file=join(directory,name),image=await cacheStat(file);if(!image)continue;
    const metadata=file.replace(/\.png$/,'.json'),info=await cacheStat(metadata);
    entries.push({file,metadata,size:image.size+(info?.size||0),time:image.mtimeMs});
  }
  let total=entries.reduce((sum,e)=>sum+e.size,0);
  for(const entry of entries.sort((a,b)=>a.time-b.time)){
    if(total<=cacheBudget)break;if(entry.file===current)continue;
    await rm(entry.file,{force:true});await rm(entry.metadata,{force:true});total-=entry.size;
  }
  for(const name of names)if(/^raw-[a-f0-9]{64}\.json$/.test(name)&&!await cacheStat(join(directory,name.replace(/\.json$/,'.png'))))await rm(join(directory,name),{force:true});
}

export const rawRenderingVersion='raw-float-render-v1';
export function rawGeometry(crop,W,H,maxSide=2048,{full=false}={}){
  const area=crop||{x:0,y:0,width:1,height:1},rect={x:area.x*W,y:area.y*H,width:area.width*W,height:area.height*H},scale=full?1:Math.min(1,maxSide/Math.max(rect.width,rect.height),Math.sqrt(16_000_000/(rect.width*rect.height)));
  return {rect,width:Math.max(1,Math.floor(rect.width*scale)),height:Math.max(1,Math.floor(rect.height*scale)),limited:scale<1};
}
function floatRecipe(project,version){
  let recipe=version.recipe||createDocument({documentId:'raw-'+project.id,source:{assetId:project.id,contentHash:project.source.checksum,width:project.source.width,height:project.source.height},base:{settings:neutralSettings(),locals:[]}});
  const base=version.recipe?.base.state||version.state,settings=combineSettings({settings:base.settings},{settings:presetById(base.style?.id)?.adjustments,amount:(base.style?.amount||0)/100});
  // Compatibility controls are a deterministic prefix; pixel processing stays
  // Float32. The persisted editable document is never rewritten or flattened.
  let prefix=createDocument({documentId:recipe.documentId,source:recipe.source,base:{settings:neutralSettings(),locals:[],crop:version.state.crop}});
  const commands=splitSettings(settings).map((step,i)=>({type:'AddStep',step:{...step,id:'raw-base-'+i,title:'原有调整'}}));
  for(const [index,local] of (base.locals||[]).entries()){
    if(local.localEnabled===false||local.enabled===false)continue;
    const id='raw-local-'+index,mask={expression:{kind:'drawn',mask:{shape:local.maskType||'rectangle',rect:local.rect,feather:local.feather??.36,exclude:local.exclude||[],...(local.start?{start:local.start,end:local.end}:{}),...(local.points?{points:local.points,radius:local.brushRadius}: {})}},reference:{kind:'live-input'}};
    for(const [i,step] of splitSettings(local.localSettings||local.settings||{}).entries())commands.push({type:'AddStep',step:{...step,id:id+'-'+i,title:'原有局部调整',opacity:(local.localAmount??local.amount??100)/100}},{type:'ReplaceStepMask',stepId:id+'-'+i,mask});
  }
  for(let i=0;i<commands.length;i+=24)prefix=applyCommands(prefix,commands.slice(i,i+24)).next;
  return {prefix,recipe:{...recipe,base:prefix.base},halo:[...prefix.steps,...recipe.steps].reduce((sum,step)=>sum+(step.enabled?pixelTool(step.tool,step.toolVersion).halo:0),0)};
}
export async function sampleRawGrid(source,project,geometry,tile,crop){
  const W=project.source.width,H=project.source.height,area={x:geometry.rect.x/W,y:geometry.rect.y/H,width:geometry.rect.width/W,height:geometry.rect.height/H,angle:crop?.angle||0};
  const point=(x,y)=>{const p=viewToOriginalPoint({x:(x+.5)/geometry.width,y:(y+.5)/geometry.height},area,W,H);return {x:Math.max(0,Math.min(source.width-1,p.x*source.width-.5)),y:Math.max(0,Math.min(source.height-1,p.y*source.height-.5))};};
  let data=source.pixels,rowOffset=0;
  if(!data){
    const corners=[[tile.x,tile.y],[tile.x+tile.width-1,tile.y],[tile.x,tile.y+tile.height-1],[tile.x+tile.width-1,tile.y+tile.height-1]].map(([x,y])=>point(x,y));
    rowOffset=Math.floor(Math.min(...corners.map(p=>p.y)));
    // Even with zero interpolation weight, JS evaluates the neighboring sample.
    // Always include floor(maxY)+1 so tile boundaries cannot produce NaNs.
    const end=Math.min(source.height-1,Math.floor(Math.max(...corners.map(p=>p.y)))+1),size=(end-rowOffset+1)*source.width*16;
    if(size>256*1024*1024)throw rawError('RAW_RENDER_BUDGET','此旋转或细节组合需要过大的工作区，请减少细节步骤后重试。');
    if(source.band&&source.band.start<=rowOffset&&source.band.end>=end){data=source.band.data;rowOffset=source.band.start;}
    else{const bytes=Buffer.alloc(size),fd=await open(source.file,'r');try{const {bytesRead}=await fd.read(bytes,0,size,rowOffset*source.width*16);if(bytesRead!==size)throw rawError('RAW_CACHE_CHANGED','RAW 工作数据未能完整读取。');}finally{await fd.close();}data=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);source.band={start:rowOffset,end,data};}
  }
  const out=new Float32Array(tile.width*tile.height*4);
  for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++){const p=point(tile.x+x,tile.y+y),x0=Math.floor(p.x),y0=Math.floor(p.y),x1=Math.min(source.width-1,x0+1),y1=Math.min(source.height-1,y0+1),fx=p.x-x0,fy=p.y-y0;for(let c=0;c<4;c++){const a=data[((y0-rowOffset)*source.width+x0)*4+c]*(1-fx)+data[((y0-rowOffset)*source.width+x1)*4+c]*fx,b=data[((y1-rowOffset)*source.width+x0)*4+c]*(1-fx)+data[((y1-rowOffset)*source.width+x1)*4+c]*fx;const value=a*(1-fy)+b*fy;if(!Number.isFinite(value))throw rawError('RAW_INVALID_PIXELS','RAW 取样产生无效像素，已有成片保留。');out[(y*tile.width+x)*4+c]=value;}}
  return out;
}
export async function createRawRenderSession(folder,project,{master=false}={}){
  const source=await rawSource(folder,project.source,{master}),plans=new Map(),verified=new Set();let proxySession;
  function planFor(version){let plan=plans.get(version.id);if(!plan){plan=floatRecipe(project,version);plans.set(version.id,plan);}return plan;}
  function requiredHalo(version){return Math.max(planFor(version).halo,...(version.state.guards?.regions||[]).map(region=>requiredHalo(project.versions.find(v=>v.id===region.referenceVersionId))));}
  async function verifyVersion(version,withoutText=false){
    const key=version.id+':'+withoutText;if(verified.has(key))return;
    const owner=project.versions.indexOf(version);validateReferences(project,version.state,owner<0?project.versions.length:owner);
    for(const region of version.state.guards?.regions||[]){
      const reference=project.versions.find(v=>v.id===region.referenceVersionId),snapshot=withoutText?region.cleanSnapshot:region.snapshot;
      await readReferenceSnapshot(folder,region.snapshot);await readReferenceSnapshot(folder,region.cleanSnapshot);await verifyVersion(reference,withoutText);
      const g=rawGeometry(reference.state.crop,project.source.width,project.source.height,snapshot.maxSide||1400);
      if(g.width!==snapshot.width||g.height!==snapshot.height)throw rawError('REFERENCE_REPLAY_CHANGED','RAW 参考网格已改变，请重新确认保护。');
      if(master)proxySession??=await createRawRenderSession(folder,project);
      const proof=await (proxySession?.renderTile||renderTile)(reference,g,{x:0,y:0,width:g.width,height:g.height},reference.state.crop,{withoutText});
      if(hash(Buffer.from(proof.pixels))!==snapshot.pixelHash)throw rawError('REFERENCE_REPLAY_CHANGED','当前 RAW 渲染器或字体不能复现保存的参考，请重新确认保护。');
    }
    verified.add(key);
  }
  async function renderTile(version,g,tile,crop,options,seen=[]){
    if(seen.includes(version.id))throw rawError('REFERENCE_CYCLE','RAW 保护参考形成循环。');
    const plan=planFor(version);
    const linear=await sampleRawGrid(source,project,g,tile,crop),frame={fullWidth:project.source.width,fullHeight:project.source.height,sourceRect:{x:g.rect.x+tile.x/g.width*g.rect.width,y:g.rect.y+tile.y/g.height*g.rect.height,width:tile.width/g.width*g.rect.width,height:tile.height/g.height*g.rect.height},angle:crop?.angle||0};
    let working=linear;const placeholder=new Uint8ClampedArray(linear.length);
    for(const recipe of [plan.prefix,plan.recipe]){const rendered=renderStackPixels({pixels:options.maskView&&recipe===plan.recipe?displayPixels(working):placeholder,workingPixels:working,originalWorking:linear,linearOutput:true,width:tile.width,height:tile.height,document:recipe,frame,...(recipe===plan.recipe?{maskView:options.maskView}:{})});if(options.maskView&&recipe===plan.recipe)return {pixels:rendered.pixels};working=rendered.workingPixels;}
    if(!options.withoutText&&version.state.textOverlays?.length){const canvas=createCanvas(tile.width,tile.height),ctx=canvas.getContext('2d');drawTextOverlays(ctx,version.state.textOverlays,{width:tile.width,height:tile.height,compositionRect:g.rect,sourceRect:frame.sourceRect});const glyph=ctx.getImageData(0,0,tile.width,tile.height).data;for(let i=0;i<glyph.length;i+=4){const a=glyph[i+3]/255;if(a)for(let c=0;c<3;c++)working[i+c]=working[i+c]*(1-a)+srgbToLinear(glyph[i+c]/255)*a;}}
    const groups=new Map();for(const region of version.state.guards?.regions||[]){const masks=groups.get(region.referenceVersionId)||[];masks.push(region.mask);groups.set(region.referenceVersionId,masks);}
    for(const [id,masks] of groups){
      const reference=project.versions.find(v=>v.id===id);if(!reference)throw rawError('REFERENCE_MISSING','RAW 保护参考版本未找到。');
      const saved=await renderTile(reference,g,tile,crop,options,[...seen,version.id]),area={x:frame.sourceRect.x/project.source.width,y:frame.sourceRect.y/project.source.height,width:frame.sourceRect.width/project.source.width,height:frame.sourceRect.height/project.source.height,angle:crop?.angle||0};
      for(let y=0;y<tile.height;y++)for(let x=0;x<tile.width;x++){const p=viewToOriginalPoint({x:(x+.5)/tile.width,y:(y+.5)/tile.height},area,project.source.width,project.source.height),weight=Math.max(...masks.map(mask=>protectionWeight(mask,p))),at=(y*tile.width+x)*4;if(weight)for(let c=0;c<4;c++)working[at+c]=working[at+c]*(1-weight)+saved.working[at+c]*weight;}
    }
    return {working,pixels:displayPixels(working)};
  }
  return {source,plans,renderTile,verifyVersion,requiredHalo};
}
export async function rawFrame(folder,project,version,g,options={}){
  const session=await createRawRenderSession(folder,project,{master:options.master}),selected=options.original?project.versions[0]:version,crop=options.renderCrop??version.state.crop;
  await session.verifyVersion(selected,Boolean(options.withoutText));
  const key=rawHash(Buffer.from(JSON.stringify({renderer:rawRenderingVersion,source:project.source.raw.manifestHash,state:versionStateHash(selected),geometry:g,crop,options:{master:Boolean(options.master),maskView:options.maskView,withoutText:options.withoutText,original:options.original}}))),cache=join(folder,'previews','raw-'+key+'.png');
  const cached=await readFrameCache(cache,key,g);if(cached)return cached;
  const tile={x:0,y:0,width:g.width,height:g.height},result=options.master?{pixels:await renderTiles(session,project,selected,g,{...options,crop,depth:8})}:await session.renderTile(selected,g,tile,crop,options),png=await sharp(result.pixels,{raw:{width:g.width,height:g.height,channels:4}}).png().toBuffer();
  const published=await publishFrameCache(cache,key,g,png);
  // Only regeneratable RAW render caches are pruned. Version previews used by
  // accepted protection snapshots, the original and linear master are retained.
  await pruneFrameCaches(folder,cache);
  return {...result,png,cached:false,cachePath:published?cache:undefined};
}
export async function renderTiles(session,project,version,g,{depth=16,withoutText=false,tileSide=384,crop=version.state.crop,maskView}={}){
  await session.verifyVersion(version,withoutText);const halo=session.requiredHalo(version);
  if(halo>256)throw rawError('RAW_RENDER_BUDGET','细节步骤的累积邻域超过高精度导出预算，请减少细节步骤。');
  const channels=depth===16?3:4,rgb=depth===16?new Uint16Array(g.width*g.height*channels):new Uint8ClampedArray(g.width*g.height*channels);
  for(let y=0;y<g.height;y+=tileSide)for(let x=0;x<g.width;x+=tileSide){const w=Math.min(tileSide,g.width-x),h=Math.min(tileSide,g.height-y),tile={x:Math.max(0,x-halo),y:Math.max(0,y-halo),width:Math.min(g.width,x+w+halo)-Math.max(0,x-halo),height:Math.min(g.height,y+h+halo)-Math.max(0,y-halo)},result=await session.renderTile(version,g,tile,crop,{withoutText,maskView}),encoded=depth===16?displayPixels(result.working,{depth:16}):result.pixels;for(let row=0;row<h;row++)rgb.set(encoded.subarray(((y-tile.y+row)*tile.width+x-tile.x)*channels,((y-tile.y+row)*tile.width+x-tile.x+w)*channels),((y+row)*g.width+x)*channels);}
  return rgb;
}
export async function rawMasterExport(folder,project,version,{withoutText=false,tileSide=384}={}){
  const g=rawGeometry(version.state.crop,project.source.width,project.source.height,16384,{full:true}),session=await createRawRenderSession(folder,project,{master:true}),rgb=await renderTiles(session,project,version,g,{withoutText,tileSide,depth:16});
  const bytes=await sharp(rgb,{raw:{width:g.width,height:g.height,channels:3}}).toColourspace('rgb16').withIccProfile('srgb').tiff({compression:'deflate'}).toBuffer();return {bytes,width:g.width,height:g.height,limited:false,depth:16,pixelHash:rawHash(Buffer.from(rgb.buffer)),manifestHash:project.source.raw.manifestHash};
}
