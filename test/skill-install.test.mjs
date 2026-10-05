import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
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
