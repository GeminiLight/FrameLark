import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access,rm,mkdir,cp,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),installer=fileURLToPath(new URL('../scripts/install-photo-skill.mjs',import.meta.url));
async function fixture(t){const folder=await mkdtemp(join(tmpdir(),'framelark-install-'));t.after(()=>rm(folder,{recursive:true,force:true}));return folder;}
test('photography-eye installs outside the repository and its knowledge command runs',async t=>{
  const folder=await fixture(t),target=join(folder,'eye');
  await exec(process.execPath,[installer,'--skill','photography-eye',target]);
  const result=await exec(process.execPath,[join(target,'scripts/knowledge.mjs'),'check'],{cwd:folder});
  assert.ok(JSON.parse(result.stdout).documents>0);assert.match(await readFile(join(target,'SKILL.md'),'utf8'),/^name: photography-eye$/m);
});
test('existing skills are preserved unless update is explicit, and update retains a backup',async t=>{
  const folder=await fixture(t),target=join(folder,'eye');
  await exec(process.execPath,[installer,'--skill','photography-eye',target]);
  await writeFile(join(target,'local-note.txt'),'keep my prior installation');
  await assert.rejects(exec(process.execPath,[installer,'--skill','photography-eye',target]));
  assert.equal(await readFile(join(target,'local-note.txt'),'utf8'),'keep my prior installation');
  const updated=await exec(process.execPath,[installer,'--skill','photography-eye',target,'--update']);
  const backup=updated.stdout.match(/旧版备份：([^\n]+)/)?.[1];assert.ok(backup);
  assert.equal(await readFile(join(backup,'local-note.txt'),'utf8'),'keep my prior installation');
  await access(join(target,'SKILL.md'));
});
test('batch installation refuses an existing skill before installing the other one',async t=>{
  const folder=await fixture(t),target=join(folder,'photography-eye');
  await exec(process.execPath,[installer,'--skill','photography-eye',target]);
  await assert.rejects(exec(process.execPath,[installer,'--all',folder]));
  await assert.rejects(access(join(folder,'photo-retouch')));await access(join(target,'SKILL.md'));
});
test('invalid skill selectors and incompatible modes do not create target folders',async t=>{
  const folder=await fixture(t),target=join(folder,'missing');
  for(const args of [['--skill','../invalid',target],['--all','--skill','photography-eye',target]])await assert.rejects(exec(process.execPath,[installer,...args]));
  await assert.rejects(access(target));
});
test('update refuses unrelated directories even when they contain no skill metadata',async t=>{
  const folder=await fixture(t),target=join(folder,'unrelated');await mkdir(target);
  await writeFile(join(target,'keep.txt'),'my files');
  await assert.rejects(exec(process.execPath,[installer,'--skill','photography-eye',target,'--update']));
  assert.equal(await readFile(join(target,'keep.txt'),'utf8'),'my files');
});

async function sourceFixture(t){
  const folder=await fixture(t),source=join(folder,'source');await mkdir(join(source,'scripts'),{recursive:true});
  const root=fileURLToPath(new URL('../',import.meta.url));
  for(const name of ['install-photo-skill.mjs','installation-guide.mjs','build-framelark-plugin.mjs'])await cp(join(root,'scripts',name),join(source,'scripts',name));
  for(const name of ['photography-eye','photo-retouch','photo-series'])await cp(join(root,'skills',name),join(source,'skills',name),{recursive:true,filter:path=>!path.split(/[\\/]/).some(part=>['node_modules','.raw-venv','__pycache__'].includes(part))});
  execFileSync('git',['init','--quiet'],{cwd:source});execFileSync('git',['add','.'],{cwd:source});
  return {folder,source,root,installer:join(source,'scripts/install-photo-skill.mjs')};
}
test('standalone installation omits untracked configuration and photo projects',async t=>{
  const f=await sourceFixture(t),eye=join(f.source,'skills/photography-eye'),target=join(f.folder,'installed');
  await writeFile(join(eye,'.env.local'),'SYNTHETIC_PRIVATE_REVIEW_DATA');await mkdir(join(eye,'projects/personal'),{recursive:true});await writeFile(join(eye,'projects/personal/project.json'),'private project');
  await exec(process.execPath,[f.installer,'--skill','photography-eye',target]);
  await assert.rejects(access(join(target,'.env.local')));await assert.rejects(access(join(target,'projects/personal/project.json')));await access(join(target,'SKILL.md'));
});
test('standalone installation rejects tracked private configuration before replacing a skill',async t=>{
  const f=await sourceFixture(t),eye=join(f.source,'skills/photography-eye'),target=join(f.folder,'installed');
  await exec(process.execPath,[f.installer,'--skill','photography-eye',target]);await writeFile(join(target,'local-note.md'),'keep the previous knowledge');
  await writeFile(join(eye,'.env.local'),'SYNTHETIC_PRIVATE_REVIEW_DATA');execFileSync('git',['add','--force','skills/photography-eye/.env.local'],{cwd:f.source});
  await assert.rejects(exec(process.execPath,[f.installer,'--skill','photography-eye',target,'--update']),/Local runtime data cannot be distributed/);
  assert.equal(await readFile(join(target,'local-note.md'),'utf8'),'keep the previous knowledge');
});
test('standalone installation rejects a tracked link outside the maintained skill',async t=>{
  if(process.platform==='win32')return t.skip('Creating a symlink requires Windows privileges; file selection is also covered without links.');
  const f=await sourceFixture(t),target=join(f.folder,'installed'),outside=join(f.folder,'outside.txt');await writeFile(outside,'private local content');
  await symlink(outside,join(f.source,'skills/photography-eye/external.txt'));execFileSync('git',['add','skills/photography-eye/external.txt'],{cwd:f.source});
  await assert.rejects(exec(process.execPath,[f.installer,'--skill','photography-eye',target]),/regular files/);await assert.rejects(access(target));
});
test('standalone update upgrades reusable old native dependencies and keeps previous knowledge in backup',async t=>{
  const f=await sourceFixture(t),target=join(f.folder,'retouch');
  await cp(join(f.source,'skills/photo-retouch'),target,{recursive:true});await cp(join(f.root,'skills/photo-retouch/node_modules'),join(target,'node_modules'),{recursive:true});
  const metadata=join(target,'node_modules/sharp/package.json'),old=JSON.parse(await readFile(metadata,'utf8'));old.version='0.35.3';await writeFile(metadata,JSON.stringify(old));await writeFile(join(target,'personal-note.md'),'retained original knowledge');
  const result=await exec(process.execPath,[f.installer,target,'--update'],{timeout:180000});
  assert.equal(JSON.parse(await readFile(metadata,'utf8')).version,'0.35.4');const backup=result.stdout.match(/旧版备份：([^\n]+)/)?.[1];assert.ok(backup);
  assert.equal(await readFile(join(backup,'personal-note.md'),'utf8'),'retained original knowledge');
  const check=await exec(process.execPath,[join(target,'scripts/cli.mjs'),'help']);assert.equal(JSON.parse(check.stdout).ok,true);
});

test('standalone installation rejects knowledge links that would be missing outside the checkout',async t=>{
  const f=await sourceFixture(t),target=join(f.folder,'installed'),guide=join(f.source,'skills/photography-eye/references/repository-link.md');
  await writeFile(guide,'Read [local file](../../../notes.md).');execFileSync('git',['add','skills/photography-eye/references/repository-link.md'],{cwd:f.source});
  await assert.rejects(exec(process.execPath,[f.installer,'--skill','photography-eye',target]),/packaged Markdown link/);await assert.rejects(access(target));
});

async function isolatedInstall({folder,source,home,profile,args}){
  const options=join(folder,'isolated-options.json');await writeFile(options,JSON.stringify({source,home,profile,args}));
  const result=await exec(process.execPath,['--experimental-vm-modules',fileURLToPath(new URL('./helpers/isolated-skill-install.mjs',import.meta.url)),options]);return JSON.parse(result.stdout);
}
test('default Skill installation uses the selected Codex profile and leaves the default profile untouched',async t=>{
  const folder=await fixture(t),home=join(folder,'user'),profile=join(folder,'selected-profile'),result=await isolatedInstall({folder,home,profile,source:installer,args:['--skill','photography-eye']});
  assert.equal(result.code,0,result.messages.join('\n'));await access(join(profile,'skills/photography-eye/SKILL.md'));await assert.rejects(access(join(home,'.codex/skills/photography-eye')));
});
test('default legacy migration and its backup use the selected Codex profile',async t=>{
  const f=await sourceFixture(t),home=join(f.folder,'user'),profile=join(f.folder,'selected-profile'),legacy=join(profile,'skills/guangjian-retouch'),other=join(home,'.codex/skills/guangjian-retouch');
  for(const target of [legacy,other]){await mkdir(target,{recursive:true});await writeFile(join(target,'SKILL.md'),'---\nname: guangjian-retouch\n---\nPrior knowledge.');await writeFile(join(target,'local-note.txt'),target===legacy?'selected knowledge':'default knowledge');}
  await writeFile(join(f.source,'skills/photo-retouch/scripts/setup.mjs'),'// Root/backup contract fixture; native installation is independently tested.');
  const result=await isolatedInstall({folder:f.folder,home,profile,source:f.installer,args:['--update']});assert.equal(result.code,0,result.messages.join('\n'));
  await access(join(profile,'skills/photo-retouch/SKILL.md'));await assert.rejects(access(legacy));assert.equal(await readFile(join(other,'local-note.txt'),'utf8'),'default knowledge');
  const backup=result.messages.join('\n').match(/旧版备份：([^\n]+)/)?.[1];assert.equal(dirname(backup),join(profile,'skill-backups'));assert.equal(await readFile(join(backup,'local-note.txt'),'utf8'),'selected knowledge');
});
