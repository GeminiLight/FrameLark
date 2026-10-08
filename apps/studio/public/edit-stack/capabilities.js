import {pixelCapabilities} from './tools.js';

// Method/workflow capabilities are separate from the pixel tool registry. Optional
// host image editing never becomes a replayable tool merely by being available.
export function retouchCapabilities({surface='native',source=null,rawDecode=null,externalImageEdit=false}={}) {
  const raw=Boolean(source?.raw),browser=surface==='browser';
  return {
    version:'retouch-capabilities-v1',surface,document:pixelCapabilities(),
    masks:{geometric:true,luminance:true,semanticSegmentation:false},
    externalImageEdit:{available:externalImageEdit===true,replayable:false},
    workflow:{diagnosis:!browser,resultAudit:!browser,reviewed:!browser,independentReviewer:'host-declared',humanAcceptance:true},
    source:{kind:raw?'raw':'raster',precision:raw?'linear-float32-master':'8-bit-srgb-input',rawDecode:rawDecode===null?null:rawDecode===true},
    export:{formats:raw?['jpeg','png','tiff16']:['jpeg','png'],master:raw?'high-precision-cache':null,proxyIsMaster:false},
    limitations:[raw?'RAW 使用固定显影记录和高精度母版；显示代理不能作为母版导出。':'普通图像以 8 位 sRGB 输入；后续 Float32 不能恢复已丢失信息。',
      raw?'RAW 上限为 9600 万像素 / 16384 px；16 位 TIFF 从高精度母版输出。':'普通图像输出最多 8192 px / 1600 万像素，JPEG/PNG。',
      '几何及亮度蒙版不是自动语义分割；范围仅限制当前步骤。',
      '流程、哈希和宿主声明不证明实际看图、审美质量或独立审片身份。']
  };
}

export function negotiateWorkspace(project,state,notes=project.notes,capabilities=retouchCapabilities({surface:'studio',source:project.source})) {
  const reasons=[];
  if(project.workflow?.mode==='reviewed'&&!capabilities.workflow.reviewed)reasons.push({feature:'reviewed',message:'当前入口尚不支持诊断与复审流程，请在协作精修中继续。'});
  if(project.source.raw)reasons.push({feature:'raw-master',message:'RAW 使用高精度后端编辑，浏览器只接收代理预览。'});
  if(state.textOverlays?.length)reasons.push({feature:'lettering',message:'这个版本包含文字，请在协作精修中继续。'});
  if(Object.values(state.guards||{}).some(list=>Array.isArray(list)&&list.length))reasons.push({feature:'protection',message:'这个版本包含保护设置，请在协作精修中继续。'});
  if(state.locals.some(l=>{const n=notes.find(n=>n.id===l.id);return n&&JSON.stringify(n.rect)!==JSON.stringify(l.rect);}))reasons.push({feature:'separate-local-range',message:'标记与像素范围不同，请在协作精修中继续。'});
  if(new Set([...notes.map(n=>n.id),...state.locals.map(l=>l.id)]).size>8)reasons.push({feature:'annotation-capacity',message:'批注与局部范围合计超过 8 个，请在协作精修中继续。'});
  return {supported:reasons.length===0,required:reasons.map(r=>r.feature),reasons,fallback:reasons.length?'native':null};
}
