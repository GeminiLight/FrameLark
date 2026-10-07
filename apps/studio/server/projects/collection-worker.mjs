import {exportCollection} from '../../../../skills/photo-retouch/scripts/collection.mjs';
process.on('message',async ({id,action,folder,key,options})=>{
  try{
    if(action!=='collection-export')throw new Error('不支持这个组图任务。');
    process.send({id,result:await exportCollection(folder,options,{collectionId:key})});
  }catch(error){process.send({id,error:{code:error.code||'COLLECTION_EXPORT',message:error.message}});}
});
