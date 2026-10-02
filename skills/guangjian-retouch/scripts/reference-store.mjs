import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {hash, pipelineVersion} from './engine/edit-identity.js';
import {guardsOf, geometryOf, validateGuards} from './engine/edit-guards.js';
import {equal, fail} from './engine/edit-values.js';

export const protectionLimits={maxRegions:8,maxReferenceDepth:4,maxReferenceVersions:8};
export function assertReferenceComplexity(project,state){
  const versions=new Map(project.versions.map(v=>[v.id,v])),seen=new Set();
  function walk(current,depth,ancestors){
    for(const region of guardsOf(current).regions){
      const id=region.referenceVersionId;
      if(ancestors.has(id))fail('REFERENCE_CYCLE','保护参考形成循环。');
      if(depth>=protectionLimits.maxReferenceDepth)fail('PROTECTION_COMPLEXITY','保护参考链超过 4 层。请先解除旧区域保护并确认画面，再重新建立保护。');
      seen.add(id);if(seen.size>protectionLimits.maxReferenceVersions)fail('PROTECTION_COMPLEXITY','保护依赖超过 8 个历史版本，请先整理保护。');
      const reference=versions.get(id);if(!reference)fail('REFERENCE_NOT_FOUND','保护参考版本不存在。');
      walk(reference.state,depth+1,new Set([...ancestors,id]));
    }
  }
  walk(state,0,new Set());
}

export function validateReferences(project, state, ownerIndex = project.versions.length, {checkPipeline=true}={}) {
  validateGuards(guardsOf(state));
  assertReferenceComplexity(project,state);
  for (const region of guardsOf(state).regions) {
    const index=project.versions.findIndex(v=>v.id===region.referenceVersionId),reference=project.versions[index];
    if (index<0 || index>=ownerIndex) fail('REFERENCE_NOT_FOUND','保护必须引用更早的已保存版本，不能引用候选或形成循环。');
    if (region.sourceChecksum!==project.source.checksum || region.normalizedChecksum!==project.source.normalizedChecksum) fail('REFERENCE_SOURCE_CHANGED','保护参考与原片身份不一致。');
    if (checkPipeline&&region.pipeline!==pipelineVersion) fail('REFERENCE_PIPELINE_CHANGED','渲染管线已改变。请使用保存的无损参考重新确认保护；本次不会重新解释旧效果。');
    if (region.referenceStateHash!==hash(reference.state)) fail('REFERENCE_STATE_CHANGED','保护参考版本记录已改变，请从备份恢复。');
    if (!equal(region.geometry,geometryOf(state)) || !equal(region.geometry,geometryOf(reference.state))) fail('PROTECTED_GEOMETRY','保护参考与当前构图不一致。请先解除区域保护。');
  }
}

export async function readReferenceSnapshot(folder, snapshot) {
  try {
    if (!snapshot || !/^references\/[\w-]+(?:-clean)?\.png$/.test(snapshot.path)) fail('REFERENCE_CORRUPT','参考快照路径无效。');
    const filename=path.join(folder,snapshot.path),info=await stat(filename);
    if (info.size>80*1024*1024) fail('REFERENCE_CORRUPT','参考快照过大。');
    const bytes=await readFile(filename);
    if (hash(bytes)!==snapshot.fileHash) fail('REFERENCE_CORRUPT','保护参考快照已损坏。请恢复备份；不会忽略保护继续输出。');
    const {data,info:decoded}=await sharp(bytes,{limitInputPixels:16_000_000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if (decoded.width!==snapshot.width || decoded.height!==snapshot.height || hash(data)!==snapshot.pixelHash) fail('REFERENCE_CORRUPT','保护参考快照像素不匹配。');
    return new Uint8ClampedArray(data);
  } catch (error) {
    if (error.code?.startsWith('REFERENCE')) throw error;
    fail('REFERENCE_UNAVAILABLE','保护参考图不可读取。请恢复 references 目录中的备份；不会忽略保护继续输出。');
  }
}

export async function verifyReferences(folder, project, state) {
  const seen=new Set();
  if(guardsOf(state).regions.length){
    const original=await readFile(path.join(folder,'source','original.bin')).catch(()=>null),normalized=await readFile(path.join(folder,'source','normalized.png')).catch(()=>null);
    if(!original||!normalized||hash(original)!==project.source.checksum||hash(normalized)!==project.source.normalizedChecksum)fail('SOURCE_CHANGED','保护项目的源图已改变，请恢复备份。');
  }
  async function walk(current, ownerIndex) {
    validateReferences(project,current,ownerIndex);
    for (const region of guardsOf(current).regions) {
      for (const snapshot of [region.snapshot,region.cleanSnapshot]) if (!seen.has(snapshot.path)) { await readReferenceSnapshot(folder,snapshot);seen.add(snapshot.path); }
      if (!seen.has(region.referenceVersionId)) {seen.add(region.referenceVersionId);const index=project.versions.findIndex(v=>v.id===region.referenceVersionId);await walk(project.versions[index].state,index);}
    }
  }
  await walk(state,project.versions.length);
}

export async function writeReferenceSnapshot(folder, id, frame, clean = false) {
  const relative=`references/${id}${clean?'-clean':''}.png`;
  await mkdir(path.join(folder,'references'),{recursive:true,mode:0o700});
  await writeFile(path.join(folder,relative),frame.png,{flag:'wx',mode:0o600});
  return {path:relative,fileHash:hash(frame.png),pixelHash:frame.pixelHash,width:frame.width,height:frame.height,maxSide:1400,withoutText:clean};
}
