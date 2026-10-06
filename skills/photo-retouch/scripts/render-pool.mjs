import {Worker} from 'node:worker_threads';
import {createCoalescedJobs} from './coalesced-jobs.mjs';

const failure=(code,message)=>Object.assign(new Error(message),{code});

// One owner for admission, deadlines, cancellation and worker shutdown. Queued
// jobs do not allocate workers; a stopping worker retains its slot until exit.
export function createProjectRenderPool({concurrency=2,maxQueued=8,timeoutMs=120000,
  createWorker=()=>new Worker(new URL('./worker.mjs',import.meta.url))}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||!Number.isInteger(maxQueued)||maxQueued<0||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new TypeError('Invalid project render limits');
  const share=createCoalescedJobs(),queue=[],active=new Set(),workers=new Set();let closed=false,closing;

  function finish(task,error,result){
    if(task.done)return;
    task.done=true;clearTimeout(task.timer);task.signal?.removeEventListener('abort',task.cancel);
    const index=queue.indexOf(task);if(index>=0)queue.splice(index,1);
    const settle=()=>{workers.delete(task.worker);active.delete(task);error?task.reject(error):task.resolve(result);pump();};
    if(task.worker)Promise.resolve().then(()=>task.worker.terminate()).then(settle,()=>{
      // An unconfirmed stop must not admit more workers into the same process.
      closed=true;error=failure('RENDER_UNAVAILABLE','图片处理线程无法关闭，请重新启动工作台。');
      for(const waiting of [...queue])finish(waiting,error);
      settle();
    });
    else settle();
  }
  function pump(){
    if(closed)return;
    while(active.size<concurrency&&queue.length){
      const task=queue.shift();if(task.done)continue;
      active.add(task);
      try{
        task.worker=createWorker();workers.add(task.worker);
        task.worker.once('error',error=>finish(task,error));
        task.worker.once('exit',()=>finish(task,failure('RENDER_UNAVAILABLE','图片处理已停止，请重试。')));
        task.worker.once('message',({result,error})=>finish(task,error?failure(error.code,error.message):null,result));
        task.worker.postMessage(task.message);
      }catch(error){finish(task,error);}
    }
  }
  const pool={
    workers,
    get status(){return {active:active.size,queued:queue.length,closed,concurrency,maxQueued};},
    run(message,{signal,sharedRun=false}={}){
      if(closed)return Promise.reject(failure('RENDER_UNAVAILABLE','图片处理已停止，请重新打开工作台。'));
      if(signal?.aborted)return Promise.reject(failure('CANCELLED','操作已取消。'));
      if(!sharedRun&&['frame','preview'].includes(message.action)&&message.options?.revision!==undefined){const {id,...identity}=message;return share(JSON.stringify(identity),sharedSignal=>pool.run(message,{signal:sharedSignal,sharedRun:true}),signal);}
      if(active.size>=concurrency&&queue.length>=maxQueued)return Promise.reject(failure('RENDER_BUSY','图片处理队列已满，请等候已开始的任务，或取消部分预览后重试。'));
      const task={message,signal,done:false};
      task.promise=new Promise((resolve,reject)=>{
        Object.assign(task,{resolve,reject,cancel:()=>finish(task,failure('CANCELLED','操作已取消。'))});
        task.timer=setTimeout(()=>finish(task,failure('RENDER_TIMEOUT','图片处理超时，请缩小输出尺寸后重试。')),timeoutMs);
        queue.push(task);signal?.addEventListener('abort',task.cancel,{once:true});
        if(signal?.aborted)task.cancel();else pump();
      });
      return task.promise;
    },
    close(){
      if(closing)return closing;
      closed=true;const tasks=[...queue,...active];
      closing=Promise.allSettled(tasks.map(task=>task.promise)).then(()=>undefined);
      for(const task of tasks)finish(task,failure('RENDER_UNAVAILABLE','图片处理已停止，已有编辑仍已保存。'));
      return closing;
    }
  };return pool;
}
