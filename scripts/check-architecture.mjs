import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {access,readFile} from 'node:fs/promises';
import {dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const rootDirectories=new Set(['apps','api','skills','plugins','scripts','test','docs','assets','.agents','.github','.codex-plugin']);
const rootFiles=new Set(['README.md','README.en.md','CLOUD.md','CONTRIBUTING.md','Dockerfile','compose.yaml','package.json','package-lock.json','vercel.json','.gitignore','.gitattributes','.dockerignore','.vercelignore','.env.local.example','AGENTS.md','LICENSE','LICENSE.md','SECURITY.md','CODE_OF_CONDUCT.md','CHANGELOG.md','plugin.json','.editorconfig','.npmrc']);
const errors=[];
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
async function checkPath(owner,spec){
  if(owner.startsWith('apps/studio/public/')&&spec.startsWith('node:'))errors.push(`${owner}: browser runtime imports Node-only code: ${spec}`);
  if(!spec.startsWith('.'))return;
  const target=resolve(root,dirname(owner),spec.split('?')[0]);
  if(!await exists(target))errors.push(`${owner}: missing module/resource ${spec}`);
  const destination=relative(root,target).split(sep).join('/');
  if(owner.startsWith('apps/studio/public/')&&!destination.startsWith('apps/studio/public/'))errors.push(`${owner}: browser code imports outside the public application: ${spec}`);
  if(owner.startsWith('skills/')&&!destination.startsWith('skills/'))errors.push(`${owner}: standalone skill depends on repository runtime: ${spec}`);
  if(owner.startsWith('plugins/')&&!destination.startsWith(owner.split('/').slice(0,2).join('/')+'/'))errors.push(`${owner}: distributable plugin depends on repository runtime: ${spec}`);
  if(owner.startsWith('apps/studio/server/')&&owner!=='apps/studio/server/app.mjs'&&!owner.endsWith('/routes.mjs')&&destination.startsWith('apps/studio/server/')&&destination.endsWith('/routes.mjs'))errors.push(`${owner}: runtime depends on an HTTP route adapter: ${spec}; move shared logic to its own module`);
}
for(const file of files){
  const first=file.split('/')[0];
  if(file.includes('/')?!rootDirectories.has(first):!rootFiles.has(file))errors.push(`Unassigned root entry: ${file}`);
  if(!/\.(mjs|js)$/.test(file))continue;
  const source=await readFile(resolve(root,file),'utf8');
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"\n]+)['"]/g))await checkPath(file,match[1]);
  if(file.startsWith('apps/studio/'))for(const match of source.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g))await checkPath(file,match[1]);
}
for(const file of files.filter(file=>/\.md$/.test(file))){
  const source=await readFile(resolve(root,file),'utf8');
  for(const match of source.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)){
    const target=match[1].split(/\s+["']/)[0].split('#')[0];
    if(!target||target.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(target))continue;
    if(!await exists(resolve(root,dirname(file),decodeURIComponent(target))))errors.push(`${file}: missing documentation link ${target}`);
  }
}
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));
const deployment=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url)));
const ignored=(await readFile(new URL('../.vercelignore',import.meta.url),'utf8')).split(/\r?\n/).map(line=>line.trim());
for(const pattern of ignored.filter(line=>/^[\w.-]+\/$/.test(line))){
  const directory=pattern.slice(0,-1);
  if(files.some(file=>file.startsWith('apps/studio/')&&file.split('/').slice(0,-1).includes(directory)))errors.push(`Vercel exclusion ${pattern} also removes application source; anchor repository-only exclusions with /`);
}
assert.equal(manifest.scripts.start,'node apps/studio/server/index.mjs');
assert.equal(deployment.outputDirectory,'apps/studio/public');
for(const options of Object.values(deployment.functions)){
  const patterns=options.includeFiles.startsWith('{')?options.includeFiles.slice(1,-1).split(','):[options.includeFiles];
  for(const pattern of patterns)assert.equal(await exists(resolve(root,pattern.replace(/\/\*\*$/, ''))),true,'Vercel explicit resource exists: '+pattern);
  assert.ok(patterns.includes('apps/studio/public/assets/vision-probe.png'),'Vercel probe image is packaged');
  for(const name of ['policy','references'])assert.ok(patterns.includes('skills/photo-retouch/'+name+'/**'),'Vercel shared policy material is packaged: '+name);
}
if(errors.length)throw new Error(errors.join('\n'));
console.log(`Architecture checks passed: ${files.length} repository files, assigned root entries, portable skills and resolved application/documentation references.`);
