import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,utimes} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runCLI} from '../skills/photo-retouch/scripts/cli.mjs';

async function fixture(t,subject='night'){
 const root=await mkdtemp(join(tmpdir(),'framelark-profile-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const project=join(root,'photo'),profile=join(root,'profile.json'),input=join(root,'input.json');
 const photo=fileURLToPath(new URL('../docs/specs/evidence/shared-retouch-20261008/night.png',import.meta.url));
 const created=await runCLI(['init','--image',photo,'--project',project]);
 async function call(command,value){
   const args=[command,'--project',project,'--profile',profile];
   if(value!==undefined){await writeFile(input,JSON.stringify(value));args.push('--input',input);}
   return runCLI(args);
 }
 const feedback=await call('feedback',{revision:created.project.revision,versionId:created.project.currentId,verdict:'prefer',reason:'固定测试选择，非真实用户档案'});
 await call('profile-init');
 const learning={revision:feedback.project.revision,versionId:feedback.project.currentId,subject,lighting:'night',reason:'固定测试偏好'};
 const learned=await call('profile-learn',learning);return {profile,call,entry:learned.entry,learning};
}
test('public profile-edit preserves a readable preference when its subject grows beyond 80 characters',async t=>{
 const f=await fixture(t),subject='s'.repeat(81);
 await f.call('profile-edit',{id:f.entry.id,subject});
 const read=await f.call('profile-read');assert.equal(read.profile.entries[0].subject,subject);
 await f.call('profile-edit',{id:f.entry.id,remove:true});assert.equal((await f.call('profile-read')).profile.entries.length,0);
});
test('a previously written 120-character subject is read without truncation and can be explicitly corrected',async t=>{
 const f=await fixture(t),legacy=JSON.parse(await readFile(f.profile,'utf8'));legacy.entries[0].subject='旧'.repeat(120);
 await writeFile(f.profile,JSON.stringify(legacy));const before=await readFile(f.profile);
 const read=await f.call('profile-read');assert.equal(read.profile.entries[0].subject,legacy.entries[0].subject);assert.deepEqual(await readFile(f.profile),before);
 await f.call('profile-edit',{id:f.entry.id,subject:'夜景'});assert.equal((await f.call('profile-read')).profile.entries[0].subject,'夜景');
});
test('learning and editing share the subject boundary and reject overlong values before changing the file',async t=>{
 const f=await fixture(t,'s'.repeat(120)),before=await readFile(f.profile);
 assert.equal((await f.call('profile-read')).profile.entries[0].subject.length,120);
 await assert.rejects(f.call('profile-edit',{id:f.entry.id,subject:'s'.repeat(121)}),{code:'PROFILE_INVALID'});
 await assert.rejects(f.call('profile-learn',{...f.learning,subject:'s'.repeat(121)}),{code:'PROFILE_INVALID'});
 assert.deepEqual(await readFile(f.profile),before);
});
async function existingArchive(f,{unicode=false,pretty=false}={}){
 const p=JSON.parse(await readFile(f.profile,'utf8'));
 p.entries=Array.from({length:500},(_,i)=>({...structuredClone(f.entry),id:'entry-'+i,projectId:'project-'+i,versionId:'version-'+i,evidenceId:'evidence-'+i,intent:'test',reason:(unicode?'偏':'r').repeat(unicode?400:500),evidence:{source:'user-feedback',reason:(unicode?'偏':'r').repeat(unicode?400:500)}}));
 const compact=JSON.stringify(p);await writeFile(f.profile,pretty?JSON.stringify(p,null,2):compact);return {p,compact};
}
test('editing a readable large archive saves compact bytes that can be read again',async t=>{
 const f=await fixture(t),{compact}=await existingArchive(f);assert.ok(Buffer.byteLength(compact)<1024*1024);
 await f.call('profile-read');await f.call('profile-edit',{id:'entry-0',reason:'edited'});
 assert.ok((await readFile(f.profile)).length<Buffer.byteLength(compact));
 assert.equal((await f.call('profile-read')).profile.entries.length,500);
});
test('an oversized legacy pretty archive can be read unchanged and recovered with an explicit deletion',async t=>{
 const f=await fixture(t);await existingArchive(f,{pretty:true});const before=await readFile(f.profile);assert.ok(before.length>1024*1024);
 assert.equal((await f.call('profile-read')).profile.entries.length,500);assert.deepEqual(await readFile(f.profile),before);
 await f.call('profile-edit',{id:'entry-0',remove:true});assert.ok((await readFile(f.profile)).length<=1024*1024);
 assert.equal((await f.call('profile-read')).profile.entries.length,499);
});
test('a legacy Unicode archive larger than one MiB remains readable and supports ordinary single-record edits and deletion',async t=>{
 const f=await fixture(t),{compact}=await existingArchive(f,{unicode:true});
 assert.ok(compact.length<1024*1024);assert.ok(Buffer.byteLength(compact)>1024*1024);
 assert.equal((await f.call('profile-read')).profile.entries.length,500);
 await f.call('profile-edit',{id:'entry-0',reason:'edited'});assert.equal((await f.call('profile-read')).profile.entries[0].reason,'edited');
 await f.call('profile-edit',{id:'entry-0',remove:true});assert.equal((await f.call('profile-read')).profile.entries.length,499);
});
test('the same UTF-8 budget rejects a growing archive before changing its existing bytes',async t=>{
 const f=await fixture(t),p=JSON.parse(await readFile(f.profile,'utf8'));
 p.retainedMetadata='x'.repeat(8*1024*1024-Buffer.byteLength(JSON.stringify(p))-100);
 await writeFile(f.profile,JSON.stringify(p));const before=await readFile(f.profile);
 assert.ok(before.length<8*1024*1024);assert.equal((await f.call('profile-read')).profile.entries.length,1);
 await assert.rejects(f.call('profile-edit',{id:f.entry.id,reason:'偏'.repeat(600)}),{code:'PROFILE_SIZE'});
 assert.deepEqual(await readFile(f.profile),before);
});
test('compatibility reads remain bounded before parsing an unreasonably large file',async t=>{
 const f=await fixture(t);await writeFile(f.profile,' '.repeat(8*1024*1024+1));
 await assert.rejects(f.call('profile-read'),{code:'PROFILE_INVALID'});
});
async function stoppedProfileUpdater(t,f){
 const p=JSON.parse(await readFile(f.profile,'utf8'));p.retainedMetadata='x'.repeat(7*1024*1024);await writeFile(f.profile,JSON.stringify(p));
 await f.call('profile-read');
 const input=f.profile+'.edit.json';await writeFile(input,JSON.stringify({id:f.entry.id,reason:'interrupted write'}));
 const cli=fileURLToPath(new URL('../skills/photo-retouch/scripts/cli.mjs',import.meta.url));
 const child=spawn(process.execPath,[cli,'profile-edit','--profile',f.profile,'--input',input],{stdio:'ignore'});
 const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));t.after(async()=>{child.kill('SIGKILL');await exited;});
 let stopped=false;
 for(let n=0;n<1000&&!stopped;n++){
   if(await stat(f.profile+'.lock').catch(e=>{if(e.code==='ENOENT')return null;throw e;})){stopped=child.kill('SIGSTOP');break;}
   await new Promise(resolve=>setTimeout(resolve,1));
 }
 assert.ok(stopped,'the real CLI updater must acquire its profile lock');
 assert.ok((await stat(f.profile+'.lock')).isDirectory());return {child,exited};
}
test('public profile editing recovers after the real updater dies while holding its lock',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),{child,exited}=await stoppedProfileUpdater(t,f),before=await readFile(f.profile);
 child.kill('SIGKILL');assert.equal((await exited).signal,'SIGKILL');
 // Legacy profile locks have no owner. Advance their recovery age without a
 // five-second sleep; active writer locks below retain their actual timestamp.
 const stale=new Date(Date.now()-10_000);await utimes(f.profile+'.lock',stale,stale);
 assert.deepEqual(await readFile(f.profile),before);assert.equal((await f.call('profile-read')).profile.entries.length,1);
 await f.call('profile-edit',{id:f.entry.id,reason:'recovered write'});
 assert.equal((await f.call('profile-read')).profile.entries[0].reason,'recovered write');
 await f.call('profile-edit',{id:f.entry.id,remove:true});assert.equal((await f.call('profile-read')).profile.entries.length,0);
});
test('an active profile updater remains mutually exclusive and does not change saved preferences',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t);await stoppedProfileUpdater(t,f);const before=await readFile(f.profile);
 await assert.rejects(f.call('profile-edit',{id:f.entry.id,reason:'another writer'}),{code:'PROFILE_BUSY'});
 assert.deepEqual(await readFile(f.profile),before);
});
test('a stale legacy profile lock without owner metadata can be recovered by an ordinary edit',async t=>{
 const f=await fixture(t),lock=f.profile+'.lock';await mkdir(lock);const stale=new Date(Date.now()-10_000);await utimes(lock,stale,stale);
 await f.call('profile-edit',{id:f.entry.id,reason:'legacy recovery'});
 assert.equal((await f.call('profile-read')).profile.entries[0].reason,'legacy recovery');
});
