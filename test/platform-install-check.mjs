import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,rm,readdir,stat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
async function probe(root){
 const require=createRequire(join(root,'package.json')),sharp=require('sharp'),{createCanvas,loadImage}=require('@napi-rs/canvas');
 assert.ok(!await stat(join(root,'node_modules/@img/sharp-wasm32')).catch(()=>null),'Native CI platforms do not retain WASM');
 const canvas=createCanvas(32,32),ctx=canvas.getContext('2d');ctx.fillStyle='#dea342';ctx.fillRect(0,0,32,32);ctx.font='12px sans-serif';ctx.fillText('A',2,16);
 const png=await sharp(canvas.toBuffer('image/png')).rotate(90).resize(16,16).png().toBuffer();assert.equal((await loadImage(png)).width,16);
 const pixels=new Uint16Array(16*16*3).fill(12345),tiff=await sharp(pixels,{raw:{width:16,height:16,channels:3}}).toColourspace('rgb16').withIccProfile('srgb').tiff({compression:'deflate'}).toBuffer();
 const metadata=await sharp(tiff).metadata();assert.equal(metadata.depth,'ushort');assert.ok(metadata.icc?.length);
 let bytes=0;async function size(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())await size(path);else if(entry.isFile())bytes+=(await stat(path)).size;}}await size(join(root,'node_modules'));
 return {platform:process.platform,arch:process.arch,bytes,MiB:bytes/1048576,sharp:sharp.versions.sharp,canvas:require('@napi-rs/canvas/package.json').version,PNG:true,TIFF16:true};
}
if(process.argv[2]==='--probe')console.log(JSON.stringify(await probe(process.argv[3])));
else{
 const root=await mkdtemp(join(tmpdir(),'framelark-native-install-'));
 try{
  await mkdir(join(root,'scripts'));
  for(const file of ['package.json','package-lock.json','scripts/setup.mjs','scripts/platform-runtime.mjs'])await copyFile(new URL('../skills/photo-retouch/'+file,import.meta.url),join(root,file));
  const output=execFileSync(process.execPath,[join(root,'scripts/setup.mjs')],{encoding:'utf8',timeout:180000});
  // Windows cannot unlink loaded native DLLs. A completed probe child releases
  // its handles before the parent cleans the disposable installation.
  const result=JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--probe',root],{encoding:'utf8',timeout:30000}));
  console.log(JSON.stringify({...result,setupOutput:output},null,2));
 }finally{await rm(root,{recursive:true,force:true});}
}
