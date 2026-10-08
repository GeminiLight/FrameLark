import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,copyFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

test('lean studio boots with shared policy materials and without native image dependencies',async t=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),stage=await mkdtemp(join(tmpdir(),'framelark-lean-policy-'));
 t.after(()=>rm(stage,{recursive:true,force:true}));
 await mkdir(join(stage,'apps'),{recursive:true});await cp(join(root,'apps/studio'),join(stage,'apps/studio'),{recursive:true});await copyFile(join(root,'package.json'),join(stage,'package.json'));
 const skill=join(stage,'skills/photo-retouch');await mkdir(join(skill,'scripts'),{recursive:true});
 for(const folder of ['policy','references'])await cp(join(root,'skills/photo-retouch',folder),join(skill,folder),{recursive:true});
 await copyFile(join(root,'skills/photo-retouch/scripts/retouch-policy.mjs'),join(skill,'scripts/retouch-policy.mjs'));
 const docker=await readFile(join(root,'Dockerfile'),'utf8');for(const name of ['policy/','references/','scripts/retouch-policy.mjs'])assert.ok(docker.includes('skills/photo-retouch/'+name));
 const script=`const {pathToFileURL}=await import('node:url');const load=name=>import(pathToFileURL(process.cwd()+'/'+name));await load('apps/studio/server/app.mjs');const {loadRetouchPolicy}=await load('skills/photo-retouch/scripts/retouch-policy.mjs');const {ProjectBridge}=await load('apps/studio/server/projects/bridge.mjs');const bridge=new ProjectBridge();const capabilities=await bridge.capabilities();await bridge.close();console.log(JSON.stringify({version:(await loadRetouchPolicy({task:'audit',topics:['detail']})).provenance.version,projects:capabilities.projects}));`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:stage,env:{...process.env,OPENAI_API_KEY:'',OPENAI_MODEL:'',OPENAI_API_URL:''},timeout:15000});
 assert.deepEqual(JSON.parse(stdout),{version:'retouch-policy-2026-10-08-v1',projects:false});
});
