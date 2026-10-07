import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {trimPlatformRuntime} from './platform-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(new URL('../package.json',import.meta.url));
const [major,minor]=process.versions.node.split('.').map(Number);if(major<20||major===20&&minor<9)throw Error('需要 Node.js 20.9 或更高版本，请先更新 Node.js。');
function check(){if(require('sharp').versions.sharp!=='0.35.4'||require('@napi-rs/canvas/package.json').version!=='0.1.100')throw Error('依赖版本需要更新');require('@napi-rs/canvas');}
try{await import('sharp');await import('@napi-rs/canvas');check();console.log('帧好本地工具已就绪；无需重复安装。');}
catch{console.log('正在安装帧好本地图片处理依赖；不配置模型服务。');const npmCLI=process.platform==='win32'?[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')].find(path=>path&&existsSync(path)):null;if(process.platform==='win32'&&!npmCLI)throw Error('找不到 npm，请检查 Node.js 安装。');const code=await new Promise(resolve=>{const child=spawn(npmCLI?process.execPath:'npm',[...(npmCLI?[npmCLI]:[]),'ci','--no-audit','--no-fund'],{cwd:root,stdio:'inherit'});child.once('error',()=>resolve(1));child.once('exit',resolve);});if(code!==0)throw Error('依赖未安装完成。请检查网络与 Node.js，然后重新运行 setup.mjs；已有照片项目不会改动。');check();console.log('帧好本地工具已就绪。');}
const trimmed=await trimPlatformRuntime(root,{loaded:Object.keys(require.cache)});
if(trimmed.removed.length){
  const code=await new Promise(resolve=>{const child=spawn(process.execPath,['-e','require("sharp");require("@napi-rs/canvas");'],{cwd:root,stdio:'inherit'});child.once('error',()=>resolve(1));child.once('exit',resolve);});
  if(code!==0)throw Error('平台依赖校验失败，请重新运行 setup.mjs；已有照片项目保留。');
  console.log('已移除本平台无需使用的依赖：'+trimmed.removed.join('、'));
}
