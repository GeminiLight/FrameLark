import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(new URL('../package.json',import.meta.url));
const [major,minor]=process.versions.node.split('.').map(Number);if(major<20||major===20&&minor<9)throw Error('需要 Node.js 20.9 或更高版本，请先更新 Node.js。');
function check(){if(require('sharp').versions.sharp!=='0.35.4'||require('@napi-rs/canvas/package.json').version!=='0.1.100')throw Error('依赖版本需要更新');require('@napi-rs/canvas');}
try{check();console.log('光间本地工具已就绪；无需重复安装。');}
catch{console.log('正在安装光间本地图片处理依赖；不配置模型服务。');const code=await new Promise(resolve=>{const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['ci','--no-audit','--no-fund'],{cwd:root,stdio:'inherit'});child.once('error',()=>resolve(1));child.once('exit',resolve);});if(code!==0)throw Error('依赖未安装完成。请检查网络与 Node.js，然后重新运行 setup.mjs；已有照片项目不会改动。');check();console.log('光间本地工具已就绪。');}
