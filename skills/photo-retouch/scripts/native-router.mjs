import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadProject,publicProject,createCandidate,selectCandidateItems,changeGuards,saveNote,deleteNote,setIntent,acceptCandidate,discardCandidate,restoreVersion,saveReview,recordExport,fail} from './project.mjs';
import {editSources} from './workflow.mjs';
import {handoffProject} from './handoff.mjs';

const ui=new URL('./ui/',import.meta.url);
const files={
  '':['index.html','text/html'],'app.js':['app.js','text/javascript'],'lettering.js':['lettering.js','text/javascript'],
  'controlled-edits.js':['controlled-edits.js','text/javascript'],'controlled-edits-model.js':['controlled-edits-model.js','text/javascript'],
  'preview-requests.js':['preview-requests.js','text/javascript'],'style.css':['style.css','text/css'],'mark.svg':['mark.svg','image/svg+xml'],'xiaozhen-avatar.png':['xiaozhen-avatar.png','image/png']
};
const engineFiles=new Set(['photo-geometry.js','crop-utils.js','editor-engine.js','render-frame.js','tone-processing.js','detail-processing.js']);
const json=(res,status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};

// Authentication belongs to the caller: a private session or the same-origin project bridge.
export async function handleNativeProjectRoute(req,res,url,{folder,base='/',render,readBody,embedded=false}){
  const route=url.pathname.slice(base.length);
  if(route.startsWith('api/')){
    const operation=route.slice(4);
    if(req.method==='GET'&&operation==='project'){json(res,200,{...publicProject(await loadProject(folder)),folder});return;}
    if(req.method==='GET'&&operation==='edit-sources'){json(res,200,await editSources(folder,url.searchParams.get('version')||'current'));return;}
    if(req.method==='GET'&&operation==='image'){
      const options={maxSide:Number(url.searchParams.get('size'))||1400,withoutText:url.searchParams.get('withoutText')==='true'};
      if(url.searchParams.has('revision'))options.revision=Number(url.searchParams.get('revision'));
      if(url.searchParams.has('selectionHash'))options.selectionHash=url.searchParams.get('selectionHash');
      if(url.searchParams.has('reference')){const p=await loadProject(folder),{findVersion}=await import('./project.mjs');options.referenceCrop=findVersion(p,url.searchParams.get('reference')).state.crop;}
      const result=await render('preview',url.searchParams.get('version')||'current',options,()=>res.destroyed);
      if(res.destroyed)return;
      if(options.revision!==undefined&&(await loadProject(folder)).revision!==result.revision)fail('STALE_REVISION','预览生成时项目已更新，请重新读取。');
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Photo-Width':result.width,'X-Photo-Height':result.height,'X-Photo-Limited':String(result.limited),'X-Selection-Hash':result.selectionHash||'','X-Project-Revision':String(result.revision),'X-Frame-Spec':result.frameSpecHash});res.end(await readFile(result.path));return;
    }
    if(req.method==='GET'&&operation==='download'){
      const p=await loadProject(folder),item=p.exports.find(x=>path.basename(x.path)===url.searchParams.get('file')&&path.dirname(x.path)===path.join(folder,'exports'));if(!item)fail('EXPORT_NOT_FOUND','成片未找到，请重新导出。');
      res.writeHead(200,{'Content-Type':item.format==='png'?'image/png':'image/jpeg','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(item.path))}`,'Cache-Control':'no-store'});res.end(await readFile(item.path));return;
    }
    if(req.method==='POST'){
      const value=await readBody(req),methods={candidate:createCandidate,'candidate-selection':selectCandidateItems,guards:changeGuards,note:saveNote,'delete-note':deleteNote,intent:setIntent,accept:acceptCandidate,discard:discardCandidate,restore:restoreVersion,review:saveReview,handoff:handoffProject};
      let result;
      if(operation==='guards'&&value.operation==='protect')result=await changeGuards(folder,value,{prepare:()=>render('prepareProtection',null,value,()=>res.destroyed)});
      else if(operation==='handoff'){
        if(!['request','cancel'].includes(value.action))fail('HANDOFF_INVALID','请由 Agent 工具接手或报告进度。');
        result=await handoffProject(folder,value);
      }
      else if(Object.hasOwn(methods,operation))result=await methods[operation](folder,operation==='candidate'?{...value,actorId:'workspace-user'}:value);
      else if(operation==='export'){result=await render('export',value.version||'current',{preset:value.preset||'share',format:value.format,maxSide:value.maxSide,quality:value.quality,withoutText:value.withoutText===true});await recordExport(folder,result);}
      else{json(res,404,{error:{message:'找不到这个操作。'}});return;}
      json(res,200,result);return;
    }
    json(res,404,{error:{message:'找不到这个操作。'}});return;
  }
  if(req.method!=='GET'){json(res,405,{error:{message:'不支持这个请求。'}});return;}
  let file=Object.hasOwn(files,route)?files[route]:null,target;
  if(file)target=new URL(file[0],ui);
  else if(route.startsWith('engine/')&&engineFiles.has(route.slice(7))){file=[route,'text/javascript'];target=new URL('./'+route,import.meta.url);}
  if(!file){json(res,404,{error:{message:'页面不存在。'}});return;}
  res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'self'; img-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors ${embedded?"'self'":"'none'"}`});
  let bytes=await readFile(target);
  if(file[1]==='text/javascript')bytes=Buffer.from(bytes.toString('utf8').replace(/from '\.\.\/engine\//g,"from './engine/").replace(/from '\/engine\//g,"from './engine/"));
  res.end(bytes);
}
