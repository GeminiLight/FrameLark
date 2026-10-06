import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,cpSync,writeFileSync,existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,delimiter} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildRelease} from '../../scripts/build-release.mjs';
import {installFrameLarkRelease,validateReleaseManifest,releaseArchiveFiles} from '../../scripts/install-framelark-release.mjs';
const repositoryRoot=fileURLToPath(new URL('../../',import.meta.url)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'framelark-release-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source');await mkdir(source);
 const put=async(path,value)=>{await mkdir(dirname(join(source,path)),{recursive:true});await writeFile(join(source,path),value);};
 for(const path of ['plugin.json','.codex-plugin/plugin.json','.agents/plugins/marketplace.json','plugins/framelark-eye/.codex-plugin/plugin.json'])await put(path,await readFile(join(repositoryRoot,path)));
 await put('scripts/install-framelark-release.mjs',await readFile(join(repositoryRoot,'scripts/install-framelark-release.mjs')));
 await put('assets/framelark-avatar.png','icon');
 for(const skill of ['photography-eye','photo-retouch'])await put('skills/'+skill+'/SKILL.md','---\nname: '+skill+'\n---\nAll source content.');
 await put('skills/photography-eye/assets/xiaozhen.png','eye');
 await put('skills/photo-retouch/assets/visual-cases/example.png','full example');
 await put('skills/photo-retouch/scripts/setup.mjs','console.error("runtime ready");');
 execFileSync('git',['init','--quiet'],{cwd:source});execFileSync('git',['add','.'],{cwd:source});
 const built=await buildRelease({root:source}),manifest=JSON.parse(await readFile(join(built.output,'framelark-release.json'))),archives={};
 for(const pkg of manifest.plugins)archives[pkg.asset]=await readFile(join(built.output,pkg.asset));
 const calls=[],fetches=[],prepared=[],installRoot=join(root,'managed'),marketplaceRoot=join(installRoot,'marketplace');let active=false,existing=[],enabled=true;
 const codex=args=>{
  calls.push(args);
  if(args[1]==='marketplace'&&args[2]==='list')return {marketplaces:existing};
  if(args[1]==='marketplace')return {};
  if(args[1]==='add'){
   const name=args[2].split('@')[0],catalog=JSON.parse(readFileSync(join(marketplaceRoot,'.agents/plugins/marketplace.json'))),entry=catalog.plugins.find(p=>p.name===name),installedPath=join(root,'installed',name);
   mkdirSync(dirname(installedPath),{recursive:true});cpSync(join(marketplaceRoot,entry.source.path),installedPath,{recursive:true});active=true;
   return {pluginId:args[2],installedPath};
  }
  if(args[1]==='list')return {installed:active?[{pluginId:calls.findLast(a=>a[1]==='add')[2],installed:true,enabled}]:[]};
  throw Error('Unexpected operation');
 };
 const fetchImpl=async url=>{fetches.push(url);if(url.endsWith('/framelark-release.json'))return Response.json(manifest);const name=url.split('/').at(-1);return archives[name]?new Response(archives[name]):new Response('',{status:404});};
 const prepareRuntime=async folder=>{prepared.push(folder);await mkdir(join(folder,'skills/photo-retouch/node_modules'),{recursive:true});await writeFile(join(folder,'skills/photo-retouch/node_modules/ready'),'native runtime');};
 return {root,source,built,manifest,archives,calls,fetches,prepared,installRoot,marketplaceRoot,codex,fetchImpl,prepareRuntime,setExisting:value=>existing=value,setEnabled:value=>enabled=value};
}
test('release artifacts contain all examples and no checkout, and full setup is eager',async t=>{
 const f=await fixture(t),result=await installFrameLarkRelease({root:f.installRoot,codex:f.codex,fetchImpl:f.fetchImpl,prepareRuntime:f.prepareRuntime});
 assert.equal(result.source,'github-release');assert.equal(result.retouchDependencies,'ready');assert.equal(f.prepared.length,2);assert.ok(f.prepared[0].includes('.install-'));assert.equal(f.prepared[1],result.installedPath);
 assert.equal(await readFile(join(result.installedPath,'skills/photo-retouch/assets/visual-cases/example.png'),'utf8'),'full example');
 await stat(join(result.installedPath,'skills/photo-retouch/node_modules/ready'));assert.ok(!await stat(join(f.marketplaceRoot,'releases',f.built.tag,'framelark/skills/photo-retouch/node_modules')).catch(()=>null),'Source cache never keeps a duplicate native runtime');
 assert.ok(f.fetches.every(url=>!url.includes('api.github.com')&&!url.includes('raw.githubusercontent.com')&&!url.endsWith('.git')));assert.ok(!f.calls.some(args=>args.includes('GeminiLight/FrameLark')));
 assert.deepEqual(f.calls.find(args=>args[1]==='marketplace'&&args[2]==='add'),['plugin','marketplace','add',f.marketplaceRoot]);
});
test('photography-eye installs only its release archive and repeat registration preserves the other entry',async t=>{
 const f=await fixture(t);await installFrameLarkRelease({root:f.installRoot,codex:f.codex,fetchImpl:f.fetchImpl,prepareRuntime:f.prepareRuntime});f.setExisting([{name:'framelark',root:f.marketplaceRoot}]);f.prepared.length=0;
 const eye=await installFrameLarkRelease({photographyEye:true,root:f.installRoot,codex:f.codex,fetchImpl:f.fetchImpl,prepareRuntime:f.prepareRuntime});assert.deepEqual(eye.skills,['photography-eye']);assert.equal(f.prepared.length,0);
 const catalog=JSON.parse(await readFile(join(f.marketplaceRoot,'.agents/plugins/marketplace.json')));assert.equal(catalog.plugins.length,2);assert.ok(!f.calls.some(args=>args[2]==='remove'));
});
test('unpublished versions, bad hashes and invalid manifests fail before source registration',async t=>{
 for(const mode of ['missing','hash','manifest']){
  const f=await fixture(t),fetchImpl=async(url,options)=>{if(mode==='missing')return new Response('',{status:404});if(mode==='manifest'&&url.endsWith('framelark-release.json'))return Response.json({...f.manifest,repository:'other/repository'});if(mode==='hash'&&url.endsWith('.zip'))return new Response('bad archive');return f.fetchImpl(url,options);};
  await assert.rejects(installFrameLarkRelease({root:f.installRoot,codex:f.codex,fetchImpl,prepareRuntime:f.prepareRuntime}));assert.equal(f.prepared.length,0);assert.equal(f.calls.length,1);
 }
});
test('runtime preparation failure and source conflicts leave existing registrations unchanged',async t=>{
 const f=await fixture(t);await assert.rejects(installFrameLarkRelease({root:f.installRoot,codex:f.codex,fetchImpl:f.fetchImpl,prepareRuntime:async()=>{throw Error('setup offline');}}),/setup offline/);assert.equal(f.calls.length,1);
 f.calls.length=0;f.setExisting([{name:'framelark',root:join(f.root,'unrelated')}]);await assert.rejects(installFrameLarkRelease({root:f.installRoot,codex:f.codex,fetchImpl:f.fetchImpl,prepareRuntime:f.prepareRuntime}),/已保留原配置/);assert.equal(f.calls.length,1);
});
test('canonical Git migration restores its source if release registration fails',async t=>{
 const f=await fixture(t);execFileSync('git',['remote','add','origin','https://github.com/GeminiLight/FrameLark.git'],{cwd:f.source});f.setExisting([{name:'framelark',root:f.source}]);
 const codex=args=>{if(args[2]==='add'&&args[3]===f.marketplaceRoot){f.calls.push(args);throw Error('registration failed');}return f.codex(args);};
 await assert.rejects(installFrameLarkRelease({root:f.installRoot,codex,fetchImpl:f.fetchImpl,prepareRuntime:f.prepareRuntime}),/registration failed/);assert.deepEqual(f.calls.at(-1),['plugin','marketplace','add',f.source]);
});
test('disabled installation never reports success and immutable cache changes are preserved',async t=>{
 const f=await fixture(t);f.setEnabled(false);await assert.rejects(installFrameLarkRelease({photographyEye:true,root:f.installRoot,codex:f.codex,fetchImpl:f.fetchImpl}),/未启用/);
 const cache=join(f.marketplaceRoot,'releases',f.built.tag,'framelark-eye/skills/photography-eye/SKILL.md');await writeFile(cache,'local change');f.setEnabled(true);
 await assert.rejects(installFrameLarkRelease({photographyEye:true,root:f.installRoot,codex:f.codex,fetchImpl:f.fetchImpl}),/缓存发生变化/);assert.equal(await readFile(cache,'utf8'),'local change');
});
test('ZIP traversal, overlap, unexpected roots and oversized expansion are rejected',async t=>{
 const f=await fixture(t),pkg=f.manifest.plugins[0],original=f.archives[pkg.asset];
 const bad=Buffer.from(original),name=bad.subarray(30,30+bad.readUInt16LE(26)).toString('utf8'),replacement=name.replace('framelark/','../escape/');
 assert.equal(replacement.length,name.length);bad.write(replacement,30);const position=bad.indexOf(name,bad.readUInt32LE(bad.length-22+16));bad.write(replacement,position);assert.throws(()=>releaseArchiveFiles(bad,{...pkg,sha256:hash(bad)}));
 assert.throws(()=>validateReleaseManifest({...f.manifest,plugins:f.manifest.plugins.map((p,i)=>i?p:{...p,files:[{path:'../escape',bytes:1,sha256:'a'.repeat(64)}]})},f.built.tag));
 assert.throws(()=>validateReleaseManifest({...f.manifest,plugins:f.manifest.plugins.map((p,i)=>i?p:{...p,files:[{path:'skills/photo-retouch/huge',bytes:40*1024*1024,sha256:'a'.repeat(64)}]})},f.built.tag));
});
test('bootstrap executes from stdin without a checkout or external Node modules',async t=>{
 const f=await fixture(t),bin=join(f.root,'bin');await mkdir(bin);
 await writeFile(join(bin,'codex'),`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2),root=${JSON.stringify(f.installRoot)},market=path.join(root,'marketplace'),base=${JSON.stringify(join(f.root,'cli-installed'))};
if(args[1]==='marketplace'&&args[2]==='list')console.log('{"marketplaces":[]}');
else if(args[1]==='marketplace')console.log('{}');
else if(args[1]==='add'){const name=args[2].split('@')[0],target=path.join(base,name),catalog=JSON.parse(fs.readFileSync(path.join(market,'.agents/plugins/marketplace.json'))),entry=catalog.plugins.find(p=>p.name===name);fs.cpSync(path.join(market,entry.source.path),target,{recursive:true});console.log(JSON.stringify({pluginId:args[2],installedPath:target}));}
else if(args[1]==='list')console.log('{"installed":[{"pluginId":"framelark@framelark","installed":true,"enabled":true},{"pluginId":"framelark-eye@framelark","installed":true,"enabled":true}]}');else process.exit(1);
`);await chmod(join(bin,'codex'),0o755);
 const archive=f.manifest.plugins[0],prelude=`globalThis.fetch=async url=>url.endsWith('framelark-release.json')?Response.json(${JSON.stringify(f.manifest)}):new Response(Buffer.from((${JSON.stringify(Object.fromEntries(Object.entries(f.archives).map(([name,bytes])=>[name,bytes.toString('base64')])))} )[url.split('/').at(-1)],'base64'));\n`;
 const code=await readFile(join(repositoryRoot,'scripts/install-framelark-release.mjs'),'utf8'),result=spawnSync(process.execPath,['--input-type=module'],{cwd:f.root,input:prelude+code,encoding:'utf8',env:{...process.env,FRAMELARK_INSTALL_ROOT:f.installRoot,PATH:bin+delimiter+process.env.PATH}});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).retouchDependencies,'ready');assert.match(result.stderr,/runtime ready/);
 const inline=prelude+'await import('+JSON.stringify('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))+');';const eye=spawnSync(process.execPath,['--input-type=module','-e',inline,'--','--photography-eye'],{cwd:f.root,encoding:'utf8',env:{...process.env,FRAMELARK_INSTALL_ROOT:f.installRoot,PATH:bin+delimiter+process.env.PATH}});assert.equal(eye.status,0,eye.stderr);assert.equal(JSON.parse(eye.stdout).pluginId,'framelark-eye@framelark');assert.equal(JSON.parse(eye.stdout).retouchDependencies,'not-required');
});
