import {exportLimits} from './export-settings.js';
const utf8=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1 ? 0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes) {let c=0xffffffff;for(const byte of bytes)c=crcTable[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
const concat=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;};
function pngChunk(type,data) {const name=utf8.encode(type),out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(name,4);out.set(data,8);view.setUint32(data.length+8,crc32(out.subarray(4,data.length+8)));return out;}
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function jpegSegment(marker,data) {if(data.length>65533)throw new Error('作品信息过长');const out=new Uint8Array(data.length+4);out.set([255,marker,(data.length+2)>>8,(data.length+2)&255]);out.set(data,4);return out;}
function exifDensity(dpi) {
  const tiff=new Uint8Array(108),v=new DataView(tiff.buffer);tiff.set([73,73,42,0]);v.setUint32(4,8,true);v.setUint16(8,4,true);
  function tag(offset,id,type,count,value){v.setUint16(offset,id,true);v.setUint16(offset+2,type,true);v.setUint32(offset+4,count,true);v.setUint32(offset+8,value,true);}
  tag(10,0x11a,5,1,62);tag(22,0x11b,5,1,70);tag(34,0x128,3,1,2);tag(46,0x8769,4,1,78);
  v.setUint32(62,dpi,true);v.setUint32(66,1,true);v.setUint32(70,dpi,true);v.setUint32(74,1,true);v.setUint16(78,2,true);
  tag(80,0x9000,7,4,0x32333230);tag(92,0xa001,3,1,1);
  return concat([utf8.encode('Exif\0\0'),tiff]);
}
// Rewrite encoded metadata only. Source EXIF/GPS is never copied; pixel data is untouched.
export function writeImageMetadata(input,format,{dpi=96,includeArtwork=false,title='',author='',copyright=''}={}) {
  const bytes=input instanceof Uint8Array ? input:new Uint8Array(input);dpi=[96,240,300].includes(Number(dpi)) ? Number(dpi):96;
  const fields=includeArtwork ? {Title:String(title).slice(0,160),Author:String(author).slice(0,100),Copyright:String(copyright).slice(0,180)}:{};
  if(format==='png') {
    if(bytes[0]!==137 || bytes[1]!==80)throw new Error('PNG 编码未完成');
    const density=new Uint8Array(9),v=new DataView(density.buffer);v.setUint32(0,Math.round(dpi/0.0254));v.setUint32(4,Math.round(dpi/0.0254));density[8]=1;
    const gamma=new Uint8Array(4);new DataView(gamma.buffer).setUint32(0,45455);
    const additions=[pngChunk('sRGB',Uint8Array.of(0)),pngChunk('gAMA',gamma),pngChunk('pHYs',density),...Object.entries(fields).filter(([,value])=>value).map(([key,value])=>pngChunk('iTXt',concat([utf8.encode(key),new Uint8Array(5),utf8.encode(value)])))];
    const parts=[bytes.subarray(0,8)];let offset=8,sawHeader=false,sawEnd=false;
    while(offset+12<=bytes.length) {const size=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0),end=offset+12+size;if(end>bytes.length)throw new Error('PNG 文件不完整');const type=new TextDecoder().decode(bytes.subarray(offset+4,offset+8));
      if(['IHDR','PLTE','IDAT','IEND','tRNS'].includes(type))parts.push(bytes.subarray(offset,end));
      if(type==='IHDR'){parts.push(...additions);sawHeader=true;}if(type==='IEND'){sawEnd=true;break;}offset=end;
    }
    if(!sawHeader || !sawEnd)throw new Error('PNG 文件不完整');return concat(parts);
  }
  if(bytes[0]!==255 || bytes[1]!==216)throw new Error('JPG 编码未完成');
  const jfif=Uint8Array.of(74,70,73,70,0,1,2,1,dpi>>8,dpi&255,dpi>>8,dpi&255,0,0);
  const parts=[bytes.subarray(0,2),jpegSegment(0xe0,jfif),jpegSegment(0xe1,exifDensity(dpi))];
  if(Object.values(fields).some(Boolean)) {
    const xmp=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(fields.Title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${xml(fields.Author)}</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xml(fields.Copyright)}</rdf:li></rdf:Alt></dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>`;
    parts.push(jpegSegment(0xe1,concat([utf8.encode('http://ns.adobe.com/xap/1.0/\0'),utf8.encode(xmp)])));
  }
  let offset=2;while(offset+4<=bytes.length) {if(bytes[offset]!==255)throw new Error('JPG 文件不完整');const marker=bytes[offset+1];if(marker===0xda || marker===0xd9){parts.push(bytes.subarray(offset));return concat(parts);}const length=(bytes[offset+2]<<8)|bytes[offset+3];if(length<2 || offset+2+length>bytes.length)throw new Error('JPG 文件不完整');if(!(marker>=0xe0 && marker<=0xef) && marker!==0xfe)parts.push(bytes.subarray(offset,offset+2+length));offset+=2+length;}
  throw new Error('JPG 文件不完整');
}
// JPEG and PNG already compress pixels. ZIP uses the store method and UTF-8 filenames.
export async function createPhotoArchive(files,{limit=exportLimits.archiveBytes}={}) {
  if(!files.length)throw new Error('还没有可下载的成片');
  if(files.length>100 || files.reduce((n,file)=>n+file.blob.size+utf8.encode(file.name).length*2+100,22)>limit)throw new Error('成片合计超过 128 MB，请按照片分别下载，或使用分享尺寸。');
  const parts=[],directory=[];let offset=0;
  for(const file of files) {
    const name=utf8.encode(file.name),bytes=new Uint8Array(await file.blob.arrayBuffer()),crc=crc32(bytes),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);local.set(name,30);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
    parts.push(local,file.blob);directory.push(central);offset+=local.length+bytes.length;
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,directory.reduce((n,item)=>n+item.length,0),true);v.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}
