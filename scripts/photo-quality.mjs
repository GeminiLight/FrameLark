import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {renderPixels} from '../public/editor-engine.js';
import {inspectPixels} from '../public/diagnostics.js';
import {validCrop} from '../public/crop-utils.js';
import {normalizeObservations} from '../public/vision-review.js';
import {normalizeMetricEvidence} from '../public/diagnosis-explanation.js';
import {validateReviewDecision} from '../public/review-policy.js';
const root=new URL('../',import.meta.url),folder=new URL('test/web/fixtures/quality/',root);
export async function qualityFixture(item) {
 const bytes=await readFile(new URL(item.pixels,folder)),header=/^P6\n(\d+) (\d+)\n255\n/.exec(bytes.toString('latin1'));
 if(!header)throw new Error('Invalid fixture');const width=Number(header[1]),height=Number(header[2]),rgb=bytes.subarray(header[0].length);
 if(rgb.length!==width*height*3)throw new Error('Incomplete photo fixture');
 return {width,height,pixels:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:rgb[Math.floor(i/4)*3+i%4])};
}
export const qualityRecipes={natural:{exposure:.08,highlights:-10,shadows:6,warmth:2,vibrance:5,sharpen:12,denoise:12},detail:{sharpen:25,denoise:28},quiet:{contrast:-8,saturation:-10,fade:5}};
export function reviewIssues(review,protectedRegions=[]) {
 const issues=[];
 try{validateReviewDecision(review);normalizeObservations(review.observations);normalizeMetricEvidence(review.metricEvidence);}catch(error){issues.push({type:'wrong-advice',message:error.message});}
 if(review.crop?.needed){const c=validCrop(review.crop,{suggestion:true});if(!c)issues.push({type:'unsafe-crop',message:'裁剪越界、太小或没有实际裁剪'});else for(const r of protectedRegions){if(r.x<c.x||r.y<c.y||r.x+r.width>c.x+c.width||r.y+r.height>c.y+c.height)issues.push({type:'unsafe-crop',message:'裁剪切到人工标注的保留范围'});}}
 for(const item of review.recommendations || []){if(Math.abs(item.adjustments?.exposure)>.6 || Math.abs(item.adjustments?.saturation)>25 || Math.abs(item.adjustments?.clarity)>30)issues.push({type:'over-adjustment',message:'较强参数需人工复核，并非自动判定错误',title:item.title});}
 return issues;
}
export async function evaluateQuality({update=false,vision=false}={}) {
 const manifest=JSON.parse(await readFile(new URL('manifest.json',folder))),baselineUrl=new URL('baseline.json',folder);
 let baseline={};try{baseline=JSON.parse(await readFile(baselineUrl));}catch{}
 const next={},rows=[],visionRows=[];
 const outputFolder=new URL('artifacts/quality/',root);await mkdir(outputFolder,{recursive:true});
 let available=false;if(vision){try{available=(await(await fetch('http://localhost:3177/api/status')).json()).aiAvailable===true;}catch{}}
 for(const item of manifest.cases){const {pixels,width,height}=await qualityFixture(item);const inputHash=createHash('sha256').update(await readFile(new URL(item.file,folder))).digest('hex');if(inputHash!==item.sha256)throw new Error('Fixture checksum changed: '+item.id);
  for(const [recipe,settings] of Object.entries(qualityRecipes)){const output=renderPixels(pixels,width,height,settings),hash=createHash('sha256').update(output).digest('hex'),id=item.id+'/'+recipe;next[id]=hash;
   const before=inspectPixels(pixels,width,height),after=inspectPixels(output,width,height);
   const endpoint=data=>data.reduce((count,v,i)=>count+(i%4!==3&&(v===0||v===255)?1:0),0)/(width*height*3);
   const endpointDelta=endpoint(output)-endpoint(pixels);
   rows.push({id,hash,baseline:baseline[id]===hash?'unchanged':baseline[id]?'changed':'missing',endpointDelta,before:before.stats,after:after.stats,needsHumanReview:baseline[id]!==hash || endpointDelta>.003});
   const rgb=Buffer.alloc(width*height*3);for(let i=0;i<width*height;i++)for(let ch=0;ch<3;ch++)rgb[i*3+ch]=output[i*4+ch];await writeFile(new URL(item.id+'-'+recipe+'.ppm',outputFolder),Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]));
  }
  if(vision && available){const image='data:image/png;base64,'+(await readFile(new URL(item.file,folder))).toString('base64');try{const res=await fetch('http://localhost:3177/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image}),signal:AbortSignal.timeout(120000)});const result=await res.json();visionRows.push({id:item.id,status:res.ok?'needs human review':'failed',...result,issues:res.ok?reviewIssues(result.analysis,item.protectedRegions):[{type:'service-failure',message:result.error?.message}]});}catch{visionRows.push({id:item.id,status:'failed',issues:[{type:'service-failure',message:'视觉请求未完成'}]});}}
 }
 if(update)await writeFile(baselineUrl,JSON.stringify(next,null,2)+'\n');
 const report={at:new Date().toISOString(),independentPhotos:manifest.independentPhotos,cases:manifest.cases.length,recipes:Object.keys(qualityRecipes),rows,vision:{requested:vision,status:!vision?'not run':!available?'not configured':'needs human review',rows:visionRows},limitations:manifest.limitations};
 await writeFile(new URL('results.json',outputFolder),JSON.stringify(report,null,2)+'\n');
 return report;
}
if(process.argv[1] && new URL('file://'+process.argv[1]).href===import.meta.url){const report=await evaluateQuality({update:process.argv.includes('--update-baseline'),vision:process.argv.includes('--vision')});console.log(JSON.stringify({cases:report.cases,checks:report.rows.length,changed:report.rows.filter(item=>item.baseline!=='unchanged').length,vision:report.vision.status}));if(!process.argv.includes('--update-baseline')&&report.rows.some(item=>item.baseline!=='unchanged'))process.exitCode=1;}
