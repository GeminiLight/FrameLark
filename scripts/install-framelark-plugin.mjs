import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {buildPlugin} from './build-framelark-plugin.mjs';
import {installationGuide} from './installation-guide.mjs';
import {verifyInstalledPlugin} from './install-photography-eye.mjs';

function codex(args){
  try{return JSON.parse(execFileSync('codex',[...args,'--json'],{encoding:'utf8',maxBuffer:2_000_000,stdio:['ignore','pipe','inherit']}));}
  catch(error){if(error.code==='ENOENT')throw Error('Install Codex CLI before running plugin:install. See docs/PLUGIN.md.');throw error;}
}
try{execFileSync('codex',['plugin','add','--help'],{stdio:'ignore'});}
catch{throw Error('需要支持插件的 Codex CLI。先运行 codex plugin --help；安装或更新说明见 https://learn.chatgpt.com/docs/codex/cli 。');}
const built=await buildPlugin({variant:process.argv.includes('--photography-eye')?'photography-eye':'full'});
const current=codex(['plugin','marketplace','list']).marketplaces.find(item=>item.name===built.marketplaceName);
// Installing from this checkout explicitly selects its clean local build.
// Other marketplace names and existing standalone skills are not modified.
if(current&&(!current.root||resolve(current.root)!==resolve(built.marketplaceRoot)))codex(['plugin','marketplace','remove',built.marketplaceName]);
codex(['plugin','marketplace','add',built.marketplaceRoot]);
const installed=codex(['plugin','add',built.name+'@'+built.marketplaceName]);
const names=built.skills;
const verified=await verifyInstalledPlugin({pluginId:built.name+'@'+built.marketplaceName,installedPath:installed.installedPath,skills:names,version:built.version,codex});
let code=0;
if(names.includes('photo-retouch')){
  const setup=join(installed.installedPath,'skills/photo-retouch/scripts/setup.mjs');
  code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[setup],{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
}
const guide=installationGuide({names,retouchReady:names.includes('photo-retouch')&&code===0,version:verified.version});
if(code!==0){
  console.error(guide.message);
  throw Error('插件已安装，但本地修图依赖未就绪。请检查 Node.js 与网络后重新运行 npm run plugin:install，或请当前 Agent 准备照片精修依赖。');
}
console.log(JSON.stringify({ok:true,...verified,retouchDependencies:names.includes('photo-retouch')?'ready':'not-required',next:'Open a new Codex chat to load the installed plugin.',gettingStarted:guide},null,2));
console.error(guide.message);
