'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the production functions with controlled browser scheduling. These
// races need deferred promises / frames, rather than a physical camera or sleep.
const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const section = (from, to) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const flush = () => new Promise(resolve => setImmediate(resolve));

function mirrorHarness() {
  const requests = [], plays = [], attributes = new Map(), classes = new Set(), messages = [];
  const context = {
    document: { documentElement: { dataset: {} } },
    isExpanded: true, activeTab: 'home', setMirrorZoom() {},
    homeMirror: { hidden: false, classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)) } },
    mirrorStage: { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) },
    mirrorVideo: { srcObject: null, pause() {}, play: () => new Promise((resolve, reject) => plays.push({ resolve, reject })) },
    window: { notchAPI: { ensureCamera: async () => true } },
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } },
    pomeLocaleRendererApp: { t: value => value }, showStatusToast: value => messages.push(value),
  };
  vm.createContext(context);
  vm.runInContext('let mirrorStream = null, mirrorStarting = false, mirrorGeneration = 0;\n'
    + section('function stopMirror()', '\nif (mirrorStage)'), context);
  function stream() {
    const track = { stops: 0, stop() { this.stops += 1; } };
    return { track, getTracks: () => [track] };
  }
  return { context, requests, plays, attributes, classes, messages, stream,
    starting: () => vm.runInContext('mirrorStarting', context),
    current: () => vm.runInContext('mirrorStream', context) };
}

test('cancel then restart cannot adopt an old camera stream or leak it behind the newer stream', async () => {
  const h = mirrorHarness(), old = h.stream(), next = h.stream();
  const first = h.context.startMirror(); await flush();
  h.context.stopMirror();
  const second = h.context.startMirror(); await flush();
  h.requests[0].resolve(old); h.requests[1].resolve(next); await flush();
  assert.equal(old.track.stops, 1, 'the cancelled request releases its stream before play');
  assert.equal(h.current(), next);
  assert.equal(h.starting(), true, 'old finally must not clear the new request');
  assert.equal(h.plays.length, 1, 'only the current stream reaches video.play');
  h.plays[0].resolve(); await Promise.all([first, second]);
  assert.equal(h.classes.has('live'), true);
  h.context.stopMirror();
  assert.equal(next.track.stops, 1);
  assert.equal(h.context.mirrorVideo.srcObject, null);
});

test('native hiding cancels pending camera capture and showing never restarts it automatically', async () => {
  const h = mirrorHarness(); let visibility;
  h.context.window.notchAPI.onWindowVisibilityChanged = callback => { visibility = callback; };
  h.context.document.dispatchEvent = () => {};
  h.context.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  vm.runInContext(section('window.notchAPI?.onWindowVisibilityChanged?.(', '\nfunction collectLocalStorageSnapshot()'), h.context);
  const pending = h.context.startMirror(); await flush();
  visibility(false);
  const old = h.stream(); h.requests[0].resolve(old); await pending;
  assert.equal(old.track.stops, 1); assert.equal(h.current(), null);
  assert.equal(h.context.document.documentElement.dataset.windowVisible, 'false');
  visibility(true); await flush();
  assert.equal(h.requests.length, 1, 'returning to the panel still requires an explicit camera click');
  assert.equal(h.current(), null);
});

test('an old permission/capture rejection cannot stop or report an error over a newer live camera', async () => {
  const h = mirrorHarness(), next = h.stream();
  const first = h.context.startMirror(); await flush(); h.context.stopMirror();
  const second = h.context.startMirror(); await flush();
  h.requests[1].resolve(next); await flush(); h.plays[0].resolve(); await second;
  h.requests[0].reject(new Error('camera_permission_denied')); await first;
  assert.equal(h.current(), next);
  assert.equal(next.track.stops, 0);
  assert.equal(h.classes.has('live'), true);
  assert.equal(h.messages.length, 0);
  h.context.stopMirror(); assert.equal(next.track.stops, 1);
});

test('a delayed play completion cannot reopen the mirror after collapse or cancellation', async () => {
  const h = mirrorHarness(), stream = h.stream();
  const job = h.context.startMirror(); await flush(); h.requests[0].resolve(stream); await flush();
  h.context.stopMirror(); h.context.isExpanded = false;
  h.plays[0].resolve(); await job;
  assert.equal(stream.track.stops, 1);
  assert.equal(h.classes.has('live'), false);
  assert.equal(h.context.mirrorVideo.srcObject, null);
  assert.equal(h.attributes.get('aria-pressed'), 'false');
});

test('Dock leave and panel lifecycle cancel the pending frame before resetting hover styles', () => {
  const frames = new Map(), handlers = new Map(), windowHandlers = new Map(), documentHandlers = new Map();
  const properties = new Map(); let next = 0;
  const item = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }),
    style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) } };
  const bind = map => (name, callback) => { const list = map.get(name) || []; list.push(callback); map.set(name, list); };
  const surface = { querySelectorAll: () => [item], addEventListener: bind(handlers) };
  const context = { window: { addEventListener: bind(windowHandlers) }, document: { hidden: false, addEventListener: bind(documentHandlers) },
    requestAnimationFrame: callback => { frames.set(++next, callback); return next; }, cancelAnimationFrame: id => frames.delete(id) };
  vm.createContext(context); vm.runInContext(section('function bindDockSurface(', '\n// Window rows keep'), context);
  context.bindDockSurface(surface, '.window-item', 1.12);
  const emit = (map, name, event = {}) => (map.get(name) || []).forEach(callback => callback(event));
  for (const reset of [
    () => emit(handlers, 'pointerleave'), () => emit(windowHandlers, 'blur'),
    () => emit(documentHandlers, 'notch:will-collapse'),
    () => emit(documentHandlers, 'notch:tabchange', { detail: { tab: 'notes' } }),
    () => emit(documentHandlers, 'notch:home-modules-changed', { detail: { visibleIds: ['sun'] } }),
    () => { context.document.hidden = true; emit(documentHandlers, 'visibilitychange'); },
  ]) {
    emit(handlers, 'pointermove', { clientX: 50, clientY: 25 });
    assert.equal(frames.size, 1); reset();
    assert.equal(frames.size, 0);
    assert.equal(properties.size, 0);
  }
});
