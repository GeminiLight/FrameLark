import {linearBytes} from '../tone-processing.js';
import {compileRenderPlan} from './document.js';
import {neutralStep} from './tools.js';
import {maskSampler} from './masks.js';
import {kernelFor,exposureWeight,encodeWorking} from './kernels.js';
import {fail} from './values.js';
import {sha256,contentHash} from './identity.js';
export function createStackRenderCache({byteBudget=64*1024*1024}={}){
  if(!Number.isSafeInteger(byteBudget)||byteBudget<0)throw Error('Invalid cache budget');
  const entries=new Map();let bytes=0;
  return {get bytes(){return bytes;},get byteBudget(){return byteBudget;},get(key){const value=entries.get(key);if(value){entries.delete(key);entries.set(key,value);}return value;},put(key,value){const size=(value.input?.byteLength||0)+(value.touched?.byteLength||0)+(value.pixels?.byteLength||0);if(size>byteBudget)return;const old=entries.get(key);if(old){bytes-=old.size;entries.delete(key);}while(bytes+size>byteBudget&&entries.size){const [id,item]=entries.entries().next().value;entries.delete(id);bytes-=item.size;}entries.set(key,{...value,size});bytes+=size;},clear(){entries.clear();bytes=0;}};
}
function checkpoints(document,slots){
  const active=document.steps.flatMap((step,index)=>step.enabled&&step.opacity>0&&!neutralStep(step)?[index]:[]);
  if(slots>=active.length)return new Set(active);
  const selected=new Set();
  // Spread limited Float32 checkpoints across the stack. Keep the penultimate
  // active result for last-step edits; the final RGBA has its own cache entry.
  for(let i=1;i<=slots;i++)selected.add(active[Math.min(active.length-2,Math.floor(i*active.length/slots)-1)]);
  return selected;
}
const decode=pixels=>{const out=new Float32Array(pixels.length);for(let i=0;i<pixels.length;i+=4){out[i]=linearBytes[pixels[i]];out[i+1]=linearBytes[pixels[i+1]];out[i+2]=linearBytes[pixels[i+2]];out[i+3]=pixels[i+3];}return out;};
export function renderStackPixels({pixels,originalPixels=pixels,workingPixels,originalWorking=workingPixels,linearOutput=false,width,height,document,frame,signal,maskView,onProgress=()=>{},memoryBudgetBytes=1024*1024*1024,cache}){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16_000_000||pixels.length!==width*height*4||originalPixels.length!==pixels.length)fail('RENDER_BUDGET_EXCEEDED','编辑栈输出网格或像素数量超过限制。');
  const actualFrame={fullWidth:document.source.width,fullHeight:document.source.height,sourceRect:{x:0,y:0,width:document.source.width,height:document.source.height},angle:document.geometry.crop?.angle||0,...frame};
  if(actualFrame.fullWidth!==document.source.width||actualFrame.fullHeight!==document.source.height)fail('SOURCE_CHANGED','渲染网格不属于当前原片。');
  for(const value of Object.values(actualFrame.sourceRect))if(!Number.isFinite(value))fail('INVALID_DOCUMENT','像素取样网格无效。');
  const plan=compileRenderPlan(document,{...actualFrame,width,height,pixelCenters:'half',pipeline:document.pipeline}),steps=document.steps.filter(step=>step.enabled&&step.opacity>0&&!neutralStep(step));
  const crop={x:actualFrame.sourceRect.x/actualFrame.fullWidth,y:actualFrame.sourceRect.y/actualFrame.fullHeight,width:actualFrame.sourceRect.width/actualFrame.fullWidth,height:actualFrame.sourceRect.height/actualFrame.fullHeight,angle:actualFrame.angle};
  if(maskView&&(!['overlay','bw'].includes(maskView.mode)||!document.steps.some(step=>step.id===maskView.stepId&&step.maskRef)))fail('MASK_REFERENCE_MISSING','请选择有范围的步骤查看蒙版。');
  if(workingPixels&&(!(workingPixels instanceof Float32Array)||workingPixels.length!==pixels.length||originalWorking.length!==pixels.length))fail('INVALID_DOCUMENT','线性工作像素的尺寸无效。');
  if(workingPixels)cache=null;
  if(!steps.length&&!maskView)return {...(linearOutput?{}:{pixels:new Uint8ClampedArray(pixels)}),...(workingPixels?{workingPixels:new Float32Array(workingPixels)}:{}),plan,noChange:true};
  const frozen=document.masks.some(mask=>mask.reference.kind==='frozen-source'),buffers=2+(steps.some(step=>step.tool==='detail')?2:0)+(frozen?1:0),estimatedBytes=pixels.length*4*buffers+pixels.length*2+width*height+(maskView?width*height*4:0);
  if(!Number.isFinite(memoryBudgetBytes)||estimatedBytes>memoryBudgetBytes)fail('RENDER_BUDGET_EXCEEDED','编辑栈需要的工作缓冲超过预算，请降低导出尺寸。',{estimatedBytes,memoryBudgetBytes});
  if(cache&&cache.bytes+estimatedBytes>memoryBudgetBytes)cache.clear();
  // Byte identities also bind the decoder/sample grid. A caller cannot reuse a
  // document/source label to make a different RGBA buffer hit an old prefix.
  const bufferKey=cache?contentHash({input:sha256(pixels),original:frozen?sha256(originalPixels):null}):null,finalKey=bufferKey+':final:'+plan.renderHash+':'+plan.frameSpecHash;
  if(signal?.aborted)fail('RENDER_CANCELLED','预览已取消。');
  const final=cache&&!maskView&&cache.get(finalKey);
  if(final)return {pixels:new Uint8ClampedArray(final.pixels),plan,noChange:final.noChange,estimatedBytes,cached:true};
  let prefix=null,startIndex=0;
  if(cache&&!maskView)for(let index=plan.prefixes.length-1;index>=0;index--){const found=cache.get(bufferKey+':'+plan.prefixes[index].prefixHash);if(found){prefix=found;startIndex=index+1;break;}}
  let input=workingPixels?new Float32Array(workingPixels):prefix?new Float32Array(prefix.input):decode(pixels),output=new Float32Array(input.length);const original=frozen?(originalWorking?originalWorking:decode(originalPixels)):input,touched=prefix?new Uint8Array(prefix.touched):new Uint8Array(width*height),coverage=maskView?new Float32Array(width*height):null;
  function cancelled(){if(signal?.aborted)fail('RENDER_CANCELLED','预览已取消。');}
  const prefixSlots=cache?Math.max(0,Math.floor(((cache.byteBudget||0)-pixels.byteLength)/(input.byteLength+touched.byteLength))):0,checkpointIndexes=checkpoints(document,prefixSlots);
  let completed=0;const scratch=[0,0,0];
  for(let stepIndex=startIndex;stepIndex<document.steps.length;stepIndex++){
    const step=document.steps[stepIndex];
    cancelled();const sample=step.maskRef?maskSampler(document,step.maskRef,input,original,{width,height,frame:actualFrame,crop}):null;
    if(maskView?.stepId===step.id)for(let y=0;y<height;y++)for(let x=0;x<width;x++)coverage[y*width+x]=sample(x,y,(y*width+x)*4);
    if(!step.enabled||!step.opacity||neutralStep(step))continue;
    const kernel=kernelFor(step,input,{width,height,frame:actualFrame,document}),gain=step.tool==='exposure'?2**step.parameters.ev:1;
    for(let y=0;y<height;y++){
      if(y%32===0)cancelled();
      for(let x=0;x<width;x++){
        const at=(y*width+x)*4,r=input[at],g=input[at+1],b=input[at+2],alpha=input[at+3];output[at+3]=alpha;
        let weight=alpha?step.opacity*(sample?sample(x,y,at):1):0;if(step.tool==='exposure')weight=exposureWeight(r,g,b,gain,weight,step.parameters.headroomPolicy);
        if(!weight){output[at]=r;output[at+1]=g;output[at+2]=b;continue;}
        const values=kernel(x,y,at,scratch),nextR=r+weight*(values[0]-r),nextG=g+weight*(values[1]-g),nextB=b+weight*(values[2]-b);
        if(!Number.isFinite(nextR)||!Number.isFinite(nextG)||!Number.isFinite(nextB))fail('INVALID_PIXEL_RESULT','工具产生了非有限像素，当前有效画面保留。');
        output[at]=nextR;output[at+1]=nextG;output[at+2]=nextB;touched[y*width+x]=1;
      }
    }
    [input,output]=[output,input];onProgress({stage:'rendering',stepId:step.id,index:++completed,total:steps.length});
    if(cache&&!maskView&&checkpointIndexes.has(stepIndex)&&estimatedBytes+cache.bytes+input.byteLength+touched.byteLength<=memoryBudgetBytes)cache.put(bufferKey+':'+plan.prefixes[stepIndex].prefixHash,{input:new Float32Array(input),touched:new Uint8Array(touched)});
  }
  cancelled();if(linearOutput&&!maskView)return {workingPixels:input,plan,noChange:!touched.some(Boolean),estimatedBytes,cachedPrefix:startIndex};const result=new Uint8ClampedArray(pixels);for(let i=0;i<result.length;i+=4){if(touched[i/4]){const values=encodeWorking(input[i],input[i+1],input[i+2],scratch);result[i]=values[0];result[i+1]=values[1];result[i+2]=values[2];}}
  if(coverage){for(let at=0;at<result.length;at+=4){const weight=coverage[at/4];if(maskView.mode==='bw'){result[at]=result[at+1]=result[at+2]=weight*255;result[at+3]=255;}else for(let c=0;c<3;c++)result[at+c]=result[at+c]*(1-weight*.4)+[72,210,160][c]*weight*.4;}}
  const noChange=!touched.some(Boolean);
  if(cache&&!maskView&&estimatedBytes+cache.bytes+result.byteLength<=memoryBudgetBytes)cache.put(finalKey,{pixels:new Uint8ClampedArray(result),noChange});
  return {pixels:result,...(linearOutput?{workingPixels:input}:{}),plan,noChange,estimatedBytes,displayOnly:Boolean(maskView),cachedPrefix:startIndex};
}
export function displayMask({pixels,originalPixels=pixels,width,height,document,maskRef,frame,mode='overlay'}){
  const input=decode(pixels),original=decode(originalPixels),actual={fullWidth:document.source.width,fullHeight:document.source.height,sourceRect:{x:0,y:0,width:document.source.width,height:document.source.height},angle:0,...frame},crop={x:actual.sourceRect.x/actual.fullWidth,y:actual.sourceRect.y/actual.fullHeight,width:actual.sourceRect.width/actual.fullWidth,height:actual.sourceRect.height/actual.fullHeight,angle:actual.angle},sample=maskSampler(document,maskRef,input,original,{width,height,frame:actual,crop}),out=new Uint8ClampedArray(pixels);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,weight=sample(x,y,i);if(mode==='bw'){out[i]=out[i+1]=out[i+2]=weight*255;out[i+3]=255;}else{for(let c=0;c<3;c++)out[i+c]=out[i+c]*(1-weight*.4)+[72,210,160][c]*weight*.4;}}
  return out;
}
