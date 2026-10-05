import path from 'node:path';
import {PhotoError} from './engine/edit-values.js';
export async function openStudioProject(folder,{url='http://127.0.0.1:3177',fetchImpl=fetch}={}) {
  let base;try{base=new URL(url);}catch{throw new PhotoError('STUDIO_URL','工作台地址无效。');}
  if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password)throw new PhotoError('STUDIO_URL','只能连接本机 Zhenhao 工作台。');
  let response;
  try{response=await fetchImpl(new URL('/api/projects/register',base),{method:'POST',headers:{'Content-Type':'application/json','Origin':base.origin},body:JSON.stringify({path:path.resolve(folder)}),signal:AbortSignal.timeout(15000)});}
  catch{throw new PhotoError('STUDIO_UNAVAILABLE','请先在 Zhenhao 仓库运行 npm start，再运行 studio；也可用 serve 打开独立暗房。');}
  const data=await response.json();if(!response.ok)throw new PhotoError(data.error?.code||'STUDIO_FAILED',data.error?.message||'项目未能打开。');
  const target=new URL('/',base);target.searchParams.set('project',data.id);
  return {url:target.href,project:folder,projectId:data.id,mode:'shared-workspace',message:'请打开此地址。网页与 Skill 共用项目、批注、候选和导出记录。'};
}
