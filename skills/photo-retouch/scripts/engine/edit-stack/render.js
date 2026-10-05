import {srgbToLinear} from '../tone-processing.js';
import {compileRenderPlan} from './document.js';
import {neutralStep} from './tools.js';
import {maskSampler} from './masks.js';
import {kernelFor,exposureWeight,encodeWorking} from './kernels.js';
import {fail} from './values.js';
const decode=pixels=>{const out=new Float32Array(pixels.length);for(let i=0;i<pixels.length;i+=4){out[i]=srgbToLinear(pixels[i]/255);out[i+1]=srgbToLinear(pixels[i+1]/255);out[i+2]=srgbToLinear(pixels[i+2]/255);out[i+3]=pixels[i+3];}return out;};
export function renderStackPixels({pixels,originalPixels=pixels,width,height,document,frame,signal,maskView,onProgress=()=>{},memoryBudgetBytes=1024*1024*1024}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16_000_000||pixels.length!==width*height*4||originalPixels.length!==pixels.length)fail('RENDER_BUDGET_EXCEEDED','编辑栈输出网格或像素数量超过限制。');
  const actualFrame={fullWidth:document.source.width,fullHeight:document.source.height,sourceRect:{x:0,y:0,width:document.source.width,height:document.source.height},angle:document.geometry.crop?.angle||0,...frame};
  if(actualFrame.fullWidth!==document.source.width||actualFrame.fullHeight!==document.source.height)fail('SOURCE_CHANGED','渲染网格不属于当前原片。');
  for(const value of Object.values(actualFrame.sourceRect))if(!Number.isFinite(value))fail('INVALID_DOCUMENT','像素取样网格无效。');
  const plan=compileRenderPlan(document,{...actualFrame,width,height,pixelCenters:'half',pipeline:document.pipeline}),steps=document.steps.filter(step=>step.enabled&&step.opacity>0&&!neutralStep(step));
  const crop={x:actualFrame.sourceRect.x/actualFrame.fullWidth,y:actualFrame.sourceRect.y/actualFrame.fullHeight,width:actualFrame.sourceRect.width/actualFrame.fullWidth,height:actualFrame.sourceRect.height/actualFrame.fullHeight,angle:actualFrame.angle};
  if(maskView&&(!['overlay','bw'].includes(maskView.mode)||!document.steps.some(step=>step.id===maskView.stepId&&step.maskRef)))fail('MASK_REFERENCE_MISSING','请选择有范围的步骤查看蒙版。');
  if(!steps.length&&!maskView)return {pixels:new Uint8ClampedArray(pixels),plan,noChange:true};
  const frozen=document.masks.some(mask=>mask.reference.kind==='frozen-source'),buffers=2+(steps.some(step=>step.tool==='detail')?1:0)+(frozen?1:0),estimatedBytes=pixels.length*4*buffers+pixels.length*2+width*height+(maskView?width*height*4:0);
  if(!Number.isFinite(memoryBudgetBytes)||estimatedBytes>memoryBudgetBytes)fail('RENDER_BUDGET_EXCEEDED','编辑栈需要的工作缓冲超过预算，请降低导出尺寸。',{estimatedBytes,memoryBudgetBytes});
  let input=decode(pixels),output=new Float32Array(input.length);const original=frozen?decode(originalPixels):input,touched=new Uint8Array(width*height),coverage=maskView?new Float32Array(width*height):null;
  function cancelled(){if(signal?.aborted)fail('RENDER_CANCELLED','预览已取消。');}
  let completed=0;
  for(const step of document.steps){
    cancelled();const sample=step.maskRef?maskSampler(document,step.maskRef,input,original,{width,height,frame:actualFrame,crop}):()=>1;
    if(maskView?.stepId===step.id)for(let y=0;y<height;y++)for(let x=0;x<width;x++)coverage[y*width+x]=sample(x,y,(y*width+x)*4);
    if(!step.enabled||!step.opacity||neutralStep(step))continue;
    const kernel=kernelFor(step,input,{width,height,frame:actualFrame,document});
    for(let y=0;y<height;y++){
      if(y%32===0)cancelled();
      for(let x=0;x<width;x++){
        const at=(y*width+x)*4;output[at]=input[at];output[at+1]=input[at+1];output[at+2]=input[at+2];output[at+3]=input[at+3];
        if(!input[at+3])continue;let weight=step.opacity*sample(x,y,at);if(step.tool==='exposure')weight=exposureWeight(input[at],input[at+1],input[at+2],2**step.parameters.ev,weight,step.parameters.headroomPolicy);if(!weight)continue;
        const values=kernel(x,y,at);for(let c=0;c<3;c++){const result=input[at+c]+weight*(values[c]-input[at+c]);if(!Number.isFinite(result))fail('INVALID_PIXEL_RESULT','工具产生了非有限像素，当前有效画面保留。');output[at+c]=result;}touched[y*width+x]=1;
      }
    }
    [input,output]=[output,input];onProgress({stage:'rendering',stepId:step.id,index:++completed,total:steps.length});
  }
  cancelled();const result=new Uint8ClampedArray(pixels);for(let i=0;i<result.length;i+=4){if(touched[i/4]){const values=encodeWorking(input[i],input[i+1],input[i+2]);result[i]=values[0];result[i+1]=values[1];result[i+2]=values[2];}}
  if(coverage){for(let at=0;at<result.length;at+=4){const weight=coverage[at/4];if(maskView.mode==='bw'){result[at]=result[at+1]=result[at+2]=weight*255;result[at+3]=255;}else for(let c=0;c<3;c++)result[at+c]=result[at+c]*(1-weight*.4)+[72,210,160][c]*weight*.4;}}
  return {pixels:result,plan,noChange:!touched.some(Boolean),estimatedBytes,displayOnly:Boolean(maskView)};
}
export function displayMask({pixels,originalPixels=pixels,width,height,document,maskRef,frame,mode='overlay'}){
  const input=decode(pixels),original=decode(originalPixels),actual={fullWidth:document.source.width,fullHeight:document.source.height,sourceRect:{x:0,y:0,width:document.source.width,height:document.source.height},angle:0,...frame},crop={x:actual.sourceRect.x/actual.fullWidth,y:actual.sourceRect.y/actual.fullHeight,width:actual.sourceRect.width/actual.fullWidth,height:actual.sourceRect.height/actual.fullHeight,angle:actual.angle},sample=maskSampler(document,maskRef,input,original,{width,height,frame:actual,crop}),out=new Uint8ClampedArray(pixels);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,weight=sample(x,y,i);if(mode==='bw'){out[i]=out[i+1]=out[i+2]=weight*255;out[i+3]=255;}else{for(let c=0;c<3;c++)out[i+c]=out[i+c]*(1-weight*.4)+[72,210,160][c]*weight*.4;}}
  return out;
}
