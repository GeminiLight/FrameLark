import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
const script=fileURLToPath(new URL('../skills/photo-retouch/scripts/image-input-board.mjs',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'framelark-input-board-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const images=[];
  for(let i=0;i<9;i++){
    const path=join(dir,`${i}.jpg`),data=Buffer.alloc(48*24*3);
    for(let y=0;y<24;y++)for(let x=0;x<48;x++){const p=(y*48+x)*3;data[p]=x<24?240:10;data[p+1]=20+i*4;data[p+2]=x<24?10:240;}
    await sharp(data,{raw:{width:48,height:24,channels:3}}).withMetadata({orientation:i===0?6:1}).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toFile(path);
    images.push({id:`P${i+1}`,path});
  }
  const input=join(dir,'input.json');await writeFile(input,JSON.stringify({images}));return {dir,images,input,output:join(dir,'board')};
}
function run(f,args=[]){const r=spawnSync(process.execPath,[script,'--input',f.input,'--output',f.output,'--cell-size','256',...args],{encoding:'utf8'});let value;try{value=JSON.parse(r.stdout);}catch{}return {...r,value};}
test('one input sheet preserves nine sources, orientation and full image boundaries',async t=>{
  const f=await fixture(t),before=await Promise.all(f.images.map(async i=>hash(await readFile(i.path)))),r=run(f);
  assert.equal(r.status,0,r.stderr||r.stdout);
  const manifest=JSON.parse(await readFile(r.value.manifest,'utf8'));
  assert.equal(manifest.count,9);assert.equal(manifest.columns,3);assert.equal(manifest.rows,3);assert.equal(manifest.generated,false);
  assert.deepEqual(manifest.images.map(i=>i.id),f.images.map(i=>i.id));
  assert.deepEqual(manifest.images.map(i=>i.sha256),before);
  assert.deepEqual(await Promise.all(f.images.map(async i=>hash(await readFile(i.path)))),before);
  const {data,info}=await sharp(r.value.image).removeAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,768);assert.equal(info.height,768);
  for(const item of manifest.images){const b=item.contentBounds,c=item.cellBounds;assert.ok(b.x>=c.x+8&&b.y>=c.y+8&&b.x+b.width<=c.x+c.width-8&&b.y+b.height<=c.y+c.height-8);}
  const first=manifest.images[0].contentBounds;assert.equal(first.width,24);assert.equal(first.height,48);
  const sample=y=>{const offset=((first.y+y)*info.width+first.x+12)*info.channels;return data.slice(offset,offset+3);};
  assert.ok(sample(10)[0]>180&&sample(10)[2]<80,'the rotated red side remains present');
  assert.ok(sample(38)[2]>180&&sample(38)[0]<80,'the rotated blue side remains present');
});
test('an existing output directory is preserved without replacement',async t=>{
  const f=await fixture(t);await mkdir(f.output);const marker=join(f.output,'keep.txt');await writeFile(marker,'keep this');
  const r=run(f);assert.equal(r.status,1);assert.equal(r.value?.error.code,'INPUT_BOARD_EXISTS');assert.equal(await readFile(marker,'utf8'),'keep this');
});
test('bad or duplicated inputs fail the whole preparation without dropping a source',async t=>{
  const f=await fixture(t);await writeFile(f.images[4].path,'not an image');
  let r=run(f);assert.equal(r.status,1);assert.equal(r.value?.error.code,'INPUT_BOARD_IMAGE');await assert.rejects(access(f.output));
  await writeFile(f.input,JSON.stringify({images:[f.images[0],f.images[0]]}));r=run(f);assert.equal(r.status,1);assert.equal(r.value?.error.code,'INPUT_BOARD_INVALID');await assert.rejects(access(f.output));
});
test('a missing source is reported before any output is created',async t=>{
  const f=await fixture(t);await rm(f.images[4].path);
  const r=run(f);assert.equal(r.status,1);assert.equal(r.value?.error.code,'INPUT_BOARD_IMAGE');await assert.rejects(access(f.output));
});
test('source IDs stay in the manifest rather than appearing as text in photo inputs',async t=>{
  const f=await fixture(t),r=run(f);assert.equal(r.status,0,r.stderr||r.stdout);
  const {data,info}=await sharp(r.value.image).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const bottom=256-20;
  for(let y=bottom;y<256-4;y++)for(let x=4;x<100;x++){
    const at=(y*info.width+x)*info.channels;
    assert.ok(data[at]>210&&data[at+1]>210&&data[at+2]>200,'this empty margin must not contain source-ID lettering');
  }
});
