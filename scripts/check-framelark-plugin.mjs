import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {buildPlugin,packageFiles,repositoryRoot} from './build-framelark-plugin.mjs';

const built=await buildPlugin();
const portable=JSON.parse(await readFile(resolve(built.folder,'plugin.json'),'utf8'));
const codex=JSON.parse(await readFile(resolve(built.folder,'.codex-plugin/plugin.json'),'utf8'));
assert.equal(portable.name,'framelark');assert.equal(codex.name,portable.name);assert.equal(codex.version,portable.version);
assert.equal(codex.skills,'./skills/');assert.deepEqual(codex.interface,portable.extensions['com.openai'].interface);
assert.ok(!codex.mcpServers&&!codex.apps&&!codex.hooks,'The unified package does not claim an undeployed service.');
for(const key of ['logo','composerIcon']){
  const path=resolve(built.folder,codex.interface[key]);assert.ok(!relative(built.folder,path).startsWith('..'));
  await readFile(path);
}
const files=await packageFiles(built.folder);
assert.ok(!files.some(file=>/(^|\/)(?:node_modules|\.git|\.env[^/]*|photos|projects|exports|drafts)(\/|$)/.test(file.name)));
for(const skill of ['photo-retouch','photography-eye']){
  const content=await readFile(resolve(built.folder,'skills',skill,'SKILL.md'),'utf8');assert.match(content,new RegExp('^name: '+skill+'$','m'));
  for(const file of files.filter(file=>file.name.startsWith('skills/'+skill+'/')))assert.deepEqual(file.data,await readFile(resolve(repositoryRoot,file.name)),file.name+' differs from its maintained source');
}
const catalog=JSON.parse(await readFile(built.marketplacePath,'utf8'));assert.equal(catalog.name,'framelark');assert.equal(catalog.plugins[0].source.path,'./framelark');
assert.match(await readFile(resolve(built.folder,'skills/photo-retouch/scripts/cli.mjs'),'utf8'),/photo-tools/);
console.log(JSON.stringify({ok:true,skills:['photography-eye','photo-retouch'],files:files.length,zip:built.zipPath,scope:'self-contained skills, manifests and IP logo; no native dependencies or personal data in distribution'},null,2));
