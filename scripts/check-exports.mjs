import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const exec=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url));
const temporary=await mkdtemp(join(tmpdir(),'framelark-export-check-')),session='framelark-exports-'+randomUUID();
const server=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:temporary,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'0',OPENAI_API_KEY:'',OPENAI_MODEL:''},stdio:['ignore','pipe','pipe']});
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:2000000}).then(result=>result.stdout.trim());
const evaluate=async code=>{const value=JSON.parse(await browser('eval',code));return typeof value==='string'?JSON.parse(value):value;};
const wait=code=>browser('wait','--fn',code);
const edit=async value=>{await browser('click','#panel-adjust');await evaluate(`(()=>{const input=document.querySelector('#slider-exposure');input.value=${JSON.stringify(String(value))};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return JSON.stringify(true);})()`);await ready();};
const ready=()=>wait('!document.querySelector("#export-button").disabled&&document.querySelector("#image-loading").hidden');
const canvasIdentity=()=>evaluate(`JSON.stringify((()=>{const canvas=document.querySelector('#edited-canvas');let hash=2166136261;for(const byte of canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)hash=Math.imul(hash^byte,16777619)>>>0;return {width:canvas.width,height:canvas.height,hash};})())`);
async function exportedIdentity(index){
  return evaluate(`(async()=>{const item=window.exportCaptures[${index}],image=await createImageBitmap(item.blob),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);image.close();let hash=2166136261;for(const byte of context.getImageData(0,0,canvas.width,canvas.height).data)hash=Math.imul(hash^byte,16777619)>>>0;return JSON.stringify({width:canvas.width,height:canvas.height,hash});})()`);
}
async function beginExport(){
  await browser('click','#export-button');await browser('check','input[name="export-format"][value="png"]');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#export-size").value)'),'2048');
  for(const [width,height] of [[1280,577],[390,844],[320,720]]){
    await browser('set','viewport',String(width),String(height));
    assert.equal(await evaluate(`JSON.stringify((()=>{const button=document.querySelector('#confirm-export'),rect=button.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return rect.top>=0&&rect.bottom<=innerHeight&&hit?.closest('#confirm-export')===button;})())`),true,'Export confirmation stays visible and clickable at '+width+' × '+height);
    assert.equal(await evaluate('JSON.stringify(document.documentElement.scrollWidth<=innerWidth)'),true);
  }
  await browser('set','viewport','1280','800');
  await browser('click','#confirm-export');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#export-dialog").open)'),false,'The visible confirm action starts the export');
}

let output='';server.stderr.on('data',()=>{});
try{
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Export test server did not start')),10000);
    server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
  });
  await browser('open',base);await browser('set','viewport','1280','800');
  await wait('!document.querySelector("#project-open").hidden');
  await browser('upload','#file-input',join(root,'test/web/fixtures/quality/portrait.png'),join(root,'test/web/fixtures/quality/night.png'));
  await wait('document.querySelectorAll(".photo-tab").length===2');await ready();
  const photoIds=await evaluate('JSON.stringify([...document.querySelectorAll("[data-photo-select]")].map(button=>button.dataset.photoSelect))');
  await edit(.15);const expected=await canvasIdentity();
  // Capture the actual generated file at the download boundary. A paused export
  // worker gives the person time to keep editing and select a different photo.
  await evaluate(`(()=>{const objectURL=URL.createObjectURL,click=HTMLAnchorElement.prototype.click,post=Worker.prototype.postMessage,blobs=new Map();window.exportCaptures=[];URL.createObjectURL=function(blob){const url=objectURL.call(this,blob);blobs.set(url,blob);return url;};HTMLAnchorElement.prototype.click=function(){if(this.download&&blobs.has(this.href)){window.exportCaptures.push({name:this.download,blob:blobs.get(this.href)});return;}return click.call(this);};window.holdExport=true;Worker.prototype.postMessage=function(message,...args){if(window.holdExport&&message.id===1&&message.pixels){window.holdExport=false;window.releaseExport=()=>post.call(this,message,...args);return;}return post.call(this,message,...args);};return JSON.stringify(true);})()`);
  await beginExport();await wait('typeof window.releaseExport==="function"');
  await edit(.4);await browser('click',`[data-photo-select="${photoIds[1]}"]`);await edit(-.2);
  await evaluate('window.releaseExport();JSON.stringify(true)');await wait('window.exportCaptures.length===1');
  assert.deepEqual(await exportedIdentity(0),expected,'Export uses the clicked snapshot and the same PNG pixels as its preview');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#slider-exposure").value)'),'-0.2','Completing another photo export does not change the active adjustment');
  await browser('click',`[data-photo-select="${photoIds[0]}"]`);await ready();
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#slider-exposure").value)'),'0.4','The first photo keeps edits made while exporting');
  const sharedExpected=await canvasIdentity();
  await browser('click','#project-open');
  await wait('document.querySelector("#project-dialog").open&&document.querySelector("#project-dialog").getAttribute("aria-busy")==="false"&&!document.querySelector("#project-create").disabled');
  await browser('click','#project-create');
  await wait('document.querySelector("#project-notice").textContent.includes("已保存照片")');await browser('click','#project-close');await ready();
  await beginExport();await wait('window.exportCaptures.length===2');
  assert.deepEqual(await exportedIdentity(1),sharedExpected,'File-project PNG exports match the current preview and declared dimensions');
  const errors=await browser('errors');assert.equal(errors,'');
  console.log('Export browser checks passed: two independent photo states, immutable queued snapshot, editing/switching during export, actual PNG pixel and size equality, file-project download, and accessible confirmation on desktop/short/mobile screens.');
}catch(error){console.error(await evaluate('JSON.stringify({projectNotice:document.querySelector("#project-notice")?.textContent,projectSync:document.querySelector("#project-sync-status")?.textContent,projectCreateDisabled:document.querySelector("#project-create")?.disabled,projectDialogBusy:document.querySelector("#project-dialog")?.getAttribute("aria-busy"),projectRecentItems:document.querySelector("#project-recent")?.children.length,toast:document.querySelector("#toast")?.textContent,tasks:document.querySelector("#task-list")?.textContent,exportDialog:document.querySelector("#export-dialog")?.open,confirmDisabled:document.querySelector("#confirm-export")?.disabled,geometry:(()=>{const button=document.querySelector("#confirm-export"),rect=button.getBoundingClientRect();return {rect:rect.toJSON(),hit:document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.outerHTML.slice(0,200),height:innerHeight};})()})').catch(()=>''));await browser('screenshot',join(root,'artifacts','architecture-exports-failure.png')).catch(()=>{});console.error(await browser('errors').catch(()=>''));throw error;}
finally{
  await browser('close').catch(()=>{});
  if(server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},2500);server.once('exit',()=>{clearTimeout(timer);resolve();});});}
  await rm(temporary,{recursive:true,force:true});
}
