import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {qualityFixture,reviewIssues} from './photo-quality.mjs';
import {combineSettings,renderPixels,renderingVersion} from '../apps/studio/public/editor-engine.js';
import {photoMetering} from '../apps/studio/public/photo-metering.js';
import {inspectPixels} from '../apps/studio/public/diagnostics.js';

const base=process.env.PHOTO_EVAL_URL || 'http://localhost:3177';
const phase=process.argv.find(arg=>arg.startsWith('--phase='))?.split('=')[1] || 'baseline';
if(!/^[a-z0-9-]+$/.test(phase))throw new Error('Invalid phase');
const selected=process.argv.find(arg=>arg.startsWith('--cases='))?.split('=')[1]?.split(',') || ['portrait-low','night-noise','still-life-high','contrast','pet','deep-field'];
const manifest=JSON.parse(await readFile(new URL('../test/web/fixtures/quality/manifest.json',import.meta.url)));
const extra=JSON.parse(await readFile(new URL('../test/web/fixtures/quality/stress-extra.json',import.meta.url)));
manifest.cases.push(...extra.cases);manifest.limitations.push(...extra.limitations);
const folder=new URL('../artifacts/retouch-eval/'+phase+'/',import.meta.url);
await mkdir(folder,{recursive:true});
const mse=(a,b)=>a.reduce((sum,v,i)=>sum+(i%4===3?0:(v-b[i])**2),0)/(a.length/4*3);
const clipping=data=>data.reduce((count,v,i)=>count+(i%4!==3&&(v===0||v===255)?1:0),0)/(data.length/4*3);
async function ppm(file,pixels,width,height){
 const rgb=Buffer.alloc(width*height*3);
 for(let i=0;i<width*height;i++)for(let c=0;c<3;c++)rgb[i*3+c]=pixels[i*4+c];
 await writeFile(new URL(file,folder),Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]));
}
const cases=selected.map(id=>{const item=manifest.cases.find(c=>c.id===id);if(!item)throw new Error('Unknown photo case '+id);return item;});
const rows=[];
async function evaluate(item){
 const started=Date.now(),photo=await qualityFixture(item);
 const bytes=await readFile(new URL('../test/web/fixtures/quality/'+item.file,import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Photo fixture changed');
 const intent=item.topic==='night' || item.topic==='deep-field' ? '保留夜色和光线方向；只改善明确妨碍主体或细节的问题，不整体提亮' : item.topic==='portrait' ? '肤色自然真实，让面部清楚可读，保留原有构图与光线' : '保持原有题材和表达，让明确的光色与细节问题改善；不机械提亮、增色或裁剪';
 let row={id:item.id,source:item.source,variant:item.variant,intent,sha256:item.sha256,renderingVersion};
 try{
  const response=await fetch(base+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:'data:image/png;base64,'+bytes.toString('base64'),creativeIntent:intent,...(phase!=='baseline' ? {photoReference:photoMetering(photo.pixels,photo.width,photo.height)}:{})}),signal:AbortSignal.timeout(118000)});
  const result=await response.json();
  row={...row,httpStatus:response.status,elapsedMs:Date.now()-started,...result};
  if(response.ok){
   const settings=combineSettings(...result.analysis.recommendations.map(rec=>({settings:rec.adjustments})));
   const output=renderPixels(photo.pixels,photo.width,photo.height,settings);
   const before=inspectPixels(photo.pixels,photo.width,photo.height),after=inspectPixels(output,photo.width,photo.height);
   let recovery=null;
   if(item.parent && !/crop/.test(item.variant)){
    const parent=await qualityFixture(manifest.cases.find(c=>c.id===item.parent));
    if(parent.width===photo.width&&parent.height===photo.height)recovery={beforeMSE:mse(photo.pixels,parent.pixels),afterMSE:mse(output,parent.pixels)};
   }
   row.render={settings,before:before.stats,after:after.stats,clippingDelta:clipping(output)-clipping(photo.pixels),pixelChangeMSE:mse(photo.pixels,output),recovery,cropApplied:false};
   row.issues=reviewIssues(result.analysis,item.protectedRegions || []);
   await ppm(item.id+'-original.ppm',photo.pixels,photo.width,photo.height);
   await ppm(item.id+'-applied.ppm',output,photo.width,photo.height);
  }
 }catch(error){row={...row,httpStatus:0,elapsedMs:Date.now()-started,error:{message:String(error)}};}
 await writeFile(new URL(item.id+'.json',folder),JSON.stringify(row,null,2)+'\n');rows.push(row);
 console.log(JSON.stringify({phase,case:item.id,status:row.httpStatus,elapsedMs:row.elapsedMs,conclusion:row.analysis?.conclusion,actions:row.analysis?.recommendations.map(r=>({title:r.title,reason:r.reason,adjustments:Object.fromEntries(Object.entries(r.adjustments).filter(([,v])=>v))})),crop:row.analysis?.crop,render:row.render?{clippingDelta:row.render.clippingDelta,recovery:row.render.recovery}:null,issues:row.issues,error:row.error}));
}
// Match the app's two-photo analysis concurrency; one failure never cancels another photo.
let cursor=0;
await Promise.all([0,1].map(async()=>{while(cursor<cases.length)await evaluate(cases[cursor++]);}));
await writeFile(new URL('results.json',folder),JSON.stringify({at:new Date().toISOString(),base,phase,independentPhotos:manifest.independentPhotos,limitations:[...manifest.limitations,'Global adjustment renders here do not apply a crop; crop bounds are checked separately','MSE against a synthetic parent measures recovery only, never aesthetic quality'],rows},null,2)+'\n');
if(rows.some(r=>r.httpStatus!==200))process.exitCode=1;
