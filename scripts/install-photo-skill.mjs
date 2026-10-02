import {cp,access,mkdir,readFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),update=args.includes('--update'),destination=args.find(a=>!a.startsWith('--'));
const source=fileURLToPath(new URL('../skills/guangjian-retouch/',import.meta.url)),target=destination?path.resolve(destination):path.join(os.homedir(),'.codex','skills','guangjian-retouch');
let exists=false;try{await access(target);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
if(exists){if(!update)throw Error('Skill 已安装。使用 --update 更新并备份现有版本，或指定新的目标目录。');const old=await readFile(path.join(target,'SKILL.md'),'utf8').catch(()=> '');if(!/^name: guangjian-retouch$/m.test(old))throw Error('该目录不是光间修片 Skill，请选择新的安装目录。');}
await mkdir(path.dirname(target),{recursive:true});const stage=path.join(path.dirname(target),'.guangjian-install-'+randomUUID());
try{
  await cp(source,stage,{recursive:true,filter:src=>!src.split(path.sep).includes('node_modules')});
  if(exists)try{await cp(path.join(target,'node_modules'),path.join(stage,'node_modules'),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const code=await new Promise(resolve=>{const p=spawn(process.execPath,[path.join(stage,'scripts','setup.mjs')],{stdio:'inherit'});p.once('error',()=>resolve(1));p.once('exit',resolve);});
  if(code!==0)throw Error('依赖准备失败，原有 Skill 未改动。请检查网络后重试。');
  let backup;if(exists){const root=path.join(os.homedir(),'.codex','skill-backups');await mkdir(root,{recursive:true});backup=path.join(root,'guangjian-retouch-'+Date.now());await rename(target,backup);}
  try{await rename(stage,target);}catch(e){if(backup)await rename(backup,target);throw e;}
  console.log('光间修片 Skill 已'+(exists?'更新':'安装')+'：'+target+'\n在 Codex 中使用 $guangjian-retouch，并提供照片或项目路径。'+(backup?'\n旧版备份：'+backup:''));
}catch(error){await rm(stage,{recursive:true,force:true});console.error(error.message);process.exitCode=1;}
