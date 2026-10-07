import {readFile,mkdir,open,link,unlink,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

async function checksum(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function downloadChecked(spec,path){
 if(!Number.isSafeInteger(spec.bytes)||spec.bytes<1||spec.bytes>120_000_000||!/^[a-f0-9]{64}$/.test(spec.sha256))throw Error('Invalid size or checksum');
 try{const s=await stat(path);if(s.size!==spec.bytes||await checksum(path)!==spec.sha256)throw Error('Existing file differs from corpus; preserved: '+path);return{path,cached:true,bytes:s.size};}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(dirname(path),{recursive:true});const temporary=path+'.part-'+randomUUID();let handle;
 try{
  const response=await fetch(spec.url,{signal:AbortSignal.timeout(180000)});if(!response.ok||!response.body)throw Error('Download HTTP '+response.status);
  handle=await open(temporary,'wx');const hash=createHash('sha256');let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>spec.bytes)throw Error('Download size exceeds corpus length');hash.update(chunk);await handle.writeFile(chunk);}
  await handle.close();handle=null;
  if(size!==spec.bytes)throw Error('Download size does not match corpus length');
  if(hash.digest('hex')!==spec.sha256)throw Error('Download checksum mismatch');
  await link(temporary,path);return{path,cached:false,bytes:size};
 }finally{if(handle)await handle.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function main(args){
 if(args.includes('--help')){console.log('node scripts/fetch-retouch-eval.mjs --output <outside-repository-directory> --research-only\nDownloads the frozen 8-case FiveK research subset (~845 MB). Read the image research licenses first; --research-only acknowledges this scope. No Agent is run and no scores are produced.');return;}
 if(!args.includes('--research-only'))throw Error('FiveK images allow non-commercial research only; use --research-only for that scope after reading the licenses.');
 const index=args.indexOf('--output');if(index<0||!args[index+1]||args[index+1].startsWith('--'))throw Error('Supply --output <directory>');
 const output=resolve(args[index+1]),repo=fileURLToPath(new URL('../',import.meta.url)),rel=relative(repo,output);if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw Error('Store dataset images outside the repository.');
 const manifest=JSON.parse(await readFile(new URL('../evals/retouch/fivek-pilot.json',import.meta.url),'utf8'));
 const jobs=[...manifest.legalFiles.map(f=>({...f,path:resolve(output,'provenance',f.name)}))];
 for(const c of manifest.cases){if(!/^a\d{4}$/.test(c.id)||!/^[a-zA-Z0-9_.-]+\.dng$/.test(c.sourceName))throw Error('Invalid corpus filename');jobs.push({...c.input,path:resolve(output,'fivek/raw',c.sourceName)});for(const r of c.references)jobs.push({...r,path:resolve(output,'fivek/references',c.id,'expert-'+r.expert.toLowerCase()+'.tif')});}
 for(const job of jobs){const result=await downloadChecked(job,job.path);console.log(JSON.stringify(result));}
 console.log(JSON.stringify({cases:manifest.cases.length,references:manifest.cases.reduce((n,c)=>n+c.references.length,0),output,researchOnly:true,referenceVisibility:'Keep references hidden from editors; consult docs/evaluation/retouch.md'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
