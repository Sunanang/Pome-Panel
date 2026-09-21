'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSyncSettingsStore } = require('../sync-settings');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-sync-settings-'));
  const store = createSyncSettingsStore({
    getUserDataPath: () => dir,
    fs,
    path,
  });
  return { dir, store };
}

test('add/update/delete/reorder endpoints persist under userData', () => {
  const { dir, store } = tempStore();
  const a = store.addEndpoint({
    baseUrl: 'https://nas.local/app/pome-panel-sync',
    kind: 'gateway',
    priority: 20,
  });
  assert.equal(a.ok, true);
  const b = store.addEndpoint({
    baseUrl: 'http://192.168.1.20:4000/app/pome-panel-sync',
    kind: 'device-port',
    priority: 10,
  });
  assert.equal(b.ok, true);
  assert.equal(b.endpoint.allowInsecureHttp, false);

  const dup = store.addEndpoint({ baseUrl: 'https://nas.local/app/pome-panel-sync/' });
  assert.equal(dup.error, 'duplicate_endpoint');

  const list = store.listEndpoints();
  assert.equal(list[0].kind, 'device-port');
  assert.equal(list[1].kind, 'gateway');

  const toggled = store.updateEndpoint(b.endpoint.endpointId, {
    allowInsecureHttp: true,
    httpConfirmAccepted: true,
  });
  assert.equal(toggled.ok, true);
  assert.equal(toggled.endpoint.allowInsecureHttp, true);
  assert.ok(toggled.view.lastHttpAuditAt);

  const off = store.updateEndpoint(b.endpoint.endpointId, { allowInsecureHttp: false });
  assert.equal(off.endpoint.disabledByPolicy, true);
  assert.equal(off.endpoint.enabled, false);

  const cannotEnable = store.updateEndpoint(b.endpoint.endpointId, { enabled: true });
  assert.equal(cannotEnable.error, 'disabled_by_policy');

  const urlReset = store.updateEndpoint(a.endpoint.endpointId, {
    baseUrl: 'https://nas2.local/app/pome-panel-sync',
  });
  assert.equal(urlReset.endpoint.allowInsecureHttp, false);

  store.reorderEndpoint(a.endpoint.endpointId, 'up');
  store.deleteEndpoint(b.endpoint.endpointId);
  assert.equal(store.listEndpoints().length, 1);

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'sync-settings.json'), 'utf8'));
  assert.equal(onDisk.endpoints.length, 1);
  assert.ok(Array.isArray(onDisk.httpAudit));
});

test('gatewayBearerBlocked exposes device-port guidance; both kinds coexist', () => {
  const { store } = tempStore();
  store.addEndpoint({ baseUrl: 'https://gw.example/app/pome-panel-sync', kind: 'gateway' });
  store.addEndpoint({
    baseUrl: 'http://192.168.1.5:39111/app/pome-panel-sync',
    kind: 'device-port',
  });
  store.setGatewayBearerBlocked(true);
  const view = store.getPublicView();
  assert.equal(view.gatewayBearerBlocked, true);
  assert.match(view.devicePortGuidance, /设备同步端口/);
  assert.equal(view.endpoints.some((e) => e.kind === 'gateway'), true);
  assert.equal(view.endpoints.some((e) => e.kind === 'device-port'), true);
});

test('ensureEndpointFromPairing upserts current', () => {
  const { store } = tempStore();
  const first = store.ensureEndpointFromPairing('https://pair.local/app/pome-panel-sync', {
    serverId: 's1',
    uid: 'u1',
  });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  const again = store.ensureEndpointFromPairing('https://pair.local/app/pome-panel-sync/');
  assert.equal(again.created, false);
  assert.equal(store.listEndpoints().length, 1);
});
