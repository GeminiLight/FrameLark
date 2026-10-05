import {cp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {resolve,relative,join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deflateRawSync} from 'node:zlib';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const excluded=new Set(['node_modules','__pycache__','.DS_Store']);
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
export async function buildPlugin({output=resolve(repositoryRoot,'dist/framelark'),archive=true}={}){
  output=resolve(output);
  const relation=relative(repositoryRoot,output);
  if(output===repositoryRoot||relation.split(sep)[0]!=='dist')throw Error('Build output must be under this repository’s dist directory.');
  const folder=join(output,'marketplace/framelark');
  await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
  for(const name of ['plugin.json','.codex-plugin','assets','skills/photo-retouch','skills/photography-eye']){
    await mkdir(resolve(folder,name,'..'),{recursive:true});
    await cp(resolve(repositoryRoot,name),resolve(folder,name),{recursive:true,filter:path=>!path.split(/[\\/]/).some(part=>excluded.has(part))});
  }
  const marketplace=JSON.parse(await readFile(resolve(repositoryRoot,'.agents/plugins/marketplace.json'),'utf8'));
  marketplace.plugins[0].source.path='./framelark';
  const catalog=join(output,'marketplace/.agents/plugins/marketplace.json');await mkdir(resolve(catalog,'..'),{recursive:true});await writeFile(catalog,JSON.stringify(marketplace,null,2)+'\n');
  const manifest=JSON.parse(await readFile(join(folder,'plugin.json'),'utf8'));
  const files=await packageFiles(folder),zipPath=join(output,`framelark-${manifest.version}.zip`);
  if(archive)await writeFile(zipPath,zip(files));
  return {folder,marketplaceRoot:join(output,'marketplace'),marketplacePath:catalog,zipPath:archive?zipPath:null,files:files.length,version:manifest.version};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await buildPlugin(),null,2));
