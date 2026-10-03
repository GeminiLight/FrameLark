import {cp,access,mkdir,readFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),update=args.includes('--update'),destination=args.find(a=>!a.startsWith('--'));
const source=fileURLToPath(new URL('../skills/photo-retouch/',import.meta.url)),target=destination?path.resolve(destination):path.join(os.homedir(),'.codex','skills','photo-retouch');
const legacy=path.join(os.homedir(),'.codex','skills','guangjian-retouch');
async function exists(folder){try{await access(folder);return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}}
const prior=await exists(target)?target:!destination&&await exists(legacy)?legacy:null;
if(prior){if(!update)throw Error('Skill 已安装。使用 --update 更新并备份现有版本，或指定新的目标目录。');const old=await readFile(path.join(prior,'SKILL.md'),'utf8').catch(()=> '');if(!/^name: (photo-retouch|guangjian-retouch)$/m.test(old))throw Error('该目录不是帧映修片 Skill，请选择新的安装目录。');}
await mkdir(path.dirname(target),{recursive:true});const stage=path.join(path.dirname(target),'.photo-retouch-install-'+randomUUID());
try{
  await cp(source,stage,{recursive:true,filter:src=>!src.split(path.sep).includes('node_modules')});
  if(prior)try{await cp(path.join(prior,'node_modules'),path.join(stage,'node_modules'),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  const code=await new Promise(resolve=>{const p=spawn(process.execPath,[path.join(stage,'scripts','setup.mjs')],{stdio:'inherit'});p.once('error',()=>resolve(1));p.once('exit',resolve);});
  if(code!==0)throw Error('依赖准备失败，原有 Skill 未改动。请检查网络后重试。');
  let backup;if(prior){const root=path.join(os.homedir(),'.codex','skill-backups');await mkdir(root,{recursive:true});backup=path.join(root,path.basename(prior)+'-'+Date.now());await rename(prior,backup);}
  try{await rename(stage,target);}catch(e){if(backup)await rename(backup,prior);throw e;}
  console.log('帧映修片 Skill 已'+(prior?'更新':'安装')+'：'+target+'\n在 Codex 中使用 $photo-retouch，并提供照片或项目路径。'+(prior&&prior!==target?'\n旧标识已迁移为 photo-retouch。':'')+(backup?'\n旧版备份：'+backup:''));
}catch(error){await rm(stage,{recursive:true,force:true});console.error(error.message);process.exitCode=1;}
