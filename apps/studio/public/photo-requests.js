// A late response cannot overwrite a replacement request or a removed photograph.
export function createPhotoRequests({timeoutMs=115000,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  const tasks=new Map();
  function cancel(id,reason='cancelled') {
    const task=tasks.get(id);if(!task)return;
    tasks.delete(id);clearTimer(task.timer);task.controller.abort(reason);
  }
  return {
    start(id){
      cancel(id,'replaced');
      const task={id,controller:new AbortController(),timer:null};
      tasks.set(id,task);task.timer=setTimer(()=>task.controller.abort('timeout'),timeoutMs);
      return task;
    },
    owns:task=>tasks.get(task.id)===task,
    active:task=>tasks.get(task.id)===task && !task.controller.signal.aborted,
    finish(task){clearTimer(task.timer);if(tasks.get(task.id)===task)tasks.delete(task.id);},
    cancel,
    cancelAll(reason='cancelled'){for(const id of tasks.keys())cancel(id,reason);}
  };
}
