'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSyncSettingsStore, PERSISTED_SETTING_KEYS } = require('../sync-settings');

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

test('trusted certs persist per host:port and unknown settings keys are dropped', () => {
  const { dir, store } = tempStore();
  const pem = '-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n';
  const other = '-----BEGIN CERTIFICATE-----\nREVG\n-----END CERTIFICATE-----\n';
  assert.equal(store.trustCertificate('not a key', { pem, fingerprint256: 'AA' }).error, 'invalid_host');
  assert.equal(
    store.trustCertificate('nas.local:443', { pem: 'nope', fingerprint256: 'AA' }).error,
    'invalid_certificate',
  );
  const saved = store.trustCertificate('NAS.Local:443', {
    pem,
    fingerprint256: 'AA:BB',
    subjectCN: 'fnos',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.hostKey, 'nas.local:443');
  store.trustCertificate('nas.local:8443', { pem: other, fingerprint256: 'CC:DD' });
  assert.equal(store.getTrustedCert('nas.local:443').fingerprint256, 'AA:BB');
  assert.equal(store.getTrustedCert('nas.local:443').subjectCN, 'fnos');
  assert.equal(store.getTrustedCert('nas.local:8443').fingerprint256, 'CC:DD');
  assert.equal(store.getTrustedCert('other.local:443'), null);
  assert.equal(JSON.stringify(saved.view).includes('BEGIN CERTIFICATE'), false);

  const file = path.join(dir, 'sync-settings.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.droppedSecret = 'nope';
  raw.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  fs.writeFileSync(file, JSON.stringify(raw));
  store.recordSyncMeta({ lastUiState: 'synced' });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.droppedSecret, undefined);
  assert.equal(onDisk.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal(onDisk.trustedCerts['nas.local:443'].fingerprint256, 'AA:BB');
  assert.equal(onDisk.trustedCerts['nas.local:8443'].fingerprint256, 'CC:DD');
  assert.deepEqual(Object.keys(onDisk).sort(), [...PERSISTED_SETTING_KEYS].sort());

  const reloaded = createSyncSettingsStore({
    getUserDataPath: () => dir,
    fs,
    path,
  });
  assert.equal(reloaded.trustCertificate('nas.local:443', {
    pem: other,
    fingerprint256: 'EE:FF',
  }).ok, true);
  assert.equal(reloaded.getTrustedCert('nas.local:443').fingerprint256, 'EE:FF');
  assert.equal(reloaded.getTrustedCert('nas.local:8443').fingerprint256, 'CC:DD');
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
