import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {serveProject} from '../skills/photo-retouch/scripts/server.mjs';
import {randomUUID} from 'node:crypto';
import {initProject,loadProject,saveWorkspaceSnapshot,createCandidate,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {projectDocument} from '../skills/photo-retouch/scripts/document-state.mjs';
import {documentHash} from '../apps/studio/public/edit-stack/identity.js';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'framelark-review-browser-')),exec=promisify(execFile),session='framelark-review-'+randomUUID();
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:2000000}).then(r=>r.stdout.trim());
const evaluate=async code=>{const value=JSON.parse(await browser('eval',code));return typeof value==='string'?JSON.parse(value):value;};
const bridge=new ProjectBridge({root:temporary});let server,native;
async function fixture(name,count,exposure=0){
 const folder=join(temporary,name);await initProject(join(root,'test/web/fixtures/quality/portrait.png'),folder);
 let p=await loadProject(folder);
 if(exposure){await saveWorkspaceSnapshot(folder,{revision:p.revision,baseVersion:p.currentId,settings:{...p.versions[0].state.settings,exposure},style:null,crop:null,annotations:[]});p=await loadProject(folder);}
 for(let offset=0;offset<count;offset+=24){
  const document=projectDocument(p),commands=Array.from({length:Math.min(24,count-offset)},(_,i)=>({type:'AddStep',step:{id:'s'+(offset+i),title:name==='reset'?'A'.repeat(120):'中性步骤 '+(offset+i),tool:'exposure',toolVersion:2,parameters:{ev:0}}}));
  const made=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,actorId:'review-fixture',name:'检查夹具',documentProposal:{baseRevision:document.revision,baseHash:documentHash(document),items:[{id:'item',title:'检查夹具',commands}]}});
  await acceptCandidate(folder,{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});p=await loadProject(folder);
 }
 return {folder,data:await bridge.register(folder)};
}
try{
 const reset=await fixture('reset',1,.3),full=await fixture('full',64);
 server=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:temporary,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'0',OPENAI_API_KEY:'',OPENAI_MODEL:''},stdio:['ignore','pipe','pipe']});
 let output='';server.stderr.on('data',()=>{});
 const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server did not start')),10000);server.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/http:\/\/localhost:(\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1]);}});server.once('error',reject);});
 await browser('open',base);await browser('set','viewport','1280','800');await browser('upload','#file-input',join(root,'test/web/fixtures/quality/portrait.png'));
 await browser('wait','--fn','!document.querySelector("#export-button").disabled');await browser('click','#panel-adjust');
 await evaluate('(()=>{const digest=crypto.subtle.digest.bind(crypto.subtle);window.reviewDigests=[];crypto.subtle.digest=(...args)=>new Promise((resolve,reject)=>window.reviewDigests.push(()=>digest(...args).then(resolve,reject)));return JSON.stringify(true);})()');
 await browser('click','#edit-stack-start');await browser('wait','--fn','window.reviewDigests.length===1');
 const preparing=await evaluate('JSON.stringify(document.querySelector("#edit-stack-start").disabled)');if(!preparing)throw Error('first edit did not block duplicate clicks');
 await evaluate('window.reviewDigests[0]();JSON.stringify(true)');await browser('wait','--fn','document.querySelectorAll("#edit-stack-mount [data-step-select]").length===1&&!document.querySelector("#export-button").disabled');
 const firstId=await evaluate('JSON.stringify(document.querySelector("#edit-stack-mount [data-step-select]").dataset.stepSelect)');
 await browser('click','#edit-stack-mount [data-action=add]');
 await browser('wait','--fn','document.querySelectorAll("#edit-stack-mount [data-step-select]").length===2&&!document.querySelector("#export-button").disabled');
 const ids=await evaluate('JSON.stringify([...document.querySelectorAll("#edit-stack-mount [data-step-select]")].map(node=>node.dataset.stepSelect))');
 if(!ids.includes(firstId))throw Error('first edit was overwritten');
 console.log(JSON.stringify({case:'first-edit-admission',duplicateClickBlocked:preparing,actualStepIds:ids,firstStepPreserved:ids.includes(firstId)}));
 // Operate on a different row from the selected last step. A row menu must
 // retain its own stable ID rather than accidentally editing the inspector's ID.
 await browser('click',`#edit-stack-mount [data-action=more][data-step-id="${firstId}"]`);
 await browser('click',`#edit-stack-mount [data-action=down][data-step-id="${firstId}"]`);
 await browser('wait','--fn',`document.querySelectorAll('#edit-stack-mount [data-step-select]')[1].dataset.stepSelect==='${firstId}'&&!document.querySelector('#export-button').disabled`);
 await browser('click','#photo-undo');
 await browser('wait','--fn',`document.querySelector('#edit-stack-mount [data-step-select]').dataset.stepSelect==='${firstId}'&&!document.querySelector('#export-button').disabled`);
 console.log(JSON.stringify({case:'row-menu-target-and-undo',targetId:firstId,restoredOrder:ids}));
 await browser('open',base+'/?project='+reset.data.id);await browser('set','viewport','1280','800');
 await browser('wait','--fn','document.querySelector("#edit-stack-mount [data-action=legacy]")&&!document.querySelector("#export-button").disabled');
 await browser('click','#panel-adjust');await browser('click','#edit-stack-mount [data-action=legacy]');
 const projectControls=await evaluate('JSON.stringify({projectLabel:document.querySelector("#project-open").textContent,duplicateEntry:!!document.querySelector("#collaboration-project"),draftLabel:document.querySelector("#draft-status").textContent,versionShortcutHidden:document.querySelector("#versions-open").hidden})');
 if(projectControls.projectLabel!=='项目'||projectControls.duplicateEntry||projectControls.draftLabel!=='其他草稿'||!projectControls.versionShortcutHidden)throw Error('project access was not unified');
 console.log(JSON.stringify({case:'unified-project-controls',...projectControls}));
 const before=await evaluate('JSON.stringify({slider:document.querySelector("#slider-exposure").value,pixels:Array.from(document.querySelector("#edited-canvas").getContext("2d").getImageData(0,0,1,1).data)})');
 await browser('click','#clear-manual');await browser('wait','--fn','!document.querySelector("#export-button").disabled');
 const after=await evaluate('JSON.stringify({slider:document.querySelector("#slider-exposure").value,pixels:Array.from(document.querySelector("#edited-canvas").getContext("2d").getImageData(0,0,1,1).data),toast:document.querySelector("#toast").textContent})');
 const p=await loadProject(reset.folder);
 const exposure=p.versions.find(v=>v.id===p.currentId).recipe.base.state.settings.exposure;if(exposure!==0||after.slider!=='0'||JSON.stringify(before.pixels)===JSON.stringify(after.pixels))throw Error('reset did not affect saved pixels');
 console.log(JSON.stringify({case:'clear-legacy-parameters',before,after,authoritativeExposure:exposure}));
 await browser('click','#edit-stack-mount [data-action=highlights]');
 await browser('wait','--fn','document.querySelector("#edit-stack-mount [data-range-advanced]")&&!document.querySelector("#export-button").disabled');
 const rangeControls=await evaluate('JSON.stringify({advancedClosed:!document.querySelector("#edit-stack-mount [data-range-advanced]").open,scope:document.querySelector("#edit-stack-mount .edit-step-range").textContent,reference:document.querySelector("#edit-stack-mount [data-kind=reference]").value})');
 if(!rangeControls.advancedClosed||rangeControls.reference!=='live-input'||!rangeControls.scope.includes('仅作用于当前步骤'))throw Error('range controls did not preserve their scope');
 await browser('click','#edit-stack-mount [data-range-advanced]>summary');
 await browser('select','#edit-stack-mount [data-kind=reference]','frozen-source');
 await browser('wait','--fn','!document.querySelector("#export-button").disabled&&document.querySelector("#edit-stack-mount [data-reference-note]").textContent.includes("原始照片")');
 const frozenProject=await loadProject(reset.folder),frozenRecipe=frozenProject.versions.find(v=>v.id===frozenProject.currentId).recipe,frozenRef=frozenRecipe.steps[0].maskRef,frozenMask=frozenRecipe.masks.find(mask=>mask.id===frozenRef.id&&mask.version===frozenRef.version);
 if(frozenMask.reference.kind!=='frozen-source'||frozenMask.reference.sourceHash!==frozenRecipe.source.contentHash)throw Error('reference selection was not saved to the real recipe');
 await browser('select','#edit-stack-mount [data-kind=reference]','live-input');await browser('wait','--fn','!document.querySelector("#export-button").disabled');
 console.log(JSON.stringify({case:'advanced-range-reference-save',advancedInitiallyClosed:true,authoritativeReference:frozenMask.reference}));
 await browser('open',base+'/?project='+full.data.id);await browser('wait','--fn','document.querySelectorAll("#edit-stack-mount [data-step-select]").length===64&&!document.querySelector("#export-button").disabled');
 await evaluate('window.reviewErrors=[];window.addEventListener("error",event=>window.reviewErrors.push({message:event.message,code:event.error?.code,error:event.error?.message}));window.addEventListener("unhandledrejection",event=>window.reviewErrors.push({code:event.reason?.code,error:event.reason?.message}));JSON.stringify(true)');
 await browser('click','#panel-presets');await browser('wait','--fn','[...document.querySelectorAll(".curated-style-card img")].filter(image=>image.src.startsWith("data:image")).length===2');
 const errors=await evaluate('JSON.stringify(window.reviewErrors)');if(errors.length)throw Error(JSON.stringify(errors));
 console.log(JSON.stringify({case:'browse-styles-at-64-steps',capturedErrors:errors,visibleCards:await evaluate('JSON.stringify(document.querySelectorAll(".curated-style-card").length)')}));
 await browser('click','.curated-style-card .style-preview-open');await browser('wait','--fn','document.querySelector("#style-detail-status").textContent.includes("已达上限")');
 const capacity=await evaluate('JSON.stringify({status:document.querySelector("#style-detail-status").textContent,applyDisabled:document.querySelector("#style-detail-apply").disabled})');if(!capacity.applyDisabled)throw Error('over-limit style remained applicable');console.log(JSON.stringify({case:'capacity-preview',...capacity}));

 const saved=await loadProject(full.folder);if(saved.versions.find(v=>v.id===saved.currentId).recipe.steps.length!==64)throw Error('style trial modified saved recipe');

 native=await serveProject(reset.folder,{quiet:true});await browser('open',native.session.url);
 await browser('wait','--fn','document.querySelectorAll("#native-edit-stack [data-step-select]").length===1');
 await browser('click','#native-edit-stack [data-action=more]');await browser('click','#native-edit-stack [data-action=duplicate]');
 await browser('wait','--fn','document.querySelectorAll("#native-edit-stack [data-step-select]").length===2&&!document.querySelector("#accept-button").disabled');
 const names=await evaluate('JSON.stringify([...document.querySelectorAll("#native-edit-stack [data-step-select]")].map(node=>node.firstChild.textContent))');
 if(names[1].length>120||!names[1].endsWith(' · 副本'))throw Error('portable inspector did not bound a copied title');
 await browser('click','#accept-button');await browser('wait','--fn','document.querySelector("#candidate-actions").hidden');
 const accepted=await loadProject(reset.folder);if(accepted.versions.find(v=>v.id===accepted.currentId).recipe.steps.length!==2)throw Error('portable copy was not accepted');
 console.log(JSON.stringify({case:'portable-inspector-duplicate',savedSteps:2,copiedTitleLength:names[1].length}));
 console.log('Edit-stack browser checks passed: first-edit admission, real legacy reset/save, full-capacity style preview and portable inspector acceptance.');

}catch(error){
 console.error(await evaluate('JSON.stringify({help:document.querySelector("#style-audition-help").textContent,cards:[...document.querySelectorAll(".curated-style-card img")].map(i=>i.getAttribute("src")),errors:window.reviewErrors,toast:document.querySelector("#toast").textContent})').catch(()=>''));
 await browser('screenshot',join(root,'artifacts','edit-stack-failure.png')).catch(()=>{});throw error;
}finally{
 await browser('close').catch(()=>{});await native?.close();await bridge.close();
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},2500);server.once('exit',()=>{clearTimeout(timer);resolve();});});}
 await rm(temporary,{recursive:true,force:true});
}
