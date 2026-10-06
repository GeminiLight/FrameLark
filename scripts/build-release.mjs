import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {buildPlugin,packageFiles,repositoryRoot} from './build-framelark-plugin.mjs';

export async function buildRelease({root=repositoryRoot,tag,output=resolve(root,'dist/release')}={}){
  const version=JSON.parse(await readFile(join(root,'plugin.json'),'utf8')).version;
  tag??='v'+version;if(tag!=='v'+version)throw Error('Release tag must match the unified plugin version.');
  output=resolve(output);const relation=relative(resolve(root,'dist'),output);if(!relation||relation.startsWith('..')||isAbsolute(relation))throw Error('Release output must be under dist.');
  await mkdir(output,{recursive:true});const manifest={schema:1,repository:'GeminiLight/FrameLark',tag,plugins:[]};
  const sha256=data=>createHash('sha256').update(data).digest('hex');
  for(const variant of ['full','photography-eye']){
    const built=await buildPlugin({root,variant,output:join(output,variant)}),archive=await readFile(built.zipPath),asset=built.name+'-'+built.version+'.zip';
    const files=(await packageFiles(built.folder)).map(file=>({path:file.name,bytes:file.data.length,sha256:sha256(file.data)}));
    await writeFile(join(output,asset),archive);manifest.plugins.push({name:built.name,version:built.version,asset,bytes:archive.length,sha256:sha256(archive),files});
  }
  const installer=await readFile(join(root,'scripts/install-framelark-release.mjs'));await writeFile(join(output,'install-framelark.mjs'),installer);
  manifest.installer={asset:'install-framelark.mjs',bytes:installer.length,sha256:sha256(installer)};
  await writeFile(join(output,'framelark-release.json'),JSON.stringify(manifest,null,2)+'\n');
  const assets=[...manifest.plugins.map(p=>p.asset),manifest.installer.asset,'framelark-release.json'];
  const checksums=[];for(const name of assets)checksums.push(sha256(await readFile(join(output,name)))+'  '+name);
  await writeFile(join(output,'SHA256SUMS'),checksums.join('\n')+'\n');
  return {tag,output,assets:[...assets,'SHA256SUMS'],packages:manifest.plugins.map(({name,version,bytes})=>({name,version,bytes}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){const index=process.argv.indexOf('--tag');console.log(JSON.stringify(await buildRelease({tag:index>=0?process.argv[index+1]:undefined}),null,2));}
