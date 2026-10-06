export async function renderPresetTrial(renderer,job,trial){
  if(trial?.inputDocument){
    const pixels=await renderer.render({...job,document:trial.inputDocument});
    return renderer.render({...job,pixels,document:trial.document});
  }
  return renderer.render({...job,document:trial?.document||job.document});
}

// One bounded renderer, sequential jobs, and latest-request ownership keep the
// library responsive without publishing partial or stale thumbnail caches.
export function createStyleThumbnails({renderer,encode,isCurrent,onReady,onThumbnail,onError}){
  let generation=0,requested=null,completed=null,pending=Promise.resolve();
  return {
    build(request){
      if(request.signature===requested)return pending;
      requested=request.signature;const token=++generation;renderer.cancel();
      const current=()=>token===generation&&isCurrent(request);
      pending=(async()=>{
        const results={};let failed=false;
        for(const item of request.items){
          if(!current())return false;
          try{
            const pixels=await renderPresetTrial(renderer,item.job,item.trial);
            if(!current())return false;
            results[item.id]=encode(pixels,item.job.width,item.job.height);
            onThumbnail?.(results[item.id],item.id,request);
          }catch(error){
            if(!current()||error.name==='AbortError')return false;
            failed=true;onError?.(error,request,item.id);
          }
          // Also yield between styles when the worker is unavailable.
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(!current())return false;
        onReady(results,request);completed=failed?null:request.signature;
        if(failed)requested=null;
        return !failed;
      })().finally(()=>{if(token===generation&&completed!==request.signature)requested=null;});
      return pending;
    },
    get completedSignature(){return completed;},
    cancel(){generation++;requested=null;renderer.cancel();},
    dispose(){generation++;requested=null;renderer.dispose();}
  };
}
