import {fork} from 'node:child_process';
import {createHash} from 'node:crypto';
import {photoTools,normalizeToolPlan,compileToolPlan,validateEffect} from './engine/photo-tools/registry.js';
import {fail,PhotoToolError} from './engine/photo-tools/values.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maxInput=8*1024*1024,maxOutput=4*1024*1024;
export class PhotoToolExecutor {
  constructor({forkImpl=fork,timeoutMs=30000}={}){this.forkImpl=forkImpl;this.timeoutMs=timeoutMs;this.active=new Set();}
  execute(job,{signal,onEvent=()=>{}}={}){
    if(signal?.aborted)return Promise.reject(signal.reason?.code==='TOOL_PLAN_TIMEOUT'?signal.reason:new PhotoToolError('CANCELLED','工具执行已取消。'));
    if(Buffer.byteLength(JSON.stringify(job))>maxInput)fail('TOOL_INPUT_SIZE','工具输入超过大小限制。');
    return new Promise((resolve,reject)=>{
      const env=Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','TEMP','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
      const child=this.forkImpl(new URL('./photo-tool-worker.mjs',import.meta.url),[],{execArgv:[],serialization:'advanced',env,stdio:['ignore','ignore','pipe','ipc']});
      this.active.add(child);let result,failure,settled=false,timer,killTimer;
      const stop=error=>{if(failure)return;failure=error;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),1000);killTimer.unref?.();};
      const cancel=()=>stop(signal?.reason?.code==='TOOL_PLAN_TIMEOUT'?signal.reason:new PhotoToolError('CANCELLED','工具执行已取消。'));
      const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',cancel);this.active.delete(child);error?reject(error):resolve(result);};
      child.stderr?.on('data',()=>{});child.once('error',()=>{const error=new PhotoToolError('TOOL_PROCESS_FAILED','工具子进程无法启动。');stop(error);if(!child.pid)finish(error);});
      child.on('message',message=>{
        if(result||failure)return;
        if(message.type==='progress'){if(message.operationId===job.operation.id&&message.stage==='processing')onEvent({type:'tool',stage:'processing',operationId:job.operation.id,tool:job.operation.tool,title:job.operation.title});return;}
        if(Buffer.byteLength(JSON.stringify(message))>maxOutput){stop(new PhotoToolError('TOOL_OUTPUT_SIZE','工具返回的数据超过大小限制。'));return;}
        if(!message.ok){stop(new PhotoToolError(message.error?.code||'TOOL_EXECUTION_FAILED',message.error?.message||'工具执行失败。'));return;}
        try{validateEffect(message.result?.effect);result={...message,execution:{adapter:'subprocess',pid:child.pid,tool:job.operation.tool,version:job.operation.version,inputHash:hash(job)}};}catch{stop(new PhotoToolError('TOOL_RESULT_INVALID','工具返回结果未通过校验。'));}
      });
      child.once('close',code=>finish(failure||(!result||code!==0?new PhotoToolError('TOOL_PROCESS_FAILED','工具子进程未能完成。'):null)));
      signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>stop(new PhotoToolError('TOOL_TIMEOUT','工具执行超时，已停止子进程。')),this.timeoutMs);
      onEvent({type:'tool',stage:'running',operationId:job.operation.id,tool:job.operation.tool,title:job.operation.title});
      if(signal?.aborted)cancel();else child.send(job,error=>{if(error)stop(new PhotoToolError('TOOL_PROCESS_FAILED','工具输入未能发送。'));});
    });
  }
  close(){for(const child of this.active)child.kill('SIGTERM');}
}
export async function runPhotoToolPlan({operations,state,source,notes=[],namespace='run',selectedItemIds,preview},{signal,onEvent=()=>{},executor=new PhotoToolExecutor(),planTimeoutMs=120000}={}){
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new PhotoToolError('TOOL_PLAN_TIMEOUT','工具组合执行超时，已停止。')),planTimeoutMs);
  const combined=AbortSignal.any(signal?[signal,deadline.signal]:[deadline.signal]);
  try{
  const normalized=normalizeToolPlan(operations,{state,source,notes}),compiled=compileToolPlan(state,normalized,{source,notes,namespace,selected:selectedItemIds});
  const outputs=new Map(),records=[];
  for(const record of compiled.records){
    if(combined.aborted)throw (combined.reason?.code==='TOOL_PLAN_TIMEOUT'?combined.reason:new PhotoToolError('CANCELLED','工具方案已取消。'));
    const operation=record.operation,context={state:record.before,inputState:state,source,notes,outputs:[...outputs],layerId:`tool-${namespace.slice(0,40)}-${normalized.findIndex(op=>op.id===record.id)}`};
    const result=await executor.execute({operation,context,preview},{signal:combined,onEvent});
    if(hash(result.result.effect)!==hash(record.effect)||hash(result.result.outputs||{})!==hash(record.outputs))fail('TOOL_RESULT_MISMATCH','子进程与工具定义的结果不一致。');
    outputs.set(record.id,result.result.outputs||{});
    const receipt={...record,...(result.result.measurements?{measurements:result.result.measurements}:{}),execution:result.execution,...(result.preview?{preview:{...result.preview,png:undefined,image:`data:image/png;base64,${result.preview.png}`}}:{})};records.push(receipt);
    onEvent({type:'tool',stage:'completed',operationId:record.id,tool:operation.tool,title:operation.title,index:records.length,total:compiled.records.length,preview:receipt.preview});
  }
  return {...compiled,operations:normalized,records,namespace};
  }finally{clearTimeout(timer);}
}
