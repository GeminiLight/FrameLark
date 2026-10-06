// Share immutable preview work, with cancellation owned by each subscriber.
export function createCoalescedJobs(){
  const jobs=new Map();
  return function share(key,start,signal){
    const cancelled=()=>Object.assign(new Error('操作已取消。'),{code:'CANCELLED'});
    if(signal?.aborted)return Promise.reject(cancelled());
    let job=jobs.get(key);
    if(!job){
      const controller=new AbortController();job={controller,subscribers:new Set()};jobs.set(key,job);
      job.promise=Promise.resolve().then(()=>start(controller.signal));
      const clear=()=>{if(jobs.get(key)===job)jobs.delete(key);};job.promise.then(clear,clear);
    }
    return new Promise((resolve,reject)=>{
      let done=false;
      const settle=(error,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);job.subscribers.delete(abort);error?reject(error):resolve(value);};
      const abort=()=>{settle(cancelled());if(!job.subscribers.size){if(jobs.get(key)===job)jobs.delete(key);job.controller.abort();}};
      job.subscribers.add(abort);signal?.addEventListener('abort',abort,{once:true});
      job.promise.then(value=>settle(null,value),error=>settle(error));
      if(signal?.aborted)abort();
    });
  };
}
