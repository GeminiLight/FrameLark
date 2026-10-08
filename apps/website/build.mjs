import {readFile,writeFile,readdir,mkdir,rm,stat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join,basename,relative,sep,isAbsolute} from 'node:path';

const argumentsMap=new Map();
for(let i=2;i<process.argv.length;i+=2)argumentsMap.set(process.argv[i],process.argv[i+1]);
const websiteRoot=fileURLToPath(new URL('./',import.meta.url));
const source=join(websiteRoot,'public');
const caseSource=join(websiteRoot,'../studio/public');
const destination=resolve(argumentsMap.get('--out')||join(websiteRoot,'../../_site'));
const siteURL=new URL(argumentsMap.get('--site-url')||'https://geminilight.github.io/FrameLark/');
if(!['http:','https:'].includes(siteURL.protocol))throw new Error('A web site URL is required');
if(siteURL.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(siteURL.hostname))siteURL.protocol='https:';
if(!siteURL.pathname.endsWith('/'))siteURL.pathname+='/';
const basePath=siteURL.pathname.replace(/\/$/,'');
const extensions=new Set(['html','js','css','svg','png','jpg','jpeg','webp','ico','json','txt','woff2']);

async function canonicalPath(path){
  try{return await realpath(path);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const parent=dirname(path);if(parent===path)throw error;
    return join(await canonicalPath(parent),basename(path));
  }
}
const contains=(folder,path)=>{const part=relative(folder,path);return !part||!isAbsolute(part)&&part.split(sep)[0]!=='..';};
const canonicalDestination=await canonicalPath(destination);
for(const input of [source,caseSource]){
  const canonicalSource=await realpath(input);
  if(contains(canonicalDestination,canonicalSource)||contains(canonicalSource,canonicalDestination))throw Error('Website output cannot overlap a maintained source directory or its ancestor: '+destination);
}


async function filesIn(directory){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.name.startsWith('.'))continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...await filesIn(path));
    else if(entry.isFile()&&extensions.has(entry.name.split('.').at(-1)))files.push(path);
    else throw new Error(`Unsupported website source: ${entry.name}`);
  }
  return files;
}
function adapt(text){
  return text
    .replace(/((?:href|src)=["'])\/(?!\/)([^"']*)/g,(_,prefix,path)=>`${prefix}${basePath}/${path==='studio'?'studio/':path}`)
    .replace(/(["'`])\/(assets|api)\//g,(_,quote,folder)=>`${quote}${basePath}/${folder}/`);
}
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
let count=0;
for(const path of await filesIn(source)){
  const relative=path.slice(source.length+1);
  if(relative==='home.html'||relative==='index.html')continue;
  const target=join(destination,relative);
  await mkdir(dirname(target),{recursive:true});
  if(/\.(html|js|css|svg|json)$/.test(path)){
    let text=adapt(await readFile(path,'utf8'));
    if(relative==='install.html')text=text.replace('</head>',`  <link rel="canonical" href="${siteURL.href}install.html" />\n</head>`);
    await writeFile(target,text);
  }
  else await writeFile(target,await readFile(path));
  count++;
}
// Keep the local studio and the published website on the same case sources.
for(const name of ['examples.html','examples.css',...(await filesIn(join(caseSource,'assets/cases'))).map(path=>path.slice(caseSource.length+1))]){
  const path=join(caseSource,name),target=join(destination,name);
  await mkdir(dirname(target),{recursive:true});
  if(name==='examples.html'){
    let page=await readFile(path,'utf8');
    page=page.replaceAll('href="/" data-case-studio','href="/studio" data-case-studio');
    page=adapt(page).replace('</head>',`  <link rel="canonical" href="${siteURL.href}examples.html" />\n</head>`);
    await writeFile(target,page);
  }else if(name==='examples.css')await writeFile(target,adapt(await readFile(path,'utf8')));
  else await writeFile(target,await readFile(path));
  count++;
}
let homepage=adapt(await readFile(join(source,'home.html'),'utf8'));
homepage=homepage.replace(/(<meta property="og:image" content=")([^"]+)/,(_,prefix,path)=>prefix+new URL(path,siteURL.origin).href)
  .replace('</head>',`  <link rel="canonical" href="${siteURL.href}" />\n  <script>if(location.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(location.hostname))location.replace(location.href.replace(/^http:/,'https:'));</script>\n</head>`)
  .replace('网页的调色、裁剪与导出在浏览器中完成。启用视觉审片或向顾问提问时，会将压缩预览发送给配置的模型服务；原片不会保存到服务器文件夹。未连接模型时，也能手动编辑、试用风格和导出，基础光色分析会清楚标明来源。','这个在线工作台提供浏览器内的调色、裁剪、风格、版本和导出，照片不会发送到模型服务。视觉审片与顾问的看图能力，需要按使用指南运行完整工作台并连接视觉模型。当前诊断明确标为基础光色分析。');
await writeFile(join(destination,'index.html'),homepage);
await writeFile(join(destination,'home.html'),homepage);
let studio=adapt(await readFile(join(source,'index.html'),'utf8'));
studio=studio.replace('</head>',`  <script src="${basePath}/pages-static-runtime.js"></script>\n</head>`);
await mkdir(join(destination,'studio'),{recursive:true});
await writeFile(join(destination,'studio/index.html'),studio);
const runtime=await readFile(join(websiteRoot,'static-runtime.js'),'utf8');
await writeFile(join(destination,'pages-static-runtime.js'),runtime.replace('__FRAME_LARK_BASE_PATH__',JSON.stringify(basePath)));
await writeFile(join(destination,'.nojekyll'),'');
await writeFile(join(destination,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${siteURL.href}sitemap.xml\n`);
await writeFile(join(destination,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteURL.href}</loc></url><url><loc>${siteURL.href}examples.html</loc></url><url><loc>${siteURL.href}install.html</loc></url></urlset>\n`);

// Verify every local HTML resource before handing the output to Pages.
for(const file of ['index.html','studio/index.html','examples.html','install.html']){
  const text=await readFile(join(destination,file),'utf8');
  for(const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
    const target=match[1];
    if(!target.startsWith(basePath+'/')||target===basePath+'/')continue;
    const relative=target.slice(basePath.length+1).split(/[?#]/)[0];
    const path=join(destination,relative);
    const details=await stat(path);
    if(!details.isFile()&&!details.isDirectory())throw new Error(`Missing published resource: ${target}`);
  }
}
console.log(`Built ${count+7} static website files at ${destination}`);
console.log(`Website: ${siteURL.href}; basic editing workspace: ${siteURL.href}studio/`);
