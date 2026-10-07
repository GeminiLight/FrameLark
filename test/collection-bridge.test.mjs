import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,realpath,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
import {initCollection,inspectCollection,updateCollectionBrief,saveCollectionPlan} from '../skills/photo-retouch/scripts/collection.mjs';
import {loadProject,createCandidate,acceptCandidate} from '../skills/photo-retouch/scripts/project.mjs';

const image=fileURLToPath(new URL('../apps/studio/public/assets/alpine-demo.png',import.meta.url));
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'framelark-shared-collection-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const module=await import('../apps/studio/server/projects/collection-bridge.mjs').catch(error=>{
    if(error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('collection-bridge.mjs'))return {};throw error;
  });
  assert.equal(typeof module.CollectionBridge,'function','Shared collections need their own bridge');
  const projects=new ProjectBridge({root}),bridge=new module.CollectionBridge({root,projects});
  t.after(()=>bridge.close());t.after(()=>projects.close());
  const folder=join(root,'set');await initCollection(folder,{images:[image,image],brief:{theme:'保留现场光线',targetCount:2}});
  return {root,folder,projects,bridge};
}
function plan(c,order=c.photos.map(p=>p.id)){
  return {revision:c.revision,snapshotHash:c.snapshotHash,title:'共同选片',rationale:'用户确认当前版本与排列',order,
    decisions:c.photos.map(p=>({id:p.id,decision:order.includes(p.id)?'select':'reserve',observations:'按实际预览确认',reason:'保留这张',preserve:'原片内容',role:'组图成员'}))};
}
test('a CLI collection opens in the studio without rebuilding its photo projects',async t=>{
  const f=await fixture(t),before=await readFile(join(f.folder,'photos/P0001/project.json'));
  const c=await f.bridge.register(f.folder);
  assert.equal(c.brief.theme,'保留现场光线');assert.equal(c.photos.length,2);assert.ok(c.photos.every(p=>p.projectId&&p.preview));
  assert.deepEqual(await readFile(join(f.folder,'photos/P0001/project.json')),before);
  assert.equal((await f.projects.get(c.photos[0].projectId)).currentId,c.photos[0].versionId);
});
test('web theme and selection updates are immediately readable through the Skill runtime',async t=>{
  const f=await fixture(t);let c=await f.bridge.register(f.folder);
  c=await f.bridge.brief(c.id,{revision:c.revision,brief:{theme:'日常里的安静'}});
  c=await f.bridge.plan(c.id,plan(c,['P0002','P0001']));
  const disk=await inspectCollection(f.folder);
  assert.equal(disk.brief.theme,'日常里的安静');assert.deepEqual(disk.plan.order,['P0002','P0001']);assert.equal(disk.plan.source,'workspace-user');
  await assert.rejects(f.bridge.plan(c.id,plan({...c,revision:c.revision-1})),{code:'STALE_COLLECTION'});
  assert.deepEqual((await inspectCollection(f.folder)).plan.order,['P0002','P0001']);
});
test('the shared watcher sees CLI theme changes and accepted child versions',async t=>{
  const f=await fixture(t);let c=await f.bridge.register(f.folder);c=await f.bridge.plan(c.id,plan(c));
  const events=[],close=await f.bridge.subscribe(c.id,event=>events.push(event));t.after(close);
  await updateCollectionBrief(f.folder,{revision:c.revision,brief:{theme:'CLI 新主题'}});
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.ok(events.some(e=>e.revision>c.revision));
  c=await f.bridge.get(c.id);c=await f.bridge.plan(c.id,plan(c));const stamp=c.snapshotHash;
  const child=join(f.folder,'photos/P0001'),p=await loadProject(child);
  const trial=await createCandidate(child,{revision:p.revision,baseVersion:p.currentId,settings:{exposure:.1}});
  await acceptCandidate(child,{id:trial.candidate.id});await new Promise(resolve=>setTimeout(resolve,180));
  assert.ok(events.some(e=>e.snapshotHash!==stamp));assert.equal((await f.bridge.get(c.id)).plan.stale,true);
});
test('shared ordered export preserves versions and only serves its registered output files',async t=>{
  const f=await fixture(t);let c=await f.bridge.register(f.folder);c=await f.bridge.plan(c.id,plan(c,['P0002','P0001']));
  const exported=await f.bridge.export(c.id,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original'});
  assert.equal(exported.job.status,'done');assert.deepEqual(exported.job.items.map(i=>i.id),['P0002','P0001']);
  const first=exported.job.items[0],name=first.result.path.split('/').at(-1);
  const file=await f.bridge.exportedFile(c.id,exported.job.id,name);assert.ok(file.bytes.length>100);
  await assert.rejects(f.bridge.exportedFile(c.id,exported.job.id,'../project.json'),{code:'COLLECTION_FILE'});
});
test('creating a shared collection from a source directory keeps original files intact',async t=>{
  const f=await fixture(t),directory=join(f.root,'images');await mkdir(directory);
  const original=await readFile(image);await writeFile(join(directory,'a.png'),original);
  const c=await f.bridge.create({directory,brief:{theme:'新组图'}});
  assert.equal(c.photos.length,1);assert.deepEqual(await readFile(join(directory,'a.png')),original);
  assert.ok(c.folder.startsWith(join(await realpath(f.root),'projects','collections')));
});
test('collection downloads reject an export job directory redirected outside its collection',async t=>{
  const f=await fixture(t);let c=await f.bridge.register(f.folder);c=await f.bridge.plan(c.id,plan(c));
  const exported=await f.bridge.export(c.id,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original'});
  const directory=join(f.folder,exported.job.folder),outside=join(f.root,'outside');await mkdir(outside);
  await writeFile(join(outside,'manifest.json'),'private marker');await rename(directory,directory+'.saved');
  await symlink(outside,directory,process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.bridge.exportedFile(c.id,exported.job.id,'manifest.json'),{code:'COLLECTION_FILE'});
});
test('a restored collection identity cannot be edited through an old registration',async t=>{
  const f=await fixture(t),c=await f.bridge.register(f.folder),file=join(f.folder,'collection.json');
  const restored=JSON.parse(await readFile(file));restored.id=randomUUID();await writeFile(file,JSON.stringify(restored));
  await assert.rejects(f.bridge.get(c.id),{code:'COLLECTION_IDENTITY'});
  await assert.rejects(f.bridge.brief(c.id,{revision:c.revision,brief:{theme:'错误目标'}}),{code:'COLLECTION_IDENTITY'});
  assert.equal((await inspectCollection(f.folder)).brief.theme,c.brief.theme);
});
