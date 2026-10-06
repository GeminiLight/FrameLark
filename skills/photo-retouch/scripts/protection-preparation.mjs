import {readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {loadProject,currentVersion,hash,fail} from './project.mjs';
import {guardsOf,geometryOf} from './engine/edit-guards.js';
import {protectionMask,assertNonOverlappingReferences} from './engine/protected-regions.js';
import {outputGeometry} from './engine/export-settings.js';
import {versionPipeline,versionStateHash} from './engine/edit-identity.js';
import {assertReferenceComplexity,verifyReferences,writeReferenceSnapshot} from './reference-store.mjs';
import {randomUUID} from 'node:crypto';

// Expensive preparation runs outside the project lock (in the HTTP render worker).
// No project state is changed until the caller compares and commits this snapshot.
export async function prepareProtection(folder,value) {
  const p=await loadProject(folder),base=currentVersion(p);
  if(value.revision!==p.revision)fail('STALE_REVISION','照片或批注已更新，请重新读取后再保护。');
  if(guardsOf(base.state).regions.length>=8)fail('PROTECTION_LIMIT','最多保留 8 个保护区域。');
  const state=structuredClone(base.state);state.guards=structuredClone(guardsOf(state));
  const sourceRect=outputGeometry(base.state.crop,p.source.width,p.source.height,1400).rect;
  const viewCrop={x:sourceRect.x/p.source.width,y:sourceRect.y/p.source.height,width:sourceRect.width/p.source.width,height:sourceRect.height/p.source.height,angle:base.state.crop?.angle||0};
  const region={id:randomUUID(),name:String(value.name??'').trim().slice(0,60)||'保留画面',referenceVersionId:base.id,sourceChecksum:p.source.checksum,normalizedChecksum:p.source.normalizedChecksum,pipeline:versionPipeline(base),geometry:geometryOf(base.state),referenceStateHash:versionStateHash(base),mask:protectionMask(value,viewCrop,p.source)};
  assertNonOverlappingReferences([...state.guards.regions,region]);
  assertReferenceComplexity(p,{...state,guards:{...state.guards,regions:[...state.guards.regions,region]}});
  const createdSnapshots=[];
  try {
    const {createRenderSession}=await import('./render.mjs'),session=await createRenderSession(folder,p);
    const frame=await session.renderFrame(base.id,{maxSide:1400});
    const clean=(base.state.textOverlays?.length||guardsOf(base.state).regions.length)?await session.renderFrame(base.id,{maxSide:1400,withoutText:true}):frame;
    createdSnapshots.push(`references/${region.id}.png`);region.snapshot=await writeReferenceSnapshot(folder,region.id,frame);
    createdSnapshots.push(`references/${region.id}-clean.png`);region.cleanSnapshot=await writeReferenceSnapshot(folder,region.id,clean,true);
    state.guards.regions.push(region);
    // Decode and validate every dependency once before the short commit phase.
    await verifyReferences(folder,p,state);
    const integrity=new Map([['source/original.bin',p.source.checksum],['source/normalized.png',p.source.normalizedChecksum]]),seen=new Set();
    function collect(current){for(const r of guardsOf(current).regions){for(const s of [r.snapshot,r.cleanSnapshot])integrity.set(s.path,s.fileHash);if(!seen.has(r.referenceVersionId)){seen.add(r.referenceVersionId);collect(p.versions.find(v=>v.id===r.referenceVersionId).state);}}}
    collect(state);
    return {revision:p.revision,projectHash:hash(p),baseId:base.id,state,createdSnapshots,integrity:[...integrity]};
  } catch(error) {await discardPreparedProtection(folder,{createdSnapshots});throw error;}
}

// The same bytes already decoded above are rechecked while holding the CAS lock.
// No rendering, image decoding or PNG encoding occurs inside the transaction.
export async function verifyPreparedProtection(folder,prepared) {
  for(const [file,expected] of prepared.integrity){
    const bytes=await readFile(path.join(folder,file)).catch(()=>null);
    if(!bytes||hash(bytes)!==expected)fail(file.startsWith('source/')?'SOURCE_CHANGED':'REFERENCE_CORRUPT','保护准备期间源图或参考快照已改变，请恢复文件后重试。');
  }
}
export async function discardPreparedProtection(folder,prepared,referencedPaths=new Set()) {
  await Promise.all(prepared.createdSnapshots.filter(file=>!referencedPaths.has(file)).map(file=>rm(path.join(folder,file),{force:true})));
}
