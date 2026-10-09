import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,rename,link} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {inflateRawSync} from 'node:zlib';
import {buildPlugin,packageFiles,repositoryRoot} from '../../scripts/build-framelark-plugin.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'framelark-distribution-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const put=async(name,data)=>{await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),data);};
  for(const name of ['plugin.json','.codex-plugin/plugin.json','.agents/plugins/marketplace.json'])await put(name,await readFile(join(repositoryRoot,name)));
  await put('assets/framelark-avatar.png',Buffer.from('public test icon'));
  for(const skill of ['photo-retouch','photography-eye','photo-series'])await put(`skills/${skill}/SKILL.md`,`---\nname: ${skill}\n---\nPublic test skill.\n`);
  execFileSync('git',['init','--quiet'],{cwd:root});
  execFileSync('git',['add','.'],{cwd:root});
  return {root,put};
}

function archiveEntries(bytes){
  const files=[];let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const start=offset+30+length+extra;
    files.push({name:bytes.subarray(offset+30,offset+30+length).toString('utf8'),data:inflateRawSync(bytes.subarray(start,start+size))});
    offset=start+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50,'ZIP contains its central directory');
  return files;
}

test('plugin folder and ZIP include only maintained source, even in a used checkout',async t=>{
  const {root,put}=await fixture(t);
  for(const name of ['skills/photo-retouch/.env.local','skills/photo-retouch/projects/personal/project.json','skills/photo-retouch/node_modules/secret.js','assets/private-settings.json'])await put(name,'SYNTHETIC_PRIVATE_REVIEW_DATA');
  const built=await buildPlugin({root});
  const payload=await packageFiles(built.folder),archive=archiveEntries(await readFile(built.zipPath));
  assert.equal(payload.length,6);assert.equal(archive.length,payload.length);
  for(const file of payload){assert.ok(!file.data.includes('SYNTHETIC_PRIVATE_REVIEW_DATA'));assert.deepEqual(archive.find(item=>item.name==='framelark/'+file.name)?.data,file.data);}
  assert.ok(!payload.some(file=>file.name==='assets/private-settings.json'));
});

test('an accidentally tracked local configuration fails before replacing the last good package',async t=>{
  const {root,put}=await fixture(t),built=await buildPlugin({root}),prior=await readFile(built.zipPath);
  await put('skills/photo-retouch/.env.local','SYNTHETIC_PRIVATE_REVIEW_DATA');
  execFileSync('git',['add','--force','skills/photo-retouch/.env.local'],{cwd:root});
  await assert.rejects(buildPlugin({root}),/Local runtime data cannot be distributed/);
  assert.deepEqual(await readFile(built.zipPath),prior);
  assert.equal((await packageFiles(built.folder)).length,6);
});

test('tracked links cannot pull external files into a distribution',async t=>{
  const {root,put}=await fixture(t);
  await put('outside.txt','SYNTHETIC_PRIVATE_REVIEW_DATA');
  await symlink(join(root,'outside.txt'),join(root,'assets','external.txt'));
  execFileSync('git',['add','assets/external.txt'],{cwd:root});
  await assert.rejects(buildPlugin({root}),/regular files/);
});

test('a linked parent directory cannot substitute external data for a tracked resource',async t=>{
  const {root,put}=await fixture(t);
  await put('local-assets/framelark-avatar.png','SYNTHETIC_PRIVATE_REVIEW_DATA');
  await rename(join(root,'assets'),join(root,'assets-original'));
  await symlink(join(root,'local-assets'),join(root,'assets'),'dir');
  await assert.rejects(buildPlugin({root}),/without linked directories/);
});

test('a mismatched release identity preserves the last valid archive',async t=>{
  const {root,put}=await fixture(t),built=await buildPlugin({root}),prior=await readFile(built.zipPath);
  const manifest=JSON.parse(await readFile(join(root,'plugin.json')));manifest.version='../wrong';
  await put('plugin.json',JSON.stringify(manifest));
  await assert.rejects(buildPlugin({root}),/same valid FrameLark release/);
  assert.deepEqual(await readFile(built.zipPath),prior);
});

test('plugin build actually runs when its CLI is launched through a linked path',async t=>{
  const {root,put}=await fixture(t);
  await put('scripts/build-framelark-plugin.mjs',await readFile(join(repositoryRoot,'scripts/build-framelark-plugin.mjs')));
  const entry=join(root,'build-linked.mjs');await symlink(join(root,'scripts/build-framelark-plugin.mjs'),entry);
  const built=JSON.parse(execFileSync(process.execPath,[entry],{cwd:root,encoding:'utf8',timeout:10000}));
  assert.equal(built.version,JSON.parse(await readFile(join(root,'plugin.json'))).version);assert.equal(built.files,6);assert.ok((await readFile(built.zipPath)).length>0);
});

test('a packaged Markdown link cannot depend on repository-only files',async t=>{
 const {root,put}=await fixture(t);await put('docs/local-guide.md','Repository-only guide.');await put('skills/photo-retouch/references/guide.md','Read [architecture](../../../docs/local-guide.md).');execFileSync('git',['add','.'],{cwd:root});
 await assert.rejects(buildPlugin({root}),/packaged.*link|distribution.*link/i);
});
test('packaged cross-skill links resolve inside the full skill bundle',async t=>{
 const {root,put}=await fixture(t);await put('skills/photo-series/SKILL.md','---\nname: photo-series\n---\nUse [retouch](../photo-retouch/SKILL.md).');execFileSync('git',['add','.'],{cwd:root});await buildPlugin({root});
});

test('an inner marketplace link cannot replace a tracked plugin directory',async t=>{
 if(process.platform==='win32')return t.skip('Creating a directory symlink requires Windows privileges.');
 const {root,put}=await fixture(t),output=join(root,'dist/custom');await put('plugins/framelark/maintained.md','keep maintained plugin');execFileSync('git',['add','plugins'],{cwd:root});await mkdir(output,{recursive:true});await symlink(join(root,'plugins'),join(output,'marketplace'),'dir');
 await assert.rejects(buildPlugin({root,output}),/overlap.*source/i);assert.equal(await readFile(join(root,'plugins/framelark/maintained.md'),'utf8'),'keep maintained plugin');
});
test('an inner catalog link cannot rewrite the repository marketplace',async t=>{
 if(process.platform==='win32')return t.skip('Creating a directory symlink requires Windows privileges.');
 const {root}=await fixture(t),output=join(root,'dist/custom'),catalog=join(root,'.agents/plugins/marketplace.json'),before=await readFile(catalog);await mkdir(join(output,'marketplace'),{recursive:true});await symlink(join(root,'.agents'),join(output,'marketplace/.agents'),'dir');
 await assert.rejects(buildPlugin({root,output}),/overlap.*source/i);assert.deepEqual(await readFile(catalog),before);
});
test('a dist link to a separate output disk remains usable when it does not overlap inputs',async t=>{
 if(process.platform==='win32')return t.skip('Creating a directory symlink requires Windows privileges.');
 const {root}=await fixture(t),external=await mkdtemp(join(tmpdir(),'framelark-output-disk-'));t.after(()=>rm(external,{recursive:true,force:true}));await symlink(external,join(root,'dist'),'dir');const built=await buildPlugin({root});assert.ok((await readFile(built.zipPath)).length);assert.equal((await packageFiles(built.folder)).length,6);
});
test('an archive link to a maintained manifest is rejected before replacing the previous plugin folder',async t=>{
 if(process.platform==='win32')return t.skip('Creating a file symlink requires Windows privileges.');
 const {root}=await fixture(t),built=await buildPlugin({root}),input=join(root,'plugin.json'),before=await readFile(input);await writeFile(join(built.folder,'old-marker.txt'),'preserve old package folder');await rm(built.zipPath);await symlink(input,built.zipPath);
 await assert.rejects(buildPlugin({root}),/overlap.*source/i);assert.deepEqual(await readFile(input),before);assert.equal(await readFile(join(built.folder,'old-marker.txt'),'utf8'),'preserve old package folder');
});
test('a hardlinked archive is atomically replaced without modifying the maintained manifest',async t=>{
 const {root}=await fixture(t),built=await buildPlugin({root}),input=join(root,'plugin.json'),before=await readFile(input);await rm(built.zipPath);await link(input,built.zipPath);
 const next=await buildPlugin({root});assert.deepEqual(await readFile(input),before);assert.equal((await readFile(next.zipPath)).readUInt32LE(0),0x04034b50);assert.equal(archiveEntries(await readFile(next.zipPath)).length,6);
});
test('a hardlinked output catalog is atomically replaced without rewriting the repository marketplace',async t=>{
 const {root}=await fixture(t),built=await buildPlugin({root}),input=join(root,'.agents/plugins/marketplace.json'),before=await readFile(input);await rm(built.marketplacePath);await link(input,built.marketplacePath);
 const next=await buildPlugin({root});assert.deepEqual(await readFile(input),before);assert.deepEqual(JSON.parse(await readFile(next.marketplacePath)).plugins.map(p=>p.name),['framelark']);
});
