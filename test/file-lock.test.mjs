import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,stat,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withFileLock} from '../skills/photo-retouch/scripts/file-lock.mjs';
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'framelark-lock-owner-'));t.after(()=>rm(root,{recursive:true,force:true}));return join(root,'lock');}
const options={timeoutMs:80,staleMs:10,retryMs:5,busyCode:'FIXTURE_BUSY'};
test('a live scalar PID remains locked even when its directory is old',async t=>{
  const lock=await fixture(t);await mkdir(lock);await writeFile(join(lock,'owner'),String(process.pid));const old=new Date(Date.now()-20000);await utimes(lock,old,old);let ran=false;await assert.rejects(withFileLock(lock,()=>{ran=true;},options),{code:'FIXTURE_BUSY'});assert.equal(ran,false);assert.equal(await readFile(join(lock,'owner'),'utf8'),String(process.pid));
});
for(const kind of ['missing','empty','malformed'])test('an old '+kind+' owner can recover through the token protocol',async t=>{
  const lock=await fixture(t);await mkdir(lock);if(kind!=='missing')await writeFile(join(lock,'owner'),kind==='empty'?'':'{');const old=new Date(Date.now()-20000);await utimes(lock,old,old);await withFileLock(lock,async()=>{const owner=JSON.parse(await readFile(join(lock,'owner'),'utf8'));assert.equal(owner.pid,process.pid);assert.ok(owner.token);},options);await assert.rejects(stat(lock),{code:'ENOENT'});
});
test('an interrupted dead recovery owner can itself be reclaimed',async t=>{
  const lock=await fixture(t);await mkdir(join(lock,'recovery'),{recursive:true});for(const path of [lock,join(lock,'recovery')])await writeFile(join(path,'owner'),JSON.stringify({pid:2147483647,token:'dead'}));let ran=0;await withFileLock(lock,()=>ran++,options);assert.equal(ran,1);await assert.rejects(stat(lock),{code:'ENOENT'});
});
test('release preserves a replacement directory owned by another token',async t=>{
  const lock=await fixture(t),retired=lock+'-retired';await withFileLock(lock,async()=>{await rename(lock,retired);await mkdir(lock);await writeFile(join(lock,'owner'),JSON.stringify({pid:process.pid,token:'other'}));},options);assert.equal(JSON.parse(await readFile(join(lock,'owner'),'utf8')).token,'other');await stat(retired);
});
test('fresh anonymous locks are not reclaimed and thrown operations release their token',async t=>{
  const lock=await fixture(t);await mkdir(lock);await assert.rejects(withFileLock(lock,()=>{}, {...options,staleMs:1000}),{code:'FIXTURE_BUSY'});await rm(lock,{recursive:true,force:true});await assert.rejects(withFileLock(lock,()=>{throw Error('operation failed');},options),/operation failed/);await assert.rejects(stat(lock),{code:'ENOENT'});
});
