import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),skill=fileURLToPath(new URL('../skills/photo-retouch/',import.meta.url));

test('a standalone skill executes through a linked path instead of silently exiting',async t=>{
  const temporary=await mkdtemp(join(tmpdir(),'framelark-entrypoint-')),linked=join(temporary,'linked-skill');
  t.after(()=>rm(temporary,{recursive:true,force:true}));
  await symlink(skill,linked,process.platform==='win32'?'junction':'dir');
  for(const [script,args] of [['cli.mjs',['help']],['knowledge.mjs',['check']]]){
    const result=await exec(process.execPath,[join(linked,'scripts',script),...args],{cwd:temporary});
    const output=JSON.parse(result.stdout);assert.equal(output.ok,true,script+' runs through the linked entry');
  }
});
