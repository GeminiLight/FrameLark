const json=(response,status,value)=>{if(!response.destroyed){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(value));}};
export async function handleCollectionRoutes(request,response,url,{collections,readBody,allowed,cloud}){
  if(!url.pathname.startsWith('/api/collections'))return false;
  if(cloud||!allowed(request,request.method!=='GET')){json(response,403,{error:{code:'FORBIDDEN_ORIGIN',message:'共享文件组图仅在本机工作台可用。'}});return true;}
  const controller=new AbortController();response.once('close',()=>{if(!response.writableEnded)controller.abort();});
  const body=async()=>JSON.parse((await readBody(request,2*1024*1024)).toString('utf8'));
  try{
    if(url.pathname==='/api/collections'&&request.method==='GET'){json(response,200,{collections:await collections.list()});return true;}
    if(url.pathname==='/api/collections/register'&&request.method==='POST'){json(response,200,await collections.register((await body()).path));return true;}
    if(url.pathname==='/api/collections/create'&&request.method==='POST'){json(response,200,await collections.create(await body()));return true;}
    const match=url.pathname.match(/^\/api\/collections\/([-\w]{1,80})(?:\/(.*))?$/);
    if(!match){json(response,404,{error:{code:'COLLECTION_NOT_FOUND',message:'找不到这个组图操作。'}});return true;}
    const [,id,operation='']=match;
    if(!operation&&request.method==='GET'){json(response,200,await collections.get(id));return true;}
    if(operation==='events'&&request.method==='GET'){
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});
      const close=await collections.subscribe(id,event=>{if(!response.destroyed&&!response.writableEnded)response.write('data: '+JSON.stringify(event)+'\n\n');});
      response.once('close',close);if(response.destroyed)close();return true;
    }
    if(['brief','plan'].includes(operation)&&request.method==='POST'){json(response,200,await collections[operation](id,await body()));return true;}
    if(operation==='export'&&request.method==='POST'){json(response,200,await collections.export(id,await body(),{signal:controller.signal}));return true;}
    if(operation.startsWith('exports/')&&request.method==='GET'){
      const parts=operation.split('/');if(parts.length!==3)throw Object.assign(new Error('组图下载路径无效。'),{code:'COLLECTION_FILE'});
      const file=await collections.exportedFile(id,parts[1],decodeURIComponent(parts[2]));
      response.writeHead(200,{'Content-Type':file.name.endsWith('.json')?'application/json':file.name.endsWith('.png')?'image/png':'image/jpeg','Cache-Control':'no-store','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`});response.end(file.bytes);return true;
    }
    json(response,405,{error:{code:'COLLECTION_METHOD',message:'不支持这个组图操作。'}});return true;
  }catch(error){
    if(response.headersSent){response.end();return true;}
    const code=error.code||'COLLECTION_FAILED';json(response,code.startsWith('STALE')?409:code==='COLLECTION_NOT_FOUND'?404:400,
      {error:{code,message:/^E[A-Z_]+$/.test(code)?'组图文件暂时无法读取，请检查目录后重试。':error.message||'组图操作未完成。'}});return true;
  }
}
