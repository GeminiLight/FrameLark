import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {loadProject,publicProject,createCandidate,selectCandidateItems,changeGuards,saveNote,deleteNote,setIntent,acceptCandidate,discardCandidate,restoreVersion,saveReview,recordExport,fail,localFailure} from './project.mjs';
import {editSources} from './workflow.mjs';
const ui=fileURLToPath(new URL('ui/',import.meta.url));
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
        if(req.method==='GET'&&url.pathname==='/api/edit-sources')return json(res,200,await editSources(folder,url.searchParams.get('version')||'current'));
        if(req.method==='GET'&&url.pathname==='/api/project')return json(res,200,{...publicProject(await loadProject(folder)),folder});
        if(req.method==='GET'&&url.pathname==='/api/image'){
          const options={maxSide:Number(url.searchParams.get('size'))||1400,withoutText:url.searchParams.get('withoutText')==='true'};if(url.searchParams.has('revision'))options.revision=Number(url.searchParams.get('revision'));if(url.searchParams.has('selectionHash'))options.selectionHash=url.searchParams.get('selectionHash');if(url.searchParams.has('reference')){const p=await loadProject(folder),{findVersion}=await import('./project.mjs');options.referenceCrop=findVersion(p,url.searchParams.get('reference')).state.crop;}
          const result=await render('preview',url.searchParams.get('version')||'current',options,()=>res.destroyed);if(res.destroyed)return;if(options.revision!==undefined&&(await loadProject(folder)).revision!==result.revision)fail('STALE_REVISION','预览生成时项目已更新，请重新读取。');res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Photo-Width':result.width,'X-Photo-Height':result.height,'X-Photo-Limited':String(result.limited),'X-Selection-Hash':result.selectionHash||'','X-Project-Revision':String(result.revision),'X-Frame-Spec':result.frameSpecHash});return res.end(await readFile(result.path));
        }
        if(req.method==='GET'&&url.pathname==='/api/download'){
          const p=await loadProject(folder),item=p.exports.find(x=>path.basename(x.path)===url.searchParams.get('file')&&path.dirname(x.path)===path.join(folder,'exports'));if(!item)fail('EXPORT_NOT_FOUND','成片未找到，请重新导出。');
          res.writeHead(200,{'Content-Type':item.format==='png'?'image/png':'image/jpeg','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(item.path))}`,'Cache-Control':'no-store'});return res.end(await readFile(item.path));
        }
        if(req.method==='POST'){
          const value=await body(req);let result;
          const methods={'/api/candidate':createCandidate,'/api/candidate-selection':selectCandidateItems,'/api/guards':changeGuards,'/api/note':saveNote,'/api/delete-note':deleteNote,'/api/intent':setIntent,'/api/accept':acceptCandidate,'/api/discard':discardCandidate,'/api/restore':restoreVersion,'/api/review':saveReview};
          if(url.pathname==='/api/guards'&&value.operation==='protect')result=await changeGuards(folder,value,{prepare:()=>render('prepareProtection',null,value,()=>res.destroyed)});
          else if(methods[url.pathname])result=await methods[url.pathname](folder,value);
          else if(url.pathname==='/api/export'){result=await render('export',value.version||'current',{preset:value.preset||'share',format:value.format,maxSide:value.maxSide,quality:value.quality,withoutText:value.withoutText===true});await recordExport(folder,result);}
          else return json(res,404,{error:{message:'找不到这个操作。'}});return json(res,200,result);
        }
        return json(res,404,{error:{message:'找不到这个操作。'}});
      }
      if(req.method!=='GET')return json(res,405,{error:{message:'不支持这个请求。'}});
      const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/lettering.js':['lettering.js','text/javascript'],'/controlled-edits.js':['controlled-edits.js','text/javascript'],'/controlled-edits-model.js':['controlled-edits-model.js','text/javascript'],'/preview-requests.js':['preview-requests.js','text/javascript'],'/style.css':['style.css','text/css'],'/mark.svg':['mark.svg','image/svg+xml']};
      let file=files[url.pathname];
      if(['/engine/photo-geometry.js','/engine/crop-utils.js','/engine/editor-engine.js','/engine/render-frame.js','/engine/tone-processing.js','/engine/detail-processing.js'].includes(url.pathname))file=[new URL('.'+url.pathname,import.meta.url),'text/javascript'];
      if(!file)return json(res,404,{error:{message:'页面不存在。'}});
      res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(await readFile(file[0] instanceof URL?file[0]:path.join(ui,file[0])));
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
