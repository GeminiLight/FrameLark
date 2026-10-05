import http from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {handleRequest,closeServices,port,host} from './app.mjs';

export function startStudio(){
  const server=http.createServer(handleRequest);
  server.on('close',()=>{closeServices();});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{closeServices();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();});
  server.on('error',error=>{
    console.error(error.code==='EADDRINUSE'
      ? `端口 ${port} 已被占用。请停止之前的工作台，或设置 PORT 使用其他端口。`
      : `工作台未能启动：${error.message}`);
    process.exitCode=1;
  });
  server.listen(port, host, () => console.log(`帧好工作台已启动：http://localhost:${server.address().port}\n未配置视觉模型时，仍可上传、手动精修和导出。按 Ctrl+C 停止。`));
  return server;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)startStudio();
