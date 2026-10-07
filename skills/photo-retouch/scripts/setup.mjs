import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {promisify} from 'node:util';
import {trimPlatformRuntime} from './platform-runtime.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<20||major===20&&minor<9)throw Error('需要 Node.js 20.9 或更高版本，请先更新 Node.js。');

// Native modules are loaded only in a short-lived child. The setup process must
// not retain old require caches or Windows DLL handles while npm replaces them.
if(process.argv.includes('--probe')){
  const require=createRequire(new URL('../package.json',import.meta.url));
  if(require('sharp').versions.sharp!=='0.35.4'||require('@napi-rs/canvas/package.json').version!=='0.1.100')throw Error('依赖版本需要更新');
  require('@napi-rs/canvas');
  console.log(JSON.stringify({loaded:Object.keys(require.cache)}));
}else{
  const exec=promisify(execFile);
  const probe=async()=>JSON.parse((await exec(process.execPath,[fileURLToPath(import.meta.url),'--probe'],{cwd:root,maxBuffer:2_000_000})).stdout);
  let readiness,installed=false;
  try{readiness=await probe();}
  catch{
    console.log('正在安装帧好本地图片处理依赖；不配置模型服务。');
    const npmCLI=process.platform==='win32'?[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')].find(path=>path&&existsSync(path)):null;
    if(process.platform==='win32'&&!npmCLI)throw Error('找不到 npm，请检查 Node.js 安装。');
    const code=await new Promise(resolve=>{
      const child=spawn(npmCLI?process.execPath:'npm',[...(npmCLI?[npmCLI]:[]),'ci','--no-audit','--no-fund'],{cwd:root,stdio:'inherit'});
      child.once('error',()=>resolve(1));child.once('exit',resolve);
    });
    if(code!==0)throw Error('依赖未安装完成。请检查网络与 Node.js，然后重新运行 setup.mjs；已有照片项目不会改动。');
    try{readiness=await probe();}catch(error){throw Error('安装后的图片处理依赖校验失败，请检查 Node.js 与平台支持；已有照片项目保留。',{cause:error});}
    installed=true;
  }
  const trimmed=await trimPlatformRuntime(root,{loaded:readiness.loaded});
  if(trimmed.removed.length){
    try{await probe();}catch(error){throw Error('平台依赖校验失败，请重新运行 setup.mjs；已有照片项目保留。',{cause:error});}
    console.log('已移除本平台无需使用的依赖：'+trimmed.removed.join('、'));
  }
  console.log(installed?'帧好本地工具已就绪。':'帧好本地工具已就绪；无需重复安装。');
}
