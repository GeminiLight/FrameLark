import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile),skill=fileURLToPath(new URL('../skills/photo-retouch/',import.meta.url));
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');

test('the documented nine-grid route binds the ordered exported saved editions rather than original inputs',async t=>{
  const root=await mkdtemp(join(tmpdir(),'framelark-public-series-'));t.after(()=>rm(root,{recursive:true,force:true}));
  async function cli(command,project,...args){const result=await execute(process.execPath,[join(skill,'scripts/cli.mjs'),command,'--project',project,...args],{cwd:root});return JSON.parse(result.stdout);}
  async function submit(command,project,input){const file=join(root,'input.json');await writeFile(file,JSON.stringify(input));return cli(command,project,'--input',file);}
  const images=[];
  for(let i=0;i<9;i++){const image=join(root,`${i+1}.png`);await sharp({create:{width:128,height:96,channels:3,background:{r:40+i*10,g:70,b:100}}}).png().toFile(image);images.push(image);}
  const collection=join(root,'collection');await submit('collection-init',collection,{images,brief:{theme:'合成颜色用于验证交付协议',targetCount:9}});
  let c=await cli('collection-inspect',collection),photo=join(collection,c.photos[0].project),p=await cli('inspect',photo);
  const trial=await submit('candidate',photo,{revision:p.revision,baseVersion:p.baseVersion,settings:{exposure:.4}});
  await cli('accept',photo,'--id',trial.candidate.id,'--revision',String(trial.project.revision),'--selection-hash',trial.candidate.selectionHash,'--by','user');
  c=await cli('collection-inspect',collection);
  const order=c.photos.map(photo=>photo.id).reverse();
  c=await submit('collection-plan',collection,{revision:c.revision,snapshotHash:c.snapshotHash,title:'九格协议验证',rationale:'反序排列，用一张真实保存版校验来源',order,decisions:c.photos.map(photo=>({id:photo.id,decision:'select',observations:'合成色块，不做审美声明',reason:'验证九张顺序与版本',preserve:'输入字节',role:'测试'}))});
  const exported=await submit('collection-export',collection,{revision:c.revision,snapshotHash:c.snapshotHash,preset:'original'});
  assert.equal(exported.job.status,'done');assert.equal(exported.job.stale,false);
  const edited=exported.job.items.find(item=>item.id===c.photos[0].id);assert.equal(edited.versionId,trial.candidate.id);
  assert.notDeepEqual(await sharp(edited.result.path).removeAlpha().raw().toBuffer(),await sharp(images[0]).raw().toBuffer());
  const input=join(root,'grid-images.json'),output=join(root,'final-grid');
  await writeFile(input,JSON.stringify({images:exported.job.items.map(item=>({id:item.id,path:item.result.path}))}));
  const result=await execute(process.execPath,[join(skill,'scripts/image-input-board.mjs'),'--input',input,'--output',output,'--columns','3','--cell-size','768'],{cwd:root});
  const board=JSON.parse(result.stdout),manifest=JSON.parse(await readFile(board.manifest,'utf8')),metadata=await sharp(board.image).metadata();
  assert.deepEqual([metadata.width,metadata.height,manifest.columns,manifest.rows],[2304,2304,3,3]);
  assert.deepEqual(manifest.images.map(image=>image.id),order);
  for(let i=0;i<9;i++)assert.equal(manifest.images[i].sha256,exported.job.items[i].result.fileHash);
  for(let i=0;i<9;i++)assert.deepEqual(await readFile(join(collection,c.photos[i].project,'source/original.bin')),await readFile(images[i]));
});
