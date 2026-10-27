'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const from = source.indexOf('async function ensureAccountSyncKey(');
const to = source.indexOf('\nasync function readRendererWorkspaceSnapshot', from);
assert(from >= 0 && to > from);
const original = { serverId: 'fixture-server', uid: 'fixture-user', deviceId: 'fixture-device',
  deviceToken: 'fixture-token', boundAt: 10, baseUrl: 'https://fixture.invalid' };
function harness() {
  let current = { ...original };
  const requests = [], writes = [];
  const context = {
    fetchBoundSyncJson: () => new Promise(resolve => requests.push(resolve)),
    syncCredentialsStore: {
      read: () => ({ ok: true, bound: Boolean(current), record: current && { ...current } }),
      save: record => { writes.push(record); current = { ...record }; return { ok: true }; },
    },
  };
  vm.createContext(context); vm.runInContext(source.slice(from, to), context);
  return { ensure: context.ensureAccountSyncKey, requests, writes,
    set: value => { current = value; }, get: () => current };
}
const response = { ok: true, body: { accountSyncKey: 'fixture-account-key' } };

test('a late account key response cannot restore a cleared binding', async () => {
  const h = harness(), job = h.ensure({ ...original });
  h.set(null); h.requests[0](response);
  assert.equal(await job, null);
  assert.equal(h.get(), null);
  assert.equal(h.writes.length, 0);
});

test('a late account key response cannot replace another account or a renewed token', async () => {
  for (const patch of [{ serverId: 'other-server', uid: 'other-user', deviceId: 'other-device' },
    { deviceToken: 'new-token' }, { boundAt: 11 }]) {
    const h = harness(), job = h.ensure({ ...original });
    const next = { ...original, ...patch }; h.set(next); h.requests[0](response);
    assert.equal(await job, null);
    assert.deepEqual(h.get(), next);
    assert.equal(h.writes.length, 0);
  }
});

test('saving a key preserves settings changed during the request', async () => {
  const h = harness(), passed = { ...original }, job = h.ensure(passed);
  h.set({ ...original, baseUrl: 'https://updated.invalid', expiresAt: 123 });
  h.requests[0](response);
  assert.equal(await job, 'fixture-account-key');
  assert.equal(h.get().baseUrl, 'https://updated.invalid');
  assert.equal(h.get().expiresAt, 123);
  assert.equal(passed.accountSyncKey, 'fixture-account-key');
  assert.equal(h.writes.length, 1);
});

test('concurrent key requests reuse the first saved key and do not overwrite newer settings', async () => {
  const h = harness(), first = h.ensure({ ...original }), second = h.ensure({ ...original });
  h.requests[0](response); assert.equal(await first, 'fixture-account-key');
  h.set({ ...h.get(), baseUrl: 'https://latest.invalid' });
  h.requests[1]({ ok: true, body: { accountSyncKey: 'obsolete-response' } });
  assert.equal(await second, 'fixture-account-key');
  assert.equal(h.get().baseUrl, 'https://latest.invalid');
  assert.equal(h.writes.length, 1);
});

test('a stale caller cannot request or use a key from a replacement binding', async () => {
  const h = harness();
  h.set({ ...original, deviceToken: 'replacement', accountSyncKey: 'replacement-key' });
  assert.equal(await h.ensure({ ...original }), null);
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});
