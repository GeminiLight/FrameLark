import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProjectBridge} from '../project-bridge.mjs';
import {loadProject,createCandidate,saveNote,changeGuards,initProject} from '../skills/photo-retouch/scripts/project.mjs';
import {workspacePatch,snapshotFromProject} from '../public/project-snapshot.js';
import {snapshotSettings} from '../public/batch-edits.js';
import {effectiveSettings} from '../skills/photo-retouch/scripts/engine/edit-guards.js';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'frameyn-bridge-'));const bridge=new ProjectBridge({root});t.after(async()=>{bridge.close();await rm(root,{recursive:true,force:true});});const bytes=await sharp({create:{width:128,height:96,channels:4,background:'#657884'}}).png().toBuffer();const data=await bridge.create(bytes,'sample.png');return {root,bridge,data,bytes};}

test('Web saves the native project; CLI sees notes and edits; CLI candidate returns to Web',async t=>{
  const {bridge,data,bytes}=await fixture(t);const snapshot=snapshotFromProject(data);
  snapshot.manual.exposure=.2;snapshot.annotations.push({id:'note-web',rect:{x:.1,y:.1,width:.2,height:.2},note:'保留这里',localSettings:{shadows:10},feather:.3});
  const saved=await bridge.save(data.id,{...workspacePatch(snapshot,{intent:'保留自然光色'}),revision:data.revision,baseVersion:data.currentId});
  const cli=await loadProject(saved.path);assert.equal(cli.notes[0].note,'保留这里');assert.equal(cli.intent,'保留自然光色');assert.equal(cli.versions.at(-1).state.settings.exposure,.2);
  assert.deepEqual(await readFile(join(saved.path,'source/original.bin')),bytes);
  const made=await createCandidate(saved.path,{revision:cli.revision,baseVersion:cli.currentId,items:[{id:'light',title:'提亮',patch:{settings:{exposure:.3}}},{id:'color',title:'降暖',patch:{settings:{warmth:-5}}}]});
  let view=await bridge.get(data.id);assert.equal(view.candidates.length,1);assert.equal(view.candidates[0].stale,false);
  view=await bridge.candidate(data.id,'select',{revision:view.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash,selectedItemIds:['light']});
  const png=await bridge.preview(data.id,made.candidate.id,view.revision);assert.equal((await sharp(png).metadata()).width,128);
  view=await bridge.candidate(data.id,'accept',{id:made.candidate.id,revision:view.revision,selectionHash:view.candidates[0].selectionHash});
  assert.equal(view.current.settings.exposure,.3);assert.equal(view.current.settings.warmth,0);assert.equal(view.candidates.length,0);
  const exported=await bridge.export(data.id,{versionId:view.currentId,options:{format:'png',maxSide:2048,dpi:96,quality:.9}});
  assert.ok((await stat(exported.path)).size>0);assert.equal((await bridge.get(data.id)).exports.length,1);
});

test('stale Web saves never overwrite CLI changes and do not remove candidates',async t=>{
  const {bridge,data}=await fixture(t);
  await saveNote(data.path,{revision:data.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'CLI 批注'});
  await assert.rejects(bridge.save(data.id,{...workspacePatch(snapshotFromProject(data)),revision:data.revision,baseVersion:data.currentId}),{code:'STALE_REVISION'});
  assert.equal((await loadProject(data.path)).notes[0].note,'CLI 批注');
  await assert.rejects(bridge.get('../../other'),{code:'PROJECT_NOT_FOUND'});
});

test('Web previews become native candidates without changing the accepted version',async t=>{
  const {bridge,data}=await fixture(t),snapshot=snapshotFromProject(data);snapshot.manual.exposure=.15;snapshot.crop={x:.1,y:.1,width:.8,height:.8,angle:0};
  const proposed=await bridge.propose(data.id,{revision:data.revision,baseVersion:data.currentId,patch:workspacePatch(snapshot),goal:'预览方案',tradeoff:'减少边缘'});
  const p=await loadProject(data.path);assert.equal(p.currentId,data.currentId);assert.equal(p.candidates.length,1);assert.equal(p.candidates[0].items.length,2);
  const candidate=proposed.candidates[0];await bridge.candidate(data.id,'discard',{id:candidate.id});assert.equal((await loadProject(data.path)).candidates.length,0);
});

test('cancelled exports stop rendering and leave no recorded or partial output',async t=>{
  const {bridge,data}=await fixture(t),controller=new AbortController();
  const request=bridge.export(data.id,{versionId:data.currentId,options:{format:'png',maxSide:2048}},controller.signal);
  const timer=setTimeout(()=>controller.abort(),30);
  await assert.rejects(request,e=>e.code==='CANCELLED');clearTimeout(timer);
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(join(data.path,'exports')),[]);assert.equal((await loadProject(data.path)).exports.length,0);
});

test('shared snapshots preserve effective parameters even when layered sums exceed bounds',()=>{
  const base={manual:{exposure:1.5,contrast:70},active:['a'],recommendations:[{id:'a',adjustments:{contrast:60}}],advisorLayers:[],presetId:'misty-air',presetAmount:100,crop:null,annotations:[]};
  const patch=workspacePatch(base);assert.equal(patch.style,null);assert.deepEqual(effectiveSettings(patch),snapshotSettings(base));
});

test('protected versions cannot be silently replaced by the simpler Web workspace',async t=>{
  const {bridge,data}=await fixture(t);
  await changeGuards(data.path,{revision:data.revision,operation:'lock',parameters:['exposure']});
  const view=await bridge.get(data.id);assert.equal(view.supported,false);
  const snapshot=snapshotFromProject(view);snapshot.manual.exposure=.3;
  await assert.rejects(bridge.save(data.id,{...workspacePatch(snapshot),revision:view.revision,baseVersion:view.currentId}),{code:'WORKSPACE_UNSUPPORTED'});
});

test('file changes notify the Web client without a polling loop',async t=>{
  const {bridge,data}=await fixture(t);let resolveEvent;const event=new Promise(resolve=>{resolveEvent=resolve;});
  const close=await bridge.subscribe(data.id,resolveEvent);t.after(close);
  await saveNote(data.path,{revision:data.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'新批注'});
  const timeout=setTimeout(()=>resolveEvent({timeout:true}),2000);
  const update=await event;clearTimeout(timeout);assert.equal(update.revision,data.revision+1);
});

test('macOS HEIC import preserves original bytes and creates a usable normalized image',{skip:process.platform!=='darwin'},async t=>{
  const {root,bytes}=await fixture(t),source=join(root,'heic-source.png'),heic=join(root,'original.heic');await writeFile(source,bytes);
  await promisify(execFile)('/usr/bin/sips',['-s','format','heic',source,'--out',heic]);
  const raw=await readFile(heic),folder=join(root,'heic-project');const {project}=await initProject(heic,folder);
  assert.equal(project.source.format,'heic');assert.deepEqual(await readFile(join(folder,'source/original.bin')),raw);
  const info=await sharp(await readFile(join(folder,'source/normalized.png'))).metadata();assert.equal(info.width,128);assert.equal(info.height,96);
});
