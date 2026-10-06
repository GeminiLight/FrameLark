const json=(response,status,value)=>{if(response.destroyed)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(value));};
export async function handleProjectRoutes(request,response,url,{bridge,readBody,allowed,cloud}) {
  if(url.pathname==='/api/local-capabilities'&&request.method==='GET'){
    if(cloud)return json(response,200,{local:false,projects:false,heic:false}),true;
    if(!allowed(request,false))return json(response,403,{error:{code:'FORBIDDEN_ORIGIN',message:'请使用本机工作台地址。'}}),true;
    json(response,200,{local:true,...await bridge.capabilities()});return true;
  }
  if(!url.pathname.startsWith('/api/projects')&&url.pathname!=='/api/photos/convert')return false;
  if(cloud||!allowed(request,request.method!=='GET')){json(response,403,{error:{code:'FORBIDDEN_ORIGIN',message:'文件项目和 HEIC 转换仅在本机工作台可用。'}});return true;}
  const controller=new AbortController();response.once('close',()=>{if(!response.writableEnded)controller.abort();});
  const body=async(limit=200000)=>JSON.parse((await readBody(request,limit)).toString('utf8'));
  try {
    if(url.pathname==='/api/photos/convert'&&request.method==='POST') {
      if(process.platform!=='darwin')throw Object.assign(new Error('当前系统不支持 HEIC 转换，请先转为 JPEG/PNG。'),{code:'HEIC_UNAVAILABLE'});
      const bytes=await readBody(request,30*1024*1024);
      const controller=new AbortController();response.once('close',()=>{if(!response.writableEnded)controller.abort();});
      const {convertHeic}=await import('../../../../skills/photo-retouch/scripts/heic.mjs');
      const png=await convertHeic(bytes,{signal:controller.signal});
      if(!response.destroyed){response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});response.end(png);}return true;
    }
    if(url.pathname==='/api/projects'&&request.method==='GET'){json(response,200,{projects:await bridge.list()});return true;}
    if(url.pathname==='/api/projects/register'&&request.method==='POST'){json(response,200,await bridge.register((await body()).path));return true;}
    if(url.pathname==='/api/projects/create'&&request.method==='POST') {
      const name=decodeURIComponent(String(request.headers['x-photo-name']||'photo.png'));
      const {rawExtensions,rawLimits}=await import('../../../../skills/photo-retouch/scripts/raw/contract.mjs');
      json(response,200,await bridge.create(await readBody(request,rawExtensions.test(name)?rawLimits.bytes:30*1024*1024),name,{signal:controller.signal}));return true;
    }
    const match=/^\/api\/projects\/([-a-zA-Z0-9]{1,80})(?:\/(.*))?$/.exec(url.pathname);
    if(!match){json(response,404,{error:{message:'找不到这个项目操作。'}});return true;}
    const [,id,operation='']=match;
    if(operation==='editor'){response.writeHead(302,{Location:`/api/projects/${id}/editor/${url.search}`});response.end();return true;}
    if(operation.startsWith('editor/')){await bridge.editor(request,response,url,id,`/api/projects/${id}/editor/`,readBody,controller.signal);return true;}
    if(!operation&&request.method==='GET'){json(response,200,await bridge.get(id));return true;}
    if(operation==='original'&&request.method==='GET'){const bytes=await bridge.original(id);response.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});response.end(bytes);return true;}
    if(operation==='source'&&request.method==='GET') {const png=await bridge.source(id);response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});response.end(png);return true;}
    if(operation==='events'&&request.method==='GET') {
      const data=await bridge.get(id),send=value=>{if(!response.destroyed&&!response.writableEnded)response.write('data: '+JSON.stringify(value)+'\n\n');};
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});send({revision:data.revision});
      const close=await bridge.subscribe(id,send);response.once('close',close);if(response.destroyed)close();return true;
    }
    if(operation==='save'&&request.method==='POST'){json(response,200,await bridge.save(id,await body(4*1024*1024)));return true;}
    if(operation==='handoff'&&request.method==='POST'){
      const value=await body();if(!['request','cancel'].includes(value.action))throw Object.assign(new Error('请由 Agent 工具接手或报告进度。'),{code:'HANDOFF_INVALID'});
      json(response,200,await bridge.handoff(id,value));return true;
    }
    if(operation==='versions'&&request.method==='POST'){json(response,200,await bridge.edition(id,await body()));return true;}
    if(operation==='versions/rename'&&request.method==='POST'){json(response,200,await bridge.renameVersion(id,await body()));return true;}
    if(operation==='tools'&&request.method==='POST'){
      const value=await body(2*1024*1024),stream=request.headers.accept?.includes('application/x-ndjson');
      const emit=event=>{if(!response.destroyed&&!response.writableEnded)response.write(JSON.stringify(event)+'\n');};
      if(stream)response.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});
      try{const result=await bridge.proposeTools(id,value,{signal:controller.signal,onEvent:stream?event=>emit({...event,preview:event.preview?{width:event.preview.width,height:event.preview.height,pixelHash:event.preview.pixelHash}:undefined}):undefined});if(stream){emit({type:'result',value:result});response.end();}else json(response,200,result);}
      catch(error){if(stream){emit({type:'error',error:{code:error.code||'TOOL_FAILED',message:error.code?error.message:'工具方案未完成。'}});response.end();}else throw error;}
      return true;
    }
    if(operation==='candidate'&&request.method==='POST'){json(response,200,await bridge.propose(id,await body()));return true;}
    if(operation==='document'&&request.method==='POST'){json(response,200,await bridge.proposeDocument(id,await body(2*1024*1024),{signal:controller.signal}));return true;}
    if(['select','accept','discard','restore'].includes(operation)&&request.method==='POST'){json(response,200,await bridge.candidate(id,operation,await body()));return true;}
    if(operation==='preview'&&request.method==='GET'){
      const packet=await bridge.previewPacket(id,url.searchParams.get('version')||'current',Number(url.searchParams.get('revision')),controller.signal);
      response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store',...packet.headers});response.end(packet.bytes);return true;
    }
    if(operation==='export'&&request.method==='POST'){json(response,200,await bridge.export(id,await body(),controller.signal));return true;}
    if(operation.startsWith('exports/')&&request.method==='GET') {
      const {bytes,name}=await bridge.exportedFile(id,decodeURIComponent(operation.slice(8)));
      response.writeHead(200,{'Content-Type':name.endsWith('.tif')?'image/tiff':name.endsWith('.png')?'image/png':'image/jpeg','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store'});response.end(bytes);return true;
    }
    json(response,405,{error:{message:'不支持这个项目操作。'}});return true;
  }catch(error){
    if(response.headersSent){response.end();return true;}
    const code=error.code || 'PROJECT_FAILED',status=code.startsWith('STALE')?409:code==='PROJECT_SETUP_REQUIRED'?503:error.status || 400;
    json(response,status,{error:{code,message:/^E[A-Z_]+$/.test(code)?'项目文件暂时无法读取，请检查路径后重试。':error.message || '项目操作未完成，请重试。'}});return true;
  }
}
