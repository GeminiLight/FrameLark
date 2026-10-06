import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const folder=fileURLToPath(new URL('../../.raw-venv',import.meta.url)),python=process.platform==='win32'?folder+'/Scripts/python.exe':folder+'/bin/python';
const run=(cmd,args)=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code?reject(Error('RAW 环境安装未完成')):resolve());});
await run(process.env.FRAMELARK_PYTHON||'python3',['-m','venv',folder]);
await run(python,['-m','pip','install','rawpy==0.27.1','numpy>=2.0,<3']);
console.log('LibRaw/rawpy 已安装到项目独立环境。macOS 会优先探测 CIRAWFilter。');
