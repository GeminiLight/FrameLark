import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {initProject,loadProject,projectDocument,createCandidate,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {previewPhoto} from '../skills/photo-retouch/scripts/render.mjs';
import {documentHash} from '../skills/photo-retouch/scripts/engine/edit-stack/identity.js';

const root=fileURLToPath(new URL('../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'framelark-series-ui-')),exec=promisify(execFile),session='series-ui-'+randomUUID();
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
const screenshots=process.argv[2]&&resolve(process.argv[2]);if(screenshots)await mkdir(screenshots,{recursive:true});
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:2e6}).then(r=>r.stdout.trim());
const wait=code=>browser('wait','--fn',code),read=async code=>JSON.parse(await browser('eval',code));
const calls=[],fixtures=[];let server;
// Only deterministic protocol fixtures and generated technical images are used.
// This is an image/recipe/persistence check, not a model or aesthetic evaluation.
const provider=http.createServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks));calls.push(payload);
  if(payload.text?.format?.name!=='photo_series_review'){response.writeHead(400);response.end('{}');return;}
  const ids=payload.text.format.schema.properties.order.items.enum;
  const value={title:'配方一致性夹具',summary:'检查已保存的曝光步骤。',preserve:'保留现有步骤。',tradeoff:'仅验证协议和像素身份。',order:ids,
    sharedStyle:{presetId:'none',amount:0,reason:'不加入风格。'},photos:ids.map(id=>({id,role:'技术样张',reason:'验证配方',preserve:'已有曝光',tradeoff:'检查亮度',cropNote:'保持画幅',changes:[{key:'exposure',value:.2}]}))};
  response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({output_text:JSON.stringify(value),model:'ui-fixture'}));
});
try{
  for(const [i,color] of ['#374650','#504638'].entries()){
    const image=join(scratch,'image-'+i+'.png'),folder=join(scratch,'photo-'+i);
    await sharp({create:{width:320,height:240,channels:3,background:color}}).png().toFile(image);await initProject(image,folder);
    const p=await loadProject(folder),d=projectDocument(p),made=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,documentProposal:{baseRevision:d.revision,baseHash:documentHash(d),items:[{id:'existing',title:'已有曝光',commands:[{type:'AddStep',step:{id:'existing',title:'已有曝光',tool:'exposure',toolVersion:2,parameters:{ev:.4}}}]}]}});
    await acceptCandidate(folder,{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});
    fixtures.push({folder,before:await loadProject(folder)});
  }
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  server=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:scratch,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'0',OPENAI_API_KEY:'local-ui-fixture',OPENAI_MODEL:'ui-fixture',OPENAI_API_URL:`http://127.0.0.1:${provider.address().port}/v1/responses`},stdio:['ignore','pipe','pipe']});
  let log='';server.stderr.on('data',chunk=>{log+=chunk;});
  const base=await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Studio startup failed: '+log)),10000);server.once('error',j);server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);r('http://127.0.0.1:'+match[1]);}});});
  for(const fixture of fixtures){const response=await fetch(base+'/api/projects/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({path:fixture.folder})});assert.equal(response.status,200);fixture.view=await response.json();assert.equal(fixture.view.supported,true);}
  await browser('open',base+'/?project='+fixtures[0].view.id);await browser('set','viewport','1280','800');
  await wait('document.querySelector("#project-sync-status").textContent==="已保存到项目"');
  await browser('click','#project-open');await browser('fill','#project-path',fixtures[1].folder);await browser('click','#project-register button');
  await wait('document.querySelectorAll("#photo-tabs [data-photo-select]").length===2');await browser('click','#project-close');
  await browser('click','#series-open');await browser('fill','#series-intent','验证当前已保存步骤与整组增量的一致性');await browser('click','#series-review');
  await wait('!document.querySelector("#series-accept").disabled');assert.equal(calls.length,1);
  const images=calls[0].input[0].content.filter(item=>item.type==='input_image');assert.equal(images.length,2);
  const contexts=calls[0].input[0].content.filter(item=>item.type==='input_text'&&item.text.startsWith('{')).map(item=>JSON.parse(item.text));
  assert.equal(contexts.length,2);assert.ok(contexts.every(item=>item.current.kind==='document-preview'&&!Object.hasOwn(item.current,'settings')));
  for(let i=0;i<2;i++){
    const native=await previewPhoto(fixtures[i].folder,fixtures[i].before.currentId,{maxSide:800});
    const expected=await sharp(native.path).removeAlpha().raw().toBuffer(),actual=await sharp(Buffer.from(images[i].image_url.split(',')[1],'base64')).removeAlpha().raw().toBuffer();
    for(let c=0;c<3;c++)assert.ok(Math.abs(expected[c]-actual[c])<=3,'series model image includes saved exposure for photo '+i);
  }
  // Hold an actual committed response, then redraw the gallery while the
  // caller still awaits persistence. Rendering does not replace the save owner.
  await browser('eval',"(()=>{const fetchOriginal=window.fetch.bind(window);let held=false;window.fetch=async(...args)=>{const response=await fetchOriginal(...args);if(!held&&String(args[0]).endsWith('/accept')&&args[1]?.method==='POST'){held=true;await new Promise(resolve=>window.finishSeriesSave=resolve);}return response;};return true;})()");
  await browser('click','#series-accept');await wait('typeof window.finishSeriesSave==="function"');
  await browser('click','[data-series-view="current"]');await browser('click','[data-series-view="trial"]');
  assert.equal(await read('document.querySelector("#series-export").disabled'),true);
  await browser('eval','window.finishSeriesSave();true');await wait('document.querySelector("#series-status").textContent.includes("已应用整组调整")');
  for(const fixture of fixtures){const p=await loadProject(fixture.folder),d=projectDocument(p);assert.notEqual(p.currentId,fixture.before.currentId);assert.equal(d.steps.length,2);assert.equal(d.steps[0].id,'existing');assert.equal(d.steps[0].parameters.ev,.4);assert.equal(d.steps[1].parameters.ev,.2);}
  for(const width of [1280,390]){await browser('set','viewport',String(width),'800');assert.equal(await read('document.documentElement.scrollWidth>innerWidth'),false);if(screenshots)await browser('screenshot',join(screenshots,'series-saved-'+width+'.png'));}
  await browser('click','#series-close');await browser('set','viewport','1280','800');await browser('click','#nav-library');await browser('click','#library-undo-batch');
  await wait('document.querySelector("#toast").textContent.includes("已撤销 2 张")');
  for(const fixture of fixtures){const p=await loadProject(fixture.folder);assert.equal(projectDocument(p).steps.length,1);assert.equal(projectDocument(p).steps[0].id,'existing');}
  assert.equal(await browser('errors'),'');
  console.log('Series document UI passed: actual saved-step model images, executable deltas, disk persistence for both photos, shared-version undo and responsive layouts. Model content was a deterministic protocol fixture.');
}catch(error){console.error('Visible series state:',await browser('eval','JSON.stringify({body:document.body.innerText.slice(0,2500),toast:document.querySelector("#toast")?.textContent,status:document.querySelector("#series-status")?.textContent})').catch(()=>''));throw error;}
finally{
  await browser('close').catch(()=>{});if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);}
  await new Promise(r=>provider.close(r));await rm(scratch,{recursive:true,force:true});
}
