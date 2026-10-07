import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,rename} from 'node:fs/promises';
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
