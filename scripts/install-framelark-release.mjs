// Release bootstrap: Node built-ins only; no checkout, Git or npm package needed.
import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rename,rm,cp,stat,lstat} from 'node:fs/promises';
import {realpathSync,existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inflateRawSync} from 'node:zlib';

export const releaseRepository='GeminiLight/FrameLark';
const github='https://github.com/'+releaseRepository;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const limits={archive:16*1024*1024,expanded:32*1024*1024,files:1000};
const versionPattern=/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
function releaseSkills(pkg){
  if(pkg.name==='framelark-eye')return ['photography-eye'];
  const [major,minor,patch]=pkg.version.split(/[.-]/).slice(0,3).map(Number);
  return major>0||minor>1||minor===1&&patch>=10
    ?['photo-retouch','photography-eye','photo-series']:['photo-retouch','photography-eye'];
}
const fail=message=>{throw Error(message);};
const safePath=path=>typeof path==='string'&&/^[\w./-]+$/.test(path)&&!path.startsWith('/')&&!path.split('/').some(p=>!p||p==='.'||p==='..'||['.git','node_modules','.raw-venv','.guangjian','photos','projects','exports','drafts'].includes(p)||/^\.env(?:\.|$)/.test(p));

export function runReleaseCodex(args){
  try{let command=process.env.FRAMELARK_CODEX_BIN||'codex',prefix=[];if(process.platform==='win32'&&!process.env.FRAMELARK_CODEX_BIN){const paths=execFileSync('where.exe',['codex'],{encoding:'utf8'}).trim().split(/\r?\n/),exe=paths.find(path=>/\.exe$/i.test(path)),wrapper=paths.map(path=>join(dirname(path),'node_modules/@openai/codex/bin/codex.js')).find(existsSync);if(exe)command=exe;else if(wrapper){command=process.execPath;prefix=[wrapper];}else fail('找不到可执行的 Codex，请设置 FRAMELARK_CODEX_BIN 指向 codex.exe。');}return JSON.parse(execFileSync(command,[...prefix,...args,'--json'],{encoding:'utf8',maxBuffer:2_000_000,stdio:['ignore','pipe','inherit']}));}
  catch(error){throw Error(error.code==='ENOENT'?'需要支持插件的 Codex CLI。':'Codex 安装操作失败，请检查 CLI 和网络后重试。',{cause:error});}
}
export async function verifyReleasePlugin({pluginId,installedPath,skills,version,codex=runReleaseCodex}){
  if(!installedPath||!isAbsolute(installedPath))fail('Codex 未返回有效安装目录。');
  const manifest=JSON.parse(await readFile(join(installedPath,'.codex-plugin/plugin.json'),'utf8'));
  if(manifest.name!==pluginId.split('@')[0]||manifest.version!==version||manifest.skills!=='./skills/'||manifest.mcpServers||manifest.apps||manifest.hooks)fail('安装后的插件身份与版本包不一致。');
  const actual=(await readdir(join(installedPath,'skills'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  if(JSON.stringify(actual)!==JSON.stringify([...skills].sort()))fail('安装后的 Skill 内容与预期不一致。');
  const status=codex(['plugin','list','--marketplace','framelark']).installed?.find(p=>p.pluginId===pluginId);
  if(status?.installed!==true||status.enabled!==true)fail('插件尚未安装或未启用，请在 Codex 插件页检查。');
  return {pluginId,installedPath,version,skills,installed:true,enabled:true};
}
async function download(url,maxBytes,fetchImpl){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
  try{
    const response=await fetchImpl(url,{signal:controller.signal,headers:{Accept:'application/vnd.github+json','User-Agent':'FrameLark-release-installer'}});
    if(!response.ok)fail(response.status===404?'尚未找到公开版本包，请稍后重试或使用本地开发构建。':'版本包下载失败：HTTP '+response.status);
    if(Number(response.headers.get('content-length'))>maxBytes)fail('版本下载内容超过大小限制。');
    const chunks=[];let size=0;
    if(!response.body)fail('版本下载内容为空。');
    for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)fail('版本下载内容超过大小限制。');chunks.push(Buffer.from(chunk));}
    return Buffer.concat(chunks);
  }finally{clearTimeout(timer);}
}
export function validateReleaseManifest(value,tag){
  if(value?.schema!==1||value.repository!==releaseRepository||value.tag!==tag||!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)||!Array.isArray(value.plugins)||value.plugins.length!==2)fail('版本清单身份不一致。');
  const names=new Set();
  for(const pkg of value.plugins){
    if(!['framelark','framelark-eye'].includes(pkg.name)||names.has(pkg.name)||!versionPattern.test(pkg.version)||pkg.asset!==pkg.name+'-'+pkg.version+'.zip'||!Number.isSafeInteger(pkg.bytes)||pkg.bytes<1||pkg.bytes>limits.archive||!/^[a-f0-9]{64}$/.test(pkg.sha256)||!Array.isArray(pkg.files)||!pkg.files.length||pkg.files.length>limits.files)fail('版本包记录无效。');
    names.add(pkg.name);let size=0;const paths=new Set();
    for(const file of pkg.files){if(!safePath(file.path)||!(file.path==='plugin.json'||file.path==='.codex-plugin/plugin.json'||file.path.startsWith('assets/')||releaseSkills(pkg).some(skill=>file.path.startsWith('skills/'+skill+'/')))||paths.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||! /^[a-f0-9]{64}$/.test(file.sha256))fail('版本文件记录无效。');paths.add(file.path);size+=file.bytes;}
    if(size>limits.expanded)fail('版本展开大小超过限制。');
    if(pkg.name==='framelark'&&'v'+pkg.version!==tag)fail('统一插件版本与发布标签不一致。');
    for(const skill of releaseSkills(pkg))if(!paths.has('skills/'+skill+'/SKILL.md'))fail('版本包缺少必需的 Skill：'+skill);
  }
  return value;
}

// Parse only the bounded regular-file ZIP format emitted by our release builder.
// Every local and central header agrees; each output is checksum-bound by manifest.
export function releaseArchiveFiles(bytes,pkg){
  if(bytes.length!==pkg.bytes||digest(bytes)!==pkg.sha256)fail('版本包校验失败，已有安装保留。');
  const end=bytes.length-22;if(end<0||bytes.readUInt32LE(end)!==0x06054b50||bytes.readUInt16LE(end+20)!==0||bytes.readUInt32LE(end+4)!==0)fail('版本包 ZIP 目录无效。');
  const count=bytes.readUInt16LE(end+10),start=bytes.readUInt32LE(end+16),centralSize=bytes.readUInt32LE(end+12);
  if(count!==pkg.files.length||bytes.readUInt16LE(end+8)!==count||start+centralSize!==end)fail('版本包文件数量不一致。');
  const expected=new Map(pkg.files.map(f=>[f.path,f])),result=[],ranges=[];let at=start;
  for(let n=0;n<count;n++){
    if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)fail('版本包 ZIP 目录损坏。');
    const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),size=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42);
    if(at+46+nameLength+extra+comment>end||flags!==0x800||method!==8||(bytes.readUInt32LE(at+38)>>>16&0xf000)===0xa000)fail('版本包包含不支持的文件类型。');
    const name=bytes.subarray(at+46,at+46+nameLength).toString('utf8'),prefix=pkg.name+'/',path=name.startsWith(prefix)?name.slice(prefix.length):'',record=expected.get(path);
    if(!safePath(path)||!record||record.bytes!==size)fail('版本包文件路径或大小不一致。');
    if(offset+30>start||bytes.readUInt32LE(offset)!==0x04034b50||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method||bytes.readUInt32LE(offset+14)!==bytes.readUInt32LE(at+16)||bytes.readUInt32LE(offset+18)!==compressed||bytes.readUInt32LE(offset+22)!==size)fail('版本包 ZIP 文件头不一致。');
    const localName=bytes.readUInt16LE(offset+26),localExtra=bytes.readUInt16LE(offset+28),dataStart=offset+30+localName+localExtra;
    if(dataStart+compressed>start||bytes.subarray(offset+30,offset+30+localName).toString('utf8')!==name)fail('版本包 ZIP 范围无效。');
    const data=inflateRawSync(bytes.subarray(dataStart,dataStart+compressed),{maxOutputLength:Math.max(1,size)});
    if(data.length!==size||digest(data)!==record.sha256)fail('版本文件校验失败。');
    result.push({path,data});expected.delete(path);ranges.push([offset,dataStart+compressed]);at+=46+nameLength+extra+comment;
  }
  let next=0;for(const [a,b] of ranges.sort((a,b)=>a[0]-b[0])){if(a!==next)fail('版本包 ZIP 文件范围重叠或不连续。');next=b;}
  if(next!==start||at!==end||expected.size)fail('版本包 ZIP 目录不完整。');
  return result;
}
const exists=path=>stat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
async function verifySourceCache(folder,files){
  const changed=()=>fail('已有版本缓存发生变化，已保留。请先核对本地修改。');
  if(!(await lstat(folder)).isDirectory())changed();
  const expected=new Map(files.map(file=>[file.path,file.data]));
  async function walk(path=''){
    for(const entry of await readdir(join(folder,path),{withFileTypes:true})){
      const name=path?path+'/'+entry.name:entry.name;
      if(entry.isDirectory()){
        if(![...expected.keys()].some(file=>file.startsWith(name+'/')))changed();
        await walk(name);
      }else if(entry.isFile()){
        const bytes=expected.get(name);
        if(!bytes||digest(await readFile(join(folder,name)))!==digest(bytes))changed();
        expected.delete(name);
      }else changed();
    }
  }
  await walk();if(expected.size)changed();
}
async function setup(folder){
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(folder,'skills/photo-retouch/scripts/setup.mjs')],{stdio:['ignore',2,2]});child.once('error',reject);child.once('exit',resolve);});
  if(code!==0)fail('修图依赖未准备完成，未报告安装成功。请检查 Node.js 与网络后重试。');
}
function sameRoot(first,second){
  const canonical=path=>{try{return realpathSync(path);}catch{return resolve(path);}};
  return canonical(first)===canonical(second);
}
function canonicalOrigin(current){
  // A developer's local build can be nested inside the official Git checkout.
  // Only migrate a Git marketplace rooted at the checkout itself.
  if(current.marketplaceSource?.sourceType&&current.marketplaceSource.sourceType!=='git')return null;
  const root=current.root;
  try{const top=execFileSync('git',['-C',root,'rev-parse','--show-toplevel'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(realpathSync(top)!==realpathSync(root))return null;const url=execFileSync('git',['-C',root,'remote','get-url','origin'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();return /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)GeminiLight\/(?:FrameLark|frameyn)(?:\.git)?\/?$/i.test(url)?url:null;}catch{return null;}
}
async function moveRuntime(source,target){
  if(await exists(target))return;
  await mkdir(dirname(target),{recursive:true});
  try{await rename(source,target);}catch(error){if(error.code!=='EXDEV')throw error;await cp(source,target,{recursive:true,verbatimSymlinks:true});await rm(source,{recursive:true,force:true});}
}

async function sourceCatalog(root){
  const value=JSON.parse(await readFile(join(root,'.agents/plugins/marketplace.json'),'utf8'));
  if(value.name!=='framelark'||!Array.isArray(value.plugins)||value.plugins.some(p=>!['framelark','framelark-eye'].includes(p.name)))fail('原市场包含其他插件或记录无效，已保留来源。');
  return value;
}
async function sourceSnapshot(root,pluginId,catalog){
  const name=pluginId.split('@')[0],entry=catalog.plugins.find(p=>p.name===name);
  if(entry?.source?.source!=='local'||typeof entry.source.path!=='string')fail('无法核对原插件来源，已保留安装状态。');
  const folder=resolve(root,entry.source.path),files=[];
  async function walk(path){
    const file=join(folder,path),info=await lstat(file);
    if(info.isSymbolicLink())fail('原插件来源包含链接，已保留安装状态。');
    if(info.isDirectory()){
      for(const child of await readdir(file))if(!['node_modules','.raw-venv','__pycache__','.DS_Store'].includes(child))await walk(path+'/'+child);
    }else if(info.isFile())files.push({path,sha256:digest(await readFile(file))});
    else fail('原插件来源包含不支持的文件。');
  }
  await walk('.codex-plugin/plugin.json');await walk('skills');
  for(const path of ['plugin.json','assets'])if(await exists(join(folder,path)))await walk(path);
  return files;
}
async function atomicCatalog(path,bytes){
  if(bytes===null){await rm(path,{force:true});return;}
  await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID();
  try{await writeFile(temporary,bytes);await rename(temporary,path);}finally{await rm(temporary,{force:true});}
}

export async function installFrameLarkRelease({photographyEye=false,tag,root=process.env.FRAMELARK_INSTALL_ROOT||join(homedir(),'.local/share/framelark'),codex=runReleaseCodex,fetchImpl=fetch,prepareRuntime=setup}={}){
  const [major,minor]=process.versions.node.split('.').map(Number);if(major<20||major===20&&minor<9)fail('需要 Node.js 20.9+。');
  if(tag&&!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag))fail('版本号无效。');
  root=resolve(root);
  const name=photographyEye?'framelark-eye':'framelark',pluginId=name+'@framelark',marketplaceRoot=join(root,'marketplace'),catalogPath=join(marketplaceRoot,'.agents/plugins/marketplace.json');
  const current=codex(['plugin','marketplace','list']).marketplaces?.find(m=>m.name==='framelark');
  if(current&&!current.root)fail('当前 framelark 市场没有可用的本地来源，已保留配置。');
  const priorOrigin=current&&!sameRoot(current.root,marketplaceRoot)?canonicalOrigin(current):null;
  if(current&&!sameRoot(current.root,marketplaceRoot)&&!priorOrigin)fail('framelark 市场指向其他来源或本地构建，已保留原配置。请明确选择版本包安装来源后再继续。');
  const priorStates=current?(codex(['plugin','list','--marketplace','framelark']).installed||[]):[],priorPlugin=priorStates.find(p=>p.pluginId===pluginId&&p.installed===true);
  // The CLI has no enable/disable operation. Never enable a previously disabled
  // plugin implicitly, because its original state could not be rolled back.
  if(priorPlugin&&priorPlugin.enabled!==true)fail('原插件处于停用状态，已保留安装与来源。请先在 Codex 插件页明确启用它，再运行安装器更新。');
  const priorCatalog=await readFile(catalogPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const catalog=priorCatalog?JSON.parse(priorCatalog):{name:'framelark',interface:{displayName:'FrameLark · 帧好'},plugins:[]};
  if(catalog.name!=='framelark'||!Array.isArray(catalog.plugins)||catalog.plugins.some(p=>!['framelark','framelark-eye'].includes(p.name)))fail('本地版本市场记录发生变化，已保留。');
  const originalCatalog=priorOrigin?await sourceCatalog(current.root):catalog;
  const originalFiles=priorPlugin?await sourceSnapshot(current.root,pluginId,originalCatalog):null;
  // A Git migration switches the entire marketplace, even when only one plugin
  // is selected. Preserve every existing variant as a verified package source.
  const names=[...new Set([name,...(priorOrigin?originalCatalog.plugins.map(p=>p.name):[])])];
  const manifestURL=github+'/releases/'+(tag?'download/'+tag:'latest/download')+'/framelark-release.json';
  const value=JSON.parse((await download(manifestURL,512*1024,fetchImpl)).toString('utf8'));
  const manifest=validateReleaseManifest(value,tag||value.tag),releaseTag=manifest.tag,pkg=manifest.plugins.find(p=>p.name===name),skills=releaseSkills(pkg);
  const packages=[];
  for(const variant of names){
    const record=manifest.plugins.find(p=>p.name===variant);
    packages.push({pkg:record,files:releaseArchiveFiles(await download(github+'/releases/download/'+releaseTag+'/'+record.asset,limits.archive,fetchImpl),record)});
  }
  await mkdir(root,{recursive:true});const temporary=await mkdtemp(join(root,'.install-')),runtime=join(temporary,'runtime');
  let catalogChanged=false,registered=false,removedOriginal=false,pluginAttempted=false;
  try{
    for(const packageRecord of packages){
      const {pkg:record,files}=packageRecord,stage=join(temporary,record.name),target=join(marketplaceRoot,'releases',releaseTag,record.name);
      for(const file of files){const path=join(stage,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.data,{mode:0o600});}
      const identity=JSON.parse(await readFile(join(stage,'.codex-plugin/plugin.json'),'utf8'));
      if(identity.name!==record.name||identity.version!==record.version||identity.skills!=='./skills/'||identity.mcpServers||identity.apps||identity.hooks)fail('版本插件身份无效。');
      const actual=(await readdir(join(stage,'skills'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
      if(JSON.stringify(actual)!==JSON.stringify([...releaseSkills(record)].sort()))fail('版本包的 Skill 内容不一致。');
      if(record.name===name&&!photographyEye){
        await prepareRuntime(stage);const prepared=join(stage,'skills/photo-retouch/node_modules');if(await exists(prepared))await rename(prepared,runtime);
      }
      if(await exists(target))await verifySourceCache(target,files);
      else{await mkdir(dirname(target),{recursive:true});await rename(stage,target);}
      catalog.plugins=catalog.plugins.filter(p=>p.name!==record.name);
      catalog.plugins.push({name:record.name,source:{source:'local',path:'./releases/'+releaseTag+'/'+record.name},policy:{installation:'AVAILABLE',authentication:'ON_USE'},category:'Creativity'});
    }
    await atomicCatalog(catalogPath,Buffer.from(JSON.stringify(catalog,null,2)+'\n'));catalogChanged=true;
    if(priorOrigin){removedOriginal=true;codex(['plugin','marketplace','remove','framelark']);}
    registered=true;codex(['plugin','marketplace','add',marketplaceRoot]);
    pluginAttempted=true;const installed=codex(['plugin','add',pluginId]);
    if(installed.pluginId!==pluginId||!installed.installedPath||!isAbsolute(installed.installedPath))fail('Codex 返回了预期之外的安装结果。');
    if(!photographyEye){if(await exists(runtime))await moveRuntime(runtime,join(installed.installedPath,'skills/photo-retouch/node_modules'));await prepareRuntime(installed.installedPath);}
    for(const file of packages.find(p=>p.pkg.name===name).files)if(digest(await readFile(join(installed.installedPath,file.path)))!==digest(file.data))fail('安装副本与版本包内容不一致，未报告成功。');
    const verified=await verifyReleasePlugin({pluginId,installedPath:installed.installedPath,skills,version:pkg.version,codex});
    return {ok:true,...verified,release:releaseTag,source:'github-release',retouchDependencies:photographyEye?'not-required':'ready',archiveBytes:pkg.bytes,next:'new-chat'};
  }catch(error){
    if(!catalogChanged)throw error;
    const failures=[],attempt=async action=>{try{await action();return true;}catch(restore){failures.push(restore.message);return false;}};
    // Remove only a plugin created by this attempt. Existing installations and
    // their version caches stay available for reinstatement from the old source.
    if(pluginAttempted&&!priorPlugin)await attempt(async()=>{
      const installed=codex(['plugin','list','--marketplace','framelark']).installed?.find(p=>p.pluginId===pluginId&&p.installed===true);
      if(installed)codex(['plugin','remove',pluginId]);
    });
    const restoredCatalog=await attempt(()=>atomicCatalog(catalogPath,priorCatalog));
    if(registered&&(!current||priorOrigin))await attempt(async()=>{
      const active=codex(['plugin','marketplace','list']).marketplaces?.find(p=>p.name==='framelark');
      if(active?.root&&sameRoot(active.root,marketplaceRoot))codex(['plugin','marketplace','remove','framelark']);
    });
    let restoredSource=!current;
    if(current&&(registered||removedOriginal))restoredSource=await attempt(async()=>{
      const source=current.marketplaceSource?.sourceType==='git'?(current.marketplaceSource.source||priorOrigin):await exists(current.root)?current.root:priorOrigin;
      const args=['plugin','marketplace','add',source];
      if(current.marketplaceSource?.sourceType==='git'&&typeof current.marketplaceSource.ref==='string')args.push('--ref',current.marketplaceSource.ref);
      codex(args);
    });
    else if(current)restoredSource=true;
    if(priorPlugin&&pluginAttempted&&restoredCatalog&&restoredSource)await attempt(async()=>{
      const restored=codex(['plugin','add',pluginId]);
      if(restored.pluginId!==pluginId||!restored.installedPath||!isAbsolute(restored.installedPath))fail('原插件安装目录无法恢复。');
      const identity=JSON.parse(await readFile(join(restored.installedPath,'.codex-plugin/plugin.json'),'utf8'));
      const state=codex(['plugin','list','--marketplace','framelark']).installed?.find(p=>p.pluginId===pluginId);
      if(identity.version!==priorPlugin.version||state?.installed!==true||state.enabled!==priorPlugin.enabled)fail('原插件版本或启用状态未恢复。');
      for(const file of originalFiles)if(digest(await readFile(join(restored.installedPath,file.path)))!==file.sha256)fail('原插件内容未恢复。');
    });
    if(failures.length)throw Error('安装失败：'+error.message+'；原安装自动恢复未完成：'+failures.join('；')+'。请在 Codex 插件页核对来源、版本与启用状态，已有照片项目保留。',{cause:error});
    throw error;
  }finally{await rm(temporary,{recursive:true,force:true});}
}

const entry=process.argv[1];
let direct=import.meta.url.startsWith('data:')||import.meta.url.endsWith('/[eval1]');
if(entry&&entry!=='-'&&!entry.startsWith('--'))try{direct=import.meta.url===pathToFileURL(realpathSync(entry)).href;}catch{}
if(direct){
  try{
    const args=process.argv.slice(entry&&!entry.startsWith('--')?2:1);let photographyEye=false,tag;
    if(args.includes('--help'))console.log('FrameLark 版本安装：node install-framelark.mjs [--photography-eye] [--version vX.Y.Z]\n首次安装统一插件会准备修图依赖并包含全部案例图；无需克隆仓库。\n已停用的插件保持停用；请先在 Codex 插件页明确启用，再更新。安装失败会恢复可验证的原来源与版本，恢复失败会单独说明。');
    else{for(let i=0;i<args.length;i++){if(args[i]==='--photography-eye')photographyEye=true;else if(args[i]==='--version'){tag=args[++i];if(!tag)fail('请提供版本号。');}else fail('未知安装参数。');}const result=await installFrameLarkRelease({photographyEye,tag});console.log(JSON.stringify(result,null,2));console.error('FrameLark 已安装并启用。开启新对话后使用；本次只安装到运行命令的 Codex 环境。');}
  }catch(error){console.error('FrameLark 安装未完成：'+error.message);process.exitCode=1;}
}
