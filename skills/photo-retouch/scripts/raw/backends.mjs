import {mkdir,stat,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runRawProcess} from './process.mjs';
import {rawHash,rawError} from './contract.mjs';
import {readFile} from 'node:fs/promises';
const source=new URL('./apple.swift',import.meta.url),pythonScript=fileURLToPath(new URL('./develop.py',import.meta.url));
const python=()=>process.env.FRAMELARK_RAW_PYTHON||fileURLToPath(new URL(process.platform==='win32'?'../../.raw-venv/Scripts/python.exe':'../../.raw-venv/bin/python',import.meta.url));
let appleBuild,probePromise;
export async function appleExecutable(){
  if(!appleBuild)appleBuild=(async()=>{const code=await readFile(source),folder=join(tmpdir(),'framelark-raw-runtime'),binary=join(folder,'apple-'+rawHash(code).slice(0,20));await mkdir(folder,{recursive:true});try{await stat(binary);}catch{const temporary=binary+'.'+randomUUID();try{await runRawProcess('swiftc',['-O','-module-cache-path',join(folder,'swift-cache'),fileURLToPath(source),'-o',temporary],{timeoutMs:180000,json:false});await rename(temporary,binary);}finally{await rm(temporary,{force:true});}}return binary;})();
  return appleBuild;
}
export function backendOrder(platform,available,preferred='auto'){
  if(preferred!=='auto'){if(!['apple','rawpy'].includes(preferred)||!available[preferred])throw rawError('RAW_BACKEND_UNAVAILABLE','所选 RAW 后端不可用。');return [preferred];}
  return (platform==='darwin'?['apple','rawpy']:['rawpy']).filter(name=>available[name]);
}
export async function rawCapabilities({refresh=false}={}){
  if(refresh)probePromise=null;
  if(!probePromise)probePromise=(async()=>{const details={};if(process.platform==='darwin')try{details.apple=await runRawProcess(await appleExecutable(),['--probe'],{timeoutMs:15000});}catch{}
    try{details.rawpy=await runRawProcess(python(),[pythonScript,'--probe'],{timeoutMs:15000});}catch{}
    const order=backendOrder(process.platform,details);return {available:order.length>0,platform:process.platform,preferred:order[0]||null,backends:details,setup:'node skills/photo-retouch/scripts/raw/setup.mjs'};})();return probePromise;
}
let imports=Promise.resolve(),admitted=0;
export function decodeRaw(source,output,{signal,backend='auto'}={}){
  if(admitted>=9)return Promise.reject(rawError('RAW_BUSY','RAW 导入队列已满，请等待当前照片读取完成。'));admitted++;
  const run=imports.catch(()=>{}).then(async()=>{if(signal?.aborted)throw rawError('CANCELLED','RAW 读取已取消。');const caps=await rawCapabilities(),order=backendOrder(process.platform,caps.backends,backend);if(!order.length)throw rawError('RAW_BACKEND_UNAVAILABLE','本机 RAW 解码环境未就绪，请运行 RAW 安装脚本。');let failure;
    for(const name of order){try{return await runRawProcess(name==='apple'?await appleExecutable():python(),name==='apple'?[source,output]:[pythonScript,source,output],{signal});}catch(error){if(error.code==='CANCELLED'||error.code==='RAW_TIMEOUT')throw error;failure=error;}}
    throw failure;}).finally(()=>admitted--);imports=run;return run;
}
