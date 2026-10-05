import {execFileSync,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {buildPlugin} from './build-framelark-plugin.mjs';

const built=await buildPlugin();
function codex(args){
  try{return JSON.parse(execFileSync('codex',[...args,'--json'],{encoding:'utf8',maxBuffer:2_000_000,stdio:['ignore','pipe','inherit']}));}
  catch(error){if(error.code==='ENOENT')throw Error('Install Codex CLI before running plugin:install. See docs/PLUGIN.md.');throw error;}
}
codex(['plugin','marketplace','add',built.marketplaceRoot]);
const installed=codex(['plugin','add','framelark@framelark']);
if(!installed.installedPath)throw Error('Codex did not report the installed plugin path.');
const manifest=JSON.parse(await readFile(join(installed.installedPath,'.codex-plugin/plugin.json'),'utf8'));
if(manifest.name!=='framelark'||manifest.version!==built.version)throw Error('Installed plugin identity differs from the package.');
const setup=join(installed.installedPath,'skills/photo-retouch/scripts/setup.mjs');
const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[setup],{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
if(code!==0)throw Error('The plugin is installed, but retouch dependencies are not ready. Run the installed photo-retouch/scripts/setup.mjs again.');
console.log(JSON.stringify({ok:true,pluginId:installed.pluginId,version:installed.version,installedPath:installed.installedPath,skills:['photography-eye','photo-retouch'],retouchDependencies:'ready',next:'Open a new Codex chat to load the installed plugin.'},null,2));
