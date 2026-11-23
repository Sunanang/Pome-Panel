// Which AI sources the panel shows. Device-local: hiding a source never edits the
// tool configuration, and it is independent from "disconnect" (which removes
// Pome's entries from the tool's own config file).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotchAiSourceVisibility = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const KEY = 'notch-ai-source-hidden-v1';
  let cache = null;
  function normalize(value) {
    return Array.isArray(value) ? Array.from(new Set(value.filter(id => typeof id === 'string' && id))) : [];
  }
  function read() {
    if (cache) return cache;
    try { cache = normalize(JSON.parse(globalThis.localStorage?.getItem(KEY) || '[]')); }
    catch { cache = []; }
    return cache;
  }
  function write(next) {
    cache = normalize(next);
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(cache)); } catch {}
    return cache;
  }
  return Object.freeze({
    key: KEY,
    list: () => read().slice(),
    has: id => read().includes(id),
    hide: id => write([...read(), id]),
    show: id => write(read().filter(value => value !== id)),
    clear: () => write([]),
    reload: () => { cache = null; return read().slice(); },
  });
});
