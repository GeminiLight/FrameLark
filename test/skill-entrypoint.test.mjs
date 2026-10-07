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
  for(const [script,args] of [['cli.mjs',['help']],['cli.mjs',['controls']],['knowledge.mjs',['check']]]){
    const result=await exec(process.execPath,[join(linked,'scripts',script),...args],{cwd:temporary});
    const output=JSON.parse(result.stdout);assert.equal(output.ok,true,script+' runs through the linked entry');
    if(args[0]==='controls'){
      assert.deepEqual(output.parameters.find(parameter=>parameter.key==='exposure').range,[-1.5,1.5]);
      assert.ok(output.styles.length>0);
      const exposure=output.grayCardReference.find(reference=>reference.settings.exposure===1);
      assert.ok(exposure.encodedRGB[1][0]>128);
      assert.equal(output.project,undefined,'controls do not need a photo project');
    }
  }
});
