import {PhotoImportError,importLimits} from './photo-import.js';
export async function preparePhotoFile(file,{signal,fetchImpl=fetch}={}) {
  if(/\.(dng|crw|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|ptx|srw|x3f|3fr|fff|iiq|mos|mrw|kdc|dcr|erf|rwl|raw)$/i.test(file.name)){
    if(file.size>512*1024*1024)throw new PhotoImportError('SIZE','RAW 文件超过 512 MiB。');
    const response=await fetchImpl('/api/projects/create',{method:'POST',signal,headers:{'Content-Type':'application/octet-stream','X-Photo-Name':encodeURIComponent(file.name)},body:file});
    if(!response.ok){const problem=await response.json().catch(()=>null);throw new PhotoImportError('RAW',problem?.error?.message||'本机 RAW 后端未就绪或机型不支持。');}
    const project=await response.json(),source=await fetchImpl(`/api/projects/${project.id}/source`,{signal});if(!source.ok)throw new PhotoImportError('RAW','RAW 已保存，但代理预览未能读取，请从项目重新打开。');
    const result=new File([await source.blob()],file.name,{type:'image/png',lastModified:file.lastModified});result.rawProject=project;return result;
  }
  if(file.size>importLimits.bytes)throw new PhotoImportError('SIZE');
  if(signal?.aborted)throw new PhotoImportError('CANCELLED');
  const bytes=new Uint8Array(await file.slice(0,96).arrayBuffer()),header=String.fromCharCode(...bytes);
  const raster=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff||header.startsWith('\x89PNG\r\n\x1a\n')||header.startsWith('RIFF')&&header.slice(8,12)==='WEBP'||header.slice(4,8)==='ftyp'&&/avif|avis/.test(header);
  if(raster)return file;
  const heic=/\.(heic|heif)$/i.test(file.name)||/image\/hei[cf]/i.test(file.type)||header.slice(4,8)==='ftyp'&&/heic|heix|mif1/.test(header)&&!/avif|avis/.test(header);
  if(!heic)return file;
  const response=await fetchImpl('/api/photos/convert',{method:'POST',signal,headers:{'Content-Type':'application/octet-stream'},body:file});
  if(!response.ok){let message='HEIC 转换未完成，请重试或先转为 JPEG/PNG。';try{message=(await response.json()).error?.message || message;}catch{}throw new PhotoImportError('HEIC',message);}
  const blob=await response.blob();return new File([blob],file.name,{type:'image/png',lastModified:file.lastModified});
}
