import {lstat,mkdir,readFile,readdir,writeFile,rm,realpath} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,relative,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deflateRawSync} from 'node:zlib';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const excluded=new Set(['node_modules','__pycache__','.DS_Store']);
const payloadRoots=['plugin.json','.codex-plugin','assets','skills/photo-retouch','skills/photography-eye'];
const privateParts=new Set(['node_modules','__pycache__','.DS_Store','.git','.guangjian','.vercel','photos','projects','exports','drafts','artifacts','coverage','dist']);
function isPrivateFile(name){
  return name.split('/').some(part=>privateParts.has(part)||/^\.env(?:\.|$)/.test(part)||/\.(?:log|tmp|pyc)$/.test(part));
}
export async function maintainedPluginFiles(root=repositoryRoot){
  // A local checkout may contain credentials, sessions and photo projects. Only
  // maintained source files are release inputs, even when an ignored file is new.
  const names=execFileSync('git',['ls-files','--cached','-z','--',...payloadRoots],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
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
function zip(files){
  const chunks=[],directory=[];let offset=0,size=0;
  for(const file of files){
    const name=Buffer.from('framelark/'+file.name),data=deflateRawSync(file.data),crc=crc32(file.data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(file.data.length,22);header.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(file.data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(offset,42);
    chunks.push(header,name,data);directory.push(central,name);offset+=header.length+name.length+data.length;size+=central.length+name.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,...directory,end]);
}
export async function buildPlugin({root=repositoryRoot,output=resolve(root,'dist/framelark'),archive=true}={}){
  root=resolve(root);
  output=resolve(output);
  const relation=relative(root,output);
  if(output===root||relation.split(sep)[0]!=='dist')throw Error('Build output must be under this repository’s dist directory.');
  // Read and validate every input before replacing a previously good release.
  const files=await maintainedPluginFiles(root);
  const manifest=JSON.parse(files.find(file=>file.name==='plugin.json')?.data.toString('utf8')||'null');
  const codex=JSON.parse(files.find(file=>file.name==='.codex-plugin/plugin.json')?.data.toString('utf8')||'null');
  if(manifest?.name!=='framelark'||!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)||codex?.name!==manifest.name||codex.version!==manifest.version)throw Error('Plugin manifests must declare the same valid FrameLark release.');
  for(const skill of ['photo-retouch','photography-eye'])if(!files.some(file=>file.name===`skills/${skill}/SKILL.md`))throw Error('Missing maintained Skill: '+skill);
  const marketplace=JSON.parse(await readFile(resolve(root,'.agents/plugins/marketplace.json'),'utf8'));
  marketplace.plugins[0].source.path='./framelark';
  const folder=join(output,'marketplace/framelark');
  await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
  for(const file of files){
    const destination=resolve(folder,file.name);
    await mkdir(resolve(destination,'..'),{recursive:true});
    await writeFile(destination,file.data);
  }
  const catalog=join(output,'marketplace/.agents/plugins/marketplace.json');await mkdir(resolve(catalog,'..'),{recursive:true});await writeFile(catalog,JSON.stringify(marketplace,null,2)+'\n');
  const zipPath=join(output,`framelark-${manifest.version}.zip`);
  if(archive)await writeFile(zipPath,zip(files));
  return {folder,marketplaceRoot:join(output,'marketplace'),marketplacePath:catalog,zipPath:archive?zipPath:null,files:files.length,version:manifest.version};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)console.log(JSON.stringify(await buildPlugin(),null,2));
