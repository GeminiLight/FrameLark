// One input contract for browser preparation and the HTTP/vision adapters.
export const seriesInputLimits=Object.freeze({minPhotos:2,maxPhotos:12,imageCharacters:600_000,requestBytes:3_800_000,previewSide:800});
const bytes=value=>new TextEncoder().encode(value).length;
const tooLarge=()=>new Error('组图的文字和预览数据过大，请缩短批注后重试；当前照片和编辑保留。');

export function seriesImageBudget(request){
  if(!Array.isArray(request?.photos)||request.photos.length<seriesInputLimits.minPhotos||request.photos.length>seriesInputLimits.maxPhotos)throw new Error('请选择 2–12 张照片组成一组。');
  // Reserve the exact UTF-8 metadata, punctuation and empty image fields.
  // Base64 JPEG URLs contain no JSON-escaped characters, so the remaining
  // bytes can be shared evenly without dropping any photo or annotation.
  const metadata={...request,photos:request.photos.map(photo=>({...photo,image:''}))};
  const available=seriesInputLimits.requestBytes-bytes(JSON.stringify(metadata));
  if(available<=0)throw tooLarge();
  return Math.min(seriesInputLimits.imageCharacters,Math.floor(available/request.photos.length));
}

export function encodeSeriesPreview(canvas,maxCharacters){
  let current=canvas;
  for(;;){
    const image=current.toDataURL('image/jpeg',.72);
    if(image.length<=maxCharacters)return image;
    if(current.width===1&&current.height===1)throw tooLarge();
    const scale=Math.min(.85,Math.sqrt(maxCharacters/image.length)*.95),next=document.createElement('canvas');
    next.width=Math.max(1,Math.floor(current.width*scale));next.height=Math.max(1,Math.floor(current.height*scale));
    next.getContext('2d').drawImage(current,0,0,next.width,next.height);current=next;
  }
}

export function seriesRequestBody(request){
  const body=JSON.stringify(request);
  if(bytes(body)>seriesInputLimits.requestBytes||request.photos.some(photo=>photo.image.length>seriesInputLimits.imageCharacters))throw tooLarge();
  return body;
}
