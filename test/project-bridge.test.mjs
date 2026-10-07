import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat,mkdir,utimes} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {handleProjectRoutes} from '../apps/studio/server/projects/routes.mjs';
import {loadProject,createCandidate,acceptCandidate,saveNote,deleteNote,changeGuards,initProject} from '../skills/photo-retouch/scripts/project.mjs';
import {workspacePatch,snapshotFromProject,editionsFromProject,workspaceEditions} from '../apps/studio/public/project-snapshot.js';
import {snapshotSettings} from '../apps/studio/public/batch-edits.js';
import {effectiveSettings} from '../skills/photo-retouch/scripts/engine/edit-guards.js';
import {renderFrame} from '../skills/photo-retouch/scripts/render.mjs';
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

test('overlapping locals keep their native order and pixels through a conversation-only Web save',async t=>{
  const {bridge,data}=await fixture(t),rect={x:.1,y:.1,width:.8,height:.8};
  const a=await saveNote(data.path,{revision:data.revision,rect,note:'A exposure'}),b=await saveNote(data.path,{revision:a.project.revision,rect,note:'B contrast'});
  const made=await createCandidate(data.path,{revision:b.project.revision,baseVersion:data.currentId,items:[{id:'b',title:'contrast',patch:{locals:[{annotationId:b.note.id,settings:{contrast:60},feather:0}]}},{id:'a',title:'exposure',patch:{locals:[{annotationId:a.note.id,settings:{exposure:1},feather:0}]}}]});
  const before=await bridge.candidate(data.id,'accept',{id:made.candidate.id,revision:made.project.revision,selectionHash:made.candidate.selectionHash});
  const pixelsBefore=await renderFrame(data.path),snapshot=snapshotFromProject(before);
  assert.deepEqual(snapshot.annotations.map(a=>a.id),before.current.locals.map(l=>l.id));
  const saved=await bridge.save(data.id,{...workspacePatch(snapshot,{conversation:[{role:'user',text:'conversation only'}]}),revision:before.revision,baseVersion:before.currentId});
  assert.deepEqual(saved.current.locals,before.current.locals);assert.deepEqual(saved.notes,before.notes);
  assert.equal(saved.currentId,before.currentId);assert.equal((await renderFrame(data.path)).pixelHash,pixelsBefore.pixelHash);
});

test('unchanged notes and metadata do not expire a candidate; a real note change does',async t=>{
  const {bridge,data}=await fixture(t);
  await saveNote(data.path,{revision:data.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'keep subject'});
  let view=await bridge.get(data.id);
  const made=await createCandidate(data.path,{revision:view.revision,baseVersion:view.currentId,items:[{id:'light',title:'light',patch:{settings:{exposure:.3}}}]});
  view=await bridge.get(data.id);const snapshot=snapshotFromProject(view);
  view=await bridge.save(data.id,{...workspacePatch(snapshot,{conversation:[{role:'user',text:'Tell me more'}]}),revision:view.revision,baseVersion:view.currentId});
  assert.equal(view.candidates[0].stale,false);
  const currentId=view.currentId,choices=(await loadProject(data.path)).choices;
  view=await bridge.edition(data.id,{revision:view.revision,baseVersion:view.currentId,name:'自然版'});
  const edition=view.versions.at(-1);view=await bridge.renameVersion(data.id,{revision:view.revision,id:edition.id,name:'安静版'});
  assert.equal(view.currentId,currentId);assert.equal(view.candidates[0].stale,false);assert.deepEqual((await loadProject(data.path)).choices,choices);
  snapshot.annotations[0].note='different intent for subject';
  view=await bridge.save(data.id,{...workspacePatch(snapshot),revision:view.revision,baseVersion:view.currentId});
  assert.equal(view.candidates[0].stale,true);assert.equal(view.candidates[0].id,made.candidate.id);
});

test('Web history migration is atomic, preserves names and notes, and is idempotent after a lost response',async t=>{
  const {bridge,data,bytes}=await fixture(t),first=snapshotFromProject(data);
  first.manual.exposure=.2;first.annotations=[{id:'note-web',rect:{x:.1,y:.1,width:.2,height:.2},note:'old note',localSettings:{shadows:10}}];
  const current=structuredClone(first);current.manual.exposure=0;current.annotations[0].rect.x=.5;current.annotations[0].note='new note';
  const value={...workspacePatch(current),revision:data.revision,baseVersion:data.currentId,importId:'test-migration',versions:[{id:'web-edition',name:'微亮版',at:'2026-10-04T00:00:00.000Z',kind:'manual',patch:workspacePatch(first)}]};
  const saved=await bridge.save(data.id,value),replayed=await bridge.save(data.id,value);
  assert.equal(saved.revision,replayed.revision);assert.equal(saved.versions.length,replayed.versions.length);
  const historical=saved.versions.find(v=>v.id==='web-edition');assert.equal(historical.name,'微亮版');assert.equal(historical.state.settings.exposure,.2);assert.equal(historical.notes[0].note,'old note');
  assert.deepEqual(await readFile(join(data.path,'source/original.bin')),bytes);
  const restored=await bridge.candidate(data.id,'restore',{revision:saved.revision,id:historical.id});
  assert.equal(restored.supported,true);assert.equal(restored.notes[0].rect.x,.1);assert.equal(restored.current.settings.exposure,.2);
  const original=await bridge.candidate(data.id,'restore',{revision:restored.revision,id:data.currentId});assert.equal(original.current.settings.exposure,0);
});

test('an invalid historical version leaves the complete pre-migration project untouched',async t=>{
  const {bridge,data}=await fixture(t),snapshot=snapshotFromProject(data),before=await readFile(join(data.path,'project.json'));
  const versions=[{id:'valid',name:'自然版',at:'2026-10-04T00:00:00.000Z',patch:workspacePatch(snapshot)},{id:'invalid',name:'',at:'2026-10-04T00:00:00.000Z',patch:workspacePatch(snapshot)}];
  await assert.rejects(bridge.save(data.id,{...workspacePatch(snapshot),versions,importId:'failed-migration',revision:data.revision,baseVersion:data.currentId}),{code:'INVALID_VERSION_NAME'});
  assert.deepEqual(await readFile(join(data.path,'project.json')),before);
});

test('migration preserves all 40 editions and protected note metadata',async t=>{
  const {bridge,data}=await fixture(t),snapshot=snapshotFromProject(data);
  snapshot.annotations=[{id:'kept-note',number:5,updatedAt:'2026-10-01T00:00:00.000Z',rect:{x:.1,y:.1,width:.2,height:.2},note:'保留主体',protect:true}];
  const versions=Array.from({length:40},(_,i)=>({id:`edition-${i}`,name:`方案${i}`,at:'2026-10-04T00:00:00.000Z',patch:workspacePatch(snapshot)}));
  const saved=await bridge.save(data.id,{...workspacePatch(snapshot),versions,importId:'forty-editions',revision:data.revision,baseVersion:data.currentId});
  assert.equal(saved.versions.filter(v=>v.mode==='edition').length,40);
  assert.equal(saved.notes[0].protect,true);assert.equal(saved.notes[0].number,5);assert.equal(saved.notes[0].updatedAt,'2026-10-01T00:00:00.000Z');
  const patch=workspacePatch(snapshotFromProject(saved));patch.annotations[0].protect=false;
  const unchanged=await bridge.save(data.id,{...patch,revision:saved.revision,baseVersion:saved.currentId});assert.equal(unchanged.notes[0].protect,true);
});

test('conversation save preserves a local whose annotation was deleted, without expiring a candidate',async t=>{
  const {bridge,data}=await fixture(t),note=await saveNote(data.path,{revision:data.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'local context'});
  let candidate=await createCandidate(data.path,{revision:note.project.revision,baseVersion:data.currentId,items:[{id:'local',title:'local',patch:{locals:[{annotationId:note.note.id,settings:{exposure:.2}}]}}]});
  let view=await bridge.candidate(data.id,'accept',{revision:candidate.project.revision,id:candidate.candidate.id,selectionHash:candidate.candidate.selectionHash});
  await deleteNote(data.path,{revision:view.revision,id:note.note.id});view=await bridge.get(data.id);
  candidate=await createCandidate(data.path,{revision:view.revision,baseVersion:view.currentId,items:[{id:'light',title:'light',patch:{settings:{exposure:.2}}}]});
  view=await bridge.get(data.id);const currentId=view.currentId;
  const saved=await bridge.save(data.id,{...workspacePatch(snapshotFromProject(view),{conversation:[{role:'user',text:'hello'}]}),revision:view.revision,baseVersion:view.currentId});
  assert.equal(saved.currentId,currentId);assert.deepEqual(saved.current.locals,view.current.locals);assert.deepEqual(saved.notes,[]);assert.equal(saved.candidates[0].stale,false);
});

test('old native masks with moved notes cannot be restored or saved through Web',async t=>{
  const {bridge,data}=await fixture(t),note=await saveNote(data.path,{revision:data.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'subject'});
  const made=await createCandidate(data.path,{revision:note.project.revision,baseVersion:data.currentId,items:[{id:'local',title:'local',patch:{locals:[{annotationId:note.note.id,settings:{exposure:.2}}]}}]});
  const old=await bridge.candidate(data.id,'accept',{revision:made.project.revision,id:made.candidate.id,selectionHash:made.candidate.selectionHash});
  await saveNote(data.path,{revision:old.revision,id:note.note.id,rect:{x:.5,y:.1,width:.2,height:.2}});
  const moved=await bridge.get(data.id);assert.equal(moved.supported,false);assert.equal(moved.versions.find(v=>v.id===old.currentId).supported,false);
  await assert.rejects(bridge.candidate(data.id,'restore',{revision:moved.revision,id:old.currentId}),{code:'WORKSPACE_UNSUPPORTED'});
  await assert.rejects(bridge.save(data.id,{...workspacePatch(snapshotFromProject(moved)),revision:moved.revision,baseVersion:moved.currentId}),{code:'WORKSPACE_UNSUPPORTED'});
  assert.equal((await loadProject(data.path)).notes[0].rect.x,.5);
});

test('mutation responses are the committed snapshot, not a later external head',async t=>{
  const {bridge,data}=await fixture(t),runtime=await bridge.runtime(),patch=workspacePatch(snapshotFromProject(data));patch.settings.exposure=.1;
  const wrapped={...runtime,async saveWorkspaceSnapshot(folder,value){const result=await runtime.saveWorkspaceSnapshot(folder,value);await saveNote(folder,{revision:result.project.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'later CLI change'});return result;}};
  bridge.runtime=async()=>wrapped;
  const saved=await bridge.save(data.id,{...patch,revision:data.revision,baseVersion:data.currentId});
  assert.equal(saved.revision,2);assert.deepEqual(saved.notes,[]);assert.equal((await bridge.get(data.id)).revision,3);
});

test('malformed export dimensions are rejected at the project boundary, while 1px records remain valid',async t=>{
  const {bridge,data}=await fixture(t),file=join(data.path,'project.json'),p=await loadProject(data.path);
  p.exports=[{path:join(data.path,'exports/test.png'),versionId:p.currentId,width:1,height:1}];await writeFile(file,JSON.stringify(p));assert.equal((await bridge.get(data.id)).exports[0].width,1);
  for(const width of ['<img src=x onerror="window.bad=true">',0,-1,.5,null]){
    p.exports[0].width=width;await writeFile(file,JSON.stringify(p));await assert.rejects(bridge.get(data.id),{code:'INVALID_PROJECT'});
  }
});

test('protected versions cannot be silently replaced by the simpler Web workspace',async t=>{
  const {bridge,data}=await fixture(t);
  await changeGuards(data.path,{revision:data.revision,operation:'lock',parameters:['exposure']});
  const view=await bridge.get(data.id);assert.equal(view.supported,false);
  const snapshot=snapshotFromProject(view);snapshot.manual.exposure=.3;
  await assert.rejects(bridge.save(data.id,{...workspacePatch(snapshot),revision:view.revision,baseVersion:view.currentId}),{code:'WORKSPACE_UNSUPPORTED'});
});

test('Save As refuses unsupported historical effects even when the current version is editable',async t=>{
  const {bridge,data}=await fixture(t);
  const locked=await changeGuards(data.path,{revision:data.revision,operation:'lock',parameters:['exposure']});
  const unlocked=await changeGuards(data.path,{revision:locked.project.revision,operation:'unlock',parameterKeys:['exposure']});
  await acceptCandidate(data.path,{revision:unlocked.project.revision,id:unlocked.candidate.id,selectionHash:unlocked.candidate.selectionHash});
  const view=await bridge.get(data.id);assert.equal(view.supported,true);
  const editions=editionsFromProject(view);assert.ok(editions.some(v=>v.supported===false));
  assert.throws(()=>workspaceEditions(editions,{copy:true}),/历史版本/);
  // Existing projects can still save current edits without flattening that history.
  const saved=await bridge.save(data.id,{...workspacePatch(snapshotFromProject(view)),revision:view.revision,baseVersion:view.currentId});
  assert.equal(saved.versions.find(v=>v.id===locked.version.id).supported,false);
});

test('Web snapshot saves cannot bypass an explicitly reviewed Skill workflow',async t=>{
  const {bridge,data}=await fixture(t);
  const {configureWorkflow}=await import('../skills/photo-retouch/scripts/workflow.mjs');
  await configureWorkflow(data.path,{revision:data.revision,mode:'reviewed',independent:true});
  const view=await bridge.get(data.id);assert.equal(view.supported,false);
  await assert.rejects(bridge.save(data.id,{...workspacePatch(snapshotFromProject(view)),revision:view.revision,baseVersion:view.currentId}),{code:'WORKSPACE_REVIEWED'});
  assert.equal((await loadProject(data.path)).workflow.mode,'reviewed');
});

test('file changes notify the Web client without a polling loop',async t=>{
  const {bridge,data}=await fixture(t);let resolveEvent;const event=new Promise(resolve=>{resolveEvent=resolve;});
  const close=await bridge.subscribe(data.id,resolveEvent);t.after(close);
  await saveNote(data.path,{revision:data.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'新批注'});
  const timeout=setTimeout(()=>resolveEvent({timeout:true}),2000);
  const update=await event;clearTimeout(timeout);assert.equal(update.revision,data.revision+1);
});

test('an SSE connection catches up a CLI edit made before its watcher is attached',async t=>{
  const {bridge,data}=await fixture(t),subscribe=bridge.subscribe.bind(bridge),events=[];
  bridge.subscribe=async(id,send)=>{
    await saveNote(data.path,{revision:data.revision,rect:{x:.1,y:.1,width:.2,height:.2},note:'written in the connection gap'});
    // fs.watch cannot recover an event that was delivered before registration.
    await new Promise(resolve=>setTimeout(resolve,50));
    return subscribe(id,send);
  };
  const response=new EventEmitter();Object.assign(response,{writeHead(){},write(chunk){events.push(JSON.parse(chunk.slice(6)));},end(){this.writableEnded=true;}});
  t.after(()=>response.emit('close'));
  await handleProjectRoutes({method:'GET',headers:{}},response,new URL('http://localhost/api/projects/'+data.id+'/events'),{bridge,readBody:async()=>Buffer.from('{}'),allowed:()=>true,cloud:false});
  assert.equal(events.at(-1).revision,data.revision+1,'the connected client receives the current file revision without another edit');
});

test('two Studio instances merge new registrations and immediately see each other',async t=>{
  const {root,bridge,bytes}=await fixture(t),other=new ProjectBridge({root});t.after(()=>other.close());
  await other.registry();
  const a=await bridge.create(bytes,'studio-a.png'),b=await other.create(bytes,'studio-b.png');
  const disk=JSON.parse(await readFile(join(root,'.guangjian/projects.json'),'utf8'));
  assert.ok(disk[a.id],'later registrations preserve another instance project');
  assert.ok((await bridge.list()).some(p=>p.id===b.id),'reads see registrations from the other instance');
  assert.equal((await other.get(a.id)).id,a.id);
});

test('simultaneous registration from separate processes preserves every project',async t=>{
  const {root,data,bytes,bridge}=await fixture(t),source=join(root,'source.png');await writeFile(source,bytes);
  const folders=[join(root,'external-a'),join(root,'external-b')];
  const projects=await Promise.all(folders.map(folder=>initProject(source,folder)));
  const {spawn}=await import('node:child_process'),moduleURL=new URL('../apps/studio/server/projects/bridge.mjs',import.meta.url).href;
  const children=folders.map(folder=>spawn(process.execPath,['--input-type=module','-e',`const {ProjectBridge}=await import(${JSON.stringify(moduleURL)});const bridge=new ProjectBridge({root:process.argv[1]});await bridge.registry();process.send('ready');await new Promise(r=>process.once('message',r));await bridge.register(process.argv[2]);await bridge.close();process.disconnect();`,root,folder],{stdio:['ignore','ignore','pipe','ipc']}));
  const finished=children.map(child=>new Promise((resolve,reject)=>{let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(stderr||'registration worker failed')));}));
  t.after(()=>children.forEach(child=>child.kill()));
  await Promise.all(children.map(child=>new Promise(resolve=>child.once('message',resolve))));
  children.forEach(child=>child.send('register'));await Promise.all(finished);
  const known=new Set(Object.keys(JSON.parse(await readFile(join(root,'.guangjian/projects.json'),'utf8'))));
  assert.deepEqual(known,new Set([data.id,...projects.map(p=>p.project.id)]));
});

test('a crashed registration lock can be reclaimed without losing earlier projects',async t=>{
  const {root,data,bridge,bytes}=await fixture(t),lock=join(root,'.guangjian/projects.json.lock');
  await mkdir(lock);await writeFile(join(lock,'owner'),JSON.stringify({pid:2147483647,token:'abandoned'}));
  const next=await bridge.create(bytes,'after-crash.png');
  const ids=new Set((await bridge.list()).map(p=>p.id));assert.ok(ids.has(data.id));assert.ok(ids.has(next.id));
  await assert.rejects(stat(lock),{code:'ENOENT'});
});
test('a crash while reclaiming a registry lock does not leave registration permanently blocked',async t=>{
  const {root,bridge,bytes}=await fixture(t),lock=join(root,'.guangjian/projects.json.lock'),recovery=join(lock,'recovery');
  await mkdir(recovery,{recursive:true});
  for(const directory of [lock,recovery])await writeFile(join(directory,'owner'),JSON.stringify({pid:2147483647,token:'abandoned'}));
  const next=await bridge.create(bytes,'recovery-after-crash.png');assert.equal((await bridge.get(next.id)).id,next.id);
  await assert.rejects(stat(lock),{code:'ENOENT'});
});
for(const incomplete of ['missing','truncated'])test(`an expired ${incomplete} registration owner record recovers`,async t=>{
  const {root,bridge,bytes}=await fixture(t),lock=join(root,'.guangjian/projects.json.lock');await mkdir(lock);
  if(incomplete==='truncated')await writeFile(join(lock,'owner'),'{');
  const old=new Date(Date.now()-20000);await utimes(lock,old,old);
  const next=await bridge.create(bytes,'interrupted-registration.png');assert.equal((await bridge.get(next.id)).id,next.id);
});

test('macOS HEIC import preserves original bytes and creates a usable normalized image',{skip:process.platform!=='darwin'},async t=>{
  const {root,bytes}=await fixture(t),source=join(root,'heic-source.png'),heic=join(root,'original.heic');await writeFile(source,bytes);
  await promisify(execFile)('/usr/bin/sips',['-s','format','heic',source,'--out',heic]);
  const raw=await readFile(heic),folder=join(root,'heic-project');const {project}=await initProject(heic,folder);
  assert.equal(project.source.format,'heic');assert.deepEqual(await readFile(join(folder,'source/original.bin')),raw);
  const info=await sharp(await readFile(join(folder,'source/normalized.png'))).metadata();assert.equal(info.width,128);assert.equal(info.height,96);
});


test('automatic masked candidates need no saved note, preserve exclusions through accept and reopening',async t=>{
 const {bridge,data}=await fixture(t),snapshot=snapshotFromProject(data),excluded={x:.2,y:.2,width:.1,height:.1};
 snapshot.annotations.push({id:'auto-light',rect:{x:0,y:0,width:1,height:1},note:'提亮并排除灯光',hasNote:false,hasLocal:true,localSettings:{exposure:.2},feather:0,exclude:[excluded]});
 snapshot.crop={x:0,y:0,width:1,height:1,angle:1};
 const proposed=await bridge.propose(data.id,{revision:data.revision,baseVersion:data.currentId,patch:workspacePatch(snapshot),goal:'扶正并保护灯光'});
 assert.equal((await loadProject(data.path)).notes.length,0);assert.equal((await bridge.get(data.id)).current.locals.length,0);
 const candidate=proposed.candidates[0];
 const accepted=await bridge.candidate(data.id,'accept',{id:candidate.id,revision:proposed.revision,selectionHash:candidate.selectionHash});
 assert.deepEqual(accepted.current.locals[0].exclude,[excluded]);assert.equal(accepted.current.crop.angle,1);
 const restored=snapshotFromProject(await bridge.get(data.id));
 const saved=await bridge.save(data.id,{...workspacePatch(restored),revision:accepted.revision,baseVersion:accepted.currentId});
 assert.deepEqual(saved.current.locals[0].exclude,[excluded]);assert.equal((await loadProject(data.path)).notes.length,0);
 const exported=await bridge.export(data.id,{versionId:saved.currentId,options:{format:'png',maxSide:2048}});assert.ok((await stat(exported.path)).size>0);
});
