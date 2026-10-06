import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {initProject,loadProject,createCandidate,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';
import {projectDocument} from '../skills/photo-retouch/scripts/document-state.mjs';
import {documentHash} from '../apps/studio/public/edit-stack/identity.js';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {serveProject} from '../skills/photo-retouch/scripts/server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'framelark-inspector-ux-'));
const exec=promisify(execFile),session='framelark-inspector-'+randomUUID(),bridge=new ProjectBridge({root:temporary});
const browser=(...args)=>exec('agent-browser',['--session',session,...args],{timeout:30000,maxBuffer:1500000}).then(r=>r.stdout.trim());
const evaluate=async code=>{const result=JSON.parse(await browser('eval',code));return typeof result==='string'?JSON.parse(result):result;};
const failures=[];let server,native,base;
async function check(name,run){
  try{await run();console.log('PASS '+name);}
  catch(error){failures.push({name,error});console.error('FAIL '+name+': '+error.message);console.error(await browser('errors').catch(()=>''));}
}
async function fixture(name){
  const folder=join(temporary,name);await initProject(join(root,'test/web/fixtures/quality/portrait.png'),folder);
  const project=await loadProject(folder),document=projectDocument(project);
  const commands=[
    {type:'AddStep',step:{id:'light',title:'提亮主体',tool:'exposure',toolVersion:2,parameters:{ev:.2}}},
    {type:'AddStep',step:{id:'tone',title:'保留层次',tool:'tone',toolVersion:2,parameters:{contrast:5}}},
    {type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.55,end:.8},reference:{kind:'live-input'}}},
    {type:'ReplaceStepMask',stepId:'tone',maskRef:{id:'mask-light',version:1}}
  ];
  const made=await createCandidate(folder,{revision:project.revision,baseVersion:project.currentId,name:'范围验收',actorId:'inspector-test',documentProposal:{baseRevision:document.revision,baseHash:documentHash(document),items:[{id:'item',title:'共享范围',commands}]}});
  await acceptCandidate(folder,{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});
  return {folder,data:await bridge.register(folder)};
}
async function saved(f){return projectDocument(await loadProject(f.folder));}
function maskFor(document,id){const ref=document.steps.find(step=>step.id===id).maskRef;return document.masks.find(mask=>mask.id===ref.id&&mask.version===ref.version);}
const mount='#edit-stack-mount',field=mount+' [data-kind=mask][data-field=start]';
const ready=()=>browser('wait','--fn','!document.querySelector("#export-button").disabled');
async function open(f){
  await browser('open',base+'/?project='+f.data.id);await browser('set','viewport','1280','800');
  await browser('wait','--fn','document.querySelectorAll("#edit-stack-mount [data-step-select]").length===2&&!document.querySelector("#export-button").disabled');
  await browser('click','#panel-adjust');await browser('click',mount+' [data-step-select=light]');
  await browser('click',mount+' [data-range-advanced]>summary');
}
async function track(selector){await evaluate(`window.uxInput=document.querySelector(${JSON.stringify(selector)});JSON.stringify(true)`);}
async function keyboardScope(f,{shared=false}={}){
  await open(f);if(shared){await evaluate(`document.querySelector('${mount} [data-share-mask]').scrollIntoView({block:'center'});JSON.stringify(true)`);await browser('click',mount+' [data-share-mask]');}
  await track(field);await browser('focus',field);await browser('press','ArrowRight');
  assert.equal(await evaluate('JSON.stringify(window.uxInput.isConnected)'),true,'A preview must preserve the active range input until commit');
  await ready();const document=await saved(f);
  assert.equal(maskFor(document,'light').expression.start,.56);
  assert.equal(maskFor(document,'tone').expression.start,shared?.56:.55);
  assert.equal(await evaluate(`JSON.stringify(document.querySelector('${mount} [data-share-mask]').closest('label').hidden)`),!shared);
  await browser('click','#photo-undo');await ready();const undone=await saved(f);
  assert.equal(maskFor(undone,'light').expression.start,.55);assert.deepEqual(undone.steps[0].maskRef,undone.steps[1].maskRef);
}
async function editions(f){
  await open(f);
  async function manager(){
    await browser('click','#project-open');await browser('wait','--fn','document.querySelector("#project-dialog").getAttribute("aria-busy")==="false"');
    assert.equal(await evaluate('JSON.stringify(!!document.querySelector("#project-details [data-project-editions]"))'),true,'The unified project entry must expose naming and version comparison');
    await browser('click','#project-details [data-project-section=versions]>summary');await browser('click','#project-details [data-project-editions]');await browser('wait','--fn','document.querySelector("#versions-dialog").open');
    assert.equal(await evaluate('JSON.stringify(document.querySelector("#project-dialog").open)'),false);
  }
  async function name(label){
    await browser('fill','#edition-name',label);await browser('click','#edition-save');
    await browser('wait','--fn',`[...document.querySelectorAll('#edition-items strong')].some(node=>node.textContent.startsWith('${label}'))&&!document.querySelector('#edition-save').disabled`);
  }
  await manager();await name('自然版');await browser('click','#versions-close');
  await browser('focus',mount+' [data-kind=parameter][data-field=ev]');await browser('press','ArrowRight');await ready();
  await manager();await name('胶片版');
  let project=await loadProject(f.folder),natural=project.versions.find(v=>v.name==='自然版'),cinema=project.versions.find(v=>v.name==='胶片版');
  assert.ok(natural&&cinema);assert.notEqual(documentHash(natural.recipe),documentHash(cinema.recipe));
  await browser('click',`[data-edition-rename="${cinema.id}"]`);await browser('fill','input[aria-label="修改版本名称"]','电影版');await browser('press','Enter');
  await browser('wait','--fn',`[...document.querySelectorAll('#edition-items strong')].some(node=>node.textContent.startsWith('电影版'))`);
  project=await loadProject(f.folder);assert.equal(project.versions.find(v=>v.id===cinema.id).name,'电影版');
  assert.equal(await evaluate('JSON.stringify(document.querySelector("#versions-dialog").open)'),true,'Enter commits a name without activating another dialog action');
  await browser('click',`[data-edition-select="${natural.id}"]`);await browser('click',`[data-edition-select="${cinema.id}"]`);await browser('click','#edition-compare');
  await browser('wait','--fn','document.querySelector("#viewer-dialog").open');
  assert.deepEqual(await evaluate('JSON.stringify([...document.querySelectorAll("#viewer-dialog select")].map(node=>node.value))'),[natural.id,cinema.id]);
  await browser('click','#viewer-close');await manager();await browser('click',`[data-edition-restore="${natural.id}"]`);
  await browser('wait','--fn','!document.querySelector("#versions-dialog").open&&!document.querySelector("#export-button").disabled');
  project=await loadProject(f.folder);assert.equal(documentHash(projectDocument(project)),documentHash(natural.recipe));
  assert.ok(project.versions.some(v=>v.id===cinema.id&&v.name==='电影版'));
}
try{
  const keyboard=await fixture('keyboard'),pointer=await fixture('pointer'),shared=await fixture('shared'),portable=await fixture('portable'),versions=await fixture('versions');
  server=spawn(process.execPath,[join(root,'apps/studio/server/index.mjs')],{cwd:temporary,env:{...process.env,PORT:'0',HOST:'127.0.0.1',VERCEL:'0',OPENAI_API_KEY:'',OPENAI_MODEL:''},stdio:['ignore','pipe','pipe']});
  let output='';server.stderr.on('data',()=>{});
  base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Inspector server did not start')),10000);server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});server.once('error',reject);});
  await check('shared scope keyboard edit, independent save and undo',()=>keyboardScope(keyboard));
  await check('shared scope pointer drag saves the actual slider value',async()=>{
    await open(pointer);await track(field);await browser('focus',field);
    const rect=await evaluate(`JSON.stringify(document.querySelector('${field}').getBoundingClientRect().toJSON())`),y=rect.y+rect.height/2;
    await browser('mouse','move',String(Math.round(rect.x+rect.width*.56)),String(Math.round(y)));await browser('mouse','down');
    await browser('mouse','move',String(Math.round(rect.x+rect.width*.66)),String(Math.round(y)));await browser('mouse','up');
    assert.equal(await evaluate('JSON.stringify(window.uxInput.isConnected)'),true);await ready();
    const value=await evaluate(`JSON.stringify(Number(document.querySelector('${field}').value))`),document=await saved(pointer);
    assert.ok(value>.55&&value<.8);assert.equal(maskFor(document,'light').expression.start,value);assert.equal(maskFor(document,'tone').expression.start,.55);
  });
  await check('explicit shared edit updates all users and undo restores sharing',()=>keyboardScope(shared,{shared:true}));
  await check('portable inspector preserves first shared-range input and accepted recipe',async()=>{
    native=await serveProject(portable.folder,{quiet:true});await browser('open',native.session.url);
    await browser('wait','--fn','document.querySelectorAll("#native-edit-stack [data-step-select]").length===2');
    await browser('click','#native-edit-stack [data-step-select=light]');await browser('click','#native-edit-stack [data-range-advanced]>summary');
    const input='#native-edit-stack [data-kind=mask][data-field=start]';await track(input);await browser('focus',input);await browser('press','ArrowRight');
    assert.equal(await evaluate('JSON.stringify(window.uxInput.isConnected)'),true);
    await browser('wait','--fn','!document.querySelector("#accept-button").disabled');await browser('click','#accept-button');await browser('wait','--fn','document.querySelector("#candidate-actions").hidden');
    const document=await saved(portable);assert.equal(maskFor(document,'light').expression.start,.56);assert.equal(maskFor(document,'tone').expression.start,.55);
    await native.close();native=null;
  });
  await check('project entry retains named editions, rename, A/B and restore',()=>editions(versions));
  if(failures.length)throw new AggregateError(failures.map(f=>f.error),failures.map(f=>f.name).join('; '));
  console.log('Inspector UX browser checks passed.');
}catch(error){
  await mkdir(join(root,'artifacts'),{recursive:true});await browser('screenshot',join(root,'artifacts','inspector-ux-failure.png')).catch(()=>{});throw error;
}finally{
  await browser('close').catch(()=>{});await native?.close();await bridge.close();
  if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{server.kill('SIGKILL');resolve();},2500);server.once('exit',()=>{clearTimeout(timer);resolve();});});}
  await rm(temporary,{recursive:true,force:true});
}
