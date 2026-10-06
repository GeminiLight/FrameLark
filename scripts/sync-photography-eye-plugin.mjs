import {mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {buildPlugin,packageFiles,repositoryRoot} from './build-framelark-plugin.mjs';

// GitHub marketplaces need a self-contained plugin folder. Export a generated
// snapshot from the maintained Skill; tests detect stale snapshots in CI.
const built=await buildPlugin({variant:'photography-eye'});
const files=await packageFiles(built.folder);
const target=resolve(repositoryRoot,'plugins/framelark-eye');
await rm(resolve(target,'skills'),{recursive:true,force:true});
for(const file of files){
  const destination=resolve(target,file.name);
  await mkdir(dirname(destination),{recursive:true});
  await writeFile(destination,file.data);
}
console.log(JSON.stringify({ok:true,plugin:built.name,files:files.length,generatedFolder:target,maintainedSkill:'skills/photography-eye'},null,2));
