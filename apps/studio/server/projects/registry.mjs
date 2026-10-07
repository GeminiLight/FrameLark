import {readFile,writeFile,mkdir,rename,rm,stat,open} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failure=(code,message)=>Object.assign(new Error(message),{code});

async function readOwner(lock){try{return JSON.parse(await readFile(join(lock,'owner'),'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}}
const directory=lock=>stat(lock).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
async function abandoned(lock,ownerlessMtime){
  const owner=await readOwner(lock);
  if(owner&&Number.isInteger(owner.pid)&&owner.pid>0){try{process.kill(owner.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;if(error.code==='EPERM')return false;throw error;}}
  const info=await directory(lock);
  return Boolean(info&&Date.now()-(ownerlessMtime??info.mtimeMs)>10000);
}

// Recovery uses the same owner/token protocol as the registry lock. A crash in
// recovery is recoverable too; queued reclaimers never retire a live lock.
async function acquire(lock,deadline){
  while(true){
    let created=false;const token=randomUUID();
    try{
      await mkdir(lock,{mode:0o700});created=true;
      await writeFile(join(lock,'owner'),JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});
      return async()=>{if((await readOwner(lock))?.token===token)await rm(lock,{recursive:true,force:true});};
    }catch(error){
      if(created){await rm(lock,{recursive:true,force:true});throw error;}
      if(error.code==='ENOENT')return null;
      if(error.code!=='EEXIST')throw error;
    }
    if(await abandoned(lock)){
      const before=await directory(lock);
      if(before){const release=await acquire(join(lock,'recovery'),deadline);
        if(release)try{
          // Creating the recovery child updates its parent's mtime. Preserve
          // the observed ownerless age, and ensure this is still that directory.
          if((await directory(lock))?.ino===before.ino&&await abandoned(lock,before.mtimeMs)){const retired=lock+'.abandoned-'+randomUUID();await rename(lock,retired);await rm(retired,{recursive:true,force:true});}
        }finally{await release();}
      }
    }
    if(Date.now()>=deadline)throw failure('PROJECT_REGISTRY_BUSY','另一工作台正在保存项目列表，请稍后再试。');
    await pause(25);
  }
}

export class FileRegistry {
  constructor(file){this.file=resolve(file);this.lock=this.file+'.lock';}
  async read(){
    let value;try{value=JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}
    if(!value||typeof value!=='object'||Array.isArray(value))throw failure('PROJECT_REGISTRY_INVALID','项目列表无法读取，请保留文件并检查备份。');
    return value;
  }
  async set(id,record){
    await mkdir(dirname(this.file),{recursive:true,mode:0o700});
    const token=randomUUID(),release=await acquire(this.lock,Date.now()+5000);
    if(!release)throw failure('PROJECT_REGISTRY_UNAVAILABLE','项目列表位置已变化，请重新打开工作目录。');
    try{
      const records={...await this.read(),[id]:record},temp=this.file+'.'+token+'.tmp';
      try{
        const handle=await open(temp,'wx',0o600);
        try{await handle.writeFile(JSON.stringify(records));await handle.sync();}finally{await handle.close();}
        await rename(temp,this.file);
      }finally{await rm(temp,{force:true});}
      return records;
    }finally{
      await release();
    }
  }
}
