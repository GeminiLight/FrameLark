// Opt-in real decoder gate. npm test remains independent of Python/Swift setup.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {syntheticDng} from './raw-fixture.mjs';
import {initProject,mutateProject} from '../skills/photo-retouch/scripts/project.mjs';
import {previewPhoto,exportPhoto} from '../skills/photo-retouch/scripts/render.mjs';
import {applyCommands} from '../skills/photo-retouch/scripts/engine/edit-stack/commands.js';
import {hashFile} from '../skills/photo-retouch/scripts/raw/source.mjs';
import {rawCapabilities,appleExecutable} from '../skills/photo-retouch/scripts/raw/backends.mjs';
import {runRawProcess} from '../skills/photo-retouch/scripts/raw/process.mjs';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
const scratch=await mkdtemp(join(tmpdir(),'framelark-raw-gate-')),evidence=[];
async function timed(run){const start=performance.now(),value=await run();return {value,ms:Math.round(performance.now()-start)};}
try{
 const caps=await rawCapabilities();assert.ok(caps.backends.rawpy,'Install LibRaw with npm run setup:raw');
 const dng=join(scratch,'generated.dng');await writeFile(dng,syntheticDng());
 const inputs=[{file:dng,backends:process.platform==='darwin'?['rawpy','auto']:['rawpy']},...(process.argv[2]?[{file:resolve(process.argv[2]),backends:process.platform==='darwin'?['apple','rawpy']:['rawpy']}]:[])];
 for(const [index,input] of inputs.entries())for(const backend of input.backends){
  const folder=join(scratch,index+'-'+backend),before=await hashFile(input.file),initial=await timed(()=>initProject(input.file,folder,{rawBackend:backend}));
  const project=initial.value.project;if(backend!=='auto')assert.equal(project.source.raw.backend,backend);else assert.ok(['apple','rawpy'].includes(project.source.raw.backend));assert.ok(project.source.width>=256,'Must decode full RAW, never an embedded thumbnail');
  const first=await timed(()=>previewPhoto(folder)),warm=await timed(()=>previewPhoto(folder));assert.equal(warm.value.cached,true);assert.equal(first.value.path,warm.value.path);
  await mutateProject(folder,project.revision,p=>{const version=structuredClone(p.versions[0]);version.id='edited';version.name='Exposure test';version.parentId=p.currentId;version.recipe=applyCommands(version.recipe,[{type:'AddStep',step:{id:'light',title:'Exposure',tool:'exposure',toolVersion:2,parameters:{ev:.5}}}]).next;p.versions.push(version);p.currentId=version.id;});
  const changed=await timed(()=>previewPhoto(folder));assert.equal(changed.value.cached,false);assert.notEqual(changed.value.pixelHash,first.value.pixelHash);
  const share=await timed(()=>exportPhoto(folder)),master=await timed(()=>exportPhoto(folder,'current',{preset:'master'}));assert.equal(share.value.format,'jpeg');assert.ok(Math.max(share.value.width,share.value.height)<=2048);
  const metadata=await sharp(master.value.path).metadata();assert.equal(metadata.depth,'ushort');assert.ok(metadata.icc?.length);assert.equal(metadata.width,project.source.width);assert.equal(metadata.height,project.source.height);
  assert.equal(await hashFile(input.file),before);assert.equal(await hashFile(join(folder,'source','original.bin')),before);
  evidence.push({sample:index?'public-camera':'generated-DNG',backend,decoderVersion:project.source.raw.decoderVersion,width:project.source.width,height:project.source.height,importMs:initial.ms,firstPreviewMs:first.ms,warmPreviewMs:warm.ms,editedPreviewMs:changed.ms,shareMs:share.ms,masterMs:master.ms,sourceUnchanged:true,tiffDepth:metadata.depth});
 }
 if(process.platform==='darwin'){
  const file=join(scratch,'gradient.f32');await runRawProcess(await appleExecutable(),['--self-test',file]);const b=await readFile(file),p=new Float32Array(b.buffer,b.byteOffset,b.length/4);
  assert.ok(p[0]<p[299*17*4]);for(let y=1;y<300;y++){const delta=p[y*17*4]-p[(y-1)*17*4];assert.ok(delta>=0&&delta<.01,'Apple top-down bands must stay continuous');}
 }
 console.log(JSON.stringify({platform:process.platform,backends:caps.backends,results:evidence},null,2));
}finally{await rm(scratch,{recursive:true,force:true});}
