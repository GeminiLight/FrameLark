import {execFileSync,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildPlugin} from './build-framelark-plugin.mjs';
import {installationGuide} from './installation-guide.mjs';

function codex(args){
  try{return JSON.parse(execFileSync('codex',[...args,'--json'],{encoding:'utf8',maxBuffer:2_000_000,stdio:['ignore','pipe','inherit']}));}
  catch(error){if(error.code==='ENOENT')throw Error('Install Codex CLI before running plugin:install. See docs/PLUGIN.md.');throw error;}
}
try{execFileSync('codex',['plugin','add','--help'],{stdio:'ignore'});}
catch{throw Error('需要支持插件的 Codex CLI。先运行 codex plugin --help；安装或更新说明见 https://learn.chatgpt.com/docs/codex/cli 。');}
const built=await buildPlugin();
const current=codex(['plugin','marketplace','list']).marketplaces.find(item=>item.name==='framelark');
// Installing from this checkout explicitly selects its clean local build.
// Other marketplace names and existing standalone skills are not modified.
if(current&&(!current.root||resolve(current.root)!==resolve(built.marketplaceRoot)))codex(['plugin','marketplace','remove','framelark']);
codex(['plugin','marketplace','add',built.marketplaceRoot]);
const installed=codex(['plugin','add','framelark@framelark']);
if(!installed.installedPath)throw Error('Codex did not report the installed plugin path.');
const manifest=JSON.parse(await readFile(join(installed.installedPath,'.codex-plugin/plugin.json'),'utf8'));
if(manifest.name!=='framelark'||manifest.version!==built.version)throw Error('Installed plugin identity differs from the package.');
const setup=join(installed.installedPath,'skills/photo-retouch/scripts/setup.mjs');
const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[setup],{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
const names=['photography-eye','photo-retouch'];
const guide=installationGuide({names,retouchReady:code===0,version:manifest.version});
if(code!==0){
  console.error(guide.message);
  throw Error('插件已安装，但本地修图依赖未就绪。请检查 Node.js 与网络后重新运行 npm run plugin:install，或请当前 Agent 准备照片精修依赖。');
}
console.log(JSON.stringify({ok:true,pluginId:installed.pluginId,version:installed.version,installedPath:installed.installedPath,skills:names,retouchDependencies:'ready',next:'Open a new Codex chat to load the installed plugin.',gettingStarted:guide},null,2));
console.error(guide.message);
