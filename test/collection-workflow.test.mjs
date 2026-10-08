import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,rename,mkdir,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {initCollection,inspectCollection,updateCollectionBrief,saveCollectionPlan,collectionSheet,exportCollection} from '../skills/photo-retouch/scripts/collection.mjs';
import {loadProject,createCandidate,acceptCandidate,saveNote,hash} from '../skills/photo-retouch/scripts/project.mjs';
import {dispatchHostTool,hostToolContract} from '../skills/photo-retouch/scripts/tool-contract.mjs';
import {runCLI} from '../skills/photo-retouch/scripts/cli.mjs';
const photo=fileURLToPath(new URL('./web/fixtures/import/portrait.png',import.meta.url));
const broken=fileURLToPath(new URL('./web/fixtures/import/broken.jpg',import.meta.url));
async function fixture(t,images=[photo,photo]){
  const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-collection-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const folder=path.join(root,'set');await initCollection(folder,{images,brief:{theme:'人物与日常，保留真实肤色',purpose:'portrait',targetCount:2}});return folder;
}
function plan(c,order=c.photos.map(p=>p.id),extras={}){
  return {revision:c.revision,snapshotHash:c.snapshotHash,title:'自然人物组照',rationale:'从环境关系到表情细节；备选保留，不凑数量。',order,anchorId:order[0]||null,
    decisions:c.photos.map(p=>({id:p.id,decision:order.includes(p.id)?'select':'reserve',observations:'当前画面中人物与背景分离，头部光线较柔。',reason:'表情作为这一组的叙事线索。',preserve:'肤色与原有阴影关系。',role:'人物细节'})),...extras};
}
test('collection import isolates bad files, keeps stable IDs and original bytes, and only hints exact duplicates',async t=>{
  const folder=await fixture(t,[photo,broken,photo]),c=await inspectCollection(folder);
  assert.deepEqual(c.photos.map(p=>p.id),['P0001','P0003']);assert.equal(c.imports[1].status,'failed');assert.equal(c.photos[1].duplicateOf,'P0001');assert.equal(c.plan,null);
  assert.equal(hash(await readFile(path.join(folder,'photos/P0001/source/original.bin'))),hash(await readFile(photo)));
  assert.equal((await runCLI(['collection-inspect','--project',folder])).snapshotHash,c.snapshotHash);
  await assert.rejects(initCollection(folder,{images:[photo]}),{code:'COLLECTION_EXISTS'});
});
test('directory import is nonrecursive and limits inputs before creating a project',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-input-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'nested'));
  await writeFile(path.join(root,'a.png'),await readFile(photo));await writeFile(path.join(root,'nested/b.png'),await readFile(photo));await writeFile(path.join(root,'notes.txt'),'text');
  const c=await initCollection(path.join(root,'collection'),{directory:root});assert.equal(c.photos.length,1);
  await assert.rejects(initCollection(path.join(root,'invalid'),{images:Array(501).fill(photo)}),{code:'COLLECTION_INPUT'});
});
test('paged contact sheets report every ID and failed preview without silently omitting photos',async t=>{
  const folder=await fixture(t,Array(21).fill(photo));let sheet=await collectionSheet(folder,{page:2});
  assert.equal(sheet.pages,2);assert.equal(sheet.photos.length,1);assert.equal(sheet.photos[0].id,'P0021');assert.ok((await readFile(sheet.path)).length>100);
  await rename(path.join(folder,'photos/P0021/source/normalized.png'),path.join(folder,'saved.png'));
  sheet=await collectionSheet(folder,{page:2});assert.equal(sheet.photos[0].error.code,'SOURCE_MISSING');assert.equal(sheet.total,21);
  await assert.rejects(collectionSheet(folder,{page:3}),{code:'COLLECTION_PAGE'});
});
test('curation distinguishes reserve, exclude and unreviewed, obeys must-keep, and never removes sources',async t=>{
  const folder=await fixture(t,[photo,photo,photo]);let c=await inspectCollection(folder);
  c=await updateCollectionBrief(folder,{revision:c.revision,brief:{mustKeep:['P0002'],targetCount:6}});
  await assert.rejects(saveCollectionPlan(folder,plan(c,['P0001'])),{code:'COLLECTION_MUST_KEEP'});
  const value=plan(c,['P0002']);value.decisions[0].decision='exclude';value.decisions.pop();c=await saveCollectionPlan(folder,value);
  assert.deepEqual(c.unreviewed,['P0003']);assert.equal(c.plan.decisions[0].decision,'exclude');assert.equal(c.warnings.length,1);assert.equal(c.photos.length,3);
  const sheet=await collectionSheet(folder,{view:'planned',selected:true});assert.deepEqual(sheet.photos.map(p=>p.id),['P0002']);
  assert.ok((await readFile(path.join(folder,'photos/P0001/source/original.bin'))).length);
  const exported=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original'});
  assert.deepEqual(exported.unreviewed,['P0003']);const manifest=JSON.parse(await readFile(exported.manifest));
  assert.deepEqual(manifest.unreviewed,['P0003']);assert.equal(manifest.decisions[0].decision,'exclude');
});
test('plan validation rejects unknown IDs, repeated orders and stale child annotations; pending trials do not invalidate it',async t=>{
  const folder=await fixture(t),c=await inspectCollection(folder);
  await assert.rejects(saveCollectionPlan(folder,plan(c,['P0001','P0001'])),{code:'COLLECTION_ORDER'});
  const wrong=plan(c);wrong.decisions[0].id='P9999';await assert.rejects(saveCollectionPlan(folder,wrong),{code:'COLLECTION_DECISIONS'});
  const child=path.join(folder,'photos/P0001'),p=await loadProject(child),candidate=await createCandidate(child,{revision:p.revision,baseVersion:p.currentId,settings:{shadows:5}});
  assert.equal((await inspectCollection(folder)).snapshotHash,c.snapshotHash);
  await saveNote(child,{rect:{x:.1,y:.1,width:.2,height:.2},note:'保留这里'});
  await assert.rejects(saveCollectionPlan(folder,plan(c)),{code:'STALE_COLLECTION'});
  assert.ok(candidate.candidate.id);
});
test('theme changes and accepted edits require fresh curation; concurrent plans cannot overwrite one another',async t=>{
  const folder=await fixture(t);let c=await inspectCollection(folder);c=await saveCollectionPlan(folder,plan(c));
  c=await updateCollectionBrief(folder,{revision:c.revision,brief:{theme:'更克制的纪录感'}});assert.equal(c.plan.stale,true);
  await assert.rejects(exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash}),{code:'STALE_COLLECTION'});
  c=await saveCollectionPlan(folder,plan(c));const child=path.join(folder,'photos/P0002'),p=await loadProject(child),a=await createCandidate(child,{revision:p.revision,baseVersion:p.currentId,settings:{highlights:-5}});await acceptCandidate(child,{id:a.candidate.id});
  c=await inspectCollection(folder);assert.equal(c.plan.stale,true);
  const results=await Promise.allSettled([saveCollectionPlan(folder,plan(c)),saveCollectionPlan(folder,plan(c))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'STALE_COLLECTION');
});
test('ordered exports persist partial success and retry failures without rewriting completed files',async t=>{
  const folder=await fixture(t);let c=await inspectCollection(folder);c=await saveCollectionPlan(folder,plan(c,['P0002','P0001']));
  const missing=path.join(folder,'photos/P0001/source/normalized.png'),backup=path.join(folder,'backup.png');await rename(missing,backup);
  let result=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash});assert.equal(result.job.status,'partial');assert.deepEqual(result.job.items.map(i=>i.status),['done','failed']);
  const bytes=await readFile(result.job.items[0].result.path);await rename(backup,missing);c=await inspectCollection(folder);
  result=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,retryJob:result.job.id});assert.equal(result.job.status,'done');assert.deepEqual(await readFile(result.job.items[0].result.path),bytes);
  const manifest=JSON.parse(await readFile(result.manifest));assert.deepEqual(manifest.order,['P0002','P0001']);assert.equal(path.basename(result.job.items[0].result.path),'001-P0002.jpg');
  await writeFile(result.job.items[0].result.path,'changed');c=await inspectCollection(folder);
  result=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,retryJob:result.job.id});assert.equal(result.job.items[0].error.code,'COLLECTION_OUTPUT_CHANGED');assert.equal(await readFile(result.job.items[0].result.path,'utf8'),'changed');
});
test('retrying an unfinished export preserves any existing user output and uses its own new name',async t=>{
  const folder=await fixture(t);let c=await inspectCollection(folder);c=await saveCollectionPlan(folder,plan(c));
  const original=path.join(folder,'photos/P0002/source/normalized.png'),backup=path.join(folder,'backup.png');await rename(original,backup);
  const partial=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash});assert.deepEqual(partial.job.items.map(item=>item.status),['done','failed']);
  const completed=await readFile(partial.job.items[0].result.path),existing=path.join(folder,partial.job.folder,'002-P0002.jpg'),user=Buffer.from('user output is independent of this unfinished export');await writeFile(existing,user);await rename(backup,original);
  c=await inspectCollection(folder);const result=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,retryJob:partial.job.id});
  assert.equal(result.job.status,'done');assert.notEqual(result.job.items[1].result.path,existing);assert.deepEqual(await readFile(existing),user);assert.deepEqual(await readFile(result.job.items[0].result.path),completed);
  const before=await stat(result.job.items[1].result.path);c=await inspectCollection(folder);const again=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,retryJob:partial.job.id});
  assert.equal(again.job.status,'done');assert.equal(again.job.items[1].result.path,result.job.items[1].result.path);assert.equal((await stat(result.job.items[1].result.path)).mtimeMs,before.mtimeMs);
});
test('retrying a completed export after moving its collection returns the verified current paths',async t=>{
  const folder=await fixture(t);let c=await inspectCollection(folder);c=await saveCollectionPlan(folder,plan(c));
  const first=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original'});
  const originals=await Promise.all(first.job.items.map(async item=>({bytes:await readFile(item.result.path),mtime:(await stat(item.result.path)).mtimeMs,result:item.result})));
  const moved=folder+'-moved';await rename(folder,moved);c=await inspectCollection(moved);
  const result=await exportCollection(moved,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original',retryJob:first.job.id});
  assert.equal(result.job.status,'done');const manifest=JSON.parse(await readFile(result.manifest));
  for(const [i,item] of result.job.items.entries()){
    assert.equal(item.result.path,path.join(moved,result.job.folder,path.basename(originals[i].result.path)));
    assert.deepEqual(await readFile(item.result.path),originals[i].bytes);assert.equal((await stat(item.result.path)).mtimeMs,originals[i].mtime);
    assert.equal(item.result.fileHash,originals[i].result.fileHash);assert.equal(item.result.versionId,originals[i].result.versionId);
    assert.equal(manifest.job.items[i].result.path,item.result.path);
  }
});
test('allowlisted collection tools use their own folder and reject code execution and invalid paths',async t=>{
  const folder=await fixture(t),contract=hostToolContract();assert.equal(contract.tools.length,24);assert.ok(contract.tools.some(tool=>tool.function.name==='frameyn_document_tools'));assert.ok(contract.tools.some(tool=>tool.function.name==='frameyn_propose_document'));
  const c=await dispatchHostTool(folder,{name:'frameyn_collection_inspect',arguments:{}});assert.equal(c.photos.length,2);
  await assert.rejects(dispatchHostTool(folder,{name:'frameyn_collection_plan',arguments:{...plan(c),code:'execute'}}),{code:'INVALID_PLAN'});
  const file=path.join(folder,'collection.json'),raw=JSON.parse(await readFile(file));raw.photos[0].project='../../outside';await writeFile(file,JSON.stringify(raw));
  await assert.rejects(inspectCollection(folder),{code:'COLLECTION_INVALID'});
});
test('export retries reject tampered queue paths before writing any extra file',async t=>{
  const folder=await fixture(t);let c=await inspectCollection(folder);c=await saveCollectionPlan(folder,plan(c));
  const result=await exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original'}),file=path.join(folder,'collection.json'),raw=JSON.parse(await readFile(file));
  raw.jobs[0].items[0].id='../../escape';await writeFile(file,JSON.stringify(raw));c=await inspectCollection(folder);
  await assert.rejects(exportCollection(folder,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original',retryJob:result.job.id}),{code:'COLLECTION_INVALID'});
});
