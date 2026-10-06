import http from 'node:http';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createProjectRenderPool} from './render-pool.mjs';
import {loadProject,fail,localFailure} from './project.mjs';
import {handleNativeProjectRoute} from './native-router.mjs';
export async function serveProject(folder,{port=0,sessionFile,quiet=false}={}) {
  folder=path.resolve(folder);await loadProject(folder);const token=randomBytes(24).toString('hex');
  const renderer=createProjectRenderPool();let jobId=0,closing=false,closingPromise;
  const render=(action,key,options,signal)=>renderer.run({id:++jobId,action,folder,key,options},{signal});
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  async function body(req){let bytes=0,chunks=[];for await(const part of req){bytes+=part.length;if(bytes>2*1024*1024)fail('REQUEST_SIZE','提交内容过长，请缩短说明。');chunks.push(part);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{fail('INVALID_JSON','提交内容无法读取，请重试。');}}
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://127.0.0.1'),origin=`http://127.0.0.1:${server.address().port}`;
      if(req.headers.host!==`127.0.0.1:${server.address().port}`)return json(res,403,{error:{message:'请使用本地预览地址。'}});
      if(url.pathname.startsWith('/api/')){
        const supplied=Buffer.from(String(req.headers['x-guangjian-token']||'')),secret=Buffer.from(token);
        if(supplied.length!==secret.length||!timingSafeEqual(supplied,secret))return json(res,401,{error:{code:'SESSION_REQUIRED',message:'本地预览连接已失效，请从 Agent 重新打开预览地址。'}});
        if(req.headers.origin&&req.headers.origin!==origin)return json(res,403,{error:{message:'请求来源不匹配。'}});
      }
      const controller=new AbortController();res.once('close',()=>{if(!res.writableEnded)controller.abort();});
      await handleNativeProjectRoute(req,res,url,{folder,render:(action,key,options)=>render(action,key,options,controller.signal),readBody:body});
    }catch(error){if(res.destroyed)return;if(res.headersSent)return res.destroy();json(res,error.code?.startsWith('STALE')?409:400,{error:localFailure(error)});}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(error){closing=true;await renderer.close();if(error.code==='EADDRINUSE')fail('PORT_IN_USE','这个预览端口已被占用。使用 --port 0 自动选择新端口。');throw error;}
  const session={url:`http://127.0.0.1:${server.address().port}/#token=${token}`,port:server.address().port,pid:process.pid,project:folder};
  if(sessionFile)try{await writeFile(path.resolve(sessionFile),JSON.stringify(session),{mode:0o600});}catch{await close();fail('SESSION_FILE','预览会话文件无法保存。请使用已存在且可写的目录，或省略 --session-file。');}
  if(!quiet)console.log(JSON.stringify({ok:true,...session,mode:'local-tools',message:'预览已就绪；在当前 Agent 中继续审片与对话。按 Ctrl+C 停止。'}));
  function close(){if(closingPromise)return closingPromise;closing=true;server.close();server.closeAllConnections();closingPromise=renderer.close();return closingPromise;}
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
  return {server,session,close};
}
