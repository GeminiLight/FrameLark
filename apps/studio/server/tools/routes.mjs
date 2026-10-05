import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {photoTools,normalizeToolPlan,compileToolPlan,validateToolState} from '../../public/photo-tools/registry.js';
import {record,number,identifier,validate,fail} from '../../public/photo-tools/values.js';
import {toolPreviewSummary,publicToolRun} from './results.mjs';
export {toolPreviewSummary,publicToolRun} from './results.mjs';
const json=(response,status,value)=>{if(response.destroyed)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(value));};
export async function handlePhotoToolRoutes(request,response,url,{readBody,allowed,cloud}){
  const subprocess=!cloud&&existsSync(new URL('../../../../skills/photo-retouch/scripts/photo-tool-worker.mjs',import.meta.url));
  if(!['/api/photo-tools','/api/photo-tools/run'].includes(url.pathname))return false;
  if(url.pathname==='/api/photo-tools'&&request.method==='GET'){json(response,200,{schemaVersion:1,tools:photoTools.describe(),operationSchema:photoTools.operationSchema(),execution:subprocess?'subprocess':'inline'});return true;}
  if(url.pathname!=='/api/photo-tools/run'||request.method!=='POST'){json(response,405,{error:{code:'METHOD_NOT_ALLOWED',message:'不支持这个工具操作。'}});return true;}
  if(!cloud&&!allowed(request,true)){json(response,403,{error:{code:'FORBIDDEN_ORIGIN',message:'请使用本机工作台执行图片工具。'}});return true;}
  const controller=new AbortController();response.once('close',()=>{if(!response.writableEnded)controller.abort();});
  const stream=!cloud&&request.headers.accept?.includes('application/x-ndjson');
  const emit=event=>{if(!response.destroyed&&!response.writableEnded)response.write(JSON.stringify(event)+'\n');};
  try{
    const body=JSON.parse((await readBody(request,8*1024*1024)).toString('utf8'));
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['operations','state','source','notes','namespace','selectedItemIds','image'].includes(k)))fail('TOOL_INPUT_INVALID','工具请求包含不支持的字段。');
    const state=validateToolState(body.state);
    if(Object.keys(state).some(k=>!['settings','style','crop','locals'].includes(k)))fail('TOOL_STATE_INVALID','工具请求只能携带编辑状态。');
    validate(body.source,record({width:number(1,16384),height:number(1,16384)}));if(body.source.width*body.source.height>50_000_000)fail('TOOL_INPUT_SIZE','原片像素超出限制。');
    const namespace=body.namespace||randomUUID();validate(namespace,{...identifier,maxLength:40});
    const notes=body.notes||[];if(!Array.isArray(notes)||notes.length>8)fail('TOOL_INPUT_INVALID','标记过多。');
    if(body.image!==undefined&&(typeof body.image!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)||body.image.length>4*1024*1024))fail('TOOL_INPUT_INVALID','工具原图预览无效。');
    if(stream)response.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});
    const event=value=>emit({...value,preview:toolPreviewSummary(value.preview)});
    let result;
    if(!subprocess){
      const operations=normalizeToolPlan(body.operations,{state,source:body.source,notes});
      result=compileToolPlan(state,operations,{source:body.source,notes,namespace,selected:body.selectedItemIds});
      result={...result,operations,namespace,records:result.records.map(r=>({...r,execution:{adapter:'inline',tool:r.operation.tool,version:r.operation.version}}))};
    }else{
      const {runPhotoToolPlan}=await import('../../../../skills/photo-retouch/scripts/photo-tool-runtime.mjs');
      result=await runPhotoToolPlan({operations:body.operations,state,source:body.source,notes,namespace,selectedItemIds:body.selectedItemIds,preview:body.image?{image:body.image}:undefined},{signal:controller.signal,onEvent:stream?event:()=>{}});
    }
    const value=publicToolRun(result);if(stream){emit({type:'result',value});response.end();}else json(response,200,value);
  }catch(error){
    const failure={code:error.code||'TOOL_EXECUTION_FAILED',message:error.code?error.message:'工具执行未完成。请确认已运行 npm run setup 后重试。'};
    if(stream&&response.headersSent){emit({type:'error',error:failure});response.end();}else json(response,error.code==='CANCELLED'?499:400,{error:failure});
  }
  return true;
}
