import {createHash} from 'node:crypto';
export const rawVersion='raw-linear-srgb-v1';
export const rawLimits=Object.freeze({bytes:512*1024*1024,pixels:96_000_000,edge:16384,proxySide:2048,tileSide:768,timeoutMs:180000});
export const rawExtensions=/\.(dng|crw|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|ptx|srw|x3f|3fr|fff|iiq|mos|mrw|kdc|dcr|erf|rwl|raw)$/i;
export const rawHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function rawError(code,message){return Object.assign(new Error(message),{code});}
export function validateRawDimensions(width,height){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>rawLimits.pixels||Math.max(width,height)>rawLimits.edge)throw rawError('RAW_SIZE','RAW 尺寸超过当前处理上限（9600 万像素 / 16384px）。');}
export function validateRawManifest(value){
  if(value?.version!==rawVersion||!['apple','rawpy'].includes(value.backend)||value.space!=='linear-srgb'||value.alphaScale!==255||!value.backendVersion||!value.decoderVersion)throw rawError('RAW_MANIFEST','RAW 显影记录不完整，已有原片保留。');
  validateRawDimensions(value.width,value.height);validateRawDimensions(value.proxyWidth,value.proxyHeight);
  for(const key of ['sourceHash','masterHash','proxyHash','normalizedHash'])if(!/^[a-f0-9]{64}$/.test(value[key]))throw rawError('RAW_MANIFEST','RAW 数据身份无效。');
  if(Math.max(value.proxyWidth,value.proxyHeight)>rawLimits.proxySide||value.masterBytes!==value.width*value.height*16||value.proxyBytes!==value.proxyWidth*value.proxyHeight*16)throw rawError('RAW_MANIFEST','RAW 缓存尺寸无效。');
  return value;
}
