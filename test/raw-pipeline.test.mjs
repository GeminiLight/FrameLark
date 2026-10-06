import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
import {backendOrder} from '../skills/photo-retouch/scripts/raw/backends.mjs';
import {rawVersion,rawHash} from '../skills/photo-retouch/scripts/raw/contract.mjs';
import {displayPixels,hashFile,buildRawProxy} from '../skills/photo-retouch/scripts/raw/source.mjs';
import {createRawRenderSession,renderTiles,rawGeometry,rawMasterExport,rawFrame} from '../skills/photo-retouch/scripts/raw/render.mjs';
import {createDocument} from '../apps/studio/public/edit-stack/document.js';
import {applyCommands} from '../apps/studio/public/edit-stack/commands.js';
import {neutralSettings} from '../apps/studio/public/editor-engine.js';

test('RAW backend choice is platform-aware and explicit requests never silently substitute',()=>{
 assert.deepEqual(backendOrder('darwin',{apple:{},rawpy:{}}),['apple','rawpy']);assert.deepEqual(backendOrder('linux',{apple:{},rawpy:{}}),['rawpy']);assert.deepEqual(backendOrder('darwin',{rawpy:{}}),['rawpy']);assert.throws(()=>backendOrder('linux',{rawpy:{}},'apple'),{code:'RAW_BACKEND_UNAVAILABLE'});
});
async function fixture(t){
 const folder=await mkdtemp(join(tmpdir(),'framelark-linear-test-'));t.after(()=>rm(folder,{recursive:true,force:true}));await mkdir(join(folder,'source'));await mkdir(join(folder,'previews'));await mkdir(join(folder,'exports'));
 const width=64,height=48,pixels=new Float32Array(width*height*4);for(let i=0;i<pixels.length;i+=4){const n=i/4;pixels[i]=.15+(n%64)/200;pixels[i+1]=.2+Math.floor(n/64)/200;pixels[i+2]=.25;pixels[i+3]=255;}pixels[0]=pixels[1]=pixels[2]=10000/65535;pixels[4]=pixels[5]=pixels[6]=10001/65535;
 const bytes=Buffer.from(pixels.buffer),original=Buffer.from('synthetic original'),png=await sharp(displayPixels(pixels),{raw:{width,height,channels:4}}).png().toBuffer(),manifest={version:rawVersion,backend:'rawpy',backendVersion:'fixture',decoderVersion:'fixture',space:'linear-srgb',alphaScale:255,width,height,proxyWidth:width,proxyHeight:height,sourceHash:rawHash(original),masterHash:rawHash(bytes),masterBytes:bytes.length,proxyHash:rawHash(bytes),proxyBytes:bytes.length,normalizedHash:rawHash(png)};
 for(const [name,value] of [['original.bin',original],['master.f32',bytes],['proxy.f32',bytes],['normalized.png',png],['raw.json',JSON.stringify(manifest)]])await writeFile(join(folder,'source',name),value);
 const source={width,height,checksum:manifest.sourceHash,normalizedChecksum:manifest.normalizedHash,raw:{manifestHash:rawHash(Buffer.from(JSON.stringify(manifest)))}};
 const state={settings:neutralSettings(),style:null,crop:null,locals:[],textOverlays:[],guards:{parameters:[],locals:[],regions:[]}},recipe=createDocument({documentId:'raw-test',source:{assetId:'fixture',contentHash:source.checksum,width,height},base:state}),version={id:'original',state,recipe};return {folder,project:{id:'fixture',source,versions:[version]},version,pixels};
}
test('16-bit RAW master retains neighboring levels and carries an ICC profile',async t=>{
 const f=await fixture(t),result=await rawMasterExport(f.folder,f.project,f.version),metadata=await sharp(result.bytes).metadata();assert.equal(metadata.depth,'ushort');assert.ok(metadata.icc?.length);assert.equal(metadata.width,64);const {data}=await sharp(result.bytes).toColourspace('rgb16').raw({depth:'ushort'}).toBuffer({resolveWithObject:true});assert.notEqual(data.readUInt16LE(0),data.readUInt16LE(6));assert.equal(await readFile(join(f.folder,'source','original.bin'),'utf8'),'synthetic original');
});
test('tiled RAW render agrees with a single grid across detail, grain, masks and rotation',async t=>{
 const f=await fixture(t);f.version.recipe=applyCommands(f.version.recipe,[{type:'AddStep',step:{id:'detail',title:'detail',tool:'detail',toolVersion:2,parameters:{clarity:10,sharpen:7}}},{type:'AddStep',step:{id:'light',title:'light',tool:'exposure',toolVersion:2,parameters:{ev:.2}}},{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.5,end:.8},reference:{kind:'frozen-source',sourceHash:f.project.source.checksum}}},{type:'AddStep',step:{id:'grain',title:'grain',tool:'finish',toolVersion:2,parameters:{grain:4,vignette:5}}},{type:'UpdateGeometry',geometry:{crop:{x:.1,y:.1,width:.8,height:.8,angle:3}}}]).next;f.version.state.crop=f.version.recipe.geometry.crop;
 const g=rawGeometry(f.version.state.crop,64,48,2048),session=await createRawRenderSession(f.folder,f.project,{master:true}),full=await session.renderTile(f.version,g,{x:0,y:0,width:g.width,height:g.height},f.version.state.crop,{}),tiled=await renderTiles(session,f.project,f.version,g,{depth:16,tileSide:11});assert.deepEqual(tiled,displayPixels(full.working,{depth:16}));
});


test('RAW caches invalidate for recipe and legacy state changes, and reject source tampering',async t=>{
 const f=await fixture(t),g=rawGeometry(null,64,48);
 const first=await rawFrame(f.folder,f.project,f.version,g),warm=await rawFrame(f.folder,f.project,f.version,g);assert.equal(first.cached,false);assert.equal(warm.cached,true);assert.deepEqual(first.png,warm.png);
 f.version.state.crop={x:0,y:0,width:1,height:1,angle:3};const changed=await rawFrame(f.folder,f.project,f.version,g);assert.equal(changed.cached,false);assert.notDeepEqual(changed.png,first.png);
 f.version.recipe=applyCommands(f.version.recipe,[{type:'AddStep',step:{id:'light',title:'light',tool:'exposure',toolVersion:2,parameters:{ev:.3}}}]).next;assert.equal((await rawFrame(f.folder,f.project,f.version,g)).cached,false);
 await writeFile(join(f.folder,'source','original.bin'),'tampered original');await assert.rejects(rawFrame(f.folder,f.project,f.version,g),{code:'SOURCE_CHANGED'});
});
test('RAW rejects non-finite decoded masters and supports cancelled proxy construction',async t=>{
 const f=await fixture(t);f.pixels[0]=NaN;await writeFile(join(f.folder,'source','master.f32'),Buffer.from(f.pixels.buffer));await assert.rejects(hashFile(join(f.folder,'source','master.f32'),{finite:true}),{code:'RAW_INVALID_PIXELS'});
 const controller=new AbortController();controller.abort();await assert.rejects(buildRawProxy(join(f.folder,'source','master.f32'),64,48,{signal:controller.signal}),{name:'AbortError'});
});
test('RAW linear exposure recovers highlights before output encoding',async t=>{
 const f=await fixture(t);f.pixels[0]=f.pixels[1]=f.pixels[2]=2;
 const bytes=Buffer.from(f.pixels.buffer),manifest=JSON.parse(await readFile(join(f.folder,'source','raw.json'),'utf8'));manifest.masterHash=manifest.proxyHash=rawHash(bytes);
 await writeFile(join(f.folder,'source','master.f32'),bytes);await writeFile(join(f.folder,'source','proxy.f32'),bytes);await writeFile(join(f.folder,'source','raw.json'),JSON.stringify(manifest));f.project.source.raw.manifestHash=rawHash(Buffer.from(JSON.stringify(manifest)));
 f.version.recipe=applyCommands(f.version.recipe,[{type:'AddStep',step:{id:'lower',title:'lower',tool:'exposure',toolVersion:2,parameters:{ev:-2}}}]).next;
 const session=await createRawRenderSession(f.folder,f.project,{master:true}),g=rawGeometry(null,64,48),frame=await session.renderTile(f.version,g,{x:0,y:0,width:64,height:48},null,{});assert.equal(frame.working[0],.5);assert.ok(frame.pixels[0]>180&&frame.pixels[0]<190);
});
import {runRawProcess} from '../skills/photo-retouch/scripts/raw/process.mjs';
test('RAW subprocess failures and cancellation terminate real children',async t=>{
 await assert.rejects(runRawProcess('/nonexistent-framelark-decoder',[]),{code:'RAW_BACKEND_UNAVAILABLE'});
 await assert.rejects(runRawProcess(process.execPath,['-e','process.exit(3)']),{code:'RAW_UNSUPPORTED'});
 await assert.rejects(runRawProcess(process.execPath,['-e','console.log("invalid")']),{code:'RAW_PROTOCOL'});
 const folder=await mkdtemp(join(tmpdir(),'framelark-cancel-'));t.after(()=>rm(folder,{recursive:true,force:true}));const marker=join(folder,'pid');
 const controller=new AbortController(),running=runRawProcess(process.execPath,['-e','require("node:fs").writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)',marker],{signal:controller.signal});
 for(let n=0;n<100;n++){if(await stat(marker).catch(()=>null))break;await new Promise(resolve=>setTimeout(resolve,10));}
 const pid=Number(await readFile(marker,'utf8'));controller.abort();await assert.rejects(running,{code:'CANCELLED'});assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 await assert.rejects(runRawProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:30}),{code:'RAW_TIMEOUT'});
});

import {writeReferenceSnapshot} from '../skills/photo-retouch/scripts/reference-store.mjs';
import {hash,versionPipeline,versionStateHash} from '../skills/photo-retouch/scripts/engine/edit-identity.js';
import {protectionMask} from '../skills/photo-retouch/scripts/engine/protected-regions.js';
test('RAW protection keeps linear precision and validates saved snapshots even on cache hits',async t=>{
 const f=await fixture(t),g=rawGeometry(null,64,48,1400),reference=await rawFrame(f.folder,f.project,f.version,g);
 const snapshot=await writeReferenceSnapshot(f.folder,'guard',{...reference,width:64,height:48,pixelHash:hash(Buffer.from(reference.pixels))});
 const cleanSnapshot=await writeReferenceSnapshot(f.folder,'guard',{...reference,width:64,height:48,pixelHash:hash(Buffer.from(reference.pixels))},true);
 const edited=structuredClone(f.version);edited.id='edited';edited.recipe=applyCommands(edited.recipe,[{type:'AddStep',step:{id:'light',title:'light',tool:'exposure',toolVersion:2,parameters:{ev:1}}}]).next;
 const region={id:'guard',name:'protected',referenceVersionId:f.version.id,sourceChecksum:f.project.source.checksum,normalizedChecksum:f.project.source.normalizedChecksum,pipeline:versionPipeline(f.version),geometry:null,referenceStateHash:versionStateHash(f.version),mask:protectionMask({rect:{x:0,y:0,width:.5,height:1},feather:.1},null,{width:64,height:48}),snapshot,cleanSnapshot};edited.state.guards.regions=[region];f.project.versions.push(edited);
 const session=await createRawRenderSession(f.folder,f.project,{master:true}),tiled=await renderTiles(session,f.project,edited,g,{tileSide:13,depth:16});assert.equal(tiled[0],displayPixels(f.pixels,{depth:16})[0]);
 const first=await rawFrame(f.folder,f.project,edited,g);assert.equal((await rawFrame(f.folder,f.project,edited,g)).cached,true);assert.notDeepEqual(first.png,reference.png);
 await writeFile(join(f.folder,snapshot.path),'corrupt');await assert.rejects(rawFrame(f.folder,f.project,edited,g),{code:'REFERENCE_CORRUPT'});await assert.rejects(rawMasterExport(f.folder,f.project,edited),{code:'REFERENCE_CORRUPT'});
});
test('RAW mask display stays identical when full-resolution previews use tiles',async t=>{
 const f=await fixture(t);f.version.recipe=applyCommands(f.version.recipe,[{type:'AddStep',step:{id:'light',title:'light',tool:'exposure',toolVersion:2,parameters:{ev:.3}}},{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.4,end:.8},reference:{kind:'live-input'}}}]).next;
 const g=rawGeometry(null,64,48),session=await createRawRenderSession(f.folder,f.project,{master:true}),maskView={stepId:'light',mode:'bw'},full=await session.renderTile(f.version,g,{x:0,y:0,width:64,height:48},null,{maskView});
 assert.deepEqual(await renderTiles(session,f.project,f.version,g,{depth:8,tileSide:13,maskView}),full.pixels);
});
