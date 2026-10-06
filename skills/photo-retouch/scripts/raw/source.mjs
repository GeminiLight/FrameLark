import {readFile,writeFile,mkdir,mkdtemp,rm,stat,open,copyFile,link} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {decodeRaw} from './backends.mjs';
import {rawVersion,rawHash,rawLimits,rawError,validateRawDimensions,validateRawManifest} from './contract.mjs';
import {encodeWorking} from '../engine/edit-stack/kernels.js';
export async function hashFile(file,{finite=false,signal}={}){const hash=createHash('sha256'),fd=await open(file,'r'),buffer=Buffer.alloc(1024*1024);try{let bytes;while((bytes=(await fd.read(buffer,0,buffer.length,null)).bytesRead)){signal?.throwIfAborted();if(finite){const values=new Float32Array(buffer.buffer,buffer.byteOffset,bytes/4);for(const value of values)if(!Number.isFinite(value))throw rawError('RAW_INVALID_PIXELS','RAW 解码产生了无效像素。');}hash.update(buffer.subarray(0,bytes));}return hash.digest('hex');}finally{await fd.close();}}
export function displayPixels(linear,{depth=8}={}){const out=depth===16?new Uint16Array(linear.length/4*3):new Uint8ClampedArray(linear.length),rgb=[0,0,0];for(let i=0;i<linear.length;i+=4){encodeWorking(linear[i],linear[i+1],linear[i+2],rgb);if(depth===16){const at=i/4*3;for(let c=0;c<3;c++)out[at+c]=Math.round(rgb[c]/255*65535);}else{for(let c=0;c<3;c++)out[i+c]=rgb[c];out[i+3]=linear[i+3];}}return out;}
export async function buildRawProxy(file,width,height,{signal}={}){
  const scale=Math.min(1,rawLimits.proxySide/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)),out=new Float32Array(w*h*4),fd=await open(file,'r'),rows=new Map();
  async function row(y){if(!rows.has(y)){const b=Buffer.alloc(width*16);const {bytesRead}=await fd.read(b,0,b.length,y*width*16);if(bytesRead!==b.length)throw rawError('RAW_CACHE_CHANGED','RAW 像素缓存不完整。');rows.set(y,new Float32Array(b.buffer,b.byteOffset,b.length/4));if(rows.size>4)rows.delete(rows.keys().next().value);}return rows.get(y);}
  try{for(let y=0;y<h;y++){signal?.throwIfAborted();const sy=Math.max(0,Math.min(height-1,(y+.5)/h*height-.5)),y0=Math.floor(sy),fy=sy-y0,a=await row(y0),b=await row(Math.min(height-1,y0+1));for(let x=0;x<w;x++){const sx=Math.max(0,Math.min(width-1,(x+.5)/w*width-.5)),x0=Math.floor(sx),fx=sx-x0,x1=Math.min(width-1,x0+1);for(let c=0;c<4;c++){const v=(a[x0*4+c]*(1-fx)+a[x1*4+c]*fx)*(1-fy)+(b[x0*4+c]*(1-fx)+b[x1*4+c]*fx)*fy;if(!Number.isFinite(v))throw rawError('RAW_INVALID_PIXELS','RAW 解码产生了无效像素。');out[(y*w+x)*4+c]=v;}}}return {pixels:out,width:w,height:h};}finally{await fd.close();}
}
export async function prepareRawSource(source,folder,{signal,backend='auto'}={}){
  const size=(await stat(source)).size;if(size<1||size>rawLimits.bytes)throw rawError('RAW_SIZE','RAW 文件为空或超过 512 MiB。');
  const master=join(folder,'master.f32'),decoded=await decodeRaw(source,master,{signal,backend});validateRawDimensions(decoded.width,decoded.height);
  const masterBytes=(await stat(master)).size;if(masterBytes!==decoded.width*decoded.height*16)throw rawError('RAW_PROTOCOL','RAW 解码器的像素数量不一致。');
  signal?.throwIfAborted();const proxy=await buildRawProxy(master,decoded.width,decoded.height,{signal}),proxyBytes=Buffer.from(proxy.pixels.buffer),normalized=await sharp(displayPixels(proxy.pixels),{raw:{width:proxy.width,height:proxy.height,channels:4}}).png().toBuffer();
  const manifest=validateRawManifest({version:rawVersion,backend:decoded.backend,backendVersion:decoded.backendVersion,decoderVersion:decoded.decoderVersion,precision:decoded.precision,settings:decoded.settings,space:'linear-srgb',alphaScale:255,width:decoded.width,height:decoded.height,proxyWidth:proxy.width,proxyHeight:proxy.height,sourceHash:await hashFile(source),masterHash:await hashFile(master,{finite:true,signal}),masterBytes,proxyHash:rawHash(proxyBytes),proxyBytes:proxyBytes.length,normalizedHash:rawHash(normalized)});
  await writeFile(join(folder,'proxy.f32'),proxyBytes,{mode:0o600});await writeFile(join(folder,'normalized.png'),normalized,{mode:0o600});await writeFile(join(folder,'raw.json'),JSON.stringify(manifest),{mode:0o600});return manifest;
}
const proxies=new Map();let retained=0;
export async function createRawAssets(image,folder,options={}){
  await mkdir(folder,{recursive:false,mode:0o700});
  try{const source=join(folder,'source');await mkdir(source);await mkdir(join(folder,'previews'));await mkdir(join(folder,'exports'));const original=join(source,'original.bin');await copyFile(image,original);const input=join(source,'decode-input'+extname(image));await link(original,input);let manifest;try{manifest=await prepareRawSource(input,source,options);}finally{await rm(input,{force:true});}return {name:image.split(/[\\/]/).at(-1),format:'raw',checksum:manifest.sourceHash,normalizedChecksum:manifest.normalizedHash,width:manifest.width,height:manifest.height,bytes:(await stat(original)).size,raw:{manifestHash:rawHash(Buffer.from(JSON.stringify(manifest))),backend:manifest.backend,decoderVersion:manifest.decoderVersion,precision:manifest.precision,proxyWidth:manifest.proxyWidth,proxyHeight:manifest.proxyHeight}};}
  catch(error){await rm(folder,{recursive:true,force:true});throw error;}
}
export async function rawSource(folder,source,{master=false}={}){
  const base=join(folder,'source'),manifest=validateRawManifest(JSON.parse(await readFile(join(base,'raw.json'),'utf8')));
  if(manifest.width!==source.width||manifest.height!==source.height)throw rawError('RAW_MANIFEST','RAW 原片尺寸与显影记录不一致。');
  if(rawHash(Buffer.from(JSON.stringify(manifest)))!==source.raw.manifestHash||manifest.sourceHash!==source.checksum||await hashFile(join(base,'original.bin'))!==source.checksum)throw rawError('SOURCE_CHANGED','RAW 原片或显影记录已改变，请恢复备份。');
  if(await hashFile(join(base,'normalized.png'))!==manifest.normalizedHash)throw rawError('RAW_CACHE_CHANGED','RAW 显示代理已改变，请恢复项目备份。');
  if((await stat(join(base,'master.f32'))).size!==manifest.masterBytes)throw rawError('RAW_CACHE_CHANGED','RAW 高精度缓存尺寸已改变。');
  if(master){if(await hashFile(join(base,'master.f32'))!==manifest.masterHash)throw rawError('RAW_CACHE_CHANGED','RAW 高精度缓存身份已改变。');return {manifest,file:join(base,'master.f32'),width:manifest.width,height:manifest.height};}
  const key=folder+':'+manifest.proxyHash;let pixels=proxies.get(key);
  if(!pixels){const b=await readFile(join(base,'proxy.f32'));if(b.length!==manifest.proxyBytes||rawHash(b)!==manifest.proxyHash)throw rawError('RAW_CACHE_CHANGED','RAW 代理缓存已改变。');pixels=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));while(retained+pixels.byteLength>64*1024*1024&&proxies.size){const [id,old]=proxies.entries().next().value;proxies.delete(id);retained-=old.byteLength;}proxies.set(key,pixels);retained+=pixels.byteLength;}
  return {manifest,pixels,width:manifest.proxyWidth,height:manifest.proxyHeight};
}
