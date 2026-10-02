import {combineSettings, adjustmentKeys} from './editor-engine.js';
import {presetById} from './presets.js';
import {object, ids, cleanSettings, equal, fail} from './edit-values.js';
import {validateProtectionMask, assertNonOverlappingReferences} from './protected-regions.js';

export const emptyGuards = () => ({parameters:[], locals:[], regions:[]});
export const guardsOf = state => state.guards || emptyGuards();
export const effectiveSettings = state => combineSettings({settings:state.settings}, {settings:presetById(state.style?.id)?.adjustments,amount:(state.style?.amount||0)/100});
export const geometryOf = state => state.crop || null;
const digest = value => typeof value === 'string' && /^[\da-f]{64}$/.test(value);

export function validateGuards(guards) {
  if (guards === undefined) return emptyGuards();
  object(guards, ['parameters','locals','regions'], 'INVALID_GUARDS');
  for (const key of ['parameters','locals','regions']) if (!Array.isArray(guards[key]) || guards[key].length > (key==='parameters'?31:8)) fail('INVALID_GUARDS', '保护记录数量不正确。');
  ids(guards.parameters.map(g=>g.key), 'INVALID_GUARDS');
  ids(guards.locals.map(g=>g.id), 'INVALID_GUARDS');
  ids(guards.regions.map(g=>g.id), 'INVALID_GUARDS');
  for (const guard of guards.parameters) {
    object(guard,['key','manual','effective'],'INVALID_GUARDS');
    cleanSettings({[guard.key]:guard.manual});
    if (!Number.isFinite(guard.effective)) fail('INVALID_GUARDS','锁定的有效值必须有限。');
  }
  for (const guard of guards.locals) {
    object(guard,['id','index','layer'],'INVALID_GUARDS');
    if (!Number.isInteger(guard.index) || guard.index<0 || guard.index>7 || guard.layer?.id!==guard.id) fail('INVALID_GUARDS','局部锁快照无效。');
  }
  for (const guard of guards.regions) {
    object(guard,['id','name','referenceVersionId','sourceChecksum','normalizedChecksum','pipeline','geometry','referenceStateHash','mask','snapshot','cleanSnapshot'],'INVALID_GUARDS');
    ids([guard.referenceVersionId],'INVALID_GUARDS'); validateProtectionMask(guard.mask);
    if (!digest(guard.sourceChecksum) || !digest(guard.normalizedChecksum) || !digest(guard.referenceStateHash) || typeof guard.pipeline!=='string') fail('INVALID_GUARDS','参考版本身份无效。');
    for (const snapshot of [guard.snapshot,guard.cleanSnapshot]) {
      if (!snapshot || !/^references\/[\w-]+(?:-clean)?\.png$/.test(snapshot.path) || !digest(snapshot.fileHash) || !digest(snapshot.pixelHash) || !Number.isInteger(snapshot.width) || !Number.isInteger(snapshot.height) || snapshot.width<1 || snapshot.height<1 || snapshot.width*snapshot.height>16_000_000) fail('INVALID_GUARDS','无损参考快照记录无效。');
    }
  }
  assertNonOverlappingReferences(guards.regions);
  return guards;
}

export function assertGuards(base, next, {allowGuardChange=false}={}) {
  const guards=validateGuards(guardsOf(base)),nextGuards=validateGuards(guardsOf(next)),conflicts=[];
  if (!allowGuardChange && !equal(guards,nextGuards)) fail('GUARDS_READ_ONLY','普通方案不能修改保护，请使用专门的解除操作。');
  const effective=effectiveSettings(next);
  for (const g of guards.parameters) if (next.settings[g.key]!==g.manual || Math.abs(effective[g.key]-g.effective)>1e-10) conflicts.push({kind:'parameter',key:g.key,manual:g.manual,effective:g.effective});
  for (const g of guards.locals) if (!equal(next.locals[g.index],g.layer)) conflicts.push({kind:'local',id:g.id,index:g.index});
  if (conflicts.length) fail('LOCK_CONFLICT','调整会改变已锁定参数或局部层。请显式解除对应锁后再试。',{conflicts});
  if (guards.regions.length && !equal(geometryOf(base),geometryOf(next))) fail('PROTECTED_GEOMETRY','保留画面效果时不能改变裁剪或拉直。请先解除区域保护并接受预览。');
}

export function lockState(state, {parameters=[],localIds=[]}) {
  ids(parameters,'INVALID_GUARDS');ids(localIds,'INVALID_GUARDS');
  if (!parameters.length&&!localIds.length) fail('EMPTY_GUARD','请选择要锁定的参数或局部层。');
  if (parameters.some(key=>!adjustmentKeys.includes(key))) fail('UNKNOWN_PARAMETER','锁定列表包含未知参数。');
  const next=structuredClone(state),guards=structuredClone(guardsOf(state)),effective=effectiveSettings(state);
  for (const key of parameters) if (!guards.parameters.some(g=>g.key===key)) guards.parameters.push({key,manual:state.settings[key]??0,effective:effective[key]});
  for (const id of localIds) {
    const index=state.locals.findIndex(l=>l.id===id);
    if (index===-1) fail('LOCAL_NOT_FOUND','要锁定的局部层不存在。');
    if (!guards.locals.some(g=>g.id===id)) guards.locals.push({id,index,layer:structuredClone(state.locals[index])});
  }
  next.guards=guards;return next;
}

export function unlockState(state, {parameterKeys=[],localIds=[],regionIds=[]}) {
  const selections={parameters:ids(parameterKeys,'INVALID_GUARDS'),locals:ids(localIds,'INVALID_GUARDS'),regions:ids(regionIds,'INVALID_GUARDS')};
  if (!Object.values(selections).some(x=>x.length)) fail('EMPTY_GUARD','请选择要解除的保护。');
  const next=structuredClone(state),guards=structuredClone(guardsOf(state));
  for (const [kind,chosen] of Object.entries(selections)) {
    const key=kind==='parameters'?'key':'id';
    if (chosen.some(id=>!guards[kind].some(g=>g[key]===id))) fail('GUARD_NOT_FOUND','要解除的保护已不存在。请读取最新版本。');
    guards[kind]=guards[kind].filter(g=>!chosen.includes(g[key]));
  }
  next.guards=guards;return next;
}

// A restore includes the target's historical composites and retains every live
// constraint. Incompatible snapshots require explicit unlocking, never silently
// choosing whichever happens to be later in an array.
export function mergeRestoreGuards(current, target) {
  const merged=structuredClone(guardsOf(target));
  for(const kind of ['parameters','locals','regions']) {
    const key=kind==='parameters'?'key':'id';
    for(const live of guardsOf(current)[kind]) {
      const found=merged[kind].find(g=>g[key]===live[key]);
      if(found&&!equal(found,live))fail('LOCK_CONFLICT','恢复版本与当前保护快照冲突。请先显式解除对应保护。');
      if(!found)merged[kind].push(structuredClone(live));
    }
  }
  validateGuards(merged);return merged;
}
