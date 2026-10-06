import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'framelark-website-'));
const exec=promisify(execFile),session='framelark-website-'+randomUUID();
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:1500000}).then(r=>r.stdout.trim());
const evaluate=async code=>{const result=JSON.parse(await browser('eval',code));return typeof result==='string'?JSON.parse(result):result;};
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
let server;
const cafeReady=()=>browser('wait','--fn','!document.querySelector("#eye-panel-cafe").hidden&&document.querySelector(".eye-art").getAttribute("aria-busy")==="false"');
async function click(selector){
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'});JSON.stringify(true)`);
  await browser('wait','--fn',`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.width>0&&r.height>0&&e.contains(hit)&&!e.closest('section,dialog')?.getAnimations({subtree:true}).some(a=>a.playState==='running');})()`);
  await browser('click',selector);
}

try{
  await exec(process.execPath,['apps/website/build.mjs','--out',join(temporary,'FrameLark'),'--site-url','https://example.com/FrameLark/'],{cwd:root});
  server=http.createServer(async(request,response)=>{
    try{
      let path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(path.endsWith('/'))path+='index.html';
      const file=resolve(temporary,'.'+path);
      if(!file.startsWith(temporary+sep)){response.writeHead(403);response.end();return;}
      const data=await readFile(file);response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});response.end(data);
    }catch{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/FrameLark/';
  await browser('open',base);await browser('set','viewport','1366','900');
  await browser('wait','--fn','!document.querySelector("#compare-range").disabled');
  // Only the preloader fails once; the real image and all subsequent retries
  // still come from the built site. This reproduces a recoverable load failure.
  await evaluate(`(()=>{const NativeImage=window.Image,src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');let fail=true;window.Image=function(...args){const image=new NativeImage(...args);Object.defineProperty(image,'src',{get(){return src.get.call(image);},set(value){if(fail&&value.endsWith('/cafe-board.webp')){fail=false;queueMicrotask(()=>image.dispatchEvent(new Event('error')));}else src.set.call(image,value);}});return image;};return JSON.stringify(true);})()`);
  await browser('click','[data-eye-case=cafe]');await browser('wait','--fn','document.querySelector("#eye-announcement").textContent.includes("重试")');
  const notice=await evaluate(`(()=>{const node=document.querySelector('#eye-announcement'),r=node.getBoundingClientRect(),style=getComputedStyle(node);return JSON.stringify({text:node.textContent,height:r.height,clip:style.clip,arcadeKept:!document.querySelector('#eye-panel-arcade').hidden});})()`);
  assert.ok(notice.height>12&&notice.clip==='auto','An image-load failure needs a visible recovery message');assert.equal(notice.arcadeKept,true);
  await browser('click','[data-eye-case=cafe]');await cafeReady();
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#eye-announcement").classList.contains("is-error"))'),false);
  console.log('PASS visible image error, preserved old scene and successful retry');

  await click('#eye-panel-cafe [data-board=cafe]');await browser('wait','--fn','document.querySelector("#board-dialog").open');
  assert.ok((await evaluate('JSON.stringify(document.querySelector("#board-dialog-title").textContent)')).includes('玻璃'));
  assert.ok((await evaluate('JSON.stringify(document.querySelector("#board-dialog .original-board-link").href)')).endsWith('/assets/cases/cafe-reference.png'));
  await browser('click','#board-dialog [data-close]');await browser('focus','[data-eye-case=cafe]');await browser('press','Home');
  await browser('wait','--fn','!document.querySelector("#eye-panel-arcade").hidden');
  console.log('PASS keyboard case selection and the selected full-board action');
  await click('[data-eye-case=lakeside]');await browser('wait','--fn','!document.querySelector("#eye-panel-lakeside").hidden');
  assert.equal(await evaluate('JSON.stringify(Number(document.querySelector("#eye-total").textContent))'),await evaluate('JSON.stringify(document.querySelectorAll("[data-eye-case]").length)'));
  await click('#eye-panel-lakeside [data-board=lakeside]');await browser('wait','--fn','document.querySelector("#board-dialog").open');
  assert.ok((await evaluate('JSON.stringify(document.querySelector("#board-dialog .original-board-link").href)')).endsWith('/assets/website/lakeside-board.webp'));
  await browser('click','#board-dialog [data-close]');
  console.log('PASS new lakeside case, dynamic counter and matching full-board action');

  await browser('open',base);
  await evaluate(`(()=>{const NativeImage=window.Image,src=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');window.Image=function(...args){const image=new NativeImage(...args);Object.defineProperty(image,'src',{get(){return src.get.call(image);},set(value){if(value.endsWith('/cafe-board.webp')){window.releaseCafe=()=>{image.addEventListener('load',()=>window.cafeLoaded=true,{once:true});src.set.call(image,value);};}else src.set.call(image,value);}});return image;};return JSON.stringify(true);})()`);
  await browser('click','[data-eye-case=cafe]');await browser('wait','--fn','typeof window.releaseCafe==="function"');
  await browser('click','[data-eye-case=arcade]');await evaluate('window.releaseCafe();JSON.stringify(true)');await browser('wait','--fn','window.cafeLoaded===true');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#eye-panel-arcade").hidden)'),false);
  assert.equal(await evaluate('JSON.stringify(document.querySelector("[data-eye-case=cafe]").getAttribute("aria-selected"))'),'false');
  console.log('PASS a late case image cannot replace the newer selection');

  await click('[data-demo=portrait]');await browser('wait','--fn','document.querySelector("[data-demo=portrait]").getAttribute("aria-selected")==="true"');
  assert.ok((await evaluate('JSON.stringify(document.querySelector("#demo-credit").textContent)')).includes('AI'));
  await browser('focus','#compare-range');await browser('press','End');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#compare-range").value)'),'100');
  assert.equal(await evaluate('JSON.stringify(document.querySelector(".comparison").style.getPropertyValue("--split"))'),'100%');
  await click('[data-series-step=order]');assert.ok((await evaluate('JSON.stringify(document.querySelector(".series-step-title").textContent)')).includes('顺着'));
  await browser('focus','[data-series-step=order]');await browser('press','End');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("[data-series-step=edit]").getAttribute("aria-selected"))'),'true');
  console.log('PASS retouch comparison and collection-step interactions');

  for(const width of [390,320]){
    await browser('set','viewport',String(width),'844');await browser('open',base);
    await click('.menu-toggle');assert.equal(await evaluate('JSON.stringify(document.querySelector(".menu-toggle").getAttribute("aria-expanded"))'),'true');
    await click('#mobile-menu a[href="#eye"]');assert.equal(await evaluate('JSON.stringify(document.querySelector("#mobile-menu").hidden)'),true);
    assert.equal(await evaluate('JSON.stringify(document.documentElement.scrollWidth>innerWidth)'),false,'No horizontal loss at '+width);
    await click('[data-eye-direction="1"]');await cafeReady();
  }
  await browser('set','media','light','reduced-motion');await browser('open',base+'#cases');
  await browser('wait','--fn','location.hash==="#eye"');await browser('click','[data-eye-case=cafe]');await cafeReady();
  assert.equal(await evaluate('JSON.stringify(matchMedia("(prefers-reduced-motion: reduce)").matches)'),true);
  assert.equal(await evaluate('JSON.stringify(document.getAnimations().filter(animation=>animation.playState==="running").length)'),0);
  assert.equal(await browser('errors'),'');
  console.log('PASS 390/320px navigation, legacy case links and reduced motion');
  console.log('Website browser checks passed.');
}catch(error){
  await mkdir(join(root,'artifacts'),{recursive:true});await browser('screenshot',join(root,'artifacts','website-review-failure.png')).catch(()=>{});throw error;
}finally{
  await browser('close').catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});
}
