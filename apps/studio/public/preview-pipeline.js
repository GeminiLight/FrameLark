// One running render and one replaceable request. Quick frames may trail a
// gesture, but only its latest full frame can unlock export or final review.
export function createPreviewPipeline({renderer,resize,onFrame,onState,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,settleMs=180}={}){
  let latest=null,running=null,timer=null,sequence=0,disposed=false,quickSide=420;
  const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
  function stop(){const active=running;running=null;if(active)renderer.cancel();}
  function finish(){
    clear();if(!latest||disposed||latest.done==='full')return;
    latest.quality='full';onState?.('refining',latest.meta);pump();
  }
  function pump(){
    if(disposed||running||!latest||latest.done===latest.quality)return;
    const request=latest,quality=request.quality,side=quickSide;
    const task={request,quality};running=task;
    // Defer sampling until admission; rapid input never builds a backlog of
    // pixel buffers or captures intermediate recipes that cannot be displayed.
    Promise.resolve().then(async()=>{
      if(running!==task)return;
      const job=quality==='quick'?resize(request.job,side):request.job;
      const started=now(),pixels=await renderer.render(job),elapsed=now()-started;
      if(running!==task||disposed||!latest)return;
      if(quality==='quick'&&elapsed>0){
        const measured=Math.max(job.width,job.height);
        quickSide=Math.max(240,Math.min(640,Math.round(measured*Math.sqrt(100/elapsed)/40)*40));
      }
      const current=request.id===latest.id;
      if(current||quality==='quick'&&request.context===latest.context){
        onFrame?.({pixels,width:job.width,height:job.height,quality,meta:request.meta});
      }
      if(current){
        request.done=quality;
        if(quality==='full')onState?.('ready',request.meta);
      }
    }).catch(error=>{
      if(running!==task||disposed||latest?.id!==request.id)return;
      clear();latest=null;onState?.('failed',request.meta,error);
    }).finally(()=>{if(running===task){running=null;pump();}});
  }
  return {
    request(job,{key,context,meta,interactive=false}={}){
      if(disposed)return false;
      clear();
      const unchanged=latest?.key===key&&latest.context===context&&latest.job.pixels===job.pixels;
      if(!unchanged){
        // Abandon expensive final frames and frames for a different photo/crop.
        // Keep the bounded quick worker alive throughout the same gesture.
        if(running&&(running.quality==='full'||running.request.context!==context))stop();
        latest={id:++sequence,key,context,meta,job,quality:interactive?'quick':'full',done:null};
        onState?.(interactive?'quick':'refining',meta);pump();
      }else if(!interactive)finish();
      if(interactive&&latest?.done!=='full')timer=setTimer(finish,settleMs);
      return true;
    },
    finish,
    cancel(){clear();latest=null;stop();},
    dispose(){disposed=true;clear();latest=null;stop();renderer.dispose();},
  };
}

// Preserve original-space crop/rotation metadata. Only the transient sampling
// grid changes; the full frame and all acceptance/export pixels stay untouched.
export function createPreviewSampler({createCanvas=()=>document.createElement('canvas')}={}){
  let source=null,reduced=null,cached=null,input=null;
  return {
    resize(job,maxSide){
      const scale=Math.min(1,maxSide/Math.max(job.width,job.height));
      if(scale===1)return job;
      const width=Math.max(1,Math.round(job.width*scale)),height=Math.max(1,Math.round(job.height*scale));
      source ||= createCanvas();reduced ||= createCanvas();
      if(input!==job.pixels||source.width!==job.width||source.height!==job.height){
        source.width=job.width;source.height=job.height;
        source.getContext('2d').putImageData(new ImageData(job.pixels,job.width,job.height),0,0);
        input=job.pixels;cached=null;
      }
      if(!cached||cached.width!==width||cached.height!==height){
        reduced.width=width;reduced.height=height;
        const context=reduced.getContext('2d',{willReadFrequently:true});
        context.drawImage(source,0,0,width,height);
        cached=context.getImageData(0,0,width,height);
      }
      return {...job,pixels:cached.data,width,height};
    },
    clear(){if(source)source.width=source.height=0;if(reduced)reduced.width=reduced.height=0;source=reduced=cached=input=null;}
  };
}
