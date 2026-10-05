import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {initProject,loadProject,createCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {configureWorkflow} from '../skills/photo-retouch/scripts/workflow.mjs';

const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'frameyn-collaboration-')),folder=join(temporary,'photo');
let session='frameyn-collab-'+randomUUID();
const screenshots=process.argv[2]&&resolve(process.argv[2]);if(screenshots)await mkdir(screenshots,{recursive:true});
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:2000000}).then(r=>r.stdout.trim());
const evaluate=async code=>{await browser('frame','main');const result=JSON.parse(await browser('eval',code));return typeof result==='string'?JSON.parse(result):result;};
const frame='document.querySelector("#project-native-frame").contentDocument';
const wait=async code=>{await browser('frame','main');return browser('wait','--fn',code);};
let inputId=0;
const cli=async(command,value,options=[])=>{
  const args=[join(root,'skills/photo-retouch/scripts/cli.mjs'),command,'--project',folder,...options];
  if(value){const input=join(temporary,`input-${++inputId}.json`);await writeFile(input,JSON.stringify(value));args.push('--input',input);}
  return JSON.parse((await exec(process.execPath,args,{maxBuffer:12000000,timeout:60000})).stdout);
};
const child=async(...args)=>{await browser('frame','#project-native-frame');return browser(...args);};
const capture=async name=>{if(screenshots)await browser('screenshot',join(screenshots,name+'.png'));};
let output='',server;
try{
  const p=(await initProject(join(root,'test/web/fixtures/quality/portrait.png'),folder,{intent:'保留自然肤色，先比较再接受'})).project;
  await configureWorkflow(folder,{revision:p.revision,mode:'reviewed'});
  server=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:temporary,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'0',OPENAI_API_KEY:'',OPENAI_MODEL:''},stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',()=>{});
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Studio did not start')),10000);server.once('error',reject);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});
  const studio=await cli('studio',null,['--url',base]);await browser('open',studio.url);await browser('set','viewport','1280','800');
  await wait('document.querySelector("#project-native-loading").hidden');
  assert.equal(await evaluate(`JSON.stringify(${frame}.querySelector('#next-step').textContent.includes('诊断'))`),true);
  await child('click','.coordinate-mark summary');await child('click','#coordinate-note');
  await wait(`${frame}.querySelector('#note-text')&&!${frame}.querySelector('#note-editor').hidden`);
  await wait(`${frame}.querySelector('#save-note').disabled===false`);
  await child('fill','#note-text','保留这里的自然肤色');await child('click','#save-note');
  await wait(`${frame}.querySelector('#note-list').textContent.includes('保留这里的自然肤色')`);
  assert.equal((await loadProject(folder)).notes[0].note,'保留这里的自然肤色');
  await wait(`${frame}.querySelector('#handoff-request').disabled===false`);
  const waiting=cli('watch',null,['--timeout','20']);
  await child('click','#handoff-request');await wait(`${frame}.querySelector('#handoff-status').textContent==='等待 Agent 接手'`);
  assert.equal((await waiting).type,'handoff');
  let project=await loadProject(folder);const request=project.handoffs.at(-1),actorId='browser-test-agent';
  await cli('handoff',{action:'claim',revision:project.revision,id:request.id,actorId});
  await wait(`${frame}.querySelector('#handoff-status').textContent==='Agent 正在处理'`);
  project=await loadProject(folder);const preview=await cli('preview',null,['--max-side','512']);
  // This is a labelled workflow fixture, not a simulated aesthetic evaluation.
  await cli('diagnosis',{revision:project.revision,versionId:project.currentId,maxSide:512,pixelHash:preview.pixelHash,frameSpecHash:preview.frameSpecHash,actorId,goal:'浏览器流程验证',preserve:['测试原片与画面范围'],checked:['文件项目同步'],findings:[]});
  project=await loadProject(folder);
  const made=await cli('compose',{revision:project.revision,baseVersion:project.currentId,handoffId:request.id,actorId,name:'可分别选择的两步试片',goal:'先比较曝光与暖色',tradeoff:'测试工具效果，不作审美结论',operations:[
    {id:'light',title:'轻抬曝光',tool:'tone',version:1,target:{kind:'image'},parameters:{mode:'delta',changes:[{key:'exposure',value:.15}]},dependsOn:[]},
    {id:'color',title:'略减暖色',tool:'color',version:1,target:{kind:'image'},parameters:{mode:'delta',changes:[{key:'warmth',value:-4}]},dependsOn:[]}
  ],selectedItemIds:['light','color']});
  await cli('handoff',{action:'complete',revision:made.project.revision,id:request.id,actorId,summary:'试片已准备好，逐项比较后再接受。',candidateIds:[made.candidate.id]});
  await wait(`${frame}.querySelector('#handoff-status').textContent==='Agent 已回应'&&${frame}.querySelector('#candidate-name').textContent==='可分别选择的两步试片'`);
  await child('click','[data-view=compare]');
  await wait(`${frame}.querySelector('#accept-button').disabled===false`);
  await capture('reviewed-collaboration-desktop');
  await child('uncheck','#candidate-items input[data-edit-item="color"]');
  await wait(`${frame}.querySelector('#accept-button').disabled===false&&${frame}.querySelector('#accept-button').textContent.includes('1 项')`);
  await child('click','#accept-button');
  await wait(`${frame}.querySelector('#candidate-section').hidden`);
  project=await loadProject(folder);assert.equal(project.versions.at(-1).state.settings.exposure,.15);assert.equal(project.versions.at(-1).state.settings.warmth,0);assert.equal(project.workflow.mode,'reviewed');
  await child('click','#adjustments summary');
  await wait(`${frame}.querySelector('#parameter-exposure').disabled===false`);
  await child('focus','#parameter-exposure');await child('press','ArrowRight');
  await wait('document.querySelector("#project-sync-status").textContent.includes("未保存输入")');
  await browser('frame','main');await browser('hover','.photo-tab');await browser('click','#photo-tabs button[aria-label^="移出"]');
  assert.equal(await evaluate('JSON.stringify(document.querySelectorAll(".photo-tab").length)'),1,'Unsaved native input prevents removing its photo');
  await child('click','#manual-reset');await wait('!document.querySelector("#project-sync-status").textContent.includes("未保存输入")');
  for(const [width,height] of [[1280,577],[390,844],[320,720]]){
    await browser('set','viewport',String(width),String(height));
    assert.equal(await evaluate('JSON.stringify(document.documentElement.scrollWidth>innerWidth)'),false);
    assert.equal(await evaluate(`JSON.stringify(${frame}.documentElement.scrollWidth>${frame}.defaultView.innerWidth)`),false);
    if(width>960)assert.equal(await evaluate(`JSON.stringify(${frame}.querySelector('#export-button').getBoundingClientRect().bottom<=${frame}.defaultView.innerHeight)`),true);
    await capture('reviewed-collaboration-'+width);
  }
  await browser('frame','main');
  await browser('set','viewport','1280','577');
  const basicFolder=join(temporary,'basic'),basic=(await initProject(join(root,'test/web/fixtures/quality/night.png'),basicFolder)).project;
  const madeBasic=await createCandidate(basicFolder,{revision:basic.revision,baseVersion:basic.currentId,name:'保留夜色',goal:'保留明亮处的层次，也让暗处保持夜晚的安静。'.repeat(8),tradeoff:'先比较，再决定是否接受。'.repeat(12),items:[{id:'light',title:'轻抬曝光',patch:{settings:{exposure:.1}}}]});
  const registered=await fetch(base+'/api/projects/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({path:basicFolder})});assert.equal(registered.status,200);
  await browser('open',`${base}/?project=${basic.id}`);await wait('document.querySelector(".collaboration-candidate")');
  await browser('click','.collaboration-candidate');await wait('document.querySelector("#project-accept").disabled===false');
  for(const [width,height] of [[1280,577],[390,844],[320,720]]){
    await browser('set','viewport',String(width),String(height));
    assert.equal(await evaluate(`JSON.stringify((()=>{const b=document.querySelector('#project-accept'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})())`),true,'Accept remains visible with long copy at '+width);
    await capture('shared-preview-'+width);
  }
  await browser('click','#project-accept');await wait('!document.querySelector("#project-preview").open');
  assert.equal((await loadProject(basicFolder)).currentId,madeBasic.candidate.id);
  // Verify the first-upload entry in a fresh browser, without an earlier file project.
  await browser('close');session+='-upload';await browser('open',base);
  await browser('set','viewport','1280','800');
  await browser('upload','#file-input',join(root,'test/web/fixtures/quality/portrait-cast.png'));
  await wait('document.querySelector("#collaboration-request").textContent==="与 Agent 一起修"&&!document.querySelector("#collaboration-request").disabled');
  await browser('click','#collaboration-request');
  await wait('document.querySelector("#collaboration-status").textContent==="等待 Agent 接手"');
  const newId=await evaluate('JSON.stringify(new URL(location.href).searchParams.get("project"))');
  const shared=await(await fetch(base+'/api/projects/'+newId)).json();
  assert.equal(shared.name,'portrait-cast.png');assert.equal(shared.collaboration.status,'queued');
  await capture('one-click-agent-handoff');
  const errors=await browser('errors');assert.equal(errors,'');
  console.log('Collaboration browser checks passed: reviewed project in the full studio, human notes → CLI watch → claim → tool candidates → selective acceptance, unsaved input protection, desktop and phone layouts.');
}catch(error){
  await capture('failure').catch(()=>{});
  console.error(await evaluate(`JSON.stringify({page:document.querySelector('#toast')?.textContent,editor:${frame}?.body.innerText.slice(-1600)})`).catch(()=>''));
  throw error;
}finally{
  await browser('close').catch(()=>{});
  if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},2500);server.once('exit',()=>{clearTimeout(timer);resolve();});});}
  await rm(temporary,{recursive:true,force:true});
}
