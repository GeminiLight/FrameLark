import {cropPixelRect} from '../engine/crop-utils.js';

// DOM-free helpers: canonical selection, one-at-a-time writes, and preview identity.
export function toggleSelection(items, selectedItemIds, id, checked) {
  const byId = new Map(items.map(item => [item.id, item]));
  if (!byId.has(id)) throw new Error('找不到这项调整，请重新读取候选。');
  const before = new Set(selectedItemIds), selected = new Set(selectedItemIds);
  if (checked) {
    const visiting = new Set();
    function include(key) {
      if (visiting.has(key)) throw new Error('调整依赖存在循环，请让 Agent 重新整理方案。');
      const item = byId.get(key);
      if (!item) throw new Error('调整依赖已缺失，请让 Agent 重新整理方案。');
      visiting.add(key);
      for (const dependency of item.dependsOn || []) include(dependency);
      visiting.delete(key);
      selected.add(key);
    }
    include(id);
  } else {
    selected.delete(id);
    // Removing a prerequisite also removes every transitive dependent.
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of items) if (selected.has(item.id) && (item.dependsOn || []).some(key => !selected.has(key))) {
        selected.delete(item.id);
        changed = true;
      }
    }
  }
  const ordered = items.map(item => item.id);
  return {
    selectedItemIds: ordered.filter(key => selected.has(key)),
    addedIds: ordered.filter(key => selected.has(key) && !before.has(key)),
    removedIds: ordered.filter(key => before.has(key) && !selected.has(key)),
  };
}

// Inputs are coalesced before transmission and while a request is in flight.
// send() must read the latest acknowledged revision/hash at dispatch time.
export function createLatestMutationQueue({send, onResult, onError, onPending = () => {}, onSettled = () => {}, delay = 160, schedule = setTimeout, cancel = clearTimeout}) {
  let next = null, running = false, timer = null, serial = 0, pending = false;
  function setPending(value) { if (pending !== value) { pending = value; onPending(value); } }
  async function drain() {
    timer = null;
    if (running || !next) return;
    running = true;
    let failed = false;
    try {
      while (next) {
        const job = next;
        next = null;
        try {
          const result = await send(job.value);
          await onResult(result, {latest: job.serial === serial, value: job.value});
        } catch (error) {
          failed = true;
          next = null;
          await onError(error);
          // A conflict requires fresh context; do not replay uncertain writes.
          next = null;
          break;
        }
      }
    } finally {
      running = false;
      setPending(false);
      await onSettled({failed});
    }
  }
  return {
    pending: () => pending,
    enqueue(value) {
      next = {value: structuredClone(value), serial: ++serial};
      setPending(true);
      if (timer !== null) cancel(timer);
      if (!running) timer = schedule(() => { void drain(); }, delay);
    },
    // Useful for deterministic tests and explicit flushes; no overlapping writes.
    async flush() {
      if (timer !== null) { cancel(timer); timer = null; }
      await drain();
    },
  };
}

export function samePreviewIdentity(a, b) {
  return Boolean(a && b && a.version === b.version && a.candidateId === b.candidateId &&
    a.selectionHash === b.selectionHash && a.revision === b.revision && a.view === b.view && a.currentId === b.currentId);
}

export function imageMatchesIdentity(identity, metadata) {
  return String(identity.revision) === String(metadata.revision) &&
    (!identity.selectionHash || identity.selectionHash === metadata.selectionHash) && Boolean(metadata.frameSpec);
}

export function createPreviewGate() {
  let generation = 0, displayed = null;
  return {
    invalidate() { generation++; displayed = null; },
    begin(identity) { displayed = null; return {generation: ++generation, identity: {...identity}}; },
    isCurrent(ticket, identity) { return ticket.generation === generation && samePreviewIdentity(ticket.identity, identity); },
    complete(ticket, identity, metadata) {
      if (ticket.generation !== generation || !samePreviewIdentity(ticket.identity, identity) || !imageMatchesIdentity(ticket.identity, metadata)) return false;
      displayed = {...identity};
      return true;
    },
    readyFor(identity) { return samePreviewIdentity(displayed, identity); },
  };
}

export function selectedCandidateCanAccept(candidate, {pending = false, previewReady = false} = {}) {
  return Boolean(candidate && !pending && previewReady && !candidate.stale && !candidate.noChange &&
    (!Array.isArray(candidate.items) || candidate.selectedItemIds?.length));
}

// Preserve the affine shape; do not replace a rotated shape with its bounding box.
export function protectionOutline(mask, transform = point => point, outer = false, steps = 64) {
  const feather = outer ? Math.max(0, Number(mask.feather) || 0) : 0;
  const point = (u, v) => transform({
    x: mask.origin.x + u * mask.axisX.x + v * mask.axisY.x,
    y: mask.origin.y + u * mask.axisX.y + v * mask.axisY.y,
  });
  if (mask.type === 'radial') return Array.from({length: steps}, (_, index) => {
    const angle = index / steps * Math.PI * 2, radius = .5 + feather;
    return point(.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius);
  });
  return [[-feather, -feather], [1 + feather, -feather], [1 + feather, 1 + feather], [-feather, 1 + feather]].map(([u, v]) => point(u, v));
}

// The displayed frame uses rounded source pixel edges, not fractional plan edges.
export function renderedViewCrop(crop, width, height) {
  const rect = cropPixelRect(crop, width, height);
  return {x: rect.x / width, y: rect.y / height, width: rect.width / width, height: rect.height / height, angle: crop?.angle || 0};
}

export function guardActionReady(context, {pending = false, needsPreview = true} = {}) {
  return Boolean(context.current && !context.candidate && context.view === 'current' &&
    (!needsPreview || context.previewReady) && !context.busy && !context.dirty && !pending);
}

// A protected reference can retain visible lettering even after the live text
// layer array is cleared. Conservatively keep clean-view/export controls available.
export function hasLetteringContent(state) {
  return Boolean(state?.textOverlays?.length || state?.guards?.regions?.some(region => region.snapshot?.pixelHash !== region.cleanSnapshot?.pixelHash));
}

// A refinement starts from the visible candidate's selected combination, while
// its eventual independent candidate still belongs to the fixed accepted base.
export function refinementSource(project, version) {
  const candidate = project.candidates.find(item => item.id === version?.id);
  return {baseVersion: project.currentId, fromCandidate: candidate?.id, selectionHash: candidate?.selectionHash ?? null};
}

export function refinementSourceMatches(source, project) {
  if (!source || source.baseVersion !== project?.currentId) return false;
  if (!source.fromCandidate) return true;
  const candidate = project.candidates.find(item => item.id === source.fromCandidate);
  return Boolean(candidate && !candidate.stale && !candidate.guardOperation && (candidate.selectionHash ?? null) === source.selectionHash);
}

// A timed-out/replaced fetch must also cancel later image-decode waits. Consume
// the original promise even after cancellation so late rejection cannot leak.
export function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(Object.assign(new Error('预览请求已取消'), {name: 'AbortError', reason: signal.reason})); };
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
