import {spawn} from 'node:child_process';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {readFile,writeFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {buildPlugin,packageFiles,repositoryRoot} from './build-framelark-plugin.mjs';
import {installationGuide} from './installation-guide.mjs';
import {verifyInstalledPlugin} from './install-photography-eye.mjs';
import {runReleaseCodex,withFrameLarkInstallLock,sourceCatalog,sourceSnapshot,sameRoot,moveRuntime,backupPluginInstallation,restorePluginInstallation,assertInstallSelection,assertRollbackSource,captureExpectedInstallSelection} from './install-framelark-release.mjs';

const retry='npm run plugin:install:local'+(process.argv.includes('--photography-eye')?':photography-eye':''),codex=runReleaseCodex,digest=data=>createHash('sha256').update(data).digest('hex');
const exists=path=>stat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
async function prepare(folder){
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(folder,'skills/photo-retouch/scripts/setup.mjs')],{stdio:['ignore',2,2]});child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)throw Error('本地图片依赖准备失败，请检查 Node.js 与网络后重新运行 '+retry+'。');
}
function restoreArgs(current){
  const source=current.marketplaceSource?.sourceType==='git'?current.marketplaceSource.source:current.root;
  if(!source)throw Error('原市场来源无法重建。');
  const args=['plugin','marketplace','add',source];
  if(current.marketplaceSource?.sourceType==='git'&&typeof current.marketplaceSource.ref==='string')args.push('--ref',current.marketplaceSource.ref);
  return args;
}
async function installLocal(){
  const eyeOnly=process.argv.includes('--photography-eye'),name=eyeOnly?'framelark-eye':'framelark',marketplaceName=name,pluginId=name+'@'+marketplaceName;
  const current=structuredClone(codex(['plugin','marketplace','list']).marketplaces?.find(item=>item.name===marketplaceName));
  const prior=current?structuredClone(codex(['plugin','list','--marketplace',marketplaceName]).installed?.find(p=>p.pluginId===pluginId&&p.installed===true)):null;
  if(prior&&prior.enabled!==true)throw Error('原插件处于停用状态，已保留安装与来源；请先在 Codex 插件页明确启用，再运行 '+retry+'。');
  const originalFiles=prior?await sourceSnapshot(current.root,pluginId,await sourceCatalog(current.root,marketplaceName)):null;
  const output=resolve(repositoryRoot,'dist','local-'+name+'-'+randomUUID()),installationBackup=prior?await backupPluginInstallation(prior,{pluginId,backupDirectory:join(output,'previous-installation')}):null;let built,changed=false,attempted=false,complete=false,keepRecovery=false,committedSelection=null;
  try{
    built=await buildPlugin({variant:eyeOnly?'photography-eye':'full',output});
    const files=await packageFiles(built.folder),runtime=join(output,'prepared-runtime');
    // Prepare dependencies before replacing a working source. The source itself
    // stays clean; move its one runtime to the installed copy after registration.
    if(!eyeOnly){await prepare(built.folder);const prepared=join(built.folder,'skills/photo-retouch/node_modules');if(await exists(prepared))await rename(prepared,runtime);}
    const recoveryPath=join(output,'recovery.json'),recovery={marketplace:current||null,plugin:prior||null,files:originalFiles,installation:installationBackup};
    await writeFile(recoveryPath,JSON.stringify(recovery,null,2)+'\n',{mode:0o600});
    try{
      assertInstallSelection({marketplaceName,pluginId,current,plugin:prior,codex});
      changed=true;
      if(current)codex(['plugin','marketplace','remove',marketplaceName]);
      codex(['plugin','marketplace','add',built.marketplaceRoot]);
      attempted=true;const installed=codex(['plugin','add',pluginId]);
      if(installed.pluginId!==pluginId||!installed.installedPath||!isAbsolute(installed.installedPath))throw Error('Codex 返回了预期之外的本地安装目录。');
      committedSelection=await captureExpectedInstallSelection({marketplaceName,pluginId,sourceRoot:built.marketplaceRoot,sourceFolder:built.folder,version:built.version,installedPath:installed.installedPath,files,codex});
      if(!eyeOnly){
        const target=join(installed.installedPath,'skills/photo-retouch/node_modules');
        if(await exists(runtime))await moveRuntime(runtime,target);
        await prepare(installed.installedPath);
      }
      for(const file of files)if(digest(await readFile(join(installed.installedPath,file.name)))!==digest(file.data))throw Error('安装副本与本地构建内容不一致。');
      const verified=await verifyInstalledPlugin({pluginId,installedPath:installed.installedPath,skills:built.skills,version:built.version,codex});
      assertInstallSelection({marketplaceName,pluginId,codex,...committedSelection});
      complete=true;await rm(runtime,{recursive:true,force:true});await rm(recoveryPath,{force:true});
      const guide=installationGuide({names:built.skills,retouchReady:!eyeOnly,version:verified.version});
      console.log(JSON.stringify({ok:true,...verified,retouchDependencies:eyeOnly?'not-required':'ready',next:'Open a new Codex chat to load the installed plugin.',gettingStarted:guide,...(installationBackup?{previousInstallationBackup:dirname(installationBackup.backupPath)}:{})},null,2));console.error(guide.message);
    }catch(error){
      const failures=[],attempt=async action=>{try{await action();return true;}catch(restore){failures.push(restore.message);return false;}};
      if(changed&&error.code==='INSTALL_SELECTION_CHANGED')failures.push(error.message);
      else if(changed){
        let active;const observed=await attempt(async()=>{active=codex(['plugin','marketplace','list']).marketplaces?.find(p=>p.name===marketplaceName);});
        let owned=observed&&(!active||sameRoot(active.root,built.marketplaceRoot)||current&&sameRoot(active.root,current.root));
        if(owned)owned=await attempt(async()=>{
          if(committedSelection)assertInstallSelection({marketplaceName,pluginId,codex,...committedSelection});
          else assertRollbackSource({marketplaceName,pluginId,current,plugin:prior,sourceRoot:built.marketplaceRoot,targetVersion:built.version,targetSource:built.folder,codex});
        });
        if(observed&&!owned)failures.push('市场已由另一操作切换，已保留该来源。');
        else if(owned){
          if(attempted&&!prior)await attempt(async()=>{const installed=codex(['plugin','list','--marketplace',marketplaceName]).installed?.find(p=>p.pluginId===pluginId&&p.installed===true);if(installed)codex(['plugin','remove',pluginId]);});
          if(active&&sameRoot(active.root,built.marketplaceRoot))await attempt(async()=>{codex(['plugin','marketplace','remove',marketplaceName]);});
          const restoredSource=current?await attempt(async()=>{codex(restoreArgs(current));}):true;
          if(prior&&attempted&&restoredSource)await attempt(async()=>{
            const restored=codex(['plugin','add',pluginId]);
            if(restored.pluginId!==pluginId||!restored.installedPath||!isAbsolute(restored.installedPath))throw Error('原插件目录无法恢复。');
            if(installationBackup){if(!sameRoot(restored.installedPath,installationBackup.originalPath))throw Error('原安装绝对路径未恢复，备份已保留。');await restorePluginInstallation(installationBackup);}
            const manifest=JSON.parse(await readFile(join(restored.installedPath,'.codex-plugin/plugin.json'),'utf8')),state=codex(['plugin','list','--marketplace',marketplaceName]).installed?.find(p=>p.pluginId===pluginId);
            if(manifest.version!==prior.version||state?.installed!==true||state.enabled!==prior.enabled)throw Error('原插件版本或启用状态未恢复。');
            if(!installationBackup)for(const file of originalFiles)if(digest(await readFile(join(restored.installedPath,file.path)))!==file.sha256)throw Error('原插件内容未恢复。');
          });
        }
      }
      if(failures.length){keepRecovery=true;throw Error('本地安装失败：'+error.message+'；原安装自动恢复未完成：'+failures.join('；')+'。\n恢复记录：'+recoveryPath+'\n核对来源后重新运行 '+retry+'。',{cause:error});}
      throw Error(error.message+' 请重新运行 '+retry+'。',{cause:error});
    }
  }finally{if(!complete&&!keepRecovery)await rm(output,{recursive:true,force:true});}
}
try{await withFrameLarkInstallLock(installLocal);}catch(error){console.error('FrameLark 本地安装未完成：'+error.message);process.exitCode=1;}
