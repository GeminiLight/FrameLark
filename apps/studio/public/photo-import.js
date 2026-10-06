// Read bounded headers before asking the browser to allocate a full image.
// The browser owns EXIF orientation; we verify JPEG dimensions, never rotate twice.
export const importLimits=Object.freeze({bytes:30*1024*1024,pixels:50_000_000,edge:16384,workspacePixels:100_000_000,photos:12,headerBytes:1024*1024,timeoutMs:30000});
// One active RAW decode and eight queued decodes can each use up to 180 seconds.
// The browser deadline also leaves time for upload and proxy construction.
export const rawImportLimits=Object.freeze({bytes:512*1024*1024,timeoutMs:30*60*1000});
export const isRawPhotoName=name=>/\.(dng|crw|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|ptx|srw|x3f|3fr|fff|iiq|mos|mrw|kdc|dcr|erf|rwl|raw)$/i.test(name);
export const importAccept='image/*,.heic,.heif,.avif,.dng,.crw,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.raf,.orf,.rw2,.pef,.ptx,.srw,.x3f,.3fr,.fff,.iiq,.mos,.mrw,.kdc,.dcr,.erf,.rwl,.raw,.tif,.tiff';
const mime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif'};
const text=(b,p,n)=>String.fromCharCode(...b.subarray(p,p+n));
const u32=(b,p,little=false)=>p+4<=b.length ? new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(p,little):0;
const u16=(b,p,little=false)=>p+2<=b.length ? new DataView(b.buffer,b.byteOffset,b.byteLength).getUint16(p,little):0;
const u24=(b,p)=>b[p]+(b[p+1]<<8)+(b[p+2]<<16);

export class PhotoImportError extends Error {
  constructor(code,detail='') {super(code);this.name='PhotoImportError';this.code=code;this.detail=detail;}
}
export function importProblem(error) {
  const code=error?.name==='AbortError' ? 'CANCELLED':error?.code || 'READ';
  const messages={
    EMPTY:['文件是空的','从原照片重新下载或导出，再选择一次。'],
    SIZE:['文件超过 30 MB','导出一份小于 30 MB 的 JPEG/PNG 副本；原文件无需删除。'],
    RAW_SIZE:['RAW 文件超过 512 MiB','请选择较小的 RAW 文件，或从相机软件导出 JPEG/PNG 副本；原片无需删除。'],
    RAW_TIMEOUT:['RAW 导入等待超时','已停止这次请求；检查本机服务或解码队列后重试，其他照片和原片保留。'],
    HEIC:['HEIC / HEIF 未能转换','macOS 本地工作台可以自动转换；其他环境请先转为 JPEG/PNG。改文件后缀不能转换格式。'],
    RAW:['RAW 未能读取',error?.detail||'请使用本机 RAW 后端，检查机型与压缩方式；其他照片和原片保留。'],
    FORMAT:['不是支持的照片格式','请选择 JPG、PNG、WebP 或 AVIF；文件内容必须是照片。'],
    HEADER:['照片头信息不完整','重新下载原文件，或从照片软件重新导出 JPEG/PNG。'],
    ANIMATED:['这是一张动态图片','导出你想编辑的那一帧为静态 JPEG/PNG，再添加。'],
    DIMENSIONS:['照片尺寸超出读取范围','缩小到 5,000 万像素以内，且最长边不超过 16,384 px，再添加。'],
    WORKSPACE_PIXELS:['工作区照片总尺寸接近上限','先保存草稿或导出，再移出部分照片；工作区总量上限为 1 亿像素。'],
    CAPACITY:['工作区已打开 12 张照片','先保存草稿或导出，再移出部分照片，然后重试。'],
    DECODE:['当前浏览器未能解码这张照片','可重试；若仍失败，请重新导出 JPEG/PNG，或更换支持该格式的浏览器。'],
    ORIENTATION:['浏览器未正确读取照片方向','从照片软件导出方向已校正的 JPEG/PNG 副本，再添加。'],
    READ:['未能完整读取文件','确认照片已下载到设备、仍可打开，然后重试或重新选择。'],
    TIMEOUT:['读取超过 30 秒','确认文件已下载完成；可重试，或缩小照片后重新选择。'],
    RESOURCE:['没有足够空间读取照片','先保存草稿并移出部分大照片，或缩小这张照片，再重试。'],
    CANCELLED:['已取消读取','已经加入的照片和当前编辑都保留；需要时可以重试。']
  };
  const [reason,action]=messages[code] || messages.READ;
  return {code,reason,action,detail:error?.detail || '',retryable:['CAPACITY','WORKSPACE_PIXELS','READ','TIMEOUT','RESOURCE','DECODE','CANCELLED','RAW_TIMEOUT'].includes(code)};
}

function exifOrientation(bytes) {
  // APP1 payload starts with Exif\0\0. Malformed optional metadata stays neutral.
  if(text(bytes,0,6)!=='Exif\0\0')return 1;
  const b=bytes.subarray(6),little=text(b,0,2)==='II';
  if(!['II','MM'].includes(text(b,0,2)) || u16(b,2,little)!==42)return 1;
  const offset=u32(b,4,little),count=u16(b,offset,little);
  if(offset<8 || offset+2+count*12>b.length)return 1;
  for(let i=0;i<count;i++) {
    const p=offset+2+i*12;
    if(u16(b,p,little)===0x112 && u16(b,p+2,little)===3 && u32(b,p+4,little)===1) {
      const orientation=u16(b,p+8,little);return orientation>=1 && orientation<=8 ? orientation:1;
    }
  }
  return 1;
}
function jpegInfo(b) {
  let p=2,width=0,height=0,orientation=1;
  while(p+4<=b.length) {
    if(b[p++]!==0xff)throw new PhotoImportError('HEADER');
    while(b[p]===0xff)p++;
    const marker=b[p++];
    if(marker===0xda || marker===0xd9)break;
    if(marker===0x01 || marker>=0xd0 && marker<=0xd8)continue;
    const length=u16(b,p);
    if(length<2 || p+length>b.length)throw new PhotoImportError('HEADER');
    if(marker===0xe1 && text(b,p+2,6)==='Exif\0\0')orientation=exifOrientation(b.subarray(p+2,p+length));
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if(length<8)throw new PhotoImportError('HEADER');
      height=u16(b,p+3);width=u16(b,p+5);
    }
    p+=length;
  }
  return {width,height,orientation};
}
function pngInfo(b) {
  if(text(b,12,4)!=='IHDR' || u32(b,8)!==13 || b.length<33)throw new PhotoImportError('HEADER');
  const info={width:u32(b,16),height:u32(b,20),orientation:1};
  for(let p=33;p+8<=b.length;) {
    const length=u32(b,p),type=text(b,p+4,4);
    if(type==='acTL')throw new PhotoImportError('ANIMATED');
    if(type==='IDAT')break;
    if(p+length+12>b.length)break;
    p+=length+12;
  }
  return info;
}
function webpInfo(b,size) {
  if(u32(b,4,true)+8>size)throw new PhotoImportError('HEADER');
  let width=0,height=0;
  for(let p=12;p+8<=b.length;) {
    const type=text(b,p,4),length=u32(b,p+4,true),q=p+8;
    if(type==='ANIM' || type==='ANMF' || type==='VP8X' && (b[q]&2))throw new PhotoImportError('ANIMATED');
    if(type==='VP8X' && length>=10 && q+10<=b.length){width=u24(b,q+4)+1;height=u24(b,q+7)+1;}
    if(type==='VP8 ' && !width && length>=10 && q+10<=b.length && text(b,q+3,3)==='\x9d\x01\x2a'){width=u16(b,q+6,true)&0x3fff;height=u16(b,q+8,true)&0x3fff;}
    if(type==='VP8L' && !width && length>=5 && q+5<=b.length && b[q]===0x2f){const bits=u32(b,q+1,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
    p=q+length+(length%2);
  }
  return {width,height,orientation:1};
}
function avifInfo(b) {
  let width=0,height=0;
  // Only walk actual box boundaries, including ipco image-size properties.
  const walk=(start,end,depth=0)=>{
    if(depth>6)return;
    for(let p=start;p+8<=end;) {
      const size=u32(b,p),type=text(b,p+4,4);
      if(size<8 || p+size>end)break;
      if(type==='ispe' && size>=20){width=Math.max(width,u32(b,p+12));height=Math.max(height,u32(b,p+16));}
      if(['meta','iprp','ipco'].includes(type))walk(p+8+(type==='meta' ? 4:0),p+size,depth+1);
      p+=size;
    }
  };
  walk(0,b.length);return {width,height,orientation:1};
}
export function inspectPhotoHeader(input,{size=input.byteLength,name='',type='',maxBytes=importLimits.bytes}={}) {
  const b=input instanceof Uint8Array ? input:new Uint8Array(input);
  if(!size)throw new PhotoImportError('EMPTY');
  if(size>maxBytes)throw new PhotoImportError('SIZE');
  let format,info;
  if(b[0]===0xff && b[1]===0xd8 && b[2]===0xff){format='jpeg';info=jpegInfo(b);}
  else if(text(b,0,8)==='\x89PNG\r\n\x1a\n'){format='png';info=pngInfo(b);}
  else if(text(b,0,4)==='RIFF' && text(b,8,4)==='WEBP'){format='webp';info=webpInfo(b,size);}
  else if(text(b,4,4)==='ftyp') {
    const length=u32(b,0),brands=[text(b,8,4)];
    for(let p=16;p+4<=Math.min(length,b.length,256);p+=4)brands.push(text(b,p,4));
    if(brands.includes('avif') || brands.includes('avis')) {
      if(brands.includes('avis'))throw new PhotoImportError('ANIMATED');
      format='avif';info=avifInfo(b);
    } else if(brands.some(brand=>['heic','heix','hevc','hevx','heim','heis','hevm','hevs','mif1','msf1'].includes(brand)))throw new PhotoImportError('HEIC');
    else throw new PhotoImportError('FORMAT');
  } else {
    if(/\.(heic|heif)$/i.test(name) || /image\/(heic|heif)/.test(type))throw new PhotoImportError('HEIC');
    if(/\.(dng|cr2|cr3|nef|arw|raf|orf|rw2|tiff?)$/i.test(name) || text(b,0,4)==='II*\0' || text(b,0,4)==='MM\0*')throw new PhotoImportError('RAW');
    throw new PhotoImportError('FORMAT');
  }
  const {width,height,orientation}=info;
  if(!width || !height)throw new PhotoImportError('HEADER');
  if(width*height>importLimits.pixels || Math.max(width,height)>importLimits.edge)throw new PhotoImportError('DIMENSIONS',`${width.toLocaleString()} × ${height.toLocaleString()} px`);
  return {format,mime:mime[format],width,height,pixels:width*height,orientation,displayWidth:orientation>=5 ? height:width,displayHeight:orientation>=5 ? width:height};
}
export async function inspectPhotoFile(file,{maxBytes=importLimits.bytes}={}) {
  if(!file.size)throw new PhotoImportError('EMPTY');
  if(file.size>maxBytes)throw new PhotoImportError('SIZE');
  let bytes;
  try {bytes=await file.slice(0,importLimits.headerBytes).arrayBuffer();}
  catch {throw new PhotoImportError('READ');}
  const metadata=inspectPhotoHeader(bytes,{size:file.size,name:file.name,type:file.type,maxBytes});
  if(['jpeg','png'].includes(metadata.format)) {
    let tail;
    try {tail=new Uint8Array(await file.slice(Math.max(0,file.size-4096)).arrayBuffer());}
    catch {throw new PhotoImportError('READ');}
    if(metadata.format==='jpeg' && !tail.some((byte,index)=>byte===0xff && tail[index+1]===0xd9))throw new PhotoImportError('HEADER');
    if(metadata.format==='png' && (text(tail,tail.length-8,4)!=='IEND' || u32(tail,tail.length-12)!==0))throw new PhotoImportError('HEADER');
  }
  return metadata;
}
export function checkImportCapacity(metadata,{count=0,pixels=0}={}) {
  if(count>=importLimits.photos)throw new PhotoImportError('CAPACITY');
  if(pixels+metadata.pixels>importLimits.workspacePixels)throw new PhotoImportError('WORKSPACE_PIXELS');
}
export function validateDecodedPhoto(image,metadata) {
  const width=image.naturalWidth,height=image.naturalHeight;
  if(!width || !height)throw new PhotoImportError('DECODE');
  if(width*height>importLimits.pixels || Math.max(width,height)>importLimits.edge)throw new PhotoImportError('DIMENSIONS');
  if(metadata?.format==='jpeg' && (width!==metadata.displayWidth || height!==metadata.displayHeight))throw new PhotoImportError('ORIENTATION');
  return image;
}
export function loadPhotoImage(src,{signal,metadata,timeoutMs=importLimits.timeoutMs,createImage=()=>new Image()}={}) {
  return new Promise((resolve,reject)=>{
    const image=createImage();let settled=false,timer;
    const finish=(error)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=null;image.onerror=null;
      if(error){image.src='';reject(error);}else resolve(image);
    };
    const abort=()=>finish(new PhotoImportError('CANCELLED'));
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(new PhotoImportError('TIMEOUT')),timeoutMs);
    image.onload=()=>{try{validateDecodedPhoto(image,metadata);finish();}catch(error){finish(error);}};
    image.onerror=()=>finish(new PhotoImportError('DECODE'));
    image.src=src;
  });
}
export async function runImportBatch(rows,{signal,inspect=inspectPhotoFile,prepare=async file=>file,capacity,commit,onChange=()=>{}}) {
  for(const row of rows) {
    if(row.status==='success')continue;
    row.status='reading';row.problem=null;onChange(row);
    try {
      if(signal?.aborted)throw new PhotoImportError('CANCELLED');
      const raw=isRawPhotoName(row.file.name);
      const prepared=await boundedRead(stepSignal=>prepare(row.file,stepSignal),signal,{timeoutMs:raw?rawImportLimits.timeoutMs:importLimits.timeoutMs,timeoutCode:raw?'RAW_TIMEOUT':'TIMEOUT'});
      const metadata=await boundedRead(stepSignal=>inspect(prepared,{maxBytes:prepared===row.file?importLimits.bytes:220_000_000,signal:stepSignal}),signal);
      if(prepared!==row.file)metadata.convertedFrom=prepared.rawProject?'RAW':'HEIC';
      if(signal?.aborted)throw new PhotoImportError('CANCELLED');
      checkImportCapacity(metadata,capacity());
      row.photo=await commit(prepared,metadata,signal,row.file);
      row.status='success';row.metadata={...metadata,displayWidth:row.photo?.width || metadata.displayWidth,displayHeight:row.photo?.height || metadata.displayHeight};
    } catch(error) {row.status='failed';row.problem=importProblem(error);}
    onChange(row);
  }
  return rows;
}
function boundedRead(read,signal,{timeoutMs=importLimits.timeoutMs,timeoutCode='TIMEOUT'}={}) {
  return new Promise((resolve,reject)=>{
    let finished=false,timer;const controller=new AbortController();
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)controller.abort(error);error ? reject(error):resolve(value);};
    const abort=()=>finish(new PhotoImportError('CANCELLED'));
    if(signal?.aborted){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(new PhotoImportError(timeoutCode)),timeoutMs);
    Promise.resolve().then(()=>finished?undefined:read(controller.signal)).then(value=>finish(null,value),error=>finish(error));
  });
}
