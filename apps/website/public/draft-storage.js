// Browser draft storage has one revision/transaction contract in both entry points.
export function createDraftStore() {
  let opening;const ownedRevisions=new Map();
  function open() {
    if(!opening) opening=new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined') { reject(new Error('浏览器存储不可用'));return; }
      const request=indexedDB.open('guangjian-photo-drafts',2);
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('workspaces'))request.result.createObjectStore('workspaces',{keyPath:'id'});};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('请关闭旧的工作台后重试保存'));
    }).catch(error=>{opening=null;throw error;});
    return opening;
  }
  async function transaction(mode,operation) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('workspaces',mode),store=tx.objectStore('workspaces');
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error || new Error('草稿保存失败'));
      tx.onabort=()=>reject(tx.error || new Error('草稿保存未完成'));
      try { const request=operation(store);request.onsuccess=()=>{result=request.result;}; }
      catch(error) { tx.abort();reject(error); }
    });
  }
  return {
    adopt(workspace){const revision=workspace.storageRevision||0;if(!Number.isSafeInteger(revision)||revision<0)throw new Error('草稿保存版本无效。');ownedRevisions.set(workspace.id,revision);},
    async save(workspace,{expectedRevision=ownedRevisions.get(workspace.id)||0}={}){
      const db=await open();if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new Error('草稿保存版本无效。');
      return new Promise((resolve,reject)=>{const tx=db.transaction('workspaces','readwrite'),store=tx.objectStore('workspaces'),request=store.get(workspace.id);let failure;
        request.onsuccess=()=>{try{const actual=request.result?.storageRevision||0;if(actual!==expectedRevision||!request.result&&ownedRevisions.has(workspace.id)){failure=Object.assign(new Error('草稿已在另一标签页更新或删除。当前修改保留，请重新打开最新草稿后协调。'),{code:'STALE_DRAFT'});tx.abort();return;}store.put({...workspace,storageRevision:actual+1});}catch(error){failure=error;tx.abort();}};
        tx.oncomplete=()=>{ownedRevisions.set(workspace.id,expectedRevision+1);resolve(workspace.id);};tx.onerror=()=>reject(failure||tx.error||new Error('草稿保存失败'));tx.onabort=()=>reject(failure||tx.error||new Error('草稿保存未完成'));
      });
    },
    list:()=>transaction('readonly',store=>store.getAll()),
    get:id=>transaction('readonly',store=>store.get(id)),
    async purge(id) {
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('workspaces','readwrite'),store=tx.objectStore('workspaces'),request=store.get(id);
        request.onsuccess=()=>{if(request.result?.deletedAt) store.delete(id);else tx.abort();};
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(new Error('草稿状态已变化，请重新查看'));
      });
    },
    // Cleanup is recoverable. No original file or preference profile is deleted.
    async setDeleted(id,deleted) {
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('workspaces','readwrite'),store=tx.objectStore('workspaces'),request=store.get(id);
        request.onsuccess=()=>{if(request.result) store.put({...request.result,storageRevision:(request.result.storageRevision||0)+1,deletedAt:deleted ? new Date().toISOString():null});};
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
    }
  };
}
