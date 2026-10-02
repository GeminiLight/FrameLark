import {parentPort} from 'node:worker_threads';
import {previewPhoto,exportPhoto} from './render.mjs';
parentPort.on('message',async ({id,action,folder,key,options})=>{
  try{const result=await (action==='export'?exportPhoto:previewPhoto)(folder,key,options);parentPort.postMessage({id,result});}
  catch(error){parentPort.postMessage({id,error:{code:error.code||'RENDER_FAILED',message:error.message}});}
});
