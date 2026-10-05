// Keep transport failures distinct from a model's own, structured feedback.
export function serviceResponseFailure(response, purpose='审片') {
  let login=false;
  try {const url=new URL(response.url);login=response.redirected && url.hostname==='vercel.com' && /sso|login/.test(url.pathname);}catch{}
  if(login || [401,403].includes(response.status))return {code:'SESSION_REQUIRED',message:'工作台访问会话已失效，请重新打开页面并登录后重试。照片与已有调整保留。',retryable:true};
  if(response.status===413)return {code:'REQUEST_TOO_LARGE',message:`${purpose}预览数据过大，请减少照片数量或使用较小的图片后重试。已有编辑保留。`,retryable:false};
  if([408,504].includes(response.status))return {code:'MODEL_TIMEOUT',message:`这次${purpose}等待超时，请重试。已有编辑保留。`,retryable:true};
  return {code:'SERVICE_RESPONSE_UNAVAILABLE',message:`${purpose}服务暂时未返回可用结果，请稍后重试。照片与已有调整保留。`,retryable:true};
}
export async function readServiceJSON(response, purpose='审片') {
  if([401,403,413,408,504].includes(response.status)){const failure=serviceResponseFailure(response,purpose);throw Object.assign(new Error(failure.message),{code:failure.code,visionFailure:failure});}
  try {const value=await response.json();if(!value || typeof value!=='object' || Array.isArray(value))throw new Error();return value;}
  catch {const failure=serviceResponseFailure(response,purpose);throw Object.assign(new Error(failure.message),{code:failure.code,visionFailure:failure});}
}
export function requestFailure(error, signal, purpose='审片') {
  if(signal?.aborted && signal.reason==='timeout')return {code:'MODEL_TIMEOUT',message:`这次${purpose}等待超时，请重试。照片与已有调整保留。`,retryable:true};
  if(error?.visionFailure)return error.visionFailure;
  return {code:'NETWORK_ERROR',message:`未能连接${purpose}服务，请检查网络后重试。照片与已有调整保留。`,retryable:true};
}
