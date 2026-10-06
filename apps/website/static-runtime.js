/* GitHub Pages has no AI or file-project server. Keep browser editing available. */
(() => {
  if(location.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(location.hostname)){location.replace(location.href.replace(/^http:/,'https:'));return;}
  const basePath=__FRAME_LARK_BASE_PATH__;
  const originalFetch=window.fetch.bind(window);
  const response=(data,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}));
  window.fetch=(input,options={})=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith(basePath+'/api/'))return originalFetch(input,options);
    if(options.signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
    const path=url.pathname.slice(basePath.length);
    const method=(options.method||input?.method||'GET').toUpperCase();
    const availability={aiAvailable:false,connectionStatus:'unconfigured',configurationEditable:false,hasKey:false,model:'',endpoint:'',provider:'none',staticWebsite:true};
    if(method==='GET'&&(path==='/api/status'||path==='/api/vision-config'))return response(availability);
    return response({error:'STATIC_WORKSPACE',message:'这个在线工作台提供浏览器内修片。视觉审片与文件项目功能需要运行完整工作台。',retryable:false},503);
  };
})();
