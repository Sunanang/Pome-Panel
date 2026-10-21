(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchQuotaAnimation = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const DURATION = 720;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  function animateValue(from, to, duration, onFrame, { raf = requestAnimationFrame, cancel = cancelAnimationFrame, now = () => performance.now(), delay = 0, onEnd = () => {} } = {}) {
    let handle, stopped = false;
    const start = now() + delay;
    onFrame(from);
    if (from === to || duration <= 0) { onFrame(to); onEnd(); return () => {}; }
    function frame(time) {
      if (stopped) return;
      const t = Math.min(1, Math.max(0, (time - start) / duration));
      onFrame(from + (to - from) * easeOut(t));
      if (t < 1) handle = raf(frame); else onEnd();
    }
    handle = raf(frame);
    return () => { stopped = true; cancel(handle); };
  }
  // Entries outlive DOM rebuilds. A new target starts at the last painted frame;
  // rebinding the same target only updates the sink, never restarts the tween.
  function createValueStore(options = {}) {
    const entries = new Map();
    function set(key, target, sink, { reduced = false, failed = false, delay = 0, from = 0, onEnd = () => {} } = {}) {
      let entry = entries.get(key);
      if (failed) { if (entry) sink(entry.value); return false; }
      if (!Number.isFinite(target)) { remove(key); return false; }
      if (!entry) { entry = { value: from, target: null, sink, onEnd, running: false }; entries.set(key, entry); }
      entry.sink = sink; entry.onEnd = onEnd;
      if (entry.target === target && !reduced) { sink(entry.value); if (!entry.running) onEnd(); return entry.running; }
      entry.stop?.(); entry.running = false;
      entry.target = target;
      if (reduced || entry.value === target) { entry.value = target; sink(target); onEnd(); return false; }
      entry.running = true;
      entry.stop = animateValue(entry.value, target, DURATION, value => { entry.value = value; entry.sink(value); }, {
        ...options, delay, onEnd: () => { entry.running = false; entry.onEnd(); },
      });
      return true;
    }
    function remove(key) { entries.get(key)?.stop?.(); entries.delete(key); }
    return { set, value: key => entries.get(key)?.value, running: key => Boolean(entries.get(key)?.running),
      remove, clear: () => { for (const key of entries.keys()) remove(key); } };
  }
  function shouldRefreshOnShow(lastRequest, now) { return lastRequest == null || now - lastRequest >= 30000; }
  return { animateValue, createValueStore, shouldRefreshOnShow, DURATION };
});
