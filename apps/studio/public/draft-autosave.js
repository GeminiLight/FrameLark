// All callers await the same write loop, including edits made while a write is pending.
// A failed write stays dirty and returns false so workspace transitions can stop.
export function createDraftAutosave({capture,save,onState=()=>{},delayMs=300,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let requested=false,dirty=false,failed=false,savedAt=null,timer=null,pending=null;
  const status=()=>({dirty,failed,savedAt,saving:Boolean(pending)});
  const emit=()=>onState(status());
  function request(){requested=true;dirty=true;clearTimer(timer);timer=setTimer(flush,delayMs);emit();}
  function flush(){
    clearTimer(timer);timer=null;
    if(pending)return pending;
    if(!requested)return Promise.resolve(!failed);
    pending=Promise.resolve().then(async()=>{
      try {
        while(requested){requested=false;const snapshot=capture();await save(snapshot);savedAt=snapshot.savedAt;failed=false;}
        dirty=false;return true;
      } catch {requested=true;dirty=true;failed=true;return false;}
    }).finally(()=>{pending=null;emit();});
    emit();return pending;
  }
  return {request,flush,get status(){return status();},reset(at=null){
    if(pending)throw new Error('请等待当前草稿保存完成。');
    clearTimer(timer);timer=null;requested=false;dirty=false;failed=false;savedAt=at;emit();
  }};
}
