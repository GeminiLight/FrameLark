import {normalizeToolPlan,compileToolPlan} from './photo-tools/registry.js';
import {presetById} from './presets.js';
import {validCrop} from './crop-utils.js';
import {originalToViewPoint} from './photo-geometry.js';
import {cleanSettings, cleanRect, object, ids, bounded, equal, fail} from './edit-values.js';

const patchKeys = ['settings', 'style', 'crop', 'locals', 'textOverlays'];
export const planKeys = ['revision', 'baseRevision', 'baseVersion', 'fromCandidate', 'requestId', 'name', 'goal', 'tradeoff', 'mode', 'allowProtectedCrop', 'items', 'operations', 'selectedItemIds', ...patchKeys];

// Legacy refinement is frozen into one selectable delta against the accepted
// base. It never depends on a mutable candidate or implicitly accepts it.
export function snapshotItem(base, state, title = '整组精调') {
  const patch = {}, writePaths = [];
  const settings = Object.fromEntries(Object.entries(state.settings).filter(([key, value]) => !equal(value, base.settings[key])));
  if (Object.keys(settings).length) { patch.settings = settings; writePaths.push(...Object.keys(settings).map(key => `settings.${key}`)); }
  for (const key of ['style', 'crop', 'textOverlays']) if (!equal(state[key], base[key])) { patch[key] = structuredClone(state[key]); writePaths.push(key); }
  if (!equal(state.locals, base.locals)) {
    // Internal snapshots may remove/reinsert to preserve compositing order.
    patch.locals = [...base.locals.map(layer => ({id: layer.id, remove: true})), ...state.locals.map(layer => ({id: layer.id, layer: structuredClone(layer)}))];
    writePaths.push(...new Set(patch.locals.map(layer => `locals.${layer.id}`)));
  }
  return {id: 'whole-plan', title: title.trim().slice(0,100), dependsOn: [], patch, writePaths};
}

function localLayer(patch, base, notes) {
  object(patch, ['annotationId', 'settings', 'remove', 'feather', 'maskType', 'start', 'end', 'enabled', 'amount', 'rect', 'note', 'exclude'], 'INVALID_LOCAL');
  ids([patch.annotationId], 'INVALID_LOCAL');
  const existing = base.locals.find(l => l.id === patch.annotationId);
  if (patch.remove !== undefined && typeof patch.remove !== 'boolean') fail('INVALID_LOCAL', 'remove 必须是布尔值。');
  if (patch.remove) {
    if (Object.keys(patch).some(k => !['annotationId', 'remove'].includes(k))) fail('INVALID_LOCAL', '删除局部不能同时修改它。');
    if (!existing) fail('LOCAL_NOT_FOUND', '要移除的局部层不存在。');
    return {id: patch.annotationId, remove: true};
  }
  const note = notes.find(n => n.id === patch.annotationId) || (patch.rect ? {id:patch.annotationId,rect:cleanRect(patch.rect),note:String(patch.note||'').slice(0,600)}:null);
  if (!note) fail('NOTE_NOT_FOUND', '局部标记已更新或删除，请重新读取批注。');
  const layer = structuredClone(existing || {id: note.id, maskType: 'rectangle', feather: .36, localAmount: 100, localEnabled: true, localSettings: {}});
  if(patch.exclude!==undefined){if(!Array.isArray(patch.exclude)||patch.exclude.length>8)fail('INVALID_MASK','排除范围无效。');layer.exclude=patch.exclude.map(r=>cleanRect(r));}
  layer.rect = cleanRect(note.rect); layer.note = note.note;
  layer.localSettings = {...layer.localSettings, ...cleanSettings(patch.settings)};
  if (patch.feather !== undefined) layer.feather = bounded(patch.feather, 0, 1, 'INVALID_FEATHER');
  if (patch.amount !== undefined) layer.localAmount = bounded(patch.amount, 0, 150, 'INVALID_LOCAL');
  if (patch.maskType !== undefined) {
    if (!['rectangle', 'radial', 'linear'].includes(patch.maskType)) fail('INVALID_MASK', '本版局部支持矩形、径向、渐变。');
    layer.maskType = patch.maskType;
  }
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') fail('INVALID_LOCAL', 'enabled 必须是布尔值。');
    layer.localEnabled = patch.enabled;
  }
  if (layer.maskType === 'linear') for (const key of ['start', 'end']) {
    const point = patch[key] || layer[key] || {x: note.rect.x, y: note.rect.y + (key === 'end' ? note.rect.height : 0)};
    object(point, ['x', 'y'], 'INVALID_MASK');
    layer[key] = {x: bounded(point.x, 0, 1, 'INVALID_MASK'), y: bounded(point.y, 0, 1, 'INVALID_MASK')};
  }
  else if (patch.start !== undefined || patch.end !== undefined) fail('INVALID_MASK', '渐变端点仅用于 linear 蒙版。');
  return {id: note.id, layer};
}

export function normalizePatch(patch, {base, notes, mode, cleanText}) {
  object(patch, patchKeys);
  const result = {}, writePaths = [];
  if (patch.settings !== undefined) {
    result.settings = cleanSettings(patch.settings);
    writePaths.push(...Object.keys(result.settings).map(k => `settings.${k}`));
  }
  if (patch.style !== undefined) {
    if (patch.style === null) result.style = null;
    else {
      object(patch.style, ['id', 'amount'], 'UNKNOWN_STYLE');
      if (!presetById(patch.style.id)) fail('UNKNOWN_STYLE', '风格不存在，请先读取风格目录。');
      result.style = {id: patch.style.id, amount: bounded(patch.style.amount, 0, 100, 'STYLE_AMOUNT')};
    }
    writePaths.push('style');
  }
  if (patch.crop !== undefined) {
    if (patch.crop === null) result.crop = null;
    else {
      object(patch.crop, ['x', 'y', 'width', 'height', 'angle'], 'INVALID_CROP');
      if (patch.crop.angle !== undefined) bounded(patch.crop.angle, -15, 15, 'INVALID_CROP');
      result.crop = validCrop(patch.crop);
      if (!result.crop) fail('INVALID_CROP', '裁剪越界或过小。请保留至少 5% 的长宽。');
    }
    writePaths.push('crop');
  }
  if (patch.locals !== undefined) {
    if (!Array.isArray(patch.locals) || patch.locals.length > 8) fail('INVALID_LOCAL', '局部调整最多 8 处。');
    result.locals = patch.locals.map(p => localLayer(p, base, notes));
    ids(result.locals.map(l => l.id), 'INVALID_LOCAL');
    writePaths.push(...result.locals.map(l => `locals.${l.id}`));
  }
  if (patch.textOverlays !== undefined) {
    if (mode !== 'lettering') fail('LETTERING_MODE_REQUIRED', '添加、修改或移除文字需明确使用 mode: lettering。');
    result.textOverlays = cleanText(patch.textOverlays); writePaths.push('textOverlays');
  }
  if (!writePaths.length) fail('EMPTY_ITEM', '每个调整项目至少需要一个明确操作。');
  return {patch: result, writePaths};
}

export function normalizePlan(plan, context) {
  object(plan, planKeys);
  if (plan.mode !== undefined && !['retouch', 'lettering'].includes(plan.mode)) fail('INVALID_PLAN', 'mode 仅支持 retouch 或 lettering。');
  if (plan.allowProtectedCrop !== undefined && typeof plan.allowProtectedCrop !== 'boolean') fail('INVALID_PLAN', 'allowProtectedCrop 必须是布尔值。');
  if (plan.baseRevision !== undefined && plan.baseRevision !== plan.revision) fail('STALE_REVISION', 'baseRevision 必须与读取的 revision 一致。');
  for (const key of ['name', 'goal', 'tradeoff', 'requestId']) if (plan[key] !== undefined && typeof plan[key] !== 'string') fail('INVALID_PLAN', `${key} 必须是字符串。`);
  if(plan.operations!==undefined){
    if(plan.items!==undefined||patchKeys.some(k=>plan[k]!==undefined))fail('AMBIGUOUS_PLAN','工具组合不能与旧 patch 格式混用。');
    const operations=normalizeToolPlan(plan.operations,{state:context.base,source:context.source,notes:context.notes});
    const compiled=compileToolPlan(context.base,operations,{source:context.source,notes:context.notes,namespace:context.toolNamespace,selected:plan.selectedItemIds});
    const all=compileToolPlan(context.base,operations,{source:context.source,notes:context.notes,namespace:context.toolNamespace});
    const items=all.records.map(r=>({id:r.id,title:r.operation.title,dependsOn:r.operation.dependsOn,operation:r.operation,patch:r.effect,writePaths:r.writePaths}));
    return {items,legacy:false,selectedItemIds:compiled.selectedItemIds};
  }
  const legacy = plan.items === undefined;
  if (!legacy && patchKeys.some(k => plan[k] !== undefined)) fail('AMBIGUOUS_PLAN', 'items 不能与顶层调整混用。');
  if (legacy && plan.selectedItemIds !== undefined) fail('AMBIGUOUS_PLAN', '逐项选择需提供 items。');
  const input = legacy ? [{id: 'whole-plan', title: plan.name || '整组调整', patch: Object.fromEntries(patchKeys.filter(k => plan[k] !== undefined).map(k => [k, plan[k]]))}] : plan.items;
  if (!Array.isArray(input) || !input.length || input.length > 24) fail('INVALID_ITEMS', '一个方案需要 1～24 个调整项目。');
  const items = input.map(item => {
    object(item, ['id', 'title', 'dependsOn', 'patch'], 'INVALID_ITEM'); ids([item.id], 'INVALID_ITEM');
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100) fail('INVALID_ITEM', '项目标题应为 1～100 字。');
    const normalized = normalizePatch(item.patch, {...context, mode: plan.mode});
    return {id: item.id, title: item.title.trim(), dependsOn: ids(item.dependsOn || [], 'INVALID_DEPENDENCY'), ...normalized};
  });
  ids(items.map(i => i.id), 'DUPLICATE_ITEM');
  const byId = new Map(items.map(i => [i.id, i])), visiting = new Set(), visited = new Set(), owners = new Map();
  function visit(item) {
    if (visiting.has(item.id)) fail('DEPENDENCY_CYCLE', '调整项目之间存在循环依赖。');
    if (visited.has(item.id)) return;
    visiting.add(item.id);
    for (const dep of item.dependsOn) { if (!byId.has(dep)) fail('DEPENDENCY_MISSING', `依赖 ${dep} 不存在。`); visit(byId.get(dep)); }
    visiting.delete(item.id); visited.add(item.id);
  }
  for (const item of items) {
    visit(item);
    for (const path of item.writePaths) {
      if (owners.has(path)) fail('PATCH_CONFLICT', `多个项目修改 ${path}，请合并成一个项目。`, {path, itemIds: [owners.get(path), item.id]});
      owners.set(path, item.id);
    }
  }
  return {items, legacy, selectedItemIds: selectionIds(items, plan.selectedItemIds ?? items.map(i => i.id))};
}

export function selectionIds(items, selected) {
  const chosen = new Set(ids(selected)), known = new Set(items.map(i => i.id));
  for (const id of chosen) if (!known.has(id)) fail('UNKNOWN_ITEM', `项目 ${id} 不存在。`);
  for (const item of items) if (chosen.has(item.id)) for (const dep of item.dependsOn) if (!chosen.has(dep)) {
    fail('DEPENDENCY_REQUIRED', `「${item.title}」依赖 ${dep}，请同时选择。`, {itemId: item.id, dependency: dep});
  }
  return items.filter(i => chosen.has(i.id)).map(i => i.id);
}

export function compileSelection(base, items, selected,context={}) {
  if(items.some(item=>item.operation)){
    if(items.some(item=>!item.operation))fail('AMBIGUOUS_PLAN','工具组合与旧 patch 项目不能混合。');
    const result=compileToolPlan(base,items.map(i=>i.operation),{source:context.source,notes:context.notes,namespace:context.toolNamespace,selected});
    return {state:result.state,selectedItemIds:result.selectedItemIds,noChange:result.noChange};
  }
  const selectedItemIds = selectionIds(items, selected), chosen = new Set(selectedItemIds), state = structuredClone(base);
  for (const item of items) if (chosen.has(item.id)) {
    const patch = item.patch;
    if (patch.settings) Object.assign(state.settings, patch.settings);
    for (const key of ['style', 'crop', 'textOverlays']) if (patch[key] !== undefined) state[key] = structuredClone(patch[key]);
    for (const local of patch.locals || []) {
      const index = state.locals.findIndex(l => l.id === local.id);
      if (local.remove) { if (index !== -1) state.locals.splice(index, 1); }
      else if (index === -1) state.locals.push(structuredClone(local.layer));
      else state.locals[index] = structuredClone(local.layer);
    }
  }
  if (state.locals.length > 8) fail('INVALID_LOCAL', '局部调整最多 8 处。');
  return {state, selectedItemIds, noChange: equal(state, base)};
}

export function checkProtectedCrop(state, notes, source, allowProtectedCrop = false) {
  const warnings = [], crop = state.crop;
  if (crop) for (const note of notes.filter(n => n.protect)) {
    const n = note.rect, full = {x: 0, y: 0, width: 1, height: 1, angle: crop.angle};
    const points = [{x:n.x,y:n.y},{x:n.x+n.width,y:n.y},{x:n.x,y:n.y+n.height},{x:n.x+n.width,y:n.y+n.height}].map(p => originalToViewPoint(p, full, source.width, source.height));
    if (points.some(p => p.x < crop.x-1e-7 || p.y < crop.y-1e-7 || p.x > crop.x+crop.width+1e-7 || p.y > crop.y+crop.height+1e-7)) {
      if (!allowProtectedCrop) fail('PROTECTED_CROP', '裁剪会切到用户要求保留的标记。请调整边界，或明确取得该处裁剪的同意。');
      warnings.push(`裁剪涉及保留标记 ${note.number}`);
    }
  }
  return warnings;
}
