import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,chmod,truncate} from 'node:fs/promises';
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
import {renderFrame,exportPhoto} from '../skills/photo-retouch/scripts/render.mjs';

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
test('RAW master export is independent of a valid but visibly different display proxy',async t=>{
 const f=await fixture(t),before=await rawMasterExport(f.folder,f.project,f.version),proxy=new Float32Array(f.pixels.length);
 for(let i=3;i<proxy.length;i+=4)proxy[i]=255;
 const bytes=Buffer.from(proxy.buffer),manifest=JSON.parse(await readFile(join(f.folder,'source','raw.json'),'utf8'));manifest.proxyHash=rawHash(bytes);
 await writeFile(join(f.folder,'source','proxy.f32'),bytes);await writeFile(join(f.folder,'source','raw.json'),JSON.stringify(manifest));f.project.source.raw.manifestHash=rawHash(Buffer.from(JSON.stringify(manifest)));
 const after=await rawMasterExport(f.folder,f.project,f.version);assert.equal(after.pixelHash,before.pixelHash);
 const preview=await createRawRenderSession(f.folder,f.project,{master:false}),g=rawGeometry(null,64,48),shown=await preview.renderTile(f.version,g,{x:0,y:0,width:64,height:48},null,{});assert.equal(shown.pixels[0],0);assert.ok(f.pixels[0]>0);
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

const sidecar=file=>file.replace(/\.png$/,'.json');
async function cacheMetadata(frame,width,height){
 const png=await readFile(frame.cachePath);
 return {schema:1,key:frame.cachePath.match(/raw-([a-f0-9]{64})\.png$/)[1],width,height,bytes:png.length,fileHash:rawHash(png)};
}
test('RAW PNG export rebuilds a changed cache from the verified master without changing TIFF or source bytes',async t=>{
 const f=await fixture(t);Object.assign(f.project,{schema:3,revision:1,currentId:f.version.id,acceptedId:null,notes:[],candidates:[],reviews:[],exports:[],choices:[],intent:'合成缓存测试'});Object.assign(f.project.source,{name:'fixture.dng',format:'raw',bytes:Buffer.byteLength('synthetic original')});
 await writeFile(join(f.folder,'project.json'),JSON.stringify(f.project));
 const source=await readFile(join(f.folder,'source','original.bin')),master=await readFile(join(f.folder,'source','master.f32')),tiff=await rawMasterExport(f.folder,f.project,f.version);
 const first=await renderFrame(f.folder,'current',{maxSide:8192,master:true,withoutText:false});
 await sharp({create:{width:64,height:48,channels:4,background:'#000000'}}).png().toFile(first.cachePath);
 const exported=await exportPhoto(f.folder,'current',{format:'png',preset:'original',output:join(f.folder,'exports','recovered.png')});
 assert.equal(exported.pixelHash,first.pixelHash);assert.deepEqual(await sharp(exported.path).ensureAlpha().raw().toBuffer(),Buffer.from(first.pixels));
 assert.equal((await rawMasterExport(f.folder,f.project,f.version)).pixelHash,tiff.pixelHash);
 assert.deepEqual(await readFile(join(f.folder,'source','original.bin')),source);assert.deepEqual(await readFile(join(f.folder,'source','master.f32')),master);
});
test('RAW cache pairs reject valid wrong dimensions and corrupt PNG contents even when a sidecar records their hash',async t=>{
 for(const kind of ['wrong-size','damaged-png','wrong-key'])await t.test(kind,async child=>{
   const f=await fixture(child),g=rawGeometry(null,64,48),first=await rawFrame(f.folder,f.project,f.version,g),meta=await cacheMetadata(first,64,48);
   if(kind==='wrong-size')await sharp({create:{width:8,height:8,channels:4,background:'#000000'}}).png().toFile(first.cachePath);
   if(kind==='damaged-png')await writeFile(first.cachePath,first.png.subarray(0,40));
   const png=await readFile(first.cachePath);meta.bytes=png.length;meta.fileHash=rawHash(png);if(kind==='wrong-key')meta.key='0'.repeat(64);
   await writeFile(sidecar(first.cachePath),JSON.stringify(meta));
   const recovered=await rawFrame(f.folder,f.project,f.version,g);assert.equal(recovered.cached,false);assert.deepEqual(recovered.pixels,first.pixels);
   assert.equal((await rawFrame(f.folder,f.project,f.version,g)).cached,true);
 });
});
test('RAW cache rebuilds corrupt IDAT data with matching metadata and intact PNG dimensions',async t=>{
 const f=await fixture(t),g=rawGeometry(null,64,48),first=await rawFrame(f.folder,f.project,f.version,g),png=Buffer.from(first.png);
 let offset=8,changed=false;
 while(offset+12<=png.length){
   const length=png.readUInt32BE(offset),kind=png.toString('ascii',offset+4,offset+8);
   if(kind==='IDAT'&&length>8){png[offset+8+Math.floor(length/2)]^=255;changed=true;break;}
   offset+=length+12;
 }
 assert.ok(changed,'fixture must contain a compressed IDAT chunk');
 assert.deepEqual(png.subarray(0,33),first.png.subarray(0,33));assert.equal(png.length,first.png.length);
 const metadata=JSON.parse(await readFile(sidecar(first.cachePath),'utf8'));metadata.fileHash=rawHash(png);
 await writeFile(first.cachePath,png);await writeFile(sidecar(first.cachePath),JSON.stringify(metadata));
 const recovered=await rawFrame(f.folder,f.project,f.version,g);assert.equal(recovered.cached,false);assert.deepEqual(recovered.pixels,first.pixels);
 assert.equal((await rawFrame(f.folder,f.project,f.version,g)).cached,true);
});
test('RAW legacy caches without sidecars are regenerated and verified cache pairs are reused',async t=>{
 const f=await fixture(t),g=rawGeometry(null,64,48),first=await rawFrame(f.folder,f.project,f.version,g);
 await rm(sidecar(first.cachePath),{force:true});
 const refreshed=await rawFrame(f.folder,f.project,f.version,g);assert.equal(refreshed.cached,false);assert.deepEqual(refreshed.pixels,first.pixels);
 const meta=JSON.parse(await readFile(sidecar(first.cachePath),'utf8'));assert.equal(meta.fileHash,rawHash(refreshed.png));
 assert.equal((await rawFrame(f.folder,f.project,f.version,g)).cached,true);
});
test('RAW cache metadata reads are bounded and filesystem access errors are not swallowed',async t=>{
 const f=await fixture(t),g=rawGeometry(null,64,48),first=await rawFrame(f.folder,f.project,f.version,g);
 await writeFile(sidecar(first.cachePath),' '.repeat(8192));
 const rebuilt=await rawFrame(f.folder,f.project,f.version,g);assert.equal(rebuilt.cached,false);assert.deepEqual(rebuilt.pixels,first.pixels);
 if(process.platform!=='win32'&&process.getuid?.()!==0){
   const file=sidecar(first.cachePath);await chmod(file,0);try{await assert.rejects(rawFrame(f.folder,f.project,f.version,g),{code:'EACCES'});}finally{await chmod(file,0o600);}
 }
});
test('concurrent RAW cache publication leaves a verified reusable pair',async t=>{
 const f=await fixture(t),g=rawGeometry(null,64,48),frames=await Promise.all([rawFrame(f.folder,f.project,f.version,g),rawFrame(f.folder,f.project,f.version,g)]);
 assert.deepEqual(frames[0].pixels,frames[1].pixels);assert.equal((await rawFrame(f.folder,f.project,f.version,g)).cached,true);
 const meta=JSON.parse(await readFile(sidecar(frames[0].cachePath),'utf8'));assert.equal(meta.fileHash,rawHash(await readFile(frames[0].cachePath)));
});
test('RAW cache pruning removes sidecars and orphan metadata without touching originals',async t=>{
 const f=await fixture(t),old=join(f.folder,'previews','raw-'+'a'.repeat(64)+'.png'),orphan=join(f.folder,'previews','raw-'+'b'.repeat(64)+'.json');
 await writeFile(old,'x');await truncate(old,256*1024*1024+1);await writeFile(sidecar(old),'{}');await writeFile(orphan,'{}');
 const original=await readFile(join(f.folder,'source','original.bin'));await rawFrame(f.folder,f.project,f.version,rawGeometry(null,64,48));
 for(const file of [old,sidecar(old),orphan])await assert.rejects(stat(file),{code:'ENOENT'});
 assert.deepEqual(await readFile(join(f.folder,'source','original.bin')),original);
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
 const referenceBytes=await readFile(join(f.folder,snapshot.path)),cleanBytes=await readFile(join(f.folder,cleanSnapshot.path));
 await sharp({create:{width:64,height:48,channels:4,background:'#000000'}}).png().toFile(first.cachePath);
 const rebuilt=await rawFrame(f.folder,f.project,edited,g);assert.equal(rebuilt.cached,false);assert.deepEqual(rebuilt.pixels,first.pixels);
 assert.deepEqual(await readFile(join(f.folder,snapshot.path)),referenceBytes);assert.deepEqual(await readFile(join(f.folder,cleanSnapshot.path)),cleanBytes);
  await writeFile(join(f.folder,snapshot.path),'corrupt');await assert.rejects(rawFrame(f.folder,f.project,edited,g),{code:'REFERENCE_CORRUPT'});await assert.rejects(rawMasterExport(f.folder,f.project,edited),{code:'REFERENCE_CORRUPT'});
});
test('RAW mask display stays identical when full-resolution previews use tiles',async t=>{
 const f=await fixture(t);f.version.recipe=applyCommands(f.version.recipe,[{type:'AddStep',step:{id:'light',title:'light',tool:'exposure',toolVersion:2,parameters:{ev:.3}}},{type:'ReplaceStepMask',stepId:'light',mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.4,end:.8},reference:{kind:'live-input'}}}]).next;
 const g=rawGeometry(null,64,48),session=await createRawRenderSession(f.folder,f.project,{master:true}),maskView={stepId:'light',mode:'bw'},full=await session.renderTile(f.version,g,{x:0,y:0,width:64,height:48},null,{maskView});
 assert.deepEqual(await renderTiles(session,f.project,f.version,g,{depth:8,tileSide:13,maskView}),full.pixels);
});
