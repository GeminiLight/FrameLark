import {PhotoImportError,importLimits} from './photo-import.js';
export async function preparePhotoFile(file,{signal,fetchImpl=fetch}={}) {
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
