import {spawn} from 'node:child_process';
import {rawError,rawLimits} from './contract.mjs';
export function runRawProcess(command,args,{signal,timeoutMs=rawLimits.timeoutMs,json=true}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(rawError('CANCELLED','RAW 读取已取消。'));return;}
    const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});let output='',error='',failure,timer,killTimer;
    const stop=reason=>{if(failure)return;failure=reason;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);};
    const abort=()=>stop(rawError('CANCELLED','RAW 读取已取消，已有照片保留。'));signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>stop(rawError('RAW_TIMEOUT','RAW 读取超时，请重试或使用兼容的解码器。')),timeoutMs);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536)stop(rawError('RAW_PROTOCOL','RAW 解码器返回内容超出限制。'));});
    child.stderr.on('data',chunk=>{error=(error+chunk).slice(-8192);});
    function finish(){clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);}
    child.once('error',err=>{finish();reject(rawError('RAW_BACKEND_UNAVAILABLE','RAW 解码器不可用：'+err.code));});
    child.once('close',code=>{finish();if(failure)return reject(failure);if(code!==0)return reject(rawError('RAW_UNSUPPORTED','此 RAW 机型或压缩方式未能解码。'+(error.includes('ModuleNotFoundError')?' 请先运行 RAW 环境安装。':'')));try{resolve(json?JSON.parse(output):null);}catch{reject(rawError('RAW_PROTOCOL','RAW 解码器返回了无效记录。'));}});
  });
}
