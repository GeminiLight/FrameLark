import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {initProject,loadProject,currentVersion,createCandidate,acceptCandidate,changeGuards,saveNote,deleteNote,hash} from '../skills/photo-retouch/scripts/project.mjs';
import {renderFrame,exportPhoto,previewPhoto} from '../skills/photo-retouch/scripts/render.mjs';
import {protectionMask,protectionWeight,compositeProtectedRegions} from '../skills/photo-retouch/scripts/engine/protected-regions.js';
import {viewToOriginalPoint} from '../skills/photo-retouch/scripts/engine/photo-geometry.js';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t,{width=96,height=80,alpha=false}={}){const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-protection-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'source.png'),data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=(x*17+y*7)%256;data[i+1]=(x*3+y*11)%256;data[i+2]=(x*5+y*13)%256;data[i+3]=alpha?(x+y)%256:255;}await sharp(data,{raw:{width,height,channels:4}}).png().toFile(file);const folder=path.join(root,'project');await initProject(file,folder);return folder;}
const plan=(p,settings,extra={})=>({revision:p.revision,baseVersion:p.currentId,settings,...extra});
const accept=(folder,result)=>acceptCandidate(folder,{id:result.candidate.id,revision:result.project.revision,selectionHash:result.candidate.selectionHash});
async function protect(folder,extra={}){const p=await loadProject(folder);return changeGuards(folder,{revision:p.revision,operation:'protect',rect:{x:.3,y:.25,width:.3,height:.35},coordinateSpace:'view',maskType:'rectangle',feather:.12,...extra});}
function verifyPixels(frame,reference,unprotected,region,source,crop){let core=0,outside=0,blend=0;for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){const i=(y*frame.width+x)*4,weight=protectionWeight(region.mask,viewToOriginalPoint({x:(x+.5)/frame.width,y:(y+.5)/frame.height},crop,source.width,source.height));if(weight===1){assert.deepEqual(frame.pixels.subarray(i,i+4),reference.pixels.subarray(i,i+4));core++;}else if(weight===0){assert.deepEqual(frame.pixels.subarray(i,i+4),unprotected.pixels.subarray(i,i+4));outside++;}else blend++;}assert.ok(core>0);assert.ok(outside>0);return {core,outside,blend};}

test('hard core and outer feather preserve exact RGBA endpoints including transparency',()=>{
  const mask=protectionMask({rect:{x:.25,y:.25,width:.5,height:.5},feather:.2},null,{width:8,height:8});assert.equal(protectionWeight(mask,{x:.25,y:.25}),1);assert.equal(protectionWeight(mask,{x:.2,y:.5})>0,true);assert.equal(protectionWeight(mask,{x:0,y:0}),0);
  const original=new Uint8ClampedArray(8*8*4),reference=new Uint8ClampedArray(original.length);for(let i=0;i<original.length;i+=4){original.set([250,100,20,79],i);reference.set([10,180,230,132],i);}
  const region={referenceVersionId:'ref',mask},output=compositeProtectedRegions(original,8,8,[region],new Map([['ref',reference]]),null,{width:8,height:8});
  assert.deepEqual(output.slice((3*8+3)*4,(3*8+3)*4+4),reference.slice(0,4));assert.deepEqual(output.slice(0,4),original.slice(0,4));
  const radial=protectionMask({rect:{x:.25,y:.25,width:.5,height:.5},maskType:'radial',feather:.1},null,{width:8,height:8});assert.equal(protectionWeight(radial,{x:.5,y:.5}),1);assert.equal(protectionWeight(radial,{x:.25,y:.25}),0);
});

test('all global/detail/style/local effects composite before the protected final core',async t=>{
  const folder=await fixture(t);const reference=await renderFrame(folder),guard=await protect(folder);let p=await loadProject(folder);await saveNote(folder,{revision:p.revision,rect:{x:.1,y:.1,width:.8,height:.8},note:'local'});p=await loadProject(folder);
  const settings={exposure:.6,warmth:20,tint:-15,grain:20,sharpen:40,denoise:30,texture:25,clarity:20,vignette:45,blueSaturation:20};
  const candidate=await createCandidate(folder,plan(p,settings,{style:{id:'daily-soft',amount:25},locals:[{annotationId:p.notes[0].id,settings:{exposure:.3,grain:9,sharpen:15},feather:.5}]}));
  const frame=await renderFrame(folder,candidate.candidate.id);const raw=JSON.parse(await readFile(path.join(folder,'project.json'),'utf8'));const c=raw.candidates.find(c=>c.id===candidate.candidate.id);c.state.guards.regions=[];await writeFile(path.join(folder,'project.json'),JSON.stringify(raw));const unprotected=await renderFrame(folder,c.id);
  const counts=verifyPixels(frame,reference,unprotected,guard.version.state.guards.regions[0],p.source,null);assert.ok(counts.blend>0);assert.notEqual(frame.pixelHash,unprotected.pixelHash);
});

test('rotated and cropped view selection maps exactly to original affine shape',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder);const rotation=await createCandidate(folder,plan(p,{exposure:.1},{crop:{x:.1,y:.1,width:.8,height:.8,angle:7}}));await accept(folder,rotation);
  const before=await renderFrame(folder),guard=await protect(folder,{maskType:'radial'});p=await loadProject(folder);const region=guard.version.state.guards.regions[0];
  const center=viewToOriginalPoint({x:.45,y:.425},currentVersion(p).state.crop,p.source.width,p.source.height);assert.equal(protectionWeight(region.mask,center),1);
  await assert.rejects(createCandidate(folder,plan(p,{},{crop:null})),{code:'PROTECTED_GEOMETRY'});
  await assert.rejects(createCandidate(folder,plan(p,{},{crop:{...currentVersion(p).state.crop,angle:8}})),{code:'PROTECTED_GEOMETRY'});
  assert.equal((await renderFrame(folder)).pixelHash,before.pixelHash);
  const changed=await createCandidate(folder,plan(p,{warmth:25,exposure:.4})),frame=await renderFrame(folder,changed.candidate.id);
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){const r=frame.sourceRect,crop={x:r.x/p.source.width,y:r.y/p.source.height,width:r.width/p.source.width,height:r.height/p.source.height,angle:7};if(protectionWeight(region.mask,viewToOriginalPoint({x:(x+.5)/frame.width,y:(y+.5)/frame.height},crop,p.source.width,p.source.height))===1){const i=(y*frame.width+x)*4;assert.deepEqual(frame.pixels.subarray(i,i+4),before.pixels.subarray(i,i+4));}}
});

test('matching-size PNG export is byte-exact and alternate output grids replay compatible references',async t=>{
  const folder=await fixture(t,{width:900,height:640});const referenceId=(await loadProject(folder)).currentId,guard=await protect(folder),p=await loadProject(folder),candidate=await createCandidate(folder,plan(p,{exposure:.25,warmth:12,grain:8}));await accept(folder,candidate);
  for(const maxSide of [512,900]){
    const frame=await renderFrame(folder,'current',{maxSide}),reference=await renderFrame(folder,referenceId,{maxSide});const r=guard.version.state.guards.regions[0];
    for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++)if(protectionWeight(r.mask,{x:(x+.5)/frame.width,y:(y+.5)/frame.height})===1){const i=(y*frame.width+x)*4;assert.deepEqual(frame.pixels.subarray(i,i+4),reference.pixels.subarray(i,i+4));}
    const file=await exportPhoto(folder,'current',{maxSide,format:'png',output:path.join(folder,'exports',`grid-${maxSide}.png`)});assert.equal(file.pixelGuarantee,'decoded-rgba');assert.equal(hash(await sharp(file.path).ensureAlpha().raw().toBuffer()),frame.pixelHash);assert.equal(file.fileHash,hash(await readFile(file.path)));
  }
  const jpeg=await exportPhoto(folder,'current',{maxSide:512,format:'jpeg',output:path.join(folder,'exports','lossy.jpg')});assert.equal(jpeg.pixelGuarantee,'before-lossy-encoding');assert.ok(jpeg.bytes>0);assert.equal((await sharp(jpeg.path).metadata()).width,512);
});

test('accurate region is an exact crop of final frame, including vignette, grain and neighborhood filters',async t=>{
  const folder=await fixture(t,{width:160,height:120});let p=await loadProject(folder);const edit=await createCandidate(folder,plan(p,{vignette:60,grain:30,sharpen:50,clarity:30,denoise:25}));await accept(folder,edit);await protect(folder);
  const full=await renderFrame(folder),region=await renderFrame(folder,'current',{region:{x:.19,y:.17,width:.52,height:.58}}),bytes=await sharp(full.png).extract(region.regionPixels).ensureAlpha().raw().toBuffer();assert.equal(hash(bytes),region.pixelHash);assert.equal(region.regionMode,'crop-final-frame');assert.deepEqual(region.frameSpec,full.frameSpec);
});

test('protection remains anchored after deleting or moving crop-only discussion notes',async t=>{
  const folder=await fixture(t);await saveNote(folder,{rect:{x:.3,y:.25,width:.3,height:.35},note:'face',protect:true});await protect(folder);let p=await loadProject(folder),before=await renderFrame(folder);await deleteNote(folder,{id:p.notes[0].id});assert.equal((await renderFrame(folder)).pixelHash,before.pixelHash);p=await loadProject(folder);assert.equal(currentVersion(p).state.guards.regions.length,1);assert.equal(p.notes.length,0);
});

test('missing/corrupt reference files and tampered source refuse rendering and acceptance',async t=>{
  const folder=await fixture(t);const guard=await protect(folder),p=await loadProject(folder),candidate=await createCandidate(folder,plan(p,{exposure:.2})),snapshot=guard.version.state.guards.regions[0].snapshot,file=path.join(folder,snapshot.path),original=await readFile(file);
  await writeFile(file,'corrupt');await assert.rejects(renderFrame(folder,candidate.candidate.id),{code:'REFERENCE_CORRUPT'});await assert.rejects(accept(folder,candidate),{code:'REFERENCE_CORRUPT'});
  await writeFile(file,original);await rm(file);await assert.rejects(renderFrame(folder),{code:'REFERENCE_UNAVAILABLE'});
});

test('reference metadata fails closed on missing IDs, future references and pipeline changes',async t=>{
  const folder=await fixture(t);await protect(folder);const file=path.join(folder,'project.json'),original=await readFile(file,'utf8');
  for(const [modify,code] of [[r=>r.referenceVersionId='missing','REFERENCE_NOT_FOUND'],[(r,p)=>r.referenceVersionId=p.currentId,'REFERENCE_CYCLE'],[r=>r.pipeline='future-pipeline','REFERENCE_PIPELINE_CHANGED'],[r=>r.sourceChecksum='a'.repeat(64),'REFERENCE_SOURCE_CHANGED'],[r=>r.referenceStateHash='a'.repeat(64),'REFERENCE_STATE_CHANGED']]){const p=JSON.parse(original),r=currentVersion(p).state.guards.regions[0];modify(r,p);await writeFile(file,JSON.stringify(p));await assert.rejects(renderFrame(folder),{code});}
});

test('cross-reference feather overlaps reject, disjoint regions work and same-reference masks use max weight',async t=>{
  const folder=await fixture(t);await protect(folder,{rect:{x:.1,y:.1,width:.2,height:.2},feather:.1});
  await assert.rejects(protect(folder,{rect:{x:.25,y:.15,width:.2,height:.2}}),{code:'PROTECTION_OVERLAP'});
  const second=await protect(folder,{rect:{x:.65,y:.65,width:.2,height:.2}});assert.equal(second.version.state.guards.regions.length,2);assert.ok((await renderFrame(folder)).pixelHash);
  const mask=protectionMask({rect:{x:.2,y:.2,width:.6,height:.6},feather:.1},null,{width:8,height:8}),pixels=new Uint8ClampedArray(8*8*4).fill(80),ref=new Uint8ClampedArray(8*8*4).fill(140),regions=[{referenceVersionId:'r',mask}];
  const one=compositeProtectedRegions(pixels,8,8,regions,new Map([['r',ref]]),null,{width:8,height:8}),two=compositeProtectedRegions(pixels,8,8,[...regions,...regions],new Map([['r',ref]]),null,{width:8,height:8});assert.deepEqual(one,two);
});

test('final protection includes lettering while no-text output uses clean reference',async t=>{
  const folder=await fixture(t,{width:200,height:160});let p=await loadProject(folder);const text=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,mode:'lettering',textOverlays:[{text:'A',x:.3,y:.3,width:.3,size:.1,style:'sticker'}]});await accept(folder,text);
  const ref=await renderFrame(folder),cleanRef=await renderFrame(folder,'current',{withoutText:true}),guard=await protect(folder,{rect:{x:.2,y:.2,width:.5,height:.5}});p=await loadProject(folder);
  const change=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,mode:'lettering',textOverlays:[{text:'B',x:.3,y:.3,width:.3,size:.1,style:'sticker'}],settings:{exposure:.5}}),frame=await renderFrame(folder,change.candidate.id),clean=await renderFrame(folder,change.candidate.id,{withoutText:true}),r=guard.version.state.guards.regions[0];
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++)if(protectionWeight(r.mask,{x:(x+.5)/frame.width,y:(y+.5)/frame.height})===1){const i=(y*frame.width+x)*4;assert.deepEqual(frame.pixels.subarray(i,i+4),ref.pixels.subarray(i,i+4));assert.deepEqual(clean.pixels.subarray(i,i+4),cleanRef.pixels.subarray(i,i+4));}
});

test('unlocking a region previews previously covered edits without changing accepted pixels',async t=>{
  const folder=await fixture(t);await protect(folder);let p=await loadProject(folder);const edit=await createCandidate(folder,plan(p,{exposure:.6}));await accept(folder,edit);p=await loadProject(folder);const before=await renderFrame(folder),unlock=await changeGuards(folder,{revision:p.revision,operation:'unlock',regionIds:[currentVersion(p).state.guards.regions[0].id]});assert.equal((await renderFrame(folder)).pixelHash,before.pixelHash);assert.notEqual((await renderFrame(folder,unlock.candidate.id)).pixelHash,before.pixelHash);await accept(folder,unlock);assert.equal(currentVersion(await loadProject(folder)).state.guards.regions.length,0);
});

test('view core uses rounded source edges, including boundary pixels of fractional crops',async t=>{
  const folder=await fixture(t,{width:513,height:377});let p=await loadProject(folder);const crop={x:.053,y:.071,width:.881,height:.833,angle:4};const edit=await createCandidate(folder,plan(p,{},{crop}));await accept(folder,edit);const frame=await renderFrame(folder),selected={x:.2,y:.2,width:.4,height:.4};const saved=await protect(folder,{rect:selected,feather:0});const r=frame.sourceRect,actual={x:r.x/513,y:r.y/377,width:r.width/513,height:r.height/377,angle:4},mask=saved.version.state.guards.regions[0].mask;
  const expected=viewToOriginalPoint({x:selected.x,y:selected.y},actual,513,377);assert.deepEqual(mask.origin,expected);
});

test('restoring historical protected appearance preserves the final composite after explicit unlock',async t=>{
  const folder=await fixture(t);await protect(folder);let p=await loadProject(folder);const edit=await createCandidate(folder,plan(p,{exposure:.6}));await accept(folder,edit);p=await loadProject(folder);const savedId=p.currentId,savedPixels=(await renderFrame(folder)).pixelHash;
  const unlock=await changeGuards(folder,{revision:p.revision,operation:'unlock',regionIds:currentVersion(p).state.guards.regions.map(r=>r.id)});await accept(folder,unlock);p=await loadProject(folder);const {restoreVersion}=await import('../skills/photo-retouch/scripts/project.mjs');await restoreVersion(folder,{revision:p.revision,id:savedId});assert.equal((await renderFrame(folder)).pixelHash,savedPixels);
});

test('nested protected lettering without own text retains compatible no-text references at another size',async t=>{
  const folder=await fixture(t,{width:800,height:600});let p=await loadProject(folder);const letter=await createCandidate(folder,plan(p,{}, {mode:'lettering',textOverlays:[{text:'A',x:.1,y:.1,width:.25,size:.05}]}));await accept(folder,letter);await protect(folder,{rect:{x:.06,y:.05,width:.3,height:.2},feather:.05});p=await loadProject(folder);const remove=await createCandidate(folder,plan(p,{}, {mode:'lettering',textOverlays:[]}));await accept(folder,remove);await protect(folder,{rect:{x:.65,y:.65,width:.2,height:.2},feather:.05});const frame=await renderFrame(folder,'current',{maxSide:512,withoutText:true});assert.equal(frame.width,512);
});

test('pipeline mismatch blocks protected output but permits inspection and explicit unlock recovery',async t=>{
  const folder=await fixture(t);await protect(folder);const file=path.join(folder,'project.json'),p=JSON.parse(await readFile(file,'utf8'));currentVersion(p).state.guards.regions[0].pipeline='old-version';await writeFile(file,JSON.stringify(p));
  const loaded=await loadProject(folder);assert.equal(loaded.currentId,p.currentId);await assert.rejects(renderFrame(folder),{code:'REFERENCE_PIPELINE_CHANGED'});
  const {runCLI}=await import('../skills/photo-retouch/scripts/cli.mjs');const inspect=await runCLI(['inspect','--project',folder]);assert.equal(inspect.preview.available,false);assert.equal(inspect.preview.error.code,'REFERENCE_PIPELINE_CHANGED');assert.ok(inspect.original.path);
  const unlock=await changeGuards(folder,{revision:p.revision,operation:'unlock',regionIds:currentVersion(p).state.guards.regions.map(r=>r.id)});assert.ok((await renderFrame(folder,unlock.candidate.id)).pixelHash);await accept(folder,unlock);assert.ok((await renderFrame(folder)).pixelHash);
});

test('protected source changes refuse acceptance even after a valid preview',async t=>{
  const folder=await fixture(t);await protect(folder);const p=await loadProject(folder),candidate=await createCandidate(folder,plan(p,{exposure:.1}));await renderFrame(folder,candidate.candidate.id);await writeFile(path.join(folder,'source','original.bin'),'changed');await assert.rejects(accept(folder,candidate),{code:'SOURCE_CHANGED'});
});

test('reference dependency depth is bounded before recording a costly new protection',async t=>{
  const folder=await fixture(t);for(let i=0;i<4;i++)await protect(folder,{rect:{x:.03+i*.22,y:.2,width:.1,height:.1},feather:0});const p=await loadProject(folder);await assert.rejects(protect(folder,{rect:{x:.1,y:.7,width:.1,height:.1},feather:0}),{code:'PROTECTION_COMPLEXITY'});assert.equal((await loadProject(folder)).revision,p.revision);
});
