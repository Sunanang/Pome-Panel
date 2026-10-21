'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../renderer/ai-usage-animation');
function harness() {
  let time = 0, next = 0;
  const frames = new Map();
  const store = A.createValueStore({ now: () => time, raf: cb => { frames.set(++next, cb); return next; }, cancel: id => frames.delete(id) });
  return { store, frames, tick(at) { time = at; const batch = [...frames.values()]; frames.clear(); batch.forEach(cb => cb(time)); } };
}
test('first reading starts at zero, reaches the exact target and never overshoots', () => {
  const h = harness(), seen = [];
  assert.equal(h.store.set('codex/5h', 80, v => seen.push(v)), true);
  assert.equal(seen[0], 0);
  h.tick(360); assert(seen.at(-1) > 0 && seen.at(-1) < 80);
  h.tick(720); assert.equal(seen.at(-1), 80); assert.equal(h.frames.size, 0);
});
test('unchanged readings and failed refreshes schedule no animation', () => {
  const h = harness();let value;
  h.store.set('x', 50, v => value = v, { reduced: true });
  assert.equal(h.store.set('x', 50, v => value = v), false);
  assert.equal(h.store.set('x', 90, v => value = v, { failed: true }), false);
  assert.equal(value, 50);assert.equal(h.frames.size, 0);
  assert.equal(h.store.set('unknown', null, () => assert.fail()), false);
});
test('new targets continue at the current painted value, including DOM rebinding', () => {
  const h = harness();let value;
  h.store.set('x', 100, v => value = v);h.tick(200);
  const halfway = value;
  h.store.set('x', 100, v => value = v);assert.equal(value, halfway);
  h.store.set('x', 20, v => value = v);assert.equal(value, halfway);
  assert.equal(h.frames.size, 1);h.tick(920);assert.equal(value, 20);
});
test('reduced motion cancels a running animation and applies the target immediately', () => {
  const h = harness();let value;
  h.store.set('x', 100, v => value = v);h.tick(100);
  assert.equal(h.store.set('x', 100, v => value = v, { reduced: true }), false);
  assert.equal(value, 100);assert.equal(h.frames.size, 0);
});
test('window rows stagger without changing endpoints and can be removed', () => {
  const h = harness();let value;
  h.store.set('row', 80, v => value = v, { delay: 60 });h.tick(30);assert.equal(value, 0);
  h.tick(400);assert(value > 0 && value < 80);h.tick(780);assert.equal(value, 80);
  h.store.set('row', 10, v => value = v);h.store.clear();assert.equal(h.frames.size, 0);
});
test('panel shows refresh once per thirty seconds; manual refresh has its own explicit path', () => {
  assert.equal(A.shouldRefreshOnShow(null, 0), true);
  assert.equal(A.shouldRefreshOnShow(0, 29999), false);
  assert.equal(A.shouldRefreshOnShow(0, 30000), true);
});


test('an unknown reading clears the tween without replacing unknown UI with a cached number', () => {
  const h = harness();
  h.store.set('x', 80, () => {}, {reduced:true});
  assert.equal(h.store.set('x', null, () => assert.fail('unknown must not paint a previous value')),false);
  assert.equal(h.store.value('x'),undefined);
});

test('disconnect pruning cancels stale sinks while keeping other sources and cached frames', () => {
  const h = harness(); let detachedFrames = 0, retained;
  h.store.set('codex/5h/main', 80, () => detachedFrames++);
  h.store.set('cursor/auto/main', 60, value => retained = value);
  h.tick(100);
  const before = detachedFrames, current = retained;
  h.store.prune(key => key.startsWith('cursor/'));
  assert.equal(h.store.value('codex/5h/main'), undefined);
  assert.equal(h.store.value('cursor/auto/main'), current);
  assert.equal(h.frames.size, 1);
  h.tick(720);
  assert.equal(detachedFrames, before, 'a detached source must never paint another frame');
  assert.equal(retained, 60);
  h.store.prune(() => false);
  assert.equal(h.store.value('cursor/auto/main'), undefined);
  const reconnected = [];
  h.store.set('codex/5h/main', 50, value => reconnected.push(value));
  assert.equal(reconnected[0], 0, 'reconnection starts fresh before any frame runs');
  h.tick(1440); assert.equal(reconnected.at(-1), 50);
});
