import http from 'node:http';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {loadProject,fail,localFailure} from './project.mjs';
import {handleNativeProjectRoute} from './native-router.mjs';
export async function serveProject(folder,{port=0,sessionFile,quiet=false}={}) {
  folder=path.resolve(folder);await loadProject(folder);const token=randomBytes(24).toString('hex');
  const worker=new Worker(new URL('./worker.mjs',import.meta.url));const jobs=new Map();let jobId=0,queue=Promise.resolve(),closing=false,workerFailed=false,queued=0;
  worker.on('message',({id,result,error})=>{const job=jobs.get(id);if(!job)return;jobs.delete(id);error?job.reject(Object.assign(new Error(error.message),{code:error.code})):job.resolve(result);});
  const failWorker=()=>{workerFailed=true;for(const job of jobs.values())job.reject(Object.assign(new Error('图片处理已停止。请在 Agent 中重新启动本地预览，已有编辑仍已保存。'),{code:'RENDER_UNAVAILABLE'}));jobs.clear();};worker.on('error',failWorker);worker.on('exit',code=>{if(!closing)failWorker();});
  function render(action,key,options={},cancelled=()=>false){if(queued>=8)fail('RENDER_BUSY','图片处理队列已满，请稍后重试。');queued++;const task=async()=>{if(cancelled())fail('PREVIEW_CANCELLED','预览已取消');if(action==='preview'&&options.revision!==undefined){const current=await loadProject(folder);if(current.revision!==options.revision)fail('STALE_REVISION','更新的预览已取代此请求。');}return new Promise((resolve,reject)=>{if(workerFailed||closing)return reject(Object.assign(new Error('图片处理已停止，请重新启动本地预览。'),{code:'RENDER_UNAVAILABLE'}));const id=++jobId;jobs.set(id,{resolve,reject});worker.postMessage({id,action,folder,key,options});});};const result=queue.then(task).finally(()=>{queued--;});queue=result.catch(()=>{});return result;}
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  async function body(req){let bytes=0,chunks=[];for await(const part of req){bytes+=part.length;if(bytes>64*1024)fail('REQUEST_SIZE','提交内容过长，请缩短说明。');chunks.push(part);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('INVALID_JSON','提交内容无法读取，请重试。');}}
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1'),origin=`http://127.0.0.1:${server.address().port}`;
      if(req.headers.host!==`127.0.0.1:${server.address().port}`)return json(res,403,{error:{message:'请使用本地预览地址。'}});
      if(url.pathname.startsWith('/api/')){
        const supplied=Buffer.from(String(req.headers['x-guangjian-token']||'')),secret=Buffer.from(token);
        if(supplied.length!==secret.length||!timingSafeEqual(supplied,secret))return json(res,401,{error:{code:'SESSION_REQUIRED',message:'本地预览连接已失效，请从 Agent 重新打开预览地址。'}});
        if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:{message:'请求来源不匹配。'}});
      }
      await handleNativeProjectRoute(req,res,url,{folder,render,readBody:body});
    }catch(error){if(res.destroyed)return;if(res.headersSent)return res.destroy();json(res,error.code?.startsWith('STALE')?409:400,{error:localFailure(error)});}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(error){closing=true;await worker.terminate();if(error.code==='EADDRINUSE')fail('PORT_IN_USE','这个预览端口已被占用。使用 --port 0 自动选择新端口。');throw error;}
  const session={url:`http://127.0.0.1:${server.address().port}/#token=${token}`,port:server.address().port,pid:process.pid,project:folder};
  if(sessionFile)try{await writeFile(path.resolve(sessionFile),JSON.stringify(session),{mode:0o600});}catch{await close();fail('SESSION_FILE','预览会话文件无法保存。请使用已存在且可写的目录，或省略 --session-file。');}
  if(!quiet)console.log(JSON.stringify({ok:true,...session,mode:'local-tools',message:'预览已就绪；在当前 Agent 中继续审片与对话。按 Ctrl+C 停止。'}));
  async function close(){if(closing)return;closing=true;server.close();await worker.terminate();for(const job of jobs.values())job.reject(new Error('预览服务已停止'));jobs.clear();}
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
  return {server,session,close};
}
