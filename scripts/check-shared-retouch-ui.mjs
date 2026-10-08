import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {initProject,loadProject,projectDocument,createCandidate,acceptCandidate,setIntent} from '../skills/photo-retouch/scripts/project.mjs';
import {configureWorkflow} from '../skills/photo-retouch/scripts/workflow.mjs';
import {documentHash} from '../skills/photo-retouch/scripts/engine/edit-stack/identity.js';
import {loadRetouchPolicy} from '../skills/photo-retouch/scripts/retouch-policy.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'framelark-shared-ui-')),folder=join(scratch,'photo'),exec=promisify(execFile),session='retouch-ui-'+randomUUID();
const screenshots=process.argv[2]&&resolve(process.argv[2]);if(screenshots)await mkdir(screenshots,{recursive:true});
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:2e6}).then(r=>r.stdout.trim());
const wait=code=>browser('wait','--fn',code),read=async code=>JSON.parse(await browser('eval',code));
const calls=[];let server;
// This fixture tests UI transport/state only. Real semantic evidence is in the
// separate opt-in subscription matrix; these observations are not aesthetic QA.
const provider=http.createServer(async(request,response)=>{
 const chunks=[];for await(const chunk of request)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks));calls.push(payload);
 const value=payload.text.format.name==='retouch_diagnosis'?{goal:'界面验收目标',preserve:['保留测试原片'],checked:['界面协议测试'],findings:[],colorIntent:null}:{decision:'ready',summary:'固定流程夹具，非审美结论',checked:['界面协议测试'],strengths:['版本身份一致'],issues:[],resolutions:[]};
 response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({output_text:JSON.stringify(value),model:'ui-fixture'}));
});
const visual={goal:'比较亮度',benefit:'独立选择亮度变化',tradeoff:'复看灯头',findingIds:[]};
async function candidate(commands){const p=await loadProject(folder),d=projectDocument(p),policy=await loadRetouchPolicy({task:'plan'});return createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,policy:policy.provenance,documentProposal:{baseRevision:d.revision,baseHash:documentHash(d),items:commands.map((c,i)=>({id:'item-'+i,title:i?'色彩':'亮度',visual,commands:[c]}))}});}
try{
 await initProject(join(root,'test/web/fixtures/quality/night.png'),folder,{intent:'保留夜色'});
 const first=await candidate([{type:'AddStep',step:{id:'light',title:'提亮',tool:'exposure',toolVersion:2,parameters:{ev:.2}}}]);await acceptCandidate(folder,{revision:first.project.revision,id:first.candidate.id,selectionHash:first.candidate.selectionHash});
 let p=await loadProject(folder);await configureWorkflow(folder,{revision:p.revision,mode:'reviewed'});
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));
 server=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:scratch,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'0',OPENAI_API_KEY:'local-ui-fixture',OPENAI_MODEL:'ui-fixture',OPENAI_API_URL:`http://127.0.0.1:${provider.address().port}/v1/responses`},stdio:['ignore','pipe','pipe']});
 let log='';server.stderr.on('data',chunk=>{log+=chunk;});
 const base=await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Studio startup failed: '+log)),10000);server.once('error',j);server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);r('http://127.0.0.1:'+match[1]);}});});
 const response=await fetch(base+'/api/projects/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({path:folder})});const view=await response.json();assert.equal(view.supported,true);
 await browser('open',base+'/?project='+view.id);await browser('set','viewport','1280','800');
 await wait('document.querySelector("#project-sync-status")&&!document.querySelector("#project-sync-status").hidden&&document.querySelector("#project-sync-status").textContent==="已保存到项目"');
 await browser('click','#project-open');await wait('document.querySelector("#project-dialog").open&&document.querySelector("[data-project-review=diagnosis]")');
 await browser('click','[data-project-review="diagnosis"]');await wait('document.querySelector("#project-notice").textContent.includes("诊断已保存")');
 p=await loadProject(folder);assert.equal(p.diagnoses.length,1);assert.ok(p.diagnoses[0].policy.bundleHash);assert.equal(await read('document.querySelector("#project-native-frame")?.closest("section")?.hidden===false'),false);
 const made=await candidate([{type:'UpdateStepParameters',stepId:'light',parameters:{ev:.4}},{type:'AddStep',step:{id:'warm',title:'稍暖',tool:'color',toolVersion:2,parameters:{warmth:2}}}]);
 await wait(`document.querySelector('[data-review-version="${made.candidate.id}"]')`);await browser('click',`[data-review-version="${made.candidate.id}"]`);await wait('document.querySelector("[data-candidate-audit]").textContent.includes("审核通过")');
 await browser('uncheck','[data-project-item="item-1"]');await wait('document.querySelector("[data-candidate-audit]").textContent.includes("尚无有效审核")');
 await browser('click',`[data-project-preview="${made.candidate.id}"]`);await wait('document.querySelector("#project-accept").disabled===false');await browser('click','#project-accept');await wait('!document.querySelector("#project-preview").open');
 p=await loadProject(folder);assert.equal(p.versions.at(-1).acceptedBy,'user');assert.equal(p.versions.at(-1).recipe.steps.length,1);
 await browser('click','[data-project-review="audit"]:not([data-review-version])');await wait('document.querySelector("[data-project-audit-status]").textContent.includes("审核通过")');
 for(const width of [1280,390]){await browser('set','viewport',String(width),'800');assert.equal(await read('document.documentElement.scrollWidth>innerWidth'),false);if(screenshots)await browser('screenshot',join(screenshots,'review-current-'+width+'.png'));}
 p=await loadProject(folder);await setIntent(folder,{revision:p.revision,intent:'改为更暗的目标'});await wait('document.querySelector("[data-project-audit-status]").textContent.includes("尚无有效审核")');
 assert.equal((await loadProject(folder)).resultAudits.length,2);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.instructions.includes('共同摄影与审核方法')));
 if(screenshots)await browser('screenshot',join(screenshots,'review-target-changed.png'));
 console.log('Shared retouch UI passed: current diagnosis, shared policy, selectable candidate audit invalidation, direct human acceptance, reviewed document in standard editor, goal invalidation and responsive layout. Model content was a deterministic UI fixture.');
}catch(error){console.error('Visible failure state:',await browser('eval',`JSON.stringify({url:location.href,body:document.body.innerText.slice(0,2800),notice:document.querySelector('#project-notice')?.textContent,previewNote:document.querySelector('#project-preview-note')?.textContent,images:[...document.querySelectorAll('#project-preview img')].map(i=>({src:i.src,complete:i.complete,width:i.naturalWidth})),status:document.querySelector('#project-sync-status')?.textContent})`).catch(()=>''));throw error;}finally{await browser('close').catch(()=>{});if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}await new Promise(r=>provider.close(r));await rm(scratch,{recursive:true,force:true});}
