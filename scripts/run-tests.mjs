import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const suite=process.argv[2]||'all';
if(!['all','web','skill'].includes(suite))throw Error('Use: node scripts/run-tests.mjs [web|skill]');
async function run(args){
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});
    child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?1:0)));
  });
  if(code!==0){process.exitCode=code;return false;}return true;
}
const files=[];
if(suite!=='web'){
  if(!await run(['test/prepare-fixtures.mjs']))process.exit(process.exitCode);
  files.push(...(await readdir(new URL('../test/',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'test/'+name));
}
if(suite!=='skill')files.push(...(await readdir(new URL('../test/web/',import.meta.url))).filter(name=>/\.test\.(js|mjs)$/.test(name)).sort().map(name=>'test/web/'+name));
await run(['--test','--test-concurrency=4',...files]);
