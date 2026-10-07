import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm,chmod,access} from 'node:fs/promises';
import {join,dirname,delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {inflateRawSync} from 'node:zlib';
import {buildPlugin,packageFiles,repositoryRoot} from '../../scripts/build-framelark-plugin.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'framelark-eye-plugin-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const put=async(name,data)=>{await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),data);};
  for(const name of ['plugin.json','.codex-plugin/plugin.json'])await put(name,await readFile(join(repositoryRoot,name)));
  await put('.agents/plugins/marketplace.json',JSON.stringify({name:'framelark',plugins:[
    {name:'framelark',source:{source:'local',path:'./'},policy:{installation:'AVAILABLE',authentication:'ON_USE'},category:'Creativity'},
    {name:'framelark-eye',source:{source:'local',path:'./plugins/framelark-eye'},policy:{installation:'AVAILABLE',authentication:'ON_USE'},category:'Creativity'}
  ]}));
  await put('assets/framelark-avatar.png','full plugin icon');
  await put('skills/photo-retouch/SKILL.md','---\nname: photo-retouch\n---\nFull retouch workflow.');
  await put('skills/photo-series/SKILL.md','---\nname: photo-series\n---\nSeries workflow using the bundled retouch runtime.');
  await put('skills/photo-retouch/package.json','{"dependencies":{"sharp":"0.35.4"}}');
  await put('skills/photo-retouch/scripts/setup.mjs',"import {writeFileSync} from 'node:fs'; writeFileSync("+JSON.stringify(join(root,'retouch-setup-ran'))+",'ran');");
  await put('skills/photography-eye/SKILL.md','---\nname: photography-eye\n---\nSee [guide](references/guide.md) and [bird](assets/xiaozhen.png).');
  await put('skills/photography-eye/references/guide.md','The maintained photography guide.');
  await put('skills/photography-eye/assets/xiaozhen.png','eye icon');
  await put('plugins/framelark-eye/.codex-plugin/plugin.json',JSON.stringify({name:'framelark-eye',version:'0.1.0',description:'Photography guidance only.',skills:'./skills/',interface:{displayName:'FrameLark 摄影眼',logo:'./skills/photography-eye/assets/xiaozhen.png',composerIcon:'./skills/photography-eye/assets/xiaozhen.png',defaultPrompt:['这里咋拍？']}}));
  execFileSync('git',['init','--quiet'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
  return {root,put};
}
function archiveEntries(bytes){
  const files=[];let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28),start=offset+30+length+extra;
    files.push({name:bytes.subarray(offset+30,offset+30+length).toString('utf8'),data:inflateRawSync(bytes.subarray(start,start+size))});offset=start+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);return files;
}

test('standalone photography plugin preserves the maintained skill and excludes retouching from folder and ZIP',async t=>{
  const {root}=await fixture(t),built=await buildPlugin({root,variant:'photography-eye'});
  const files=await packageFiles(built.folder),portable=JSON.parse(await readFile(join(built.folder,'plugin.json'))),native=JSON.parse(await readFile(join(built.folder,'.codex-plugin/plugin.json')));
  assert.equal(portable.name,'framelark-eye');assert.equal(native.name,portable.name);assert.equal(native.skills,'./skills/');
  assert.deepEqual(files.filter(f=>f.name.endsWith('/SKILL.md')).map(f=>f.name),['skills/photography-eye/SKILL.md']);
  assert.ok(!files.some(f=>f.name.includes('photo-retouch')||f.name.endsWith('package.json')||f.name.includes('node_modules')));
  for(const name of ['SKILL.md','references/guide.md','assets/xiaozhen.png'])assert.deepEqual(await readFile(join(built.folder,'skills/photography-eye',name)),await readFile(join(root,'skills/photography-eye',name)));
  for(const key of ['logo','composerIcon'])await access(join(built.folder,portable.extensions['com.openai'].interface[key]));
  const archive=archiveEntries(await readFile(built.zipPath));
  assert.deepEqual(archive.map(f=>f.name).sort(),files.map(f=>'framelark-eye/'+f.name).sort());
  for(const f of files)assert.deepEqual(archive.find(a=>a.name==='framelark-eye/'+f.name).data,f.data);
  const catalog=JSON.parse(await readFile(built.marketplacePath));assert.equal(catalog.name,'framelark-eye');assert.equal(catalog.plugins.length,1);assert.equal(catalog.plugins[0].source.path,'./framelark-eye');
  const full=await buildPlugin({root});assert.ok((await packageFiles(full.folder)).some(f=>f.name==='skills/photo-retouch/SKILL.md'));await access(built.zipPath);
});

test('full plugin includes three independent skill entries',async t=>{
  const {root}=await fixture(t),built=await buildPlugin({root});
  assert.deepEqual([...built.skills].sort(),['photo-retouch','photo-series','photography-eye']);
  const files=await packageFiles(built.folder);
  for(const name of built.skills)await access(join(built.folder,'skills',name,'SKILL.md'));
  assert.deepEqual(files.filter(file=>file.name.endsWith('/SKILL.md')).map(file=>file.name).sort(),built.skills.map(name=>'skills/'+name+'/SKILL.md').sort());
});

test('standalone series installation includes its retouch dependency but leaves photography eye out',async t=>{
  const {root,put}=await fixture(t);
  for(const name of ['install-photo-skill.mjs','installation-guide.mjs','build-framelark-plugin.mjs'])await put('scripts/'+name,await readFile(join(repositoryRoot,'scripts',name)));
  const target=join(root,'installed-skills');
  const result=spawnSync(process.execPath,[join(root,'scripts/install-photo-skill.mjs'),'--skill','photo-series',target],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  await access(join(target,'photo-series/SKILL.md'));await access(join(target,'photo-retouch/SKILL.md'));
  await access(join(root,'retouch-setup-ran'));
  await assert.rejects(access(join(target,'photography-eye')));
});

test('eye-only build never reads tracked retouch configuration',async t=>{
  const {root,put}=await fixture(t);await put('skills/photo-retouch/.env.local','SYNTHETIC_PRIVATE_REVIEW_DATA');execFileSync('git',['add','--force','skills/photo-retouch/.env.local'],{cwd:root});
  const built=await buildPlugin({root,variant:'photography-eye'});assert.ok(!(await readFile(built.zipPath)).includes('SYNTHETIC_PRIVATE_REVIEW_DATA'));
  await assert.rejects(buildPlugin({root}),/Local runtime data cannot be distributed/);
});

test('standalone installer leaves retouch setup untouched and reports one available workflow',async t=>{
  const {root,put}=await fixture(t);
  for(const name of ['build-framelark-plugin.mjs','install-framelark-plugin.mjs','install-photography-eye.mjs','installation-guide.mjs'])await put('scripts/'+name,await readFile(join(repositoryRoot,'scripts',name)));
  await put('bin/codex',`#!/usr/bin/env node
const args=process.argv.slice(2),eye=args.some(a=>a.startsWith('framelark-eye@'));
if(args.includes('marketplace')&&args.includes('list'))console.log(JSON.stringify({marketplaces:[]}));
else if(args.includes('list')){const market=args[args.indexOf('--marketplace')+1],name=market==='framelark-eye'?'framelark-eye':'framelark';console.log(JSON.stringify({installed:[{pluginId:name+'@'+market,installed:true,enabled:true}]}));}
else if(args.includes('add')&&args.includes('plugin')&&!args.includes('marketplace')&&!args.includes('--help'))console.log(JSON.stringify({installedPath:${JSON.stringify(root)}+'/dist/'+(eye?'framelark-eye':'framelark')+'/marketplace/'+(eye?'framelark-eye':'framelark'),pluginId:eye?'framelark-eye@framelark-eye':'framelark@framelark',version:eye?'0.1.0':'0.1.7'}));
else console.log('{}');
`);await chmod(join(root,'bin/codex'),0o755);
  const env={...process.env,PATH:join(root,'bin')+delimiter+process.env.PATH};
  const result=spawnSync(process.execPath,[join(root,'scripts/install-framelark-plugin.mjs'),'--photography-eye'],{cwd:root,env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.deepEqual(output.skills,['photography-eye']);assert.equal(output.installed,true);assert.equal(output.enabled,true);assert.equal(output.retouchDependencies,'not-required');assert.equal(output.gettingStarted.tasks.length,1);
  await assert.rejects(access(join(root,'retouch-setup-ran')));
  const full=spawnSync(process.execPath,[join(root,'scripts/install-framelark-plugin.mjs')],{cwd:root,env,encoding:'utf8'});assert.equal(full.status,0,full.stderr);await access(join(root,'retouch-setup-ran'));
});

test('GitHub marketplace exposes a self-contained photography plugin matching its maintained release',async()=>{
  const catalog=JSON.parse(await readFile(join(repositoryRoot,'.agents/plugins/marketplace.json'))),entry=catalog.plugins.find(plugin=>plugin.name==='framelark-eye');
  assert.ok(entry);const pluginRoot=join(repositoryRoot,entry.source.path),built=await buildPlugin({variant:'photography-eye'});
  const expected=await packageFiles(built.folder),actual=await packageFiles(pluginRoot);
  assert.deepEqual(actual.map(file=>file.name).sort(),expected.map(file=>file.name).sort(),'Run plugin:sync:photography-eye after changing the maintained skill.');
  for(const file of expected)assert.deepEqual(actual.find(item=>item.name===file.name).data,file.data,file.name+' must match the maintained release.');
});
