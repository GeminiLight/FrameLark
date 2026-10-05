import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import {createDocument} from '../apps/studio/public/edit-stack/document.js';
import {applyCommands} from '../apps/studio/public/edit-stack/commands.js';
import {sha256} from '../apps/studio/public/edit-stack/identity.js';
import {createStackRenderCache,renderStackPixels} from '../apps/studio/public/edit-stack/render.js';
const rows=[];
const tools=[['exposure',{ev:.12}],['tone',{contrast:8,shadows:5}],['color',{warmth:4,vibrance:5}],['detail',{clarity:3,sharpen:3}],['finish',{grain:3,vignette:5}]];
for(const [width,height] of [[560,420],[1400,1050]]){
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;pixels[i]=30+200*x/width;pixels[i+1]=40+160*y/height;pixels[i+2]=70;pixels[i+3]=255;}
  for(const count of [1,8,24]){
    const base=createDocument({documentId:'bench',source:{assetId:'fixture',contentHash:sha256(pixels),width,height},base:{settings:{},locals:[]}});
    const document=applyCommands(base,Array.from({length:count},(_,index)=>{const [tool,parameters]=tools[index%tools.length];return {type:'AddStep',step:{id:'s'+index,title:'s'+index,tool,toolVersion:2,parameters}};})).next;
    const cache=createStackRenderCache(),run=(recipe,options={})=>renderStackPixels({pixels,width,height,document:recipe,...options});
    const timed=fn=>{const start=performance.now(),value=fn();return {ms:Math.round((performance.now()-start)*10)/10,value};};
    const cold=timed(()=>run(document,{cache})),warm=[];
    for(let n=0;n<3;n++)warm.push(timed(()=>run(document,{cache})).ms);
    const edits={};
    for(const [position,index] of [['first',0],['middle',Math.floor(count/2)],['last',count-1]]){
      const step=document.steps[index],key=Object.keys(step.parameters).find(key=>typeof step.parameters[key]==='number'),changed=applyCommands(document,[{type:'UpdateStepParameters',stepId:step.id,parameters:{[key]:step.parameters[key]+(key==='ev'?.01:1)}}]).next;
      const positionCache=createStackRenderCache();run(document,{cache:positionCache});const result=timed(()=>run(changed,{cache:positionCache}));edits[position]={ms:result.ms,cachedPrefix:result.value.cachedPrefix||0};positionCache.clear();
    }
    rows.push({width,height,count,coldMs:cold.ms,warmMs:warm,edits,estimatedWorkBytes:cold.value.estimatedBytes,retainedCacheBytes:cache.bytes,rssAfterBytes:process.memoryUsage().rss});
  }
}
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,protocol:'synthetic gradient, fixed exposure/tone/color/detail/finish sequence; one cold sample, three identical warm samples, one independently prewarmed baseline and edited sample for each position; not a visual-quality score or a peak-memory measurement',rows},null,2));
