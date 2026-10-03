// Independent queues own their controllers; changing the active photograph never cancels a job.
export function createTaskQueue({concurrency=1,onChange=()=>{}}={}) {
  const tasks=[];let running=0,sequence=0;
  const emit=task=>onChange(task,tasks);
  function pump() {
    while(running<concurrency) {
      const task=tasks.find(item=>item.status==='queued');if(!task)return;
      running++;task.status='running';task.attempt++;task.startedAt=Date.now();task.finishedAt=null;task.controller=new AbortController();emit(task);
      Promise.resolve().then(()=>task.status==='cancelled' ? undefined:task.run({signal:task.controller.signal,progress:message=>{if(task.status==='running'){task.message=message;emit(task);}}}))
        .then(result=>{if(task.status!=='cancelled'){task.result=result;task.status='done';task.message='';}})
        .catch(error=>{if(task.status!=='cancelled'){task.status='failed';task.error=String(error?.message || '处理未完成');}})
        .finally(()=>{running--;task.controller=null;task.finishedAt=Date.now();emit(task);pump();});
    }
  }
  return {
    tasks,
    add({key,label,kind,photoId,run,...details}) {
      const prior=tasks.find(item=>item.key===key && ['queued','running'].includes(item.status));if(prior)return prior;
      const task={...details,id:`job-${++sequence}`,key,label,kind,photoId,run,status:'queued',attempt:0,message:'',error:null,result:null};
      if(kind==='analysis')for(const old of tasks.filter(item=>item.key===key && ['failed','cancelled'].includes(item.status)))old.supersededBy=task.id;
      tasks.push(task);emit(task);pump();return task;
    },
    cancel(id,reason='cancelled') {const task=tasks.find(item=>item.id===id);if(!task || !['queued','running'].includes(task.status))return;task.status='cancelled';task.cancelReason=reason;task.message='';task.controller?.abort(reason);emit(task);pump();},
    retry(id) {const task=tasks.find(item=>item.id===id);if(!task || task.controller || typeof task.run!=='function' || !['failed','cancelled'].includes(task.status))return false;task.status='queued';task.error=null;task.result=null;task.message='';emit(task);pump();return true;},
    releasePhoto(photoId) {
      const matching=tasks.filter(task=>task.photoId===photoId);
      // Release source-capturing closures, while keeping completed export downloads.
      // Cancel the whole group before pumping, so a second job cannot start mid-removal.
      for(const task of matching) {
        if(['queued','running'].includes(task.status)){task.status='cancelled';task.message='';task.controller?.abort();}
        task.run=null;task.released=true;
      }
      matching.forEach(emit);pump();
    },
    clear() {for(let i=tasks.length-1;i>=0;i--)if(!tasks[i].controller && ['done','cancelled'].includes(tasks[i].status))tasks.splice(i,1);emit(null);}
  };
}

export function latestReviewTask(tasks,photoId) {
  return tasks.findLast(task=>task.kind==='analysis' && task.photoId===photoId && task.cancelReason!=='superseded' && !task.supersededBy && !task.released);
}
export function unresolvedFailure(task) {return task.status==='failed' && !task.released && !task.supersededBy;}
export function elapsedReview(task,now=Date.now()) {
  return task?.status==='running' && Number.isFinite(task.startedAt) ? `已等待 ${Math.max(0,Math.floor((now-task.startedAt)/1000))} 秒`:'';
}
