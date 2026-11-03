'use strict';

const SIGNALS = ['camera', 'sharing', 'focus'];
const ENTER_DELAY_MS = 3000;
const EXIT_DELAY_MS = 30000;

// Runtime state is deliberately separate from the saved manual switch. Unknown
// samples never mean "off" and cannot release an already active signal.
function createMeetingModeMonitor({ probe, onChange = () => {}, now = Date.now,
  intervalMs = 2000, enterDelayMs = ENTER_DELAY_MS, exitDelayMs = EXIT_DELAY_MS,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let enabled = true, stopped = true, timer = null, generation = 0;
  let state = Object.fromEntries(SIGNALS.map(key => [key, { active: false, available: false, pendingSince: null, checkedAt: null }]));
  let lastPublished = '';
  function snapshot() {
    const signals = Object.fromEntries(SIGNALS.map(key => [key, { ...state[key], pendingSince: undefined }]));
    return { enabled, active: enabled && SIGNALS.some(key => state[key].active),
      reasons: enabled ? SIGNALS.filter(key => state[key].active) : [], signals };
  }
  function publish() {
    const next = snapshot();
    // Poll timestamps are diagnostic, not a reason to rerender settings.
    const signature = JSON.stringify({ ...next, signals: Object.fromEntries(SIGNALS.map(key => [key,
      { active: state[key].active, available: state[key].available, error: state[key].error }])) });
    if (signature !== lastPublished) { lastPublished = signature; onChange(next); }
  }
  function accept(sample = {}) {
    const at = now();
    for (const key of SIGNALS) {
      const input = sample[key];
      const value = typeof input === 'boolean' ? input : input?.active;
      const available = typeof value === 'boolean' && input?.available !== false;
      const row = state[key];
      row.available = available;
      row.error = available ? null : typeof input?.error === 'string' ? input.error : 'unavailable';
      if (!available) { row.pendingSince = null; continue; }
      row.checkedAt = at;
      if (value === row.active) { row.pendingSince = null; continue; }
      if (row.pendingSince == null) row.pendingSince = at;
      // Camera gets a brief debounce. Sharing and Focus suppress immediately.
      const delay = value ? key === 'camera' ? enterDelayMs : 0 : exitDelayMs;
      if (at - row.pendingSince >= delay) { row.active = value; row.pendingSince = null; }
    }
    publish();
  }
  async function poll() {
    if (stopped || !enabled) return;
    const epoch = generation;
    let sample;
    try { sample = await probe(); } catch { sample = {}; }
    if (stopped || epoch !== generation) return;
    accept(sample);
    timer = setTimer(poll, intervalMs);
    timer?.unref?.();
  }
  return {
    snapshot, accept,
    start() { if (!stopped) return; stopped = false; void poll(); },
    stop() { stopped = true; generation++; clearTimer(timer); timer = null; },
    setEnabled(value) {
      if (enabled === value) return;
      enabled = value; generation++; clearTimer(timer); timer = null;
      state = Object.fromEntries(SIGNALS.map(key => [key, { active: false, available: false, pendingSince: null, checkedAt: null }]));
      publish();
      if (enabled && !stopped) void poll();
    },
  };
}

module.exports = { createMeetingModeMonitor, SIGNALS, ENTER_DELAY_MS, EXIT_DELAY_MS };
