// Explicit opt-in acceptance, never imported by run-tests or subscription-free CI.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {CodexAppServer} from '../apps/studio/server/ai/codex.mjs';
import {validateStructured,invalidStructuredPaths} from '../apps/studio/server/ai/vision.mjs';
import {prepareAdvisorRequest,finishAdvisorReply} from '../apps/studio/server/ai/advisor-policy.mjs';
import {prepareProjectReview,persistProjectReview} from '../apps/studio/server/ai/project-review.mjs';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {initProject,loadProject,projectDocument,createCandidate,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {renderFrame,previewPhoto} from '../skills/photo-retouch/scripts/render.mjs';
import {compileRetouchPlan} from '../apps/studio/public/edit-stack/planning.js';
import {documentHash} from '../apps/studio/public/edit-stack/identity.js';
import {restoreTransaction} from '../apps/studio/public/edit-stack/commands.js';

const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.argv.includes('--run')){console.log('Opt-in: node scripts/check-retouch-semantics.mjs --run --output <new-directory>. Uses only local ChatGPT Codex subscription, gpt-6-astra / xhigh, one attempt per fixed case.');process.exit(0);}
const output=resolve(process.argv[process.argv.indexOf('--output')+1]||'artifacts/shared-retouch-semantics');
if(!process.argv.includes('--output'))throw Error('Provide a new --output directory; previous attempts must remain intact.');
await mkdir(dirname(output),{recursive:true});
await mkdir(output,{recursive:false});
const model='gpt-6-astra',effort='xhigh',timeoutMs=240000;
const source=join(root,'test/web/fixtures/quality/night.png'),bytes=await readFile(source);
const sha=value=>createHash('sha256').update(value).digest('hex');
assert.equal(sha(bytes),'bff8e5689368fe318bd12f4c38fff5c07ac55ecbcf7099f73b95653c2a5b441f');
const manifest={protocol:'shared-retouch-semantics-v1',model,effort,attemptsPerCase:1,retries:0,timeoutMs,source:{file:'night.png',sha256:sha(bytes),attribution:'SpaceX',rights:'public domain',catalog:'test/web/fixtures/quality/manifest.json'},cases:[
 {id:'diagnosis',kind:'diagnosis'},
 {id:'protected-lift',question:'请把整张照片稍微提亮，让暗部更可读，但保留现在已经很亮的灯头和光晕。只要一项可以独立撤回的亮度调整，不改色彩、不裁剪、不扶正。给出可执行的文档提案。'},
 {id:'scoped-update',seeded:true,question:'这次只把原步骤 light 的曝光在当前值基础上增加 0.25 EV。保留原来的高光蒙版、70% 强度、节点数量、顺序和后续色彩步骤，继续修改原步骤，不加任何新步骤。'},
 {id:'compound',question:'给我恰好三项可以分别勾选的试片：一项让暗部稍亮但保护已有亮处；一项将色温 warmth 增加 2；一项单独顺时针旋转 0.5 度供我核对。先不要接受。不要互相设置无关的硬依赖。'},
 {id:'missing-capability',question:'我只要自动精准语义分割天空、删除左侧高塔并生成新的云层。当前没有语义分割和外部 AI 图片编辑能力。请明确能否执行；不要用矩形近似、调色或裁剪来替代，也不要创建像素编辑提案。'},
 {id:'audit',kind:'audit',seeded:true}
]};
const json=(path,value)=>writeFile(join(output,path),JSON.stringify(value,null,2)+'\n');
await copyFile(source,join(output,'night.png'));await json('manifest.json',manifest);
const codex=new CodexAppServer({root:output}),bridge=new ProjectBridge({root:output}),results=[];
const seedCommands=[{type:'AddStep',step:{id:'light',title:'已有提亮',tool:'exposure',toolVersion:2,parameters:{ev:.35},opacity:.7}},{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.45,end:.8},reference:{kind:'live-input'}}},{type:'AddStep',step:{id:'color',title:'独立色彩',tool:'color',toolVersion:2,parameters:{warmth:2}}}];
async function seed(folder,{accept=false}={}){const p=await loadProject(folder),d=projectDocument(p),made=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,name:'Fixed acceptance fixture',documentProposal:{baseRevision:d.revision,baseHash:documentHash(d),items:[{id:'fixture',title:'固定验收输入',commands:seedCommands}]}});if(accept)await acceptCandidate(folder,{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});return made;}
async function savePayload(id,payload){
 const saved=structuredClone(payload);let n=0;
 for(const input of saved.input)for(const block of input.content)if(block.type==='input_image'){
  const data=Buffer.from(block.image_url.split(',')[1],'base64'),file=`${id}-input-${++n}.png`;await writeFile(join(output,file),data);delete block.image_url;block.file=file;block.sha256=sha(data);
 }
 await json(id+'-request.json',saved);
}
function measure(before,after){let dark=0,darkCount=0,high=0,highCount=0;for(let i=0;i<before.pixels.length;i+=4){const a=(before.pixels[i]+before.pixels[i+1]+before.pixels[i+2])/3,b=(after.pixels[i]+after.pixels[i+1]+after.pixels[i+2])/3;if(a>=20&&a<=130){dark+=b-a;darkCount++;}if(a>=245){high+=Math.abs(b-a);highCount++;}}return {darkMeanGain:dark/darkCount,highlightMeanAbsoluteChange:high/highCount,darkCount,highCount};}
try{
 const info=await codex.info();
 await json('subscription.json',{authenticated:info.authenticated,authType:info.authType,modelAvailable:info.models.some(m=>m.id===model&&m.efforts.includes(effort))});
 if(!info.authenticated||info.authType!=='chatgpt')throw Error('A logged-in ChatGPT subscription is required; API fallback is disabled.');
 if(!info.models.some(m=>m.id===model&&m.efforts.includes(effort)))throw Error('Requested gpt-6-astra / xhigh is unavailable; no substitution allowed.');
 const reviewFolder=join(output,'review-project');await initProject(source,reviewFolder,{intent:'保持夜色，暗处更可读，保留亮灯'});let reviewView=await bridge.register(reviewFolder);
 for(const scenario of manifest.cases){
  const startedAt=new Date().toISOString(),row={id:scenario.id,model,effort,attempt:1,startedAt};let partial='';console.log('Running '+scenario.id);
  try{
   let packet,folder,p,document;
   if(scenario.kind){
    if(scenario.kind==='audit'){const made=await seed(reviewFolder);reviewView=await bridge.get(reviewView.id);packet=await prepareProjectReview(bridge,reviewView.id,'audit',{revision:reviewView.revision,versionId:made.candidate.id});}
    else packet=await prepareProjectReview(bridge,reviewView.id,'diagnosis',{revision:reviewView.revision});
   }else{
    folder=join(output,scenario.id+'-project');await initProject(source,folder,{intent:'保持夜色，暗处更可读，保留亮灯'});if(scenario.seeded)await seed(folder,{accept:true});
    p=await loadProject(folder);document=projectDocument(p);const before=await renderFrame(folder);await writeFile(join(output,scenario.id+'-before.png'),before.png);await json(scenario.id+'-document.json',document);
    packet=await prepareAdvisorRequest({image:'data:image/png;base64,'+before.png.toString('base64'),question:scenario.question,context:{document,creativeIntent:p.intent,scopeStepId:scenario.id==='scoped-update'?'light':null}});
   }
   row.policy=packet.policy.provenance;await savePayload(scenario.id,packet.payload);
   const raw=await codex.request(packet.payload,{model,effort,signal:AbortSignal.timeout(timeoutMs),onEvent:event=>{if(event.type==='delta')partial+=event.delta||'';}});
   await writeFile(join(output,scenario.id+'-raw.txt'),raw.output_text);row.actualModel=raw.model;
   const value=JSON.parse(raw.output_text);row.schemaValid=validateStructured(value,packet.payload.text.format.schema);
   if(!row.schemaValid)throw Error('Schema mismatch: '+invalidStructuredPaths(value,packet.payload.text.format.schema).join(', '));
   if(scenario.kind){
    reviewView=await persistProjectReview(bridge,packet,{value,provenance:{model,effort,provider:'Codex Subscription'}});await json(scenario.id+'-record.json',reviewView.review);row.decision=reviewView.review.decision||null;
   }else{
    const answer=finishAdvisorReply(packet,{value,provenance:{model,effort,provider:'Codex Subscription'}});await json(scenario.id+'-validated.json',answer);
    if(scenario.id==='missing-capability'){assert.equal(answer.action.kind,'none');assert.match(answer.reply,/不|无|暂|缺/);}
    else{
     assert.equal(answer.action.kind,'document');const compiled=compileRetouchPlan(document,answer.action,{scopeStepId:scenario.id==='scoped-update'?'light':null});
     if(scenario.id==='scoped-update'){
      assert.equal(compiled.document.steps.length,document.steps.length);assert.deepEqual(compiled.document.steps[0],{...document.steps[0],parameters:{...document.steps[0].parameters,ev:.6}});assert.deepEqual(compiled.document.steps[1],document.steps[1]);assert.deepEqual(restoreTransaction(compiled.document,compiled.transaction,'undo').steps,document.steps);row.undoVerified=true;
     }
     if(scenario.id==='compound'){assert.equal(compiled.items.length,3);assert.ok(compiled.items.every(i=>!i.dependsOn.length));for(const item of compiled.items)compileRetouchPlan(document,answer.action,{selectedItemIds:[item.id]});}
     const made=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,documentProposal:answer.action.proposal,actorId:'semantic-acceptance',name:scenario.id}),after=await renderFrame(folder,made.candidate.id),before=await renderFrame(folder);
     await writeFile(join(output,scenario.id+'-after.png'),after.png);await json(scenario.id+'-compiled.json',{document:compiled.document,items:compiled.items,selectionHash:made.candidate.selectionHash,transaction:compiled.transaction});
     if(scenario.id==='protected-lift'){
      assert.equal(compiled.items.length,1);assert.equal(compiled.document.steps.length,1);const step=compiled.document.steps[0];assert.equal(step.tool,'exposure');assert.ok(step.parameters.ev>0);assert.ok(step.maskRef);row.pixelChecks=measure(before,after);assert.ok(row.pixelChecks.darkMeanGain>.5);assert.ok(row.pixelChecks.highlightMeanAbsoluteChange<=1.5);
      const preview=await previewPhoto(folder,made.candidate.id,{maxSide:1400,maskView:{stepId:step.id,mode:'bw'}});await copyFile(preview.path,join(output,scenario.id+'-mask.png'));
     }
    }
   }
   row.status='passed';
  }catch(error){if(partial)await writeFile(join(output,scenario.id+'-partial.txt'),partial);row.status='failed';row.error={code:error.code||error.name,message:error.message};}
  row.finishedAt=new Date().toISOString();results.push(row);await json('results.json',results);console.log(scenario.id+': '+row.status);
 }
}catch(error){await json('unavailable.json',{code:error.code||error.name,message:error.message,model,effort});process.exitCode=2;}
finally{codex.stop();await codex.closing;await bridge.close();}
if(results.length&&results.some(r=>r.status!=='passed'))process.exitCode=1;
console.log(JSON.stringify({output,passed:results.filter(r=>r.status==='passed').length,total:results.length,model,effort}));
