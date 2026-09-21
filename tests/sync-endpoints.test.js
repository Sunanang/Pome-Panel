'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalizeEndpointUrl,
  endpointHttpPolicy,
  applyAllowInsecureHttpToggle,
  applyEndpointBaseUrlChange,
  classifyTransportError,
  shouldFailover,
  selectEndpointsForAttempt,
  dedupeEndpointsByCanonical,
  canRequestEndpoint,
  deriveSyncUiState,
  shouldShowInsecureHttpWarning,
  shouldGuideDevicePort,
  normalizeEndpointInput,
} = require('../packages/sync-protocol/endpoints');

test('canonicalize rejects credentials/query/fragment and normalizes', () => {
  assert.equal(canonicalizeEndpointUrl('').error, 'empty_url');
  assert.equal(
    canonicalizeEndpointUrl('https://user:pass@nas.local/app').error,
    'credentials_not_allowed',
  );
  assert.equal(
    canonicalizeEndpointUrl('https://nas.local/app?x=1').error,
    'query_or_fragment_not_allowed',
  );
  const ok = canonicalizeEndpointUrl('HTTPS://NAS.LOCAL:443/app/pome-panel-sync/');
  assert.equal(ok.ok, true);
  assert.equal(ok.canonical, 'https://nas.local/app/pome-panel-sync');
});

test('canonicalize collapses duplicate appPath', () => {
  const ok = canonicalizeEndpointUrl(
    'https://nas.local/app/pome-panel-sync/pome-panel-sync/extra',
  );
  assert.equal(ok.canonical, 'https://nas.local/app/pome-panel-sync/extra');
});

test('dedupe by canonical URL', () => {
  const list = dedupeEndpointsByCanonical([
    { endpointId: 'a', baseUrl: 'https://nas.local/app/' },
    { endpointId: 'b', baseUrl: 'https://nas.local/app' },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].endpointId, 'a');
});

test('HTTP switch default off; URL change resets; loopback exempt', () => {
  const created = normalizeEndpointInput({
    baseUrl: 'http://192.168.1.8:5666/app/pome-panel-sync',
  });
  assert.equal(created.ok, true);
  assert.equal(created.endpoint.allowInsecureHttp, false);

  const policyOff = endpointHttpPolicy({
    baseUrl: created.endpoint.baseUrl,
    allowInsecureHttp: false,
  });
  assert.equal(policyOff.allowed, false);
  assert.equal(policyOff.requiresConfirm, true);

  const loop = endpointHttpPolicy({ baseUrl: 'http://127.0.0.1:8080/app' });
  assert.equal(loop.allowed, true);
  assert.equal(loop.exemptLoopback, true);

  const reset = applyEndpointBaseUrlChange(
    { ...created.endpoint, allowInsecureHttp: true },
    'http://192.168.1.9/app',
  );
  assert.equal(reset.endpoint.allowInsecureHttp, false);
});

test('closing HTTP switch → disabledByPolicy; never rewrite https', () => {
  const ep = {
    endpointId: 'e1',
    baseUrl: 'http://10.0.0.2/app/pome-panel-sync',
    allowInsecureHttp: true,
    enabled: true,
    disabledByPolicy: false,
  };
  const needConfirm = applyAllowInsecureHttpToggle(ep, true, { confirmed: false });
  assert.equal(needConfirm.error, 'http_confirm_required');

  const off = applyAllowInsecureHttpToggle(ep, false);
  assert.equal(off.ok, true);
  assert.equal(off.rewrittenToHttps, false);
  assert.equal(off.endpoint.baseUrl.startsWith('http://'), true);
  assert.equal(off.endpoint.disabledByPolicy, true);
  assert.equal(off.endpoint.enabled, false);
  assert.equal(canRequestEndpoint(off.endpoint).error, 'disabled_by_policy');
});

test('failover: DNS/timeout/502 transfer; 401 and certificate do not', () => {
  assert.equal(shouldFailover('ENOTFOUND'), true);
  assert.equal(shouldFailover('timeout'), true);
  assert.equal(shouldFailover(503), true);
  assert.equal(shouldFailover(401), false);
  assert.equal(classifyTransportError('unable to verify the first certificate').kind, 'certificate_error');
  assert.equal(shouldFailover('unable to verify the first certificate'), false);
  assert.equal(classifyTransportError('CERT_HAS_EXPIRED').transferable, false);
});

test('selectEndpointsForAttempt skips disabledByPolicy and sorts by priority', () => {
  const ordered = selectEndpointsForAttempt([
    { endpointId: 'b', priority: 20, enabled: true, baseUrl: 'https://b' },
    { endpointId: 'a', priority: 10, enabled: true, baseUrl: 'https://a' },
    { endpointId: 'c', priority: 5, enabled: true, disabledByPolicy: true, baseUrl: 'http://c' },
  ]);
  assert.deepEqual(ordered.map((e) => e.endpointId), ['a', 'b']);
});

test('device-port may coexist; guidance only when G0 blocked', () => {
  assert.equal(shouldGuideDevicePort({ gatewayBearerBlocked: true }), true);
  assert.equal(shouldGuideDevicePort({ gatewayBearerBlocked: false }), false);
  const mixed = normalizeEndpointInput({
    baseUrl: 'http://192.168.1.5:39100/',
    kind: 'device-port',
  });
  assert.equal(mixed.endpoint.kind, 'device-port');
});

test('deriveSyncUiState covers certificate_error and endpoint_disabled', () => {
  assert.equal(deriveSyncUiState({ certificateError: true }), 'certificate_error');
  assert.equal(deriveSyncUiState({ bound: true, endpointDisabled: true }), 'endpoint_disabled');
  assert.equal(deriveSyncUiState({ bound: false }), 'unbound');
  assert.equal(deriveSyncUiState({ bound: true, outboxCount: 0 }), 'synced');
});

test('insecure warning when enabled HTTP endpoint has allowInsecureHttp', () => {
  assert.equal(
    shouldShowInsecureHttpWarning([
      {
        endpointId: '1',
        baseUrl: 'http://192.168.0.1/app',
        enabled: true,
        allowInsecureHttp: true,
      },
    ]),
    true,
  );
  assert.equal(
    shouldShowInsecureHttpWarning([
      {
        endpointId: '2',
        baseUrl: 'http://127.0.0.1/app',
        enabled: true,
        allowInsecureHttp: false,
      },
    ]),
    false,
  );
});
