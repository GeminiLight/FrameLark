import {readFile,writeFile,mkdir,mkdtemp,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {buildPlugin,packageFiles,repositoryRoot} from './build-framelark-plugin.mjs';
import {validateReleaseManifest} from './install-framelark-release.mjs';

export async function buildRelease({root=repositoryRoot,tag,output=resolve(root,'dist/release')}={}){
  const version=JSON.parse(await readFile(join(root,'plugin.json'),'utf8')).version;
  tag??='v'+version;if(tag!=='v'+version)throw Error('Release tag must match the unified plugin version.');
  output=resolve(output);const relation=relative(resolve(root,'dist'),output);if(!relation||relation.startsWith('..')||isAbsolute(relation))throw Error('Release output must be under dist.');
  await mkdir(dirname(output),{recursive:true});
  const stage=await mkdtemp(join(dirname(output),'.release-'));
  try{
    const manifest={schema:1,repository:'GeminiLight/FrameLark',tag,plugins:[]};
    const sha256=data=>createHash('sha256').update(data).digest('hex');
    for(const variant of ['full','photography-eye']){
      const built=await buildPlugin({root,variant,output:join(stage,variant)}),archive=await readFile(built.zipPath),asset=built.name+'-'+built.version+'.zip';
      const files=(await packageFiles(built.folder)).map(file=>({path:file.name,bytes:file.data.length,sha256:sha256(file.data)}));
      await writeFile(join(stage,asset),archive);manifest.plugins.push({name:built.name,version:built.version,asset,bytes:archive.length,sha256:sha256(archive),files});
    }
    const installer=await readFile(join(root,'scripts/install-framelark-release.mjs'));await writeFile(join(stage,'install-framelark.mjs'),installer);
    validateReleaseManifest(manifest,tag);
    manifest.installer={asset:'install-framelark.mjs',bytes:installer.length,sha256:sha256(installer)};
    await writeFile(join(stage,'framelark-release.json'),JSON.stringify(manifest,null,2)+'\n');
    const assets=[...manifest.plugins.map(p=>p.asset),manifest.installer.asset,'framelark-release.json'];
    const checksums=[];for(const name of assets)checksums.push(sha256(await readFile(join(stage,name)))+'  '+name);
    await writeFile(join(stage,'SHA256SUMS'),checksums.join('\n')+'\n');
    // Replace a complete validated asset set, keeping the previous build if promotion fails.
    const backup=output+'.previous-'+randomUUID();let previous=false;
    try{await rename(output,backup);previous=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await rename(stage,output);}catch(error){if(previous)await rename(backup,output);throw error;}
    if(previous)await rm(backup,{recursive:true,force:true});
    return {tag,output,assets:[...assets,'SHA256SUMS'],packages:manifest.plugins.map(({name,version,bytes})=>({name,version,bytes}))};
  }finally{await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){const index=process.argv.indexOf('--tag');console.log(JSON.stringify(await buildRelease({tag:index>=0?process.argv[index+1]:undefined}),null,2));}
