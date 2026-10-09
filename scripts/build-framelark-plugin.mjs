import {lstat,mkdir,readFile,readdir,writeFile,rm,realpath,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,relative,join,sep,posix,dirname,basename,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deflateRawSync} from 'node:zlib';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const excluded=new Set(['node_modules','.raw-venv','__pycache__','.DS_Store']);
const payloadRoots=['plugin.json','.codex-plugin','assets','skills/photo-retouch','skills/photography-eye','skills/photo-series'];
const privateParts=new Set(['node_modules','.raw-venv','__pycache__','.DS_Store','.git','.guangjian','.vercel','photos','projects','exports','drafts','artifacts','coverage','dist']);
async function canonicalPath(path){
  try{return await realpath(path);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const parent=dirname(path);if(parent===path)throw error;
    return join(await canonicalPath(parent),basename(path));
  }
}
const contains=(parent,child)=>{const part=relative(parent,child);return !part||!isAbsolute(part)&&part.split(sep)[0]!=='..';};
export async function validateBuildOutput(root,output){
  const destination=await canonicalPath(resolve(output));
  const tracked=execFileSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  // A dist alias may intentionally point to another disk. It must never point
  // into a maintained tree, or promotion could delete that tree as old output.
  const inputs=new Set(['.git',...tracked.map(name=>name.split('/')[0])]);
  const metadata=['--absolute-git-dir','--git-common-dir'].map(option=>resolve(root,execFileSync('git',['rev-parse',option],{cwd:root,encoding:'utf8'}).trim()));
  for(const input of [...inputs].map(name=>join(root,name)).concat(metadata)){
    const source=await canonicalPath(input);
    if(contains(source,destination)||contains(destination,source))throw Error('Build output cannot overlap a maintained source directory or its ancestor: '+output);
  }
}
async function writeOutputLeaf(path,data){
  // Replacing the leaf prevents a regular hardlink from truncating its source.
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,data,{flag:'wx'});await rename(temporary,path);}finally{await rm(temporary,{force:true});}
}
function isPrivateFile(name){
  return name.split('/').some(part=>privateParts.has(part)||/^\.env(?:\.|$)/.test(part)||/\.(?:log|tmp|pyc)$/.test(part));
}
export async function maintainedPluginFiles(root=repositoryRoot,roots=payloadRoots){
  // A local checkout may contain credentials, sessions and photo projects. Only
  // maintained source files are release inputs, even when an ignored file is new.
  const names=execFileSync('git',['ls-files','--cached','-z','--',...roots],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
  const sourceRoot=await realpath(root);
  const files=[];
  for(const name of names){
    if(isPrivateFile(name))throw Error('Local runtime data cannot be distributed: '+name);
    const source=join(root,name);
    if(!(await lstat(source)).isFile()||await realpath(source)!==resolve(sourceRoot,name))throw Error('Plugin payload must contain regular files without linked directories: '+name);
    files.push({name,data:await readFile(source)});
  }
  return files;
}
export function validatePackagedLinks(files){
  const names=new Set(files.map(file=>file.name));
  for(const file of files.filter(file=>file.name.endsWith('.md'))){
    for(const match of file.data.toString('utf8').matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)){
      const target=match[1].split(/\s+["']/)[0].split('#')[0];
      if(!target||/^[a-z][a-z0-9+.-]*:/i.test(target))continue;
      let decoded;try{decoded=decodeURIComponent(target);}catch{throw Error('Invalid packaged Markdown link: '+file.name+' -> '+target);}
      const destination=posix.normalize(posix.join(posix.dirname(file.name),decoded));
      if(decoded.startsWith('/')||destination.startsWith('../')||!names.has(destination))throw Error('Missing packaged Markdown link: '+file.name+' -> '+target);
    }
  }
}
export async function packageFiles(folder,prefix=''){
  const files=[];
  for(const entry of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(excluded.has(entry.name))continue;
    const path=join(folder,entry.name),name=prefix+entry.name;
    if(entry.isSymbolicLink())throw Error('Plugin payload must contain regular files: '+name);
    if(entry.isDirectory())files.push(...await packageFiles(path,name+'/'));
    else if(entry.isFile())files.push({name,data:await readFile(path)});
  }
  return files;
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(files,prefix='framelark'){
  const chunks=[],directory=[];let offset=0,size=0;
  for(const file of files){
    const name=Buffer.from(prefix+'/'+file.name),data=deflateRawSync(file.data),crc=crc32(file.data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(file.data.length,22);header.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(file.data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    chunks.push(header,name,data);directory.push(central,name);offset+=header.length+name.length+data.length;size+=central.length+name.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...directory,end]);
}
export async function buildPlugin({root=repositoryRoot,output,archive=true,variant='full'}={}){
  if(!['full','photography-eye'].includes(variant))throw Error('Unknown plugin variant: '+variant);
  const eyeOnly=variant==='photography-eye',name=eyeOnly?'framelark-eye':'framelark';
  const skills=eyeOnly?['photography-eye']:['photo-retouch','photography-eye','photo-series'];
  root=resolve(root);
  output=resolve(output||resolve(root,'dist',name));
  const relation=relative(root,output);
  if(output===root||relation.split(sep)[0]!=='dist')throw Error('Build output must be under this repository’s dist directory.');
  await validateBuildOutput(root,output);
  // Read and validate every input before replacing a previously good release.
  const metadataPath='plugins/framelark-eye/.codex-plugin/plugin.json';
  const sourceFiles=await maintainedPluginFiles(root,eyeOnly?['skills/photography-eye',metadataPath]:payloadRoots);
  // Both repository installation and release archives use the conventional
  // skills/<name>/ layout. Skill content has one maintained source.
  let files=sourceFiles.filter(file=>file.name!==metadataPath),manifest,codex;
  if(eyeOnly){
    const source=JSON.parse(sourceFiles.find(file=>file.name===metadataPath)?.data.toString('utf8')||'null');
    if(source?.name!==name||source.skills!=='./skills/')throw Error('Missing valid standalone photography-eye plugin manifest.');
    const {skills:sourceSkills,interface:sourceInterface,...identity}=source;
    const display={...sourceInterface};
    manifest={$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',...identity,extensions:{'com.openai':{interface:display}}};
    codex={...identity,skills:'./skills/',interface:display};
    files.push({name:'plugin.json',data:Buffer.from(JSON.stringify(manifest,null,2)+'\n')},{name:'.codex-plugin/plugin.json',data:Buffer.from(JSON.stringify(codex,null,2)+'\n')});
  }else{
    manifest=JSON.parse(files.find(file=>file.name==='plugin.json')?.data.toString('utf8')||'null');
    codex=JSON.parse(files.find(file=>file.name==='.codex-plugin/plugin.json')?.data.toString('utf8')||'null');
  }
  if(manifest?.name!==name||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)||codex?.name!==manifest.name||codex.version!==manifest.version)throw Error('Plugin manifests must declare the same valid FrameLark release.');
  for(const skill of skills)if(!files.some(file=>file.name===`skills/${skill}/SKILL.md`))throw Error('Missing maintained Skill: '+skill);
  validatePackagedLinks(files);
  const marketplace=JSON.parse(await readFile(resolve(root,'.agents/plugins/marketplace.json'),'utf8'));
  const entry=marketplace.plugins.find(plugin=>plugin.name===name);
  if(!entry)throw Error('Missing plugin marketplace entry: '+name);
  marketplace.plugins=[{...entry,source:{source:'local',path:'./'+name}}];
  if(eyeOnly){marketplace.name=name;marketplace.interface={displayName:'FrameLark 摄影眼'};}
  const folder=join(output,'marketplace',name);
  await validateBuildOutput(root,output);
  await validateBuildOutput(root,folder);
  const catalog=join(output,'marketplace/.agents/plugins/marketplace.json');
  const zipPath=join(output,`${name}-${manifest.version}.zip`);
  await validateBuildOutput(root,catalog);
  if(archive)await validateBuildOutput(root,zipPath);
  await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
  for(const file of files){
    const destination=resolve(folder,file.name);
    await mkdir(resolve(destination,'..'),{recursive:true});
    await writeFile(destination,file.data);
  }
  await validateBuildOutput(root,catalog);await mkdir(resolve(catalog,'..'),{recursive:true});await writeOutputLeaf(catalog,JSON.stringify(marketplace,null,2)+'\n');
  if(archive){await validateBuildOutput(root,zipPath);await writeOutputLeaf(zipPath,zip(files,name));}
  return {name,skills,marketplaceName:marketplace.name,folder,marketplaceRoot:join(output,'marketplace'),marketplacePath:catalog,zipPath:archive?zipPath:null,files:files.length,version:manifest.version};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)console.log(JSON.stringify(await buildPlugin({variant:process.argv.includes('--photography-eye')?'photography-eye':'full'}),null,2));
