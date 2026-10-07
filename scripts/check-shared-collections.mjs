import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
import {initCollection,inspectCollection,updateCollectionBrief} from '../skills/photo-retouch/scripts/collection.mjs';
import {loadProject,createCandidate,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),exec=promisify(execFile),session='framelark-collections-'+randomUUID();
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:1500000}).then(r=>r.stdout.trim());
const evaluate=async code=>JSON.parse(await browser('eval',code));
const temporary=await mkdtemp(join(tmpdir(),'framelark-collection-browser-'));
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
const output=process.argv[2]||join(root,'artifacts','shared-collections');let child;
try{
  const images=[];for(const [index,color] of ['#a87658','#657d8a'].entries()){
    const path=join(temporary,'photo-'+index+'.png');await sharp({create:{width:320,height:240,channels:3,background:color}}).png().toFile(path);images.push(path);
  }
  const folder=join(temporary,'collection');await initCollection(folder,{images,brief:{theme:'安静的旅途',targetCount:2}});
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  child=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:temporary,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(port)}});
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let n=0;n<80;n++){
    try{const response=await fetch(base+'/api/local-capabilities');if(response.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,'Private local studio must start');
  await browser('open',base);await browser('set','viewport','1280','800');
  await browser('wait','--fn','Boolean(document.querySelector("#collection-open"))');
  await browser('click','#collection-open');await browser('fill','#collection-source',folder);await browser('click','#collection-load');
  await browser('wait','--fn','document.querySelector("#shared-collection-dialog").open&&document.querySelectorAll("[data-collection-photo]").length===2');
  await browser('fill','#collection-theme','网页确认的新主题');await browser('click','#collection-save-theme');
  await browser('wait','--fn','document.querySelector("#collection-status").textContent.includes("主题已保存")');
  assert.equal((await inspectCollection(folder)).brief.theme,'网页确认的新主题');
  await browser('click','[data-collection-move="P0002"][data-direction="-1"]');await browser('click','#collection-save-plan');
  await browser('wait','--fn','document.querySelector("#collection-status").textContent.includes("选片与顺序已保存")');
  let c=await inspectCollection(folder);assert.deepEqual(c.plan.order,['P0002','P0001']);assert.equal(c.plan.source,'workspace-user');
  await updateCollectionBrief(folder,{revision:c.revision,brief:{theme:'Agent 更新的主题'}});
  await browser('wait','--fn','document.querySelector("#collection-theme").value==="Agent 更新的主题"');
  assert.equal(await evaluate('document.querySelector("#collection-theme").disabled'),false,'A completed save must release the theme input');
  await browser('fill','#collection-theme','还没保存的网页输入');c=await inspectCollection(folder);
  await updateCollectionBrief(folder,{revision:c.revision,brief:{theme:'Agent 再次更新'}});
  await browser('wait','--fn','document.querySelector("#collection-status").textContent.includes("保留")');
  assert.equal(await evaluate('document.querySelector("#collection-theme").value'),'还没保存的网页输入');
  await browser('click','#collection-backup');await browser('click','#collection-reload');
  await browser('wait','--fn','document.querySelector("#collection-theme").value==="Agent 再次更新"');
  await browser('click','#collection-save-plan');await browser('wait','--fn','document.querySelector("#collection-status").textContent.includes("选片与顺序已保存")');
  await browser('click','#collection-export');await browser('wait','--fn','document.querySelectorAll("#collection-downloads a").length===3');
  const links=await evaluate('Array.from(document.querySelectorAll("#collection-downloads a"),a=>a.href)');
  for(const url of links){const response=await fetch(url);assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>100);}
  assert.equal((await inspectCollection(folder)).jobs.at(-1).status,'done');
  const childFolder=join(folder,'photos/P0001'),project=await loadProject(childFolder);
  const candidate=await createCandidate(childFolder,{revision:project.revision,baseVersion:project.currentId,settings:{exposure:.1}});
  await acceptCandidate(childFolder,{id:candidate.candidate.id});
  await browser('wait','--fn','document.querySelector("#collection-downloads strong").textContent.includes("此前导出的版本")');
  assert.equal(await evaluate('document.querySelector("#collection-export").disabled'),true);
  await browser('click','#collection-save-plan');await browser('wait','--fn','document.querySelector("#collection-status").textContent.includes("选片与顺序已保存")');
  await mkdir(output,{recursive:true});await browser('screenshot',join(output,'desktop.png'));
  for(const [width,height,name] of [[1280,577,'short-screen'],[390,844,'mobile'],[320,720,'small-phone']]){
    await browser('set','viewport',String(width),String(height));assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false);
    const visible=await evaluate('(()=>{const button=document.querySelector("#collection-export"),r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.bottom<=innerHeight&&r.top>=0&&button.contains(hit);})()');
    assert.equal(visible,true,'Ordered export remains reachable at '+width+'×'+height);
    await browser('screenshot',join(output,name+'.png'));
  }
  assert.equal(await browser('errors'),'');
  console.log('PASS shared collection: CLI→Web theme/version, Web→CLI order, dirty-input protection, real export/download, old-output labels, desktop/short-screen/390px/320px.');
}finally{
  await browser('close').catch(()=>{});
  if(child&&child.exitCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');const force=setTimeout(()=>child.kill('SIGKILL'),3000);await exit;clearTimeout(force);}
  await rm(temporary,{recursive:true,force:true});
}
