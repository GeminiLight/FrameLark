import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {initProject,loadProject,currentVersion,createCandidate,selectCandidateItems,acceptCandidate,discardCandidate,restoreVersion,changeGuards,saveNote,deleteNote,hash} from '../skills/photo-retouch/scripts/project.mjs';
import {renderFrame} from '../skills/photo-retouch/scripts/render.mjs';
import {serveProject} from '../skills/photo-retouch/scripts/server.mjs';
import {runCLI} from '../skills/photo-retouch/scripts/cli.mjs';
import {hostToolContract,dispatchHostTool} from '../skills/photo-retouch/scripts/tool-contract.mjs';
import {effectiveSettings} from '../skills/photo-retouch/scripts/engine/edit-guards.js';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-selection-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'source.png');await sharp({create:{width:72,height:56,channels:4,background:'#6b8090'}}).png().toFile(file);const folder=path.join(root,'photo');await initProject(file,folder);return folder;}
const item=(id,settings,extra={})=>({id,title:id,patch:{settings},...extra});
const plan=(p,items,extra={})=>({revision:p.revision,baseVersion:p.currentId,items,...extra});
const accept=(folder,result)=>acceptCandidate(folder,{id:result.candidate.id,revision:result.project.revision,selectionHash:result.candidate.selectionHash});
const select=(folder,result,selectedItemIds)=>selectCandidateItems(folder,{id:result.candidate.id,revision:result.project.revision,selectionHash:result.candidate.selectionHash,selectedItemIds});

test('selection always compiles the same combination from its immutable base',async t=>{
  const folder=await fixture(t),p=await loadProject(folder),initial=await createCandidate(folder,plan(p,[item('light',{exposure:.3}),item('blue',{blueSaturation:-12})]));
  const light=await select(folder,initial,['light']);assert.equal(light.candidate.state.settings.blueSaturation,0);assert.equal(light.candidate.state.settings.exposure,.3);
  const expectedHash=light.candidate.selectionHash,expectedPixels=(await renderFrame(folder,light.candidate.id)).pixelHash;
  const empty=await select(folder,light,[]);assert.deepEqual(empty.candidate.state,currentVersion(p).state);assert.equal(empty.candidate.noChange,true);
  await assert.rejects(accept(folder,empty),{code:'NO_CHANGE'});
  const blue=await select(folder,empty,['blue']),again=await select(folder,blue,['light']);assert.equal(again.candidate.selectionHash,expectedHash);assert.equal((await renderFrame(folder,again.candidate.id)).pixelHash,expectedPixels);
  await accept(folder,again);const saved=await loadProject(folder);assert.equal(currentVersion(saved).state.settings.blueSaturation,0);assert.deepEqual(saved.choices.at(-1).selectedItemIds,['light']);assert.deepEqual(saved.choices.at(-1).items.map(i=>i.id),['light']);
});

test('item order is fixed; click order does not change selection identity',async t=>{
  const folder=await fixture(t),p=await loadProject(folder),initial=await createCandidate(folder,plan(p,[item('a',{exposure:.1}),item('b',{contrast:5})]));
  const shuffled=await select(folder,initial,['b','a']);assert.equal(shuffled.candidate.selectionHash,initial.candidate.selectionHash);assert.deepEqual(shuffled.candidate.selectedItemIds,['a','b']);
});

test('schema rejects unknown operations, ambiguous patches, nonfinite values and duplicate IDs',async t=>{
  const folder=await fixture(t),p=await loadProject(folder);
  for(const [value,code] of [[{...plan(p,[item('a',{exposure:.1})]),settings:{exposure:.2}},'AMBIGUOUS_PLAN'],[plan(p,[item('a',{exposure:NaN})]),'PARAMETER_RANGE'],[plan(p,[item('a',{exposure:Infinity})]),'PARAMETER_RANGE'],[plan(p,[item('a',{exposure:.1}),item('a',{warmth:2})]),'DUPLICATE_ITEM'],[plan(p,[{id:'x',title:'x',patch:{code:'process.exit()'}}]),'INVALID_PLAN'],[{...plan(p,[item('a',{exposure:.1})]),guards:{}},'INVALID_PLAN'],[plan(p,[item('x',{bogus:1})]),'UNKNOWN_PARAMETER']])await assert.rejects(createCandidate(folder,value),{code});
  assert.equal((await loadProject(folder)).revision,p.revision);
});

test('path conflicts, missing dependencies and dependency cycles fail explicitly',async t=>{
  const folder=await fixture(t),p=await loadProject(folder);
  await assert.rejects(createCandidate(folder,plan(p,[item('a',{exposure:.1}),item('b',{exposure:.2})])),{code:'PATCH_CONFLICT'});
  await assert.rejects(createCandidate(folder,plan(p,[item('a',{exposure:.1},{dependsOn:['b']})])),{code:'DEPENDENCY_MISSING'});
  await assert.rejects(createCandidate(folder,plan(p,[item('a',{exposure:.1},{dependsOn:['b']}),item('b',{warmth:2},{dependsOn:['a']})])),{code:'DEPENDENCY_CYCLE'});
  const result=await createCandidate(folder,plan(p,[item('a',{exposure:.1}),item('b',{warmth:2},{dependsOn:['a']})]));
  await assert.rejects(select(folder,result,['b']),{code:'DEPENDENCY_REQUIRED'});
  await assert.rejects(select(folder,result,['unknown']),{code:'UNKNOWN_ITEM'});
});

test('stale preview hash, project revision, base version and concurrent writes cannot accept wrong selection',async t=>{
  const folder=await fixture(t),p=await loadProject(folder),first=await createCandidate(folder,plan(p,[item('a',{exposure:.1}),item('b',{warmth:2})]));
  await assert.rejects(acceptCandidate(folder,{id:first.candidate.id}),{code:'STALE_SELECTION'});
  const newer=await select(folder,first,['a']);
  await assert.rejects(acceptCandidate(folder,{id:first.candidate.id,revision:newer.project.revision,selectionHash:first.candidate.selectionHash}),{code:'STALE_SELECTION'});
  await assert.rejects(select(folder,first,['b']),{code:'STALE_REVISION'});
  const races=await Promise.allSettled([select(folder,newer,['a','b']),select(folder,newer,[])]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(createCandidate(folder,plan(p,[item('c',{contrast:5})])),{code:'STALE_REVISION'});
});

test('effective parameter lock rejects manual, style contribution and restore bypasses',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder);const edited=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,settings:{exposure:.2}});await accept(folder,edited);
  p=await loadProject(folder);await changeGuards(folder,{revision:p.revision,operation:'lock',parameters:['exposure']});p=await loadProject(folder);
  assert.equal(currentVersion(p).state.guards.parameters[0].effective,.2);
  await assert.rejects(createCandidate(folder,plan(p,[item('x',{exposure:.3})])),{code:'LOCK_CONFLICT'});
  await assert.rejects(createCandidate(folder,plan(p,[{id:'style',title:'style',patch:{style:{id:'daily-soft',amount:50}}} ])),{code:'LOCK_CONFLICT'});
  await assert.rejects(restoreVersion(folder,{id:p.versions[0].id,revision:p.revision}),{code:'LOCK_CONFLICT'});
  const other=await createCandidate(folder,plan(p,[item('contrast',{contrast:10})]));assert.equal(effectiveSettings(other.candidate.state).exposure,.2);
});

test('local layer lock protects its mask, enabled state, removal and order independently of notes',async t=>{
  const folder=await fixture(t);await saveNote(folder,{rect:{x:.1,y:.1,width:.3,height:.3},note:'face'});let p=await loadProject(folder),note=p.notes[0];
  const local=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,locals:[{annotationId:note.id,settings:{exposure:.2}}]});await accept(folder,local);
  p=await loadProject(folder);await changeGuards(folder,{revision:p.revision,operation:'lock',localIds:[note.id]});p=await loadProject(folder);
  for(const patch of [{enabled:false},{feather:.9},{settings:{exposure:.3}},{remove:true}])await assert.rejects(createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,locals:[{annotationId:note.id,...patch}]}),{code:'LOCK_CONFLICT'});
  await deleteNote(folder,{id:note.id});p=await loadProject(folder);const global=await createCandidate(folder,plan(p,[item('global',{exposure:.3})]));assert.equal(global.candidate.state.locals.length,1);
});

test('explicit unlock is previewed; discard keeps guards and accept releases them',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder);await changeGuards(folder,{revision:p.revision,operation:'lock',parameters:['exposure']});p=await loadProject(folder);
  const unlock=await changeGuards(folder,{revision:p.revision,operation:'unlock',parameterKeys:['exposure']});assert.equal(currentVersion(unlock.project).state.guards.parameters.length,1);
  await discardCandidate(folder,{id:unlock.candidate.id});p=await loadProject(folder);assert.equal(currentVersion(p).state.guards.parameters.length,1);
  const retry=await changeGuards(folder,{revision:p.revision,operation:'unlock',parameterKeys:['exposure']});await accept(folder,retry);p=await loadProject(folder);assert.equal(currentVersion(p).state.guards.parameters.length,0);
  const candidate=await createCandidate(folder,plan(p,[item('unlocked',{exposure:.4})]));assert.ok(candidate.candidate.id);
});

test('restore preserves live guards and restores historical guard snapshots explicitly',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder),original=p.currentId;const locked=await changeGuards(folder,{revision:p.revision,operation:'lock',parameters:['warmth']});
  await restoreVersion(folder,{id:original,revision:locked.project.revision});p=await loadProject(folder);assert.equal(currentVersion(p).state.guards.parameters.length,1);
  const unlock=await changeGuards(folder,{revision:p.revision,operation:'unlock',parameterKeys:['warmth']});await accept(folder,unlock);p=await loadProject(folder);await restoreVersion(folder,{id:locked.version.id,revision:p.revision});assert.equal(currentVersion(await loadProject(folder)).state.guards.parameters.length,1);
});

test('schema 1 inspection is read-only; first mutation backs up exact bytes and wraps old single candidates',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder);const candidate=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,settings:{warmth:6}});p=candidate.project;
  const {createHash}=await import('node:crypto');p.schema=1;for(const v of [...p.versions,...p.candidates])delete v.state.guards;
  const old=p.candidates[0];for(const key of ['items','selectedItemIds','selectionHash','legacy','baseRevision','noChange'])delete old[key];old.baseFingerprint=createHash('sha256').update(JSON.stringify({current:p.currentId,intent:p.intent,notes:p.notes})).digest('hex');
  const bytes=JSON.stringify(p,null,2);await writeFile(path.join(folder,'project.json'),bytes);
  const loaded=await loadProject(folder);assert.equal(loaded.schema,2);assert.equal(await readFile(path.join(folder,'project.json'),'utf8'),bytes);assert.equal(loaded.candidates[0].items.length,1);
  await acceptCandidate(folder,{id:old.id});assert.equal(await readFile(path.join(folder,'project.schema-1.backup.json'),'utf8'),bytes);assert.equal(JSON.parse(await readFile(path.join(folder,'project.json'),'utf8')).schema,2);
});

test('CLI, host tool dispatch and HTTP share selection and guard validation',async t=>{
  const folder=await fixture(t),p=await loadProject(folder),call={name:'frameyn_propose_edits',arguments:plan(p,[item('a',{exposure:.1}),item('b',{warmth:4})])};
  const contract=hostToolContract();assert.equal(contract.kind,'provider-neutral-host-contract');assert.equal(contract.tools[0].function.parameters.additionalProperties,false);
  const file=path.join(folder,'call.json');await writeFile(file,JSON.stringify(call));const result=await runCLI(['tool','--project',folder,'--input',file]);
  await assert.rejects(dispatchHostTool(folder,{name:'eval',arguments:{code:'bad'}}),{code:'UNKNOWN_TOOL'});
  const runtime=await serveProject(folder,{quiet:true});t.after(()=>runtime.close());const base=`http://127.0.0.1:${runtime.session.port}`,token=new URLSearchParams(new URL(runtime.session.url).hash.slice(1)).get('token'),headers={'X-Guangjian-Token':token,'Content-Type':'application/json'};
  const response=await fetch(base+'/api/candidate-selection',{method:'POST',headers,body:JSON.stringify({id:result.candidate.id,revision:result.project.revision,selectionHash:result.candidate.selectionHash,selectedItemIds:['a']})});assert.equal(response.status,200);const selected=await response.json();
  const image=await fetch(base+`/api/image?version=${selected.candidate.id}&revision=${selected.project.revision}&selectionHash=${selected.candidate.selectionHash}`,{headers});assert.equal(image.status,200);assert.equal(image.headers.get('X-Selection-Hash'),selected.candidate.selectionHash);assert.equal(image.headers.get('X-Project-Revision'),String(selected.project.revision));assert.match(image.headers.get('X-Frame-Spec'),/^[a-f0-9]{64}$/);
  const stale=await fetch(base+`/api/image?version=${selected.candidate.id}&revision=${result.project.revision}`,{headers});assert.equal(stale.status,409);
  await runCLI(['accept','--project',folder,'--id',selected.candidate.id,'--revision',String(selected.project.revision),'--selection-hash',selected.candidate.selectionHash]);
  const saved=await loadProject(folder);assert.equal(currentVersion(saved).state.settings.warmth,0);
});

test('published JSON schema matches the live host tool definition',async()=>{
  const schema=JSON.parse(await readFile(new URL('../skills/photo-retouch/schemas/edit-plan.schema.json',import.meta.url),'utf8'));
  const {$schema,title,...definition}=schema;assert.deepEqual(definition,hostToolContract().tools[0].function.parameters);assert.equal(definition.properties.items.items.properties.patch.additionalProperties,false);
});

test('legacy refinement freezes the selected parent into one accepted-base item and survives parent changes',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder);
  const first=await createCandidate(folder,plan(p,[item('light',{exposure:.3}),item('warm',{warmth:8})]));
  const chosen=await select(folder,first,['light']);
  const refined=await createCandidate(folder,{revision:chosen.project.revision,baseVersion:p.currentId,fromCandidate:first.candidate.id,settings:{contrast:6}});
  assert.equal(refined.candidate.refinedFrom,first.candidate.id);assert.equal(refined.candidate.parentId,p.currentId);
  assert.equal(refined.candidate.items.length,1);assert.equal(refined.candidate.state.settings.exposure,.3);assert.equal(refined.candidate.state.settings.warmth,0);
  const hashBefore=refined.candidate.selectionHash;
  await selectCandidateItems(folder,{id:first.candidate.id,revision:refined.project.revision,selectionHash:chosen.candidate.selectionHash,selectedItemIds:['warm']});
  await discardCandidate(folder,{id:first.candidate.id});p=await loadProject(folder);
  const blank=await selectCandidateItems(folder,{id:refined.candidate.id,revision:p.revision,selectionHash:hashBefore,selectedItemIds:[]});assert.deepEqual(blank.candidate.state,currentVersion(p).state);
  const again=await select(folder,blank,['whole-plan']);assert.equal(again.candidate.selectionHash,hashBefore);
  await accept(folder,again);assert.equal(currentVersion(await loadProject(folder)).state.settings.warmth,0);
});

test('legacy refinement preserves complete local snapshots and ordering across remove/reinsert',async t=>{
  const folder=await fixture(t),a=await saveNote(folder,{rect:{x:.1,y:.1,width:.3,height:.3},note:'a'}),b=await saveNote(folder,{rect:{x:.2,y:.2,width:.3,height:.3},note:'b'});let p=await loadProject(folder);
  const saved=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,locals:[{annotationId:a.note.id,settings:{exposure:.1}},{annotationId:b.note.id,settings:{warmth:4}}]});await accept(folder,saved);p=await loadProject(folder);
  const removed=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,locals:[{annotationId:a.note.id,remove:true}]});
  const restored=await createCandidate(folder,{revision:removed.project.revision,baseVersion:p.currentId,fromCandidate:removed.candidate.id,locals:[{annotationId:a.note.id,settings:{exposure:.2}}]});
  assert.deepEqual(restored.candidate.state.locals.map(l=>l.id),[b.note.id,a.note.id]);
  await accept(folder,restored);assert.equal(currentVersion(await loadProject(folder)).state.locals[0].localSettings.warmth,4);
});

test('legacy refinement rejects ambiguity, no-op, stale revision, and unlock candidates',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder);const first=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,settings:{exposure:.1}});p=first.project;
  await assert.rejects(createCandidate(folder,plan(p,[item('x',{contrast:4})],{fromCandidate:first.candidate.id})),{code:'AMBIGUOUS_PLAN'});
  await assert.rejects(createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,fromCandidate:first.candidate.id,settings:{exposure:.1}}),{code:'NO_CHANGE'});
  await assert.rejects(createCandidate(folder,{revision:p.revision-1,baseVersion:p.currentId,fromCandidate:first.candidate.id,settings:{exposure:.2}}),{code:'STALE_REVISION'});
  const locked=await changeGuards(folder,{revision:p.revision,operation:'lock',parameters:['warmth']});
  const unlock=await changeGuards(folder,{revision:locked.project.revision,operation:'unlock',parameterKeys:['warmth']});
  await assert.rejects(createCandidate(folder,{revision:unlock.project.revision,baseVersion:unlock.project.currentId,fromCandidate:unlock.candidate.id,settings:{exposure:.3}}),{code:'GUARD_SELECTION'});
});

test('schema 1 refinement migration preserves reordered local composites and exact backup bytes',async t=>{
  const folder=await fixture(t),a=await saveNote(folder,{rect:{x:.1,y:.1,width:.3,height:.3},note:'a'}),b=await saveNote(folder,{rect:{x:.2,y:.2,width:.3,height:.3},note:'b'});let p=await loadProject(folder);
  const saved=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,locals:[{annotationId:a.note.id,settings:{exposure:.2}},{annotationId:b.note.id,settings:{contrast:20}}]});await accept(folder,saved);p=await loadProject(folder);
  const candidate=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,settings:{warmth:2}});p=candidate.project;p.candidates[0].state.locals.reverse();p.schema=1;
  const {createHash}=await import('node:crypto');for(const v of [...p.versions,...p.candidates])delete v.state.guards;
  const old=p.candidates[0];for(const key of ['items','selectedItemIds','selectionHash','legacy','baseRevision','noChange'])delete old[key];old.baseFingerprint=createHash('sha256').update(JSON.stringify({current:p.currentId,intent:p.intent,notes:p.notes})).digest('hex');
  const bytes=JSON.stringify(p,null,2);await writeFile(path.join(folder,'project.json'),bytes);const before=await renderFrame(folder,old.id);
  await acceptCandidate(folder,{id:old.id});const after=await renderFrame(folder);assert.equal(after.pixelHash,before.pixelHash);assert.deepEqual(currentVersion(await loadProject(folder)).state.locals.map(l=>l.id),[b.note.id,a.note.id]);assert.equal(await readFile(path.join(folder,'project.schema-1.backup.json'),'utf8'),bytes);
});
