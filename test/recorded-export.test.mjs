import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,rename,realpath,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {createRequire} from 'node:module';
import {initProject,loadProject,recordExport} from '../skills/photo-retouch/scripts/project.mjs';
import {exportPhoto} from '../skills/photo-retouch/scripts/render.mjs';
import {serveProject} from '../skills/photo-retouch/scripts/server.mjs';
import {ProjectBridge} from '../apps/studio/server/projects/bridge.mjs';
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'framelark-recorded-export-')),image=join(root,'technical.png'),folder=join(root,'photo'),bridge=new ProjectBridge({root}),services=[];
  t.after(async()=>{for(const service of services)await service.close();await bridge.close();await rm(root,{recursive:true,force:true});});const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');await sharp({create:{width:32,height:24,channels:3,background:'#7c92a2'}}).png().toFile(image);await initProject(image,folder);const project=await bridge.register(folder),exported=await bridge.export(project.id,{versionId:project.currentId,options:{preset:'original',format:'png'}});
  return {root,folder,bridge,project,exported,native:async(folder,name=basename(exported.path),operation='download')=>{const service=await serveProject(await realpath(folder),{quiet:true});services.push(service);const url=new URL(service.session.url),token=new URLSearchParams(url.hash.slice(1)).get('token');url.hash='';url.pathname='/api/'+operation;url.searchParams.set('file',name);return fetch(url,{method:operation==='export'?'POST':'GET',headers:{'x-guangjian-token':token,'content-type':'application/json'},...(operation==='export'?{body:JSON.stringify({version:project.currentId,format:'png',preset:'original'})}:{})});}};
}
test('a moved project serves its existing recorded image from both Studio and native interfaces',async t=>{
  const f=await fixture(t),bytes=await readFile(f.exported.path),moved=join(f.root,'moved');await rename(f.folder,moved);await f.bridge.register(moved);assert.deepEqual((await f.bridge.exportedFile(f.project.id,basename(f.exported.path))).bytes,bytes);const response=await f.native(moved);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
});
test('native recorded downloads reject an image link to bytes outside the registered project',async t=>{
  if(process.platform==='win32')return t.skip('Creating file symlinks requires optional Windows privileges.');const f=await fixture(t),outside=join(f.root,'outside.txt');await writeFile(outside,'technical outside-project fixture');await rename(f.exported.path,f.exported.path+'.original');await symlink(outside,f.exported.path);const response=await f.native(f.folder);assert.equal(response.status,400);await assert.rejects(f.bridge.exportedFile(f.project.id,basename(f.exported.path)));assert.equal(await readFile(outside,'utf8'),'technical outside-project fixture');
});
test('legacy hashed export records remain portable while old unhashed records stay usable in place',async t=>{
  const f=await fixture(t),file=join(f.folder,'project.json'),p=await loadProject(f.folder),bytes=await readFile(f.exported.path);delete p.exports[0].relativePath;await writeFile(file,JSON.stringify(p));const moved=join(f.root,'moved');await rename(f.folder,moved);await f.bridge.register(moved);assert.deepEqual((await f.bridge.exportedFile(f.project.id,basename(f.exported.path))).bytes,bytes);let response=await f.native(moved);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  p.exports[0].path=join(await realpath(moved),'exports',basename(f.exported.path));delete p.exports[0].fileHash;await writeFile(join(moved,'project.json'),JSON.stringify(p));assert.deepEqual((await f.bridge.exportedFile(f.project.id,basename(f.exported.path))).bytes,bytes);response=await f.native(moved);assert.equal(response.status,200);
});
test('changed exported bytes are refused by both interfaces without altering the user file',async t=>{
  const f=await fixture(t),user=Buffer.from('independent replacement content');await writeFile(f.exported.path,user);await assert.rejects(f.bridge.exportedFile(f.project.id,basename(f.exported.path)),{code:'EXPORT_CHANGED'});assert.equal((await f.native(f.folder)).status,400);assert.deepEqual(await readFile(f.exported.path),user);
});
test('an explicitly external output is not claimed as an internal export even if identical bytes are copied there',async t=>{
  const f=await fixture(t),external=join(f.root,'external.png'),p=await loadProject(f.folder),result=await exportPhoto(f.folder,p.currentId,{preset:'original',format:'png',output:external});await recordExport(f.folder,result);const bytes=await readFile(external);await writeFile(join(f.folder,'exports','external.png'),bytes);assert.equal((await loadProject(f.folder)).exports.at(-1).path,external);await assert.rejects(f.bridge.exportedFile(f.project.id,'external.png'),{code:'EXPORT_CHANGED'});assert.equal((await f.native(f.folder,'external.png')).status,400);assert.deepEqual(await readFile(external),bytes);
});
test('redirected export directories are rejected before writing or serving files',async t=>{
  if(process.platform==='win32')return t.skip('Creating directory links requires optional Windows privileges.');const f=await fixture(t),outside=join(f.root,'elsewhere');await rename(join(f.folder,'exports'),outside);await symlink(outside,join(f.folder,'exports'),'dir');const names=await readdir(outside);await assert.rejects(f.bridge.exportedFile(f.project.id,basename(f.exported.path)),{code:'EXPORT_PATH'});await assert.rejects(f.bridge.export(f.project.id,{versionId:f.project.currentId,options:{format:'png'}}),{code:'EXPORT_PATH'});assert.equal((await f.native(f.folder)).status,400);assert.equal((await f.native(f.folder,basename(f.exported.path),'export')).status,400);assert.deepEqual(await readdir(outside),names);
});
