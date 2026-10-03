import {cropPixelRect} from './crop-utils.js';
export const exportLimits={maxSide:8192,maxPixels:16_000_000,archiveBytes:128*1024*1024};
export const exportPresets={share:{label:'日常分享',format:'jpeg',maxSide:2048,quality:.9,dpi:96},print:{label:'打印成片',format:'jpeg',maxSide:6000,quality:.98,dpi:300},original:{label:'原尺寸保存',format:'png',maxSide:8192,quality:.98,dpi:300}};
export function outputGeometry(crop,w,h,maxSide=8192) {
  if(!Number.isFinite(w) || !Number.isFinite(h) || w<1 || h<1)throw new Error('原片尺寸不可用');
  const rect=cropPixelRect(crop,w,h),side=Math.min(exportLimits.maxSide,Math.max(512,Number(maxSide)||8192));
  const scale=Math.min(1,side/Math.max(rect.width,rect.height),Math.sqrt(exportLimits.maxPixels/(rect.width*rect.height)));
  return {rect,width:Math.max(1,Math.floor(rect.width*scale)),height:Math.max(1,Math.floor(rect.height*scale)),limited:scale<1,original:scale===1};
}
export function safeFilename(name,extension,index='') {return `${String(name).replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,100) || 'photo'}${index ? `-${index}`:''}-帧映.${extension}`;}
export const printCentimeters=(pixels,dpi)=>pixels/Math.max(1,dpi)*2.54;
