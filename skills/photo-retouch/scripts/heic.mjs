import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PhotoError} from './engine/edit-values.js';
const run=promisify(execFile);
export function heicKind(bytes) {
  if(bytes.length<16 || bytes.toString('ascii',4,8)!=='ftyp')return null;
  const size=Math.min(bytes.readUInt32BE(0),bytes.length,256),brands=[];
  for(let at=8;at+4<=size;at+=4)if(at!==12)brands.push(bytes.toString('ascii',at,at+4));
  if(brands.includes('avif')||brands.includes('avis'))return null;
  if(brands.some(b=>['msf1','hevc','hevx'].includes(b)))return 'sequence';
  return brands.some(b=>['heic','heix','mif1'].includes(b))?'still':null;
}
export async function convertHeic(bytes,{signal,platform=process.platform,exec=run}={}) {
  if(!bytes.length||bytes.length>30*1024*1024)throw new PhotoError('IMAGE_SIZE','HEIC 原文件须小于 30 MB。');
  if(heicKind(bytes)!=='still')throw new PhotoError('IMAGE_FORMAT','请选择单张静态 HEIC / HEIF 照片。');
  if(platform!=='darwin')throw new PhotoError('HEIC_UNAVAILABLE','本机暂不支持 HEIC 转换。请在 macOS 本地工作台打开，或先转为 JPEG/PNG。');
  const directory=await mkdtemp(join(tmpdir(),'frameyn-heic-'));
  try {
    const source=join(directory,'source.heic'),output=join(directory,'working.png');
    await writeFile(source,bytes,{mode:0o600});
    const options={signal,timeout:30000,killSignal:'SIGKILL',maxBuffer:16384};
    const info=await exec('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight',source],options);
    const width=Number(/pixelWidth:\s*(\d+)/.exec(info.stdout)?.[1]),height=Number(/pixelHeight:\s*(\d+)/.exec(info.stdout)?.[1]);
    if(!width||!height||width*height>50_000_000||Math.max(width,height)>16384)throw new PhotoError('IMAGE_SIZE','照片超过 5,000 万像素或最长边 16,384 px。');
    await exec('/usr/bin/sips',['-s','format','png',source,'--out',output],options);
    if((await stat(output)).size>220_000_000)throw new PhotoError('IMAGE_SIZE','转换后的照片过大，请先缩小尺寸。');
    const converted=await readFile(output);
    if(converted.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new PhotoError('IMAGE_DECODE','HEIC 转换失败，请重新导出照片。');
    return converted;
  }catch(error){
    if(error instanceof PhotoError)throw error;
    if(signal?.aborted)throw new PhotoError('CANCELLED','HEIC 转换已取消。');
    throw new PhotoError('IMAGE_DECODE','HEIC 转换未完成，请重试或先转为 JPEG/PNG。');
  }finally{await rm(directory,{recursive:true,force:true});}
}
