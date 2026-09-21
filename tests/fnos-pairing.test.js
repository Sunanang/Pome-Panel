'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createApp } = require('../fnos/app/server/createApp');
const { createMemoryStore } = require('../fnos/app/server/store');
const { applyGatewayTrimHygiene } = require('../fnos/app/server/auth');
const { dispatch } = require('../fnos/app/server/testHarness');
const {
  INSECURE_DEVICE_TOKEN_TTL_MS,
  DEVICE_TOKEN_TTL_MS,
  PAIRING_CODE_TTL_MS,
} = require('../packages/sync-protocol');
const { hashSecret } = require('../fnos/app/server/pairing');

function gatewayHeaders(uid = 'uid-alice', extra = {}) {
  return {
    ...applyGatewayTrimHygiene(
      { 'x-trim-userid': 'spoof', origin: 'http://localhost' },
      { injectUid: uid, injectUsername: 'alice' },
    ),
    origin: 'http://localhost',
    host: 'localhost',
    ...extra,
  };
}

async function issueCsrf(app, uid = 'uid-alice') {
  const res = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/pair/csrf',
    headers: gatewayHeaders(uid),
  });
  assert.equal(res.statusCode, 200);
  return res.getJson().csrfToken;
}

async function startPair(app, { uid = 'uid-alice', csrfToken, origin = 'http://localhost', headers = {} } = {}) {
  const token = csrfToken || (await issueCsrf(app, uid));
  return dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/start',
    headers: {
      ...gatewayHeaders(uid, { origin, 'x-csrf-token': token }),
      ...headers,
    },
    body: {},
  });
}

test('pair/start rejects missing Origin (CSRF surface)', async () => {
  const app = createApp({ listenMode: 'gateway', serverId: 'srv-pair' });
  const csrf = await issueCsrf(app);
  const res = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/start',
    headers: {
      ...applyGatewayTrimHygiene({}, { injectUid: 'uid-alice' }),
      'x-csrf-token': csrf,
      // no origin
    },
    body: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.getJson().error, 'origin_missing');
});

test('pair/start rejects invalid CSRF', async () => {
  const app = createApp({ listenMode: 'gateway' });
  const res = await startPair(app, { csrfToken: 'not-a-real-csrf' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.getJson().error, 'csrf_invalid');
});

test('pair/start requires gateway session; device-port returns 404', async () => {
  const gateway = createApp({ listenMode: 'gateway' });
  const denied = await dispatch(gateway, {
    method: 'POST',
    url: '/api/v1/pair/start',
    headers: { origin: 'http://localhost', 'x-csrf-token': 'x' },
    body: {},
  });
  assert.equal(denied.statusCode, 401);

  const deviceApp = createApp({ listenMode: 'device-port' });
  const dp = await dispatch(deviceApp, {
    method: 'POST',
    url: '/api/v1/pair/start',
    headers: gatewayHeaders(),
    body: {},
  });
  assert.equal(dp.statusCode, 404);
});

test('pair/start issues code once; store keeps only hash', async () => {
  const store = createMemoryStore({ serverId: 'srv-hash' });
  const app = createApp({ listenMode: 'gateway', store });
  const res = await startPair(app);
  assert.equal(res.statusCode, 200);
  const body = res.getJson();
  assert.match(body.pairingCode, /^\d{6}$/);
  assert.ok(body.codeId);
  assert.ok(body.expiresAt > Date.now());

  const row = store._peekPairingByCode(body.pairingCode);
  assert.ok(row);
  assert.equal(row.codeHash, hashSecret(body.pairingCode));
  assert.equal(row.uid, 'uid-alice');
  assert.equal(JSON.stringify(row).includes(body.pairingCode), false);
});

test('pair/claim single-consume in same transaction; second claim 409', async () => {
  const store = createMemoryStore({ serverId: 'srv-once' });
  const app = createApp({ listenMode: 'gateway', store });
  const started = await startPair(app);
  const code = started.getJson().pairingCode;

  const first = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/claim',
    body: { pairingCode: code, deviceName: 'Mac-A' },
  });
  assert.equal(first.statusCode, 200);
  const tokenBody = first.getJson();
  assert.ok(tokenBody.deviceToken);
  assert.equal(tokenBody.uid, 'uid-alice');
  assert.equal(tokenBody.serverId, 'srv-once');
  assert.equal(tokenBody.insecureBound, false);
  assert.ok(tokenBody.deviceToken.length >= 43); // 32 bytes base64url

  const second = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/complete',
    body: { pairingCode: code, deviceName: 'Mac-B' },
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.getJson().error, 'code_consumed');
});

test('token/uid isolation: devices and revoke scoped to owner uid', async () => {
  const store = createMemoryStore({ serverId: 'srv-iso' });
  const app = createApp({ listenMode: 'gateway', store });

  const aStart = await startPair(app, { uid: 'uid-a' });
  const aClaim = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/claim',
    body: { pairingCode: aStart.getJson().pairingCode, deviceName: 'A' },
  });
  const aToken = aClaim.getJson().deviceToken;
  const aDeviceId = aClaim.getJson().deviceId;

  const bStart = await startPair(app, { uid: 'uid-b' });
  const bClaim = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/claim',
    body: { pairingCode: bStart.getJson().pairingCode, deviceName: 'B' },
  });
  const bToken = bClaim.getJson().deviceToken;

  const aList = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/devices',
    headers: { authorization: `Bearer ${aToken}` },
  });
  assert.equal(aList.statusCode, 200);
  const aDevices = aList.getJson().devices;
  assert.equal(aDevices.length, 1);
  assert.equal(aDevices[0].deviceId, aDeviceId);

  const crossRevoke = await dispatch(app, {
    method: 'POST',
    url: `/api/v1/devices/${encodeURIComponent(aDeviceId)}/revoke`,
    headers: { authorization: `Bearer ${bToken}` },
    body: {},
  });
  assert.equal(crossRevoke.statusCode, 404);

  const probe = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/auth-probe',
    headers: {
      authorization: `Bearer ${aToken}`,
      ...applyGatewayTrimHygiene({}, { injectUid: 'uid-b' }),
    },
  });
  assert.equal(probe.statusCode, 403);
  assert.equal(probe.getJson().error, 'uid_mismatch');
});

test('insecureBound token: fixed 30-day expiry, no sliding renewal', async () => {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const store = createMemoryStore({ serverId: 'srv-insec', now: () => now });
  const app = createApp({ listenMode: 'gateway', store });
  const started = await startPair(app);
  const claim = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/claim',
    body: {
      pairingCode: started.getJson().pairingCode,
      insecureBound: true,
      deviceName: 'HTTP-LAN',
    },
  });
  assert.equal(claim.statusCode, 200);
  const body = claim.getJson();
  assert.equal(body.insecureBound, true);
  assert.equal(body.expiresAt, now + INSECURE_DEVICE_TOKEN_TTL_MS);

  const listed = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/devices',
    headers: { authorization: `Bearer ${body.deviceToken}` },
  });
  assert.equal(listed.getJson().devices[0].insecureBound, true);

  // Advance 10 days and touch token — expiresAt must NOT slide.
  now += 10 * 24 * 60 * 60 * 1000;
  const again = store.verifyToken(body.deviceToken, { touch: true });
  assert.ok(again);
  assert.equal(again.expiresAt, Date.parse('2026-01-01T00:00:00.000Z') + INSECURE_DEVICE_TOKEN_TTL_MS);
  assert.notEqual(again.expiresAt, now + DEVICE_TOKEN_TTL_MS);

  // After 30 days from issue, token is expired.
  now = Date.parse('2026-01-01T00:00:00.000Z') + INSECURE_DEVICE_TOKEN_TTL_MS + 1;
  assert.equal(store.verifyToken(body.deviceToken), null);
});

test('secure token slides on use (90d policy)', async () => {
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const store = createMemoryStore({ serverId: 'srv-slide', now: () => now });
  const issued = store.issueTokenRecord({ uid: 'uid-alice', insecureBound: false, now });
  assert.equal(issued.expiresAt, now + DEVICE_TOKEN_TTL_MS);
  now += 7 * 24 * 60 * 60 * 1000;
  const touched = store.verifyToken(issued.raw, { touch: true });
  assert.equal(touched.expiresAt, now + DEVICE_TOKEN_TTL_MS);
});

test('pair code expires after TTL', async () => {
  let now = 1_000_000;
  const store = createMemoryStore({ serverId: 'srv-ttl', now: () => now });
  const app = createApp({ listenMode: 'gateway', store });
  const started = await startPair(app);
  const code = started.getJson().pairingCode;
  now += PAIRING_CODE_TTL_MS + 1;
  const claim = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/claim',
    body: { pairingCode: code },
  });
  assert.equal(claim.statusCode, 410);
  assert.equal(claim.getJson().error, 'code_expired');
});

test('revoked device token is rejected', async () => {
  const store = createMemoryStore({ serverId: 'srv-rev' });
  const app = createApp({ listenMode: 'gateway', store });
  const started = await startPair(app);
  const claim = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/claim',
    body: { pairingCode: started.getJson().pairingCode },
  });
  const { deviceToken, deviceId } = claim.getJson();
  const revoked = await dispatch(app, {
    method: 'POST',
    url: `/api/v1/devices/${encodeURIComponent(deviceId)}/revoke`,
    headers: { authorization: `Bearer ${deviceToken}` },
    body: {},
  });
  assert.equal(revoked.statusCode, 200);
  const probe = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/auth-probe',
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  assert.equal(probe.statusCode, 401);
});

test('code must not be accepted via URL query', async () => {
  const app = createApp({ listenMode: 'gateway' });
  const csrf = await issueCsrf(app);
  const badStart = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/pair/start?code=123456',
    headers: gatewayHeaders('uid-alice', { 'x-csrf-token': csrf }),
    body: {},
  });
  assert.equal(badStart.statusCode, 400);
});
