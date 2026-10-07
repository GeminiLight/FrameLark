import {lstat,readdir,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';

async function packages(folder){
  const result=new Map();
  for(const entry of await readdir(folder,{withFileTypes:true})){
    if(entry.name.startsWith('.'))continue;
    const names=entry.name.startsWith('@')&&entry.isDirectory()
      ?(await readdir(join(folder,entry.name))).map(name=>entry.name+'/'+name):[entry.name];
    for(const name of names){
      try{result.set(name,JSON.parse(await readFile(join(folder,name,'package.json'),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  return result;
}

// Native readiness is a fact supplied by setup after require(), not inferred
// from the host name or an optional-dependency flag in npm's lockfile.
export async function trimPlatformRuntime(root,{loaded,platform=process.platform,arch=process.arch}={}){
  const folder=resolve(root,'node_modules'),info=await lstat(folder).catch(()=>null);
  if(!info||info.isSymbolicLink())return {removed:[],reason:'linked-or-missing-runtime'};
  if((loaded||[]).some(path=>path.split(sep).join('/').includes('/@img/sharp-wasm32/')))return {removed:[],reason:'wasm-adapter-loaded'};
  const prefix=folder.split(sep).join('/')+'/',paths=(loaded||[]).map(path=>path.split(sep).join('/')).filter(path=>path.startsWith(prefix)&&path.endsWith('.node'));
  const sharp=paths.map(path=>path.slice(prefix.length).match(/^@img\/sharp-([^/]+)\//)?.[1]).find(name=>name!== 'wasm32');
  const canvas=paths.map(path=>path.slice(prefix.length).match(/^@napi-rs\/canvas-([^/]+)\//)?.[1]).find(Boolean);
  const matching=name=>name&&(platform==='linux'?/^linux(?:musl)?-/.test(name):name.startsWith(platform+'-'))&&name.includes('-'+arch);
  if(!matching(sharp)||!matching(canvas))return {removed:[],reason:'native-adapters-not-loaded'};
  const installed=await packages(folder),declared=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  const explicit=new Set([...Object.keys(declared.dependencies||{}),...Object.keys(declared.optionalDependencies||{})]);
  const keep=new Set(['@img/sharp-'+sharp,'@img/sharp-libvips-'+sharp,'@napi-rs/canvas-'+canvas]);
  const candidates=[...installed.keys()].filter(name=>/^@img\/sharp-(?:libvips-)?(?:darwin|linux|linuxmusl|win32|freebsd|webcontainers)-/.test(name)||/^@napi-rs\/canvas-/.test(name));
  candidates.push('@img/sharp-wasm32','@emnapi/runtime','tslib');
  const removed=[];
  for(const name of candidates){
    if(keep.has(name)||explicit.has(name)||!installed.has(name))continue;
    // Optional foreign-platform wrappers are not active here. Shared transitive
    // helpers, however, are kept if another installed package still needs them.
    if(['@img/sharp-wasm32','@emnapi/runtime','tslib'].includes(name)&&[...installed.entries()].some(([owner,pkg])=>owner!==name&&Boolean(pkg.dependencies?.[name]||pkg.optionalDependencies?.[name])))continue;
    await rm(join(folder,name),{recursive:true,force:true});installed.delete(name);removed.push(name);
  }
  return {removed,sharpTarget:sharp,canvasTarget:canvas};
}
