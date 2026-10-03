import {samePreviewIdentity} from './controlled-edits-model.js';

// Keep a single preview for the visible identity. A higher-resolution preview
// also satisfies later lower-resolution requests until explicitly invalidated.
export function createPreviewRequests() {
  let active = null, displayed = null;
  const covers = (entry, identity, size) => entry && entry.size >= size && samePreviewIdentity(entry.identity, identity);
  function invalidate() {
    const previous = active;
    active = null;
    displayed = null;
    previous?.controller.abort('replaced');
  }
  return {
    invalidate,
    load(identity, size, render) {
      if (covers(active, identity, size) && !active.controller.signal.aborted) return active.promise;
      if (covers(displayed, identity, size)) return Promise.resolve(true);
      invalidate();
      const entry = {identity: {...identity}, size, controller: new AbortController()};
      active = entry;
      entry.promise = Promise.resolve().then(async () => {
        if (entry.controller.signal.aborted) return false;
        const rendered = await render(entry.controller);
        const ready = Boolean(rendered && active === entry && !entry.controller.signal.aborted);
        if (ready) displayed = {identity: entry.identity, size};
        return ready;
      }).finally(() => {
        // A replaced request can settle after the next request has started.
        if (active === entry) active = null;
      });
      return entry.promise;
    },
  };
}

// Schedule from settlement rather than a fixed interval: slow reads/decodes never
// overlap subsequent polls. Errors still retry; stop also covers in-flight work.
export function createProjectPoller({read, getProject, blocked, update, connected = () => {}, onError = () => {}, delay = 2000, schedule = setTimeout, cancel = clearTimeout}) {
  let stopped = true, timer = null, running = false;
  function scheduleNext() {
    if (!stopped && !running && timer === null) timer = schedule(tick, delay);
  }
  async function tick() {
    timer = null;
    if (stopped || running) return;
    running = true;
    try {
      if (blocked()) return;
      const next = await read();
      if (stopped || blocked()) return;
      const previous = getProject();
      if (previous && next.revision < previous.revision) return;
      if (!previous || next.revision !== previous.revision) await update(next, previous);
      if (!stopped) connected();
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      running = false;
      scheduleNext();
    }
  }
  return {
    start() { stopped = false; scheduleNext(); },
    stop() { stopped = true; if (timer !== null) cancel(timer); timer = null; },
  };
}
