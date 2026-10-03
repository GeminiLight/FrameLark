import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {initProject,loadProject,saveNote,createCandidate,acceptCandidate,changeGuards,commitProtection,hash} from '../skills/photo-retouch/scripts/project.mjs';
import {createRenderSession,renderFrame} from '../skills/photo-retouch/scripts/render.mjs';
import {prepareProtection} from '../skills/photo-retouch/scripts/protection-preparation.mjs';
import {protectionMask,protectionWeight,compositeProtectedRegions} from '../skills/photo-retouch/scripts/engine/protected-regions.js';
import {viewToOriginalPoint} from '../skills/photo-retouch/scripts/engine/photo-geometry.js';
import {srgbToLinear,linearToSrgb} from '../skills/photo-retouch/scripts/engine/tone-processing.js';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'frameyn-performance-'));t.after(()=>rm(root,{recursive:true,force:true}));const width=129,height=97,data=Buffer.alloc(width*height*4);for(let i=0;i<data.length;i++)data[i]=(i*31+7)%256;const source=path.join(root,'source.png');await sharp(data,{raw:{width,height,channels:4}}).png().toFile(source);const folder=path.join(root,'project');await initProject(source,folder);return folder;}
const guard=p=>({revision:p.revision,operation:'protect',rect:{x:.2,y:.2,width:.25,height:.25},feather:.12});

test('render session pins a project and reuses final RGBA for accurate regions and note overlays',async t=>{
  const folder=await fixture(t);let p=await loadProject(folder);const c=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,settings:{grain:14,clarity:10,denoise:15,sharpen:20,vignette:20},crop:{x:.03,y:.02,width:.9,height:.91,angle:7}});await acceptCandidate(folder,{id:c.candidate.id,revision:c.project.revision,selectionHash:c.candidate.selectionHash});
  const session=await createRenderSession(folder),full=await session.renderFrame();
  await saveNote(folder,{revision:session.project.revision,rect:{x:.2,y:.2,width:.2,height:.2},note:'new note'});
  assert.equal(session.project.notes.length,0);assert.ok(Object.isFrozen(session.project.versions[0].state));
  const region=await session.renderFrame('current',{region:{x:.2,y:.2,width:.2,height:.2}});
  assert.equal(hash(await sharp(full.png).extract(region.regionPixels).raw().toBuffer()),region.pixelHash);
  assert.equal(region.revision,session.project.revision);assert.equal(region.frameSpecHash,full.frameSpecHash);
  await session.renderFrame('current',{showNotes:true});assert.equal((await session.renderFrame()).pixelHash,full.pixelHash);
  await assert.rejects(session.renderFrame('current',{revision:session.project.revision+1}),{code:'STALE_REVISION'});
  await assert.rejects(session.renderFrame('current',{selectionHash:'wrong'}),{code:'STALE_SELECTION'});
  await writeFile(path.join(folder,'source','original.bin'),'tampered');await assert.rejects(renderFrame(folder),{code:'SOURCE_CHANGED'});
});

test('prepared protection releases the edit lock and stale commits clean up only their own snapshots',async t=>{
  const folder=await fixture(t),p=await loadProject(folder),value=guard(p),prepared=await prepareProtection(folder,value);
  await assert.rejects(stat(path.join(folder,'.edit-lock')),{code:'ENOENT'});
  const result=await saveNote(folder,{revision:p.revision,rect:{x:.5,y:.5,width:.1,height:.1},note:'concurrent edit'});
  await assert.rejects(commitProtection(folder,value,prepared),{code:'STALE_REVISION'});
  const after=await loadProject(folder);assert.equal(after.revision,result.project.revision);assert.equal(after.versions.length,1);
  for(const file of prepared.createdSnapshots)await assert.rejects(stat(path.join(folder,file)),{code:'ENOENT'});
});

test('protection CAS detects same-revision project, source and reference tampering',async t=>{
  for(const target of ['project','source','reference']){
    const folder=await fixture(t),p=await loadProject(folder),value=guard(p),prepared=await prepareProtection(folder,value);
    if(target==='project'){const changed=await loadProject(folder);changed.intent='changed without revision';await writeFile(path.join(folder,'project.json'),JSON.stringify(changed));}
    else await writeFile(path.join(folder,target==='source'?'source/original.bin':prepared.createdSnapshots[0]),'tampered');
    await assert.rejects(commitProtection(folder,value,prepared),{code:target==='project'?'STALE_REVISION':target==='source'?'SOURCE_CHANGED':'REFERENCE_CORRUPT'});
    assert.equal((await loadProject(folder)).versions.length,1);
  }
});

test('failed preparation leaves no accepted version and concurrent protections accept at most one',async t=>{
  const folder=await fixture(t),p=await loadProject(folder),value=guard(p);
  const results=await Promise.allSettled([changeGuards(folder,value),changeGuards(folder,value)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'STALE_REVISION');
  const saved=await loadProject(folder);assert.equal(saved.versions.length,2);assert.ok((await renderFrame(folder)).pixelHash);
});

// Baseline full scan kept as an independent byte-for-byte oracle.
function baselineComposite(pixels,width,height,regions,references,crop,source){const output=new Uint8ClampedArray(pixels),groups=new Map(),linear=Float64Array.from({length:256},(_,i)=>srgbToLinear(i/255));for(const r of regions){if(!groups.has(r.referenceVersionId))groups.set(r.referenceVersionId,[]);groups.get(r.referenceVersionId).push(r.mask);}for(const [id,masks] of groups){const reference=references.get(id);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const point=viewToOriginalPoint({x:(x+.5)/width,y:(y+.5)/height},crop,source.width,source.height),weight=Math.max(...masks.map(mask=>protectionWeight(mask,point)));if(!weight)continue;const at=(y*width+x)*4;if(weight===1){output.set(reference.subarray(at,at+4),at);continue;}const ra=reference[at+3]/255,na=output[at+3]/255,alpha=ra*weight+na*(1-weight);for(let c=0;c<3;c++)output[at+c]=alpha?linearToSrgb((linear[reference[at+c]]*ra*weight+linear[output[at+c]]*na*(1-weight))/alpha)*255:0;output[at+3]=alpha*255;}}return output;}

test('ROI compositor is byte-identical to the baseline across rotation, feather, alpha and reference groups',()=>{
  let seed=91;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let trial=0;trial<80;trial++){
    const width=23+trial%11,height=17+trial%13,source={width:513+trial*13,height:377+trial*3};
    const crop=trial%4?{x:.03,y:.07,width:.83,height:.89,angle:(trial%31)-15}:null;
    const pixels=Uint8ClampedArray.from({length:width*height*4},()=>Math.floor(rand()*256)),a=Uint8ClampedArray.from(pixels,()=>Math.floor(rand()*256)),b=Uint8ClampedArray.from(pixels,()=>Math.floor(rand()*256));
    for(let i=3;i<pixels.length;i+=28){pixels[i]=0;a[i]=0;b[i]=0;}
    const regions=Array.from({length:1+trial%4},(_,i)=>({referenceVersionId:i%3?'a':'b',mask:protectionMask({rect:{x:rand()*.6,y:rand()*.6,width:.1+rand()*.3,height:.1+rand()*.3},feather:trial%5?rand()*.25:0,maskType:trial%2?'rectangle':'radial'},null,source)}));
    const refs=new Map([['a',a],['b',b]]);assert.deepEqual(compositeProtectedRegions(pixels,width,height,regions,refs,crop,source),baselineComposite(pixels,width,height,regions,refs,crop,source),`trial ${trial}`);
  }
});


test('retrying an already committed preparation never removes live reference snapshots',async t=>{
  const folder=await fixture(t),p=await loadProject(folder),value=guard(p),prepared=await prepareProtection(folder,value);
  await commitProtection(folder,value,prepared);const before=await renderFrame(folder);
  await assert.rejects(commitProtection(folder,value,prepared),{code:'STALE_REVISION'});
  for(const file of prepared.createdSnapshots)assert.ok((await stat(path.join(folder,file))).size>0);
  assert.equal((await renderFrame(folder)).pixelHash,before.pixelHash);
});
