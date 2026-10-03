import {toggleSelection, createLatestMutationQueue, protectionOutline, renderedViewCrop, guardActionReady} from './controlled-edits-model.js';
import {originalToViewPoint} from '/engine/photo-geometry.js';

export function createControlledEdits({getContext, json, perform, notice, invalidatePreview, applyProject, render, reloadImages, refreshProject, showAccepted, showCandidate, startProtection, labels}) {
  const $ = id => document.getElementById(id);
  const all = selector => [...document.querySelectorAll(selector)];
  let desired = null, choiceSignature = '', draft = null, shape = 'rectangle';
  const guards = () => getContext().current?.state.guards || {parameters: [], locals: [], regions: []};
  const create = (tag, className, text) => { const element = document.createElement(tag); element.className = className || ''; if (text !== undefined) element.textContent = text; return element; };
  const selectedIds = () => desired?.id === getContext().candidate?.id ? desired.selectedItemIds : getContext().candidate?.selectedItemIds || [];
  const clean = () => { $('guard-error').hidden = true; };
  function report(error) { $('guard-error').textContent = error.message; $('guard-error').hidden = false; }
  function acceptedViewReady() {
    const context = getContext();
    return guardActionReady(context, {pending: queue.pending()});
  }
  function requireAcceptedView() {
    if (!acceptedViewReady()) throw new Error('请先查看已保存画面，保存或重置待编辑内容，并等待预览完成。');
  }
  const queue = createLatestMutationQueue({
    async send(value) {
      const context = getContext(), candidate = context.project.candidates.find(item => item.id === value.id);
      if (!candidate || candidate.stale) throw new Error('候选已更新，请重新读取后选择。');
      return json('candidate-selection', {id: value.id, revision: context.project.revision, selectionHash: candidate.selectionHash, selectedItemIds: value.selectedItemIds});
    },
    onResult(result) { applyProject(result.project); render(); },
    async onError(error) { desired = null; notice(error.message); await refreshProject(false).catch(() => {}); },
    onPending() { render(); },
    async onSettled() { desired = null; render(); await reloadImages(); },
  });

  function scopeLabel(path, item, candidate) {
    if (path === 'settings') return '全局参数';
    if (path.startsWith('settings.')) {
      const key = path.slice(9), base = getContext().project.versions.find(version => version.id === candidate.parentId);
      const target = item.patch?.settings?.[key];
      return (labels[key] || key) + (typeof target === 'number' ? ` ${base?.state.settings[key] ?? 0} → ${target}` : '');
    }
    if (path === 'style') return '风格';
    if (path === 'crop') return '裁剪与拉直';
    if (path.startsWith('locals')) return '局部层 · ' + path.replace(/^locals[./:]?/, '').slice(0, 8);
    if (path.startsWith('textOverlays')) return '文字点缀';
    if (path.startsWith('guards')) return '解除保护';
    return path;
  }
  function renderSelection() {
    const context = getContext(), candidate = context.candidate, root = $('candidate-items');
    const focused = document.activeElement?.dataset?.editItem;
    root.replaceChildren();
    if (!candidate || !Array.isArray(candidate.items)) { $('selection-status').textContent = ''; return; }
    const selection = new Set(selectedIds()), byId = new Map(candidate.items.map(item => [item.id, item]));
    for (const item of candidate.items) {
      const row = create('label', 'candidate-item'), input = create('input'), copy = create('span', 'candidate-item-copy');
      input.type = 'checkbox'; input.checked = selection.has(item.id); input.dataset.editItem = item.id;
      input.disabled = context.busy || candidate.stale || Boolean(candidate.guardOperation) || context.annotationDirty;
      copy.append(create('strong', '', item.title || item.id));
      const paths = (item.writePaths || []).map(path => scopeLabel(path, item, candidate));
      if (paths.length) copy.append(create('small', '', paths.join(' · ')));
      if (item.dependsOn?.length) copy.append(create('small', 'item-dependencies', '依赖：' + item.dependsOn.map(id => byId.get(id)?.title || id).join('、')));
      input.addEventListener('change', () => {
        try {
          const update = toggleSelection(candidate.items, selectedIds(), item.id, input.checked);
          desired = {id: candidate.id, selectedItemIds: update.selectedItemIds};
          invalidatePreview();
          queue.enqueue(desired);
          renderSelection();
          const removed = update.removedIds.filter(id => id !== item.id), added = update.addedIds.filter(id => id !== item.id);
          if (removed.length) notice('同时取消依赖它的调整：' + removed.map(id => byId.get(id)?.title || id).join('、'));
          else if (added.length) notice('已一并选中所需调整：' + added.map(id => byId.get(id)?.title || id).join('、'));
        } catch (error) { notice(error.message); renderSelection(); }
      });
      row.append(input, copy); root.append(row);
    }
    const count = selection.size;
    $('selection-status').textContent = candidate.guardOperation ? '解除保护作为整组试片，接受后才会生效。' : queue.pending() ? `已选 ${count} 项 · 正在更新组合，暂不可接受` : !count ? '未选择调整，当前预览为基础版本；不会创建空版本。' : candidate.noChange ? '所选组合与基础版本一致，无需接受。' : `已选 ${count} / ${candidate.items.length} 项 · 以组合预览为准`;
    if (focused) all('[data-edit-item]').find(input => input.dataset.editItem === focused)?.focus({preventScroll: true});
  }

  function checkbox(key, title, dataset, checked = false) {
    const label = create('label', 'check-label'), input = create('input');
    input.type = 'checkbox'; input.dataset[dataset] = key; input.checked = checked;
    input.addEventListener('change', renderActions); label.append(input, create('span', '', title)); return label;
  }
  function renderGuardChoices() {
    const context = getContext(), state = context.current.state, locked = guards();
    const signature = JSON.stringify([context.current.id, locked, state.locals.map(local => [local.id, local.note])]);
    if (choiceSignature === signature) return;
    choiceSignature = signature;
    const parameterRoot = $('guard-parameter-choices'), localRoot = $('guard-local-choices');
    parameterRoot.replaceChildren(); localRoot.replaceChildren();
    for (const parameter of context.project.parameters) if (!locked.parameters?.some(lock => lock.key === parameter.key))
      parameterRoot.append(checkbox(parameter.key, labels[parameter.key] || parameter.key, 'guardParameter'));
    for (const local of state.locals) if (!locked.locals?.some(lock => lock.id === local.id)) {
      const annotation = context.project.notes.find(note => note.id === local.id);
      localRoot.append(checkbox(local.id, annotation ? `局部层 · 标记 ${annotation.number}` : `局部层 · ${local.note || local.id.slice(0, 8)}`, 'guardLocal'));
    }
    localRoot.hidden = !localRoot.childElementCount;
  }
  function unlock(payload) {
    if (!guardActionReady(getContext(), {pending: queue.pending(), needsPreview: false})) { notice('请先选择已保存画面，保存或重置待编辑内容后再解除。'); return; }
    perform(async () => {
      clean();
      try {
        const result = await json('guards', {revision: getContext().project.revision, operation: 'unlock', parameterKeys: [], localIds: [], regionIds: [], ...payload});
        applyProject(result.project); draft = null;
        await showCandidate(result.candidate.id);
        notice('解除保护已生成试片，接受后才会生效。');
      } catch (error) { report(error); throw error; }
    });
  }
  function guardRow(title, detail, payload) {
    const row = create('div', 'guard-row'), copy = create('div'), button = create('button', 'text-button', '解除并预览');
    copy.append(create('strong', '', title), create('small', 'quiet', detail)); button.dataset.guardUnlock = 'true';
    button.addEventListener('click', () => unlock(payload));
    row.append(copy, button); return row;
  }
  function renderGuards() {
    const context = getContext(); if (!context.project) return;
    renderGuardChoices();
    $('guard-context').textContent = `保护基于已保存版本：${context.current.name}`;
    const locked = guards(), root = $('guard-list'); root.replaceChildren();
    for (const parameter of locked.parameters || []) root.append(guardRow(`已锁定 · ${labels[parameter.key] || parameter.key}`, `手动值 ${parameter.manual} · 有效值 ${parameter.effective}`, {parameterKeys: [parameter.key]}));
    for (const local of locked.locals || []) {
      const annotation = context.project.notes.find(note => note.id === local.id);
      root.append(guardRow(annotation ? `已锁定 · 局部层 ${annotation.number}` : '已锁定 · 局部层', '参数、范围、强度、启用状态与顺序', {localIds: [local.id]}));
    }
    for (const [index, region] of (locked.regions || []).entries()) {
      const reference = context.project.versions.find(version => version.id === region.referenceVersionId);
      root.append(guardRow(`画面保护 ${index + 1} · ${region.mask.type === 'radial' ? '径向' : '矩形'}`, `参考：${reference?.name || region.referenceVersionId} · 外侧过渡 ${Math.round(region.mask.feather * 100)}%`, {regionIds: [region.id]}));
    }
    $('guard-empty').hidden = Boolean(root.childElementCount);
    $('guard-unlock-regions').hidden = !(locked.regions?.length);
    if (draft && (draft.versionId !== context.current.id || draft.revision !== context.project.revision)) {
      draft = null; $('protection-draft-status').textContent = '已保存画面有更新，请重新选择保护范围。';
    }
    $('protection-draft-actions').hidden = !draft;
  }
  function renderActions() {
    const context = getContext(); if (!context.project) return;
    const allowed = acceptedViewReady(), locked = guards(), geometryLocked = Boolean(locked.regions?.length);
    const selected = all('[data-guard-parameter]:checked,[data-guard-local]:checked').length;
    for (const button of all('#guard-draw,#guard-coordinate')) button.disabled = !allowed;
    for (const button of all('[data-guard-unlock],#guard-unlock-regions')) button.disabled = !guardActionReady(context, {pending: queue.pending(), needsPreview: false});
    $('guard-save-region').disabled = !allowed || !draft;
    $('guard-lock').disabled = !allowed || !selected;
    $('guard-view-current').disabled = context.busy || queue.pending();
    $('guard-required-view').textContent = allowed ? '当前显示已保存画面，可以锁定参数或选择保留核心。' : '先点击「查看已保存画面」。预览不可用时仍可解除保护；新增保护需等待预览完成。';
    $('geometry-lock-reason').hidden = !geometryLocked;
    for (const input of all('[data-crop],#crop-angle,[data-ratio],#draw-crop')) {
      input.disabled = geometryLocked || context.busy || queue.pending();
      input.title = geometryLocked ? '已有区域保护，请先解除并接受预览后重新构图。' : '';
    }
    for (const input of all('[data-parameter]')) {
      const lock = locked.parameters?.find(item => item.key === input.dataset.parameter);
      input.disabled = Boolean(lock) || context.busy || queue.pending();
      input.title = lock ? '此参数的手动值与风格后的有效值已锁定。' : '';
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) { label.classList.toggle('locked-parameter', Boolean(lock)); label.title = input.title; }
    }
    const localLocked = locked.locals?.some(local => local.id === context.selectedNote);
    $('local-lock-reason').hidden = !localLocked;
    for (const input of all('#local-parameters input,#local-feather,[data-mask],#local-trial')) input.disabled = Boolean(localLocked) || context.busy || queue.pending();
    for (const input of all('[data-edit-item]')) input.disabled = context.busy || context.candidate?.stale || Boolean(context.candidate?.guardOperation) || context.annotationDirty;
    for (const button of all('[data-candidate]')) button.disabled = context.busy || queue.pending();
  }

  function setDraft(rect) {
    requireAcceptedView();
    if (!Object.values(rect).every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width < .005 || rect.height < .005 || rect.x + rect.width > 1.00001 || rect.y + rect.height > 1.00001) throw new Error('保护范围应在当前画面内，宽高至少为 0.5%。');
    const context = getContext(); draft = {rect, versionId: context.current.id, revision: context.project.revision};
    for (const key of ['x', 'y', 'width', 'height']) $('protect-' + key).value = Number((rect[key] * 100).toFixed(2));
    $('protection-draft-status').textContent = '范围已选好。实线内完整保留，检查外侧过渡后保存。';
    $('region-protection-controls').open = true; $('protection-draft-actions').hidden = false;
    render();
  }
  $('guard-view-current').addEventListener('click', () => showAccepted());
  $('guard-unlock-regions').addEventListener('click', () => unlock({regionIds: (guards().regions || []).map(region => region.id)}));
  $('guard-lock').addEventListener('click', () => {
    try { requireAcceptedView(); } catch (error) { notice(error.message); return; }
    const parameters = all('[data-guard-parameter]:checked').map(input => input.dataset.guardParameter);
    const localIds = all('[data-guard-local]:checked').map(input => input.dataset.guardLocal);
    perform(async () => {
      clean();
      try {
        const result = await json('guards', {revision: getContext().project.revision, operation: 'lock', parameters, localIds});
        applyProject(result.project); draft = null; await showAccepted(); notice('已保存锁定记录，当前画面像素保持不变。');
      } catch (error) { report(error); throw error; }
    });
  });
  $('guard-draw').addEventListener('click', () => {
    try { requireAcceptedView(); startProtection(); } catch (error) { notice(error.message); }
  });
  $('guard-coordinate').addEventListener('click', () => {
    try { setDraft(Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number($('protect-' + key).value) / 100]))); }
    catch (error) { notice(error.message); }
  });
  $('guard-cancel-region').addEventListener('click', () => { draft = null; $('protection-draft-status').textContent = ''; render(); });
  $('guard-save-region').addEventListener('click', () => {
    try { requireAcceptedView(); if (!draft || draft.revision !== getContext().project.revision) throw new Error('请基于最新画面重新选择保护范围。'); }
    catch (error) { notice(error.message); return; }
    const selected = structuredClone(draft);
    perform(async () => {
      clean();
      try {
        const result = await json('guards', {revision: selected.revision, operation: 'protect', rect: selected.rect, coordinateSpace: 'view', maskType: shape, feather: Number($('protect-feather').value) / 100});
        applyProject(result.project); draft = null; $('protection-draft-status').textContent = '';
        await showAccepted(); notice('已保存画面保护；实线内核心以这一版为参考。');
      } catch (error) { report(error); throw error; }
    });
  });
  for (const button of all('[data-protection-shape]')) button.addEventListener('click', () => {
    shape = button.dataset.protectionShape;
    for (const item of all('[data-protection-shape]')) { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }
    render();
  });
  $('protect-feather').addEventListener('input', event => { $('protect-feather-value').value = event.target.value + '%'; render(); });

  function draw({image, pane, state, crop, view}) {
    const layer = $('protection-layer'), context = getContext(); layer.replaceChildren();
    const hidden = !context.previewReady || view === 'original'; layer.toggleAttribute('hidden', hidden);
    if (hidden || !image.naturalWidth) return;
    const rect = image.getBoundingClientRect(), parent = pane.getBoundingClientRect();
    layer.style.cssText = `left:${rect.left - parent.left}px;top:${rect.top - parent.top}px;width:${rect.width}px;height:${rect.height}px`;
    layer.setAttribute('viewBox', '0 0 1 1'); layer.setAttribute('preserveAspectRatio', 'none');
    const actualCrop = renderedViewCrop(crop, context.project.source.width, context.project.source.height);
    const transform = point => originalToViewPoint(point, actualCrop, context.project.source.width, context.project.source.height);
    function add(mask, project, isDraft = false) {
      for (const outer of [true, false]) {
        if (outer && !mask.feather) continue;
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', protectionOutline(mask, project, outer).map(point => `${point.x},${point.y}`).join(' '));
        polygon.setAttribute('class', (outer ? 'protection-outer' : 'protection-core') + (isDraft ? ' protection-draft' : ''));
        polygon.setAttribute('vector-effect', 'non-scaling-stroke'); layer.append(polygon);
      }
    }
    for (const region of state.guards?.regions || []) add(region.mask, transform);
    if (draft && !context.candidate && view === 'current') {
      const rect = draft.rect;
      add({origin: {x: rect.x, y: rect.y}, axisX: {x: rect.width, y: 0}, axisY: {x: 0, y: rect.height}, type: shape, feather: Number($('protect-feather').value) / 100}, point => point, true);
    }
  }
  return {
    pending: queue.pending, selectedIds, renderActions, setDraft, draw,
    dirty: () => Boolean(draft),
    refresh() { renderSelection(); renderGuards(); renderActions(); },
  };
}
