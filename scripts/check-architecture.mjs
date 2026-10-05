import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {access,readFile} from 'node:fs/promises';
import {dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const rootDirectories=new Set(['apps','api','skills','scripts','test','docs','.agents','.github']);
const rootFiles=new Set(['README.md','README.en.md','CONTRIBUTING.md','Dockerfile','compose.yaml','package.json','package-lock.json','vercel.json','.gitignore','.gitattributes','.dockerignore','.vercelignore','.env.local.example','AGENTS.md','LICENSE','LICENSE.md','SECURITY.md','CODE_OF_CONDUCT.md','CHANGELOG.md','.editorconfig','.npmrc']);
const errors=[];
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
async function checkPath(owner,spec){
  if(!spec.startsWith('.'))return;
  const target=resolve(root,dirname(owner),spec.split('?')[0]);
  if(!await exists(target))errors.push(`${owner}: missing module/resource ${spec}`);
  const destination=relative(root,target).split(sep).join('/');
  if(owner.startsWith('apps/studio/public/')&&!destination.startsWith('apps/studio/public/'))errors.push(`${owner}: browser code imports outside the public application: ${spec}`);
  if(owner.startsWith('skills/')&&!destination.startsWith('skills/'))errors.push(`${owner}: standalone skill depends on repository runtime: ${spec}`);
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
for(const options of Object.values(deployment.functions))assert.equal(await exists(resolve(root,options.includeFiles)),true,'Vercel probe image is packaged');
if(errors.length)throw new Error(errors.join('\n'));
console.log(`Architecture checks passed: ${files.length} repository files, assigned root entries, portable skills and resolved application/documentation references.`);
