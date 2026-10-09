import {mkdir,readFile,writeFile,lstat,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failure=(code,message)=>Object.assign(Error(message),{code});
const sameDirectory=(first,second)=>Boolean(first&&second&&first.dev===second.dev&&first.ino===second.ino&&first.birthtimeMs===second.birthtimeMs);
async function directory(lock){
  try{const info=await lstat(lock);if(!info.isDirectory()||info.isSymbolicLink())throw failure('FILE_LOCK_INVALID','文件锁位置不是普通目录，请保留内容并核对路径。');return info;}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function owner(lock){
  let value;try{value=JSON.parse(await readFile(join(lock,'owner'),'utf8'));}catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
  // Older projects wrote a scalar PID. A live old owner remains authoritative.
  if(Number.isInteger(value)&&value>0)return {pid:value};
  if(value&&Number.isInteger(value.pid)&&value.pid>0)return value;
  return null;
}
async function abandoned(lock,observedAge,staleMs){
  const selected=await owner(lock);
  if(selected){try{process.kill(selected.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;if(error.code==='EPERM')return false;throw error;}}
  const info=await directory(lock);return Boolean(info&&Date.now()-(observedAge??info.mtimeMs)>=staleMs);
}
async function acquire(lock,deadline,options){
  while(true){
    const token=randomUUID();let created=false,identity;
    try{
      await mkdir(lock,{mode:0o700});created=true;identity=await directory(lock);
      await writeFile(join(lock,'owner'),JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});
      if(!sameDirectory(identity,await directory(lock))||(await owner(lock))?.token!==token)throw failure('FILE_LOCK_LOST','文件锁位置在保存前变化，请重新读取后重试。');
      return async()=>{if(sameDirectory(identity,await directory(lock))&&(await owner(lock))?.token===token)await rm(lock,{recursive:true,force:true});};
    }catch(error){
      if(created){
        if(sameDirectory(identity,await directory(lock))){const selected=await owner(lock);if(!selected||selected.token===token)await rm(lock,{recursive:true,force:true});}
        throw error;
      }
      if(error.code==='ENOENT')return null;
      if(error.code!=='EEXIST')throw error;
    }
    const observed=await directory(lock);
    if(observed&&await abandoned(lock,observed.mtimeMs,options.staleMs)){
      const release=await acquire(join(lock,'recovery'),deadline,options);
      if(release)try{
        // Recovery itself has an owner/token. Recheck the original directory
        // and owner after admission; an earlier observation cannot retire a
        // new lock acquired by another process.
        if(sameDirectory(observed,await directory(lock))&&await abandoned(lock,observed.mtimeMs,options.staleMs)){
          const retired=lock+'.abandoned-'+randomUUID();await rename(lock,retired);await rm(retired,{recursive:true,force:true});
        }
      }finally{await release();}
    }
    if(Date.now()>=deadline)throw failure(options.busyCode,options.busyMessage);
    await pause(options.retryMs);
  }
}

export async function withFileLock(lockDirectory,operation,{timeoutMs=3150,staleMs=5000,retryMs=70,busyCode='FILE_BUSY',busyMessage='文件正在保存，请稍后重试。'}={}){
  if(typeof operation!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<0||!Number.isFinite(staleMs)||staleMs<0||!Number.isFinite(retryMs)||retryMs<=0)throw TypeError('Invalid file lock options');
  const release=await acquire(resolve(lockDirectory),Date.now()+timeoutMs,{staleMs,retryMs,busyCode,busyMessage});
  if(!release)throw failure('FILE_LOCK_LOST','文件锁父目录已变化，请重新读取后重试。');
  try{return await operation();}finally{await release();}
}
