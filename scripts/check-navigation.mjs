import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

// Exercise rendered navigation, not just the presence of controls in the HTML.
// Use a separate cloud-mode server with no model credentials or user drafts.
const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'frameyn-navigation-'));
const session='frameyn-nav-'+randomUUID();
const server=spawn(process.execPath,[join(root,'server.mjs')],{cwd:temporary,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'1',OPENAI_API_KEY:'',OPENAI_MODEL:''},stdio:['ignore','pipe','pipe']});
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30_000,maxBuffer:1_000_000}).then(r=>r.stdout.trim());
const evaluate=async code=>{const result=JSON.parse(await browser('eval',code));return typeof result==='string'?JSON.parse(result):result;};
const visible=id=>`(()=>{const e=document.querySelector(${JSON.stringify(id)}),r=e?.getBoundingClientRect();return JSON.stringify(Boolean(e&&!e.hidden&&r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth));})()`;
let output='';server.stderr.on('data',()=>{});
try {
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Navigation test server did not start')),10_000);
    server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.once('exit',()=>{clearTimeout(timer);reject(new Error('Navigation test server stopped'));});
    server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
  });
  await browser('open',base);
  await browser('set','viewport','1280','800');
  await browser('wait','--fn','document.querySelector("#try-example") && document.querySelector(".select-control")');
  for(const id of ['#nav-library','#nav-studio','#nav-learn','#nav-profile','#profile-button'])assert.equal(await evaluate(visible(id)),true,id+' is visible');
  await browser('upload','#file-input',join(root,'test/web/fixtures/quality/night.png'));
  await browser('wait','--fn','!document.querySelector(".right-panel").hidden && !document.querySelector("#export-button").disabled');
  await browser('click','#panel-adjust');
  await browser('focus','#manual-sliders input[type="range"]');await browser('press','PageUp');
  await browser('wait','--fn','!document.querySelector("#export-button").disabled');
  const frame=()=>evaluate(`(()=>{const c=document.querySelector('#edited-canvas');let hash=2166136261;for(const v of c.getContext('2d').getImageData(0,0,c.width,c.height).data)hash=Math.imul(hash^v,16777619)>>>0;return JSON.stringify({hash,manual:[...document.querySelectorAll('#manual-sliders input')].map(e=>e.value)});})()`);
  const before=await frame();let width;
  for(const [mode,pane] of [['diagnosis','inspector-review'],['adjust','inspector-adjust'],['presets','tab-presets'],['agent','tab-agent']]){
    await browser('click','#panel-'+mode);
    const state=await evaluate(`(()=>{const p=document.querySelector('.right-panel');return JSON.stringify({mode:p.dataset.view,width:p.getBoundingClientRect().width,panes:[...document.querySelectorAll('.inspector-space')].filter(e=>!e.hidden&&getComputedStyle(e).display!=='none').map(e=>e.id)});})()`);
    assert.equal(state.mode,mode);assert.deepEqual(state.panes,[pane]);
    width??=state.width;assert.equal(state.width,width,'Panel switching does not move the photograph');
  }
  await browser('wait','--fn','!document.querySelector("#export-button").disabled');assert.deepEqual(await frame(),before,'Navigation preserves the edited pixels and parameters');
  await browser('click','#nav-learn');assert.equal(await evaluate(`JSON.stringify(!document.querySelector('#learn-space').hidden)`),true);
  await browser('click','#profile-button');assert.equal(await evaluate(`JSON.stringify(document.querySelector('#profile-dialog').open&&document.querySelector('#profile-overview-tab').getAttribute('aria-selected')==='true')`),true);
  await browser('click','#close-profile');await browser('click','#nav-profile');
  assert.equal(await evaluate(`JSON.stringify(document.querySelector('#profile-preferences-tab').getAttribute('aria-selected')==='true')`),true);
  await browser('click','#close-profile');await browser('click','#nav-studio');
  for(const [w,h] of [[1280,577],[390,844],[320,720]]){
    await browser('set','viewport',String(w),String(h));
    if(w>960){for(const id of ['#nav-learn','#nav-profile','#profile-button'])assert.equal(await evaluate(visible(id)),true,id+' on a short screen');}
    else {
      const spaces=await evaluate(`JSON.stringify([...document.querySelectorAll('.mobile-spaces button')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent.trim()))`);
      assert.deepEqual(spaces,['图库','修片','学习','我的']);assert.equal(await evaluate(visible('#mobile-settings-button')),true);
      await browser('click','.mobile-spaces [data-space="learn"]');assert.equal(await evaluate(`JSON.stringify(!document.querySelector('#learn-space').hidden)`),true);
      await browser('click','.mobile-spaces [data-space="profile"]');assert.equal(await evaluate(`JSON.stringify(document.querySelector('#profile-dialog').open&&document.querySelector('#profile-overview-tab').getAttribute('aria-selected')==='true')`),true);
      await browser('click','#close-profile');await browser('click','.mobile-spaces [data-space="studio"]');
      await browser('click','#mobile-settings-button');assert.equal(await evaluate(`JSON.stringify(document.querySelector('#more-tools-dialog').open)`),true);await browser('click','#more-tools-close');
    }
    assert.equal(await evaluate(`JSON.stringify(document.documentElement.scrollWidth>innerWidth)`),false,'No horizontal overflow at '+w);
  }
  const errors=await browser('errors');assert.equal(errors,'','No browser errors');
  console.log('Rendered navigation passed: learning, profile, preferences, four inspector modes, unchanged edits and three screen sizes.');
} finally {
  await browser('close').catch(()=>{});
  if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},2000);server.once('exit',()=>{clearTimeout(timer);resolve();});});}
  await rm(temporary,{recursive:true,force:true});
}
