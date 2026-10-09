import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

const root=fileURLToPath(new URL('../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'framelark-series-input-')),exec=promisify(execFile),session='series-input-'+randomUUID();
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
const evidence=process.argv[2]&&resolve(process.argv[2]);if(evidence)await mkdir(evidence,{recursive:true});
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:45000,maxBuffer:2e6}).then(r=>r.stdout.trim());
const wait=code=>browser('wait','--fn',code),read=async code=>JSON.parse(await browser('eval',code));
const calls=[],files=[];let server;
// High-detail generated images exercise the real Canvas encoder and request
// limit. The provider is a deterministic protocol fixture, with no model calls.
const provider=http.createServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk);const payload=JSON.parse(Buffer.concat(chunks));calls.push(payload);
  const ids=payload.text.format.schema.properties.order.items.enum;
  const review={title:'整组输入夹具',summary:'保留全部技术样张。',preserve:'保留现有编辑。',tradeoff:'这里只验证输入协议。',order:ids,
    sharedStyle:{presetId:'none',amount:0,reason:'不增加风格。'},photos:ids.map(id=>({id,role:'技术样张',reason:'完整覆盖',preserve:'已有光色',tradeoff:'压缩分析预览',cropNote:'保持画幅',changes:[]}))};
  response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({output_text:JSON.stringify(review),model:'input-fixture'}));
});
try{
  for(let i=0;i<12;i++){
    let seed=1000+i;const pixels=Buffer.alloc(800*800*3);
    for(let j=0;j<pixels.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[j]=seed>>>24;}
    const file=join(scratch,'detail-'+i+'.png');await sharp(pixels,{raw:{width:800,height:800,channels:3}}).png().toFile(file);files.push(file);
  }
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));
  server=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:scratch,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'0',OPENAI_API_KEY:'local-input-fixture',OPENAI_MODEL:'input-fixture',OPENAI_API_URL:`http://127.0.0.1:${provider.address().port}/v1/responses`},stdio:['ignore','pipe','pipe']});
  let log='';server.stderr.on('data',chunk=>{log+=chunk;});
  const base=await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Studio startup failed: '+log)),10000);server.once('error',j);server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);r('http://127.0.0.1:'+match[1]);}});});
  await browser('open',base);await browser('upload','#file-input',...files);
  await wait('document.querySelectorAll("#photo-tabs [data-photo-select]").length===12 && !document.querySelector("#series-open").disabled');
  await browser('eval',"(()=>{const original=window.fetch.bind(window);window.seriesInputs=[];window.fetch=async(...args)=>{if(String(args[0])==='/api/series-review'){const body=args[1].body,data=JSON.parse(body);window.seriesInputs.push({bytes:new TextEncoder().encode(body).length,ids:data.photos.map(p=>p.id),images:data.photos.map(p=>p.image.length),intent:data.intent});}return original(...args);};return true;})()");
  await browser('click','#series-open');await browser('fill','#series-intent','完整审阅这十二张技术样张，不遗漏成员');await browser('scrollintoview','#series-review');await browser('click','#series-review');
  await wait('window.seriesInputs.length===1 && document.querySelector("#series-cancel").hidden && !document.querySelector("#series-review").disabled');
  const input=await read('window.seriesInputs'),status=await read('document.querySelector("#series-status").textContent');
  const proof={input,status,providerCalls:calls.length};console.log(JSON.stringify(proof));
  if(evidence){await writeFile(join(evidence,'series-input-proof.json'),JSON.stringify(proof,null,2)+'\n');await browser('screenshot',join(evidence,'series-input.png'));}
  assert.equal(calls.length,1,'all twelve previews reach the actual server and provider');
  assert.equal(await read('document.querySelector("#series-accept").disabled'),false,'complete review is ready to inspect');
  assert.equal(input.length,1);assert.equal(new Set(input[0].ids).size,12);assert.ok(input[0].bytes<=3_800_000);assert.ok(input[0].images.every(size=>size<=600_000));
  assert.equal(calls[0].input[0].content.filter(item=>item.type==='input_image').length,12);
  assert.equal(await browser('errors'),'');
  console.log('Series input UI passed: twelve detailed Canvas previews stay within image and HTTP budgets; all members reach the local fixture provider.');
}finally{
  await browser('close').catch(()=>{});if(server&&server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);}
  await new Promise(r=>provider.close(r));await rm(scratch,{recursive:true,force:true});
}
