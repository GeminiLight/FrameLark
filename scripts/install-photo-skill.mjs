import {cp,access,mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {installationGuide} from './installation-guide.mjs';
import {maintainedPluginFiles,validatePackagedLinks,repositoryRoot} from './build-framelark-plugin.mjs';

const catalog={
  'photo-retouch':{label:'照片精修',setup:true,legacy:'guangjian-retouch'},
  'photography-eye':{label:'摄影眼',setup:false},
  'photo-series':{label:'组图册',setup:false}
};
const help=`FrameLark 独立 Skill 安装\n\n默认精修台：node scripts/install-photo-skill.mjs [目标目录] [--update]\n单独摄影眼：node scripts/install-photo-skill.mjs --skill photography-eye [目标目录] [--update]\n组图册与精修引擎：node scripts/install-photo-skill.mjs --skill photo-series [宿主的 skills 根目录] [--update]\n三套一起：node scripts/install-photo-skill.mjs --all [宿主的 skills 根目录] [--update]\n\n组图册共享 photo-retouch 引擎，因此一起安装；不指定目录时安装到 ~/.codex/skills/，更新前保存旧版备份。`;
async function exists(folder){try{await access(folder);return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}}
function options(args){
  let skill='photo-retouch',all=false,update=false,destination,selected=false;
  for(let i=0;i<args.length;i++){
    const value=args[i];
    if(value==='--update')update=true;
    else if(value==='--all')all=true;
    else if(value==='--skill'){skill=args[++i];selected=true;if(!catalog[skill])throw Error('请选择 photo-retouch、photography-eye 或 photo-series。');}
    else if(value.startsWith('--'))throw Error('未知选项：'+value+'。运行 --help 查看用法。');
    else if(destination)throw Error('只能提供一个目标目录。');
    else destination=value;
  }
  if(all&&selected)throw Error('--all 与 --skill 不能同时使用。');
  return {names:all?Object.keys(catalog):skill==='photo-series'?['photo-retouch','photo-series']:[skill],all,update,destination};
}
async function install({names,all,update,destination}){
  const defaultHome=path.join(os.homedir(),'.codex','skills');
  const root=destination?path.resolve(destination):defaultHome;
  const entries=[];
  // Validate all existing destinations before preparing or replacing either skill.
  for(const name of names){
    const target=destination&&names.length===1?root:path.join(root,name);
    const legacy=!destination&&catalog[name].legacy?path.join(defaultHome,catalog[name].legacy):null;
    const prior=await exists(target)?target:legacy&&await exists(legacy)?legacy:null;
    if(prior){
      if(!update)throw Error(`${name} 已安装。使用 --update 更新并备份旧版，或指定新的目标目录。`);
      const old=await readFile(path.join(prior,'SKILL.md'),'utf8').catch(()=> '');
      const id=old.match(/^name:\s*(\S+)\s*$/m)?.[1];
      if(id!==name&&(!catalog[name].legacy||id!==catalog[name].legacy))throw Error('目标目录不是对应的 FrameLark Skill：'+prior);
    }
    entries.push({name,target,prior,stage:path.join(path.dirname(target),'.framelark-install-'+randomUUID())});
  }
  const files=await maintainedPluginFiles(repositoryRoot,names.map(name=>'skills/'+name+'/'));
  for(const name of names)if(!files.some(file=>file.name==='skills/'+name+'/SKILL.md'))throw Error('Missing maintained Skill: '+name);
  validatePackagedLinks(files);
  try{
    for(const entry of entries){
      await mkdir(path.dirname(entry.target),{recursive:true});
      const prefix='skills/'+entry.name+'/';
      for(const file of files.filter(file=>file.name.startsWith(prefix))){const target=path.join(entry.stage,file.name.slice(prefix.length));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.data,{mode:0o600});}
      if(entry.prior&&catalog[entry.name].setup)try{await cp(path.join(entry.prior,'node_modules'),path.join(entry.stage,'node_modules'),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
      if(catalog[entry.name].setup){
        const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(entry.stage,'scripts','setup.mjs')],{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
        if(code!==0)throw Error('图片依赖准备失败；已有 Skill 保持原样。请检查 Node.js 与网络后重试。');
      }
    }
    for(const entry of entries){
      if(entry.prior){
        const backupRoot=destination?path.join(path.dirname(entry.target),'.framelark-skill-backups'):path.join(os.homedir(),'.codex','skill-backups');
        await mkdir(backupRoot,{recursive:true});
        entry.backup=path.join(backupRoot,path.basename(entry.prior)+'-'+Date.now()+'-'+randomUUID());
        await rename(entry.prior,entry.backup);
      }
      await rename(entry.stage,entry.target);entry.installed=true;
    }
  }catch(error){
    for(const entry of entries.slice().reverse()){
      if(entry.installed)await rm(entry.target,{recursive:true,force:true});
      if(entry.backup)await rename(entry.backup,entry.prior);
    }
    throw error;
  }finally{
    for(const entry of entries)await rm(entry.stage,{recursive:true,force:true});
  }
  for(const entry of entries)console.log(`${catalog[entry.name].label} Skill 已${entry.prior?'更新':'安装'}：${entry.target}\n在 Agent 中使用 $${entry.name}。${entry.backup?'\n旧版备份：'+entry.backup:''}`);
  console.log('重新加载 Skill 列表或开启新对话后使用。');
  console.error(installationGuide({names,retouchReady:names.includes('photo-retouch')}).message);
}
try{
  const args=process.argv.slice(2);
  if(args.includes('--help')||args.includes('-h'))console.log(help);
  else await install(options(args));
}catch(error){console.error(error.message);process.exitCode=1;}
