'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../fnos/app/server/createApp');
const { createMemoryStore } = require('../fnos/app/server/store');
const {
  applyGatewayTrimHygiene,
  stripTrimHeaders,
  resolveIdentity,
} = require('../fnos/app/server/auth');
const {
  SCHEMA_VERSION,
  MIN_SUPPORTED,
  MAX_SUPPORTED,
  schemaEnvelope,
  isSchemaCompatible,
} = require('../fnos/app/server/schema');
const { validateMutationShape } = require('../fnos/app/server/routes');
const { dispatch } = require('../fnos/app/server/testHarness');

function schemaFields(body) {
  assert.equal(body.schemaVersion, SCHEMA_VERSION);
  assert.equal(body.minSupported, MIN_SUPPORTED);
  assert.equal(body.maxSupported, MAX_SUPPORTED);
}

test('schema local constants envelope and compatibility hook', () => {
  const env = schemaEnvelope();
  assert.deepEqual(env, {
    schemaVersion: 1,
    minSupported: 1,
    maxSupported: 1,
  });
  assert.equal(isSchemaCompatible(1), true);
  assert.equal(isSchemaCompatible(0), false);
  assert.equal(isSchemaCompatible(99), false);
  assert.equal(isSchemaCompatible('nope'), false);
});

test('GET /api/v1/health shape includes serverId and schema (no secrets)', async () => {
  const app = createApp({ listenMode: 'gateway', serverId: 'srv-test-1' });
  const res = await dispatch(app, { method: 'GET', url: '/api/v1/health' });
  assert.equal(res.statusCode, 200);
  const body = res.getJson();
  schemaFields(body);
  assert.equal(body.ok, true);
  assert.equal(body.serverId, 'srv-test-1');
  assert.equal(body.gatewayMode, true);
  assert.equal(body.listenMode, 'gateway');
  assert.equal(body.deviceToken, undefined);
  assert.equal(body.token, undefined);
});

test('GET /api/v1/me requires gateway session; unauthenticated → 401', async () => {
  const app = createApp({ listenMode: 'gateway' });
  const denied = await dispatch(app, { method: 'GET', url: '/api/v1/me' });
  assert.equal(denied.statusCode, 401);
  schemaFields(denied.getJson());

  const headers = applyGatewayTrimHygiene(
    { 'x-trim-userid': 'attacker', 'x-trim-username': 'evil' },
    { injectUid: 'uid-alice', injectUsername: 'alice' },
  );
  const ok = await dispatch(app, { method: 'GET', url: '/api/v1/me', headers });
  assert.equal(ok.statusCode, 200);
  const body = ok.getJson();
  schemaFields(body);
  assert.equal(body.uid, 'uid-alice');
  assert.equal(body.username, 'alice');
});

test('gateway hygiene strips client X-Trim-* then re-injects', () => {
  const cleaned = applyGatewayTrimHygiene(
    {
      'X-Trim-Userid': 'spoofed',
      'X-Trim-Username': 'spoof',
      authorization: 'Bearer keep-me',
    },
    { injectUid: 'real-uid', injectUsername: 'real' },
  );
  assert.equal(cleaned['x-trim-userid'], 'real-uid');
  assert.equal(cleaned['x-trim-username'], 'real');
  assert.equal(cleaned.authorization, 'Bearer keep-me');
  assert.deepEqual(stripTrimHeaders({ 'x-trim-userid': 'x', a: '1' }), { a: '1' });
});

test('GET /api/v1/auth-probe accepts Bearer and never echoes token', async () => {
  const store = createMemoryStore({ serverId: 'srv-probe' });
  const token = store.issueToken({ uid: 'uid-bob', deviceId: 'dev-1' });
  const app = createApp({ listenMode: 'gateway', store });

  const missing = await dispatch(app, { method: 'GET', url: '/api/v1/auth-probe' });
  assert.equal(missing.statusCode, 401);
  const missingBody = missing.getJson();
  schemaFields(missingBody);
  assert.equal(missingBody.tokenAccepted, false);
  assert.equal(JSON.stringify(missingBody).includes(token), false);

  const ok = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/auth-probe',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.getJson();
  schemaFields(body);
  assert.equal(body.authMode, 'deviceToken');
  assert.equal(body.uid, 'uid-bob');
  assert.equal(body.tokenAccepted, true);
  assert.equal(JSON.stringify(body).includes(token), false);

  const bad = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/auth-probe',
    headers: { authorization: 'Bearer not-a-real-token' },
  });
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.getJson().tokenAccepted, false);
});

test('device-port NEVER trusts X-Trim-*; only deviceToken', async () => {
  const store = createMemoryStore({ serverId: 'srv-dev' });
  const token = store.issueToken({ uid: 'uid-carol', deviceId: 'dev-2' });
  const app = createApp({ listenMode: 'device-port', store });

  const spoof = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/auth-probe',
    headers: {
      'x-trim-userid': 'uid-attacker',
      'x-trim-username': 'attacker',
    },
  });
  assert.equal(spoof.statusCode, 401);
  assert.equal(spoof.getJson().uid, null);

  const me = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/me',
    headers: { 'x-trim-userid': 'uid-attacker' },
  });
  assert.equal(me.statusCode, 404);
  assert.equal(me.getJson().error, 'me_unavailable_on_device_port');

  const ok = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/auth-probe',
    headers: {
      authorization: `Bearer ${token}`,
      'x-trim-userid': 'uid-attacker',
    },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.getJson().uid, 'uid-carol');
  assert.equal(ok.getJson().authMode, 'deviceToken');

  // sync/state also ignores trim spoof without token
  const stateDenied = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/sync/state?collection=todos',
    headers: { 'x-trim-userid': 'uid-attacker' },
  });
  assert.equal(stateDenied.statusCode, 401);
});

test('gateway rejects cross-uid token vs session conflict', async () => {
  const store = createMemoryStore();
  const token = store.issueToken({ uid: 'uid-a', deviceId: 'd1' });
  const app = createApp({ listenMode: 'gateway', store });
  const headers = applyGatewayTrimHygiene(
    {},
    { injectUid: 'uid-b', injectUsername: 'b' },
  );
  headers.authorization = `Bearer ${token}`;
  const res = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/auth-probe',
    headers,
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.getJson().error, 'uid_mismatch');
});

test('uid isolation: push/pull/state do not leak across users', async () => {
  const store = createMemoryStore({ serverId: 'srv-iso' });
  const tokenA = store.issueToken({ uid: 'uid-a', deviceId: 'da' });
  const tokenB = store.issueToken({ uid: 'uid-b', deviceId: 'db' });
  const app = createApp({ listenMode: 'device-port', store });

  const mutation = {
    schemaVersion: SCHEMA_VERSION,
    collection: 'todos',
    entityId: 'todo-1',
    op: 'upsert',
    payload: { text: 'secret-of-a', done: false },
    clientMutationId: 'cm-1',
    deviceId: 'da',
    baseServerRev: 0,
    clientTime: Date.now(),
  };

  const pushA = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
    body: { mutations: [mutation] },
  });
  assert.equal(pushA.statusCode, 200);
  assert.equal(pushA.getJson().serverRev, 1);

  const stateB = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/sync/state?collection=todos',
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(stateB.statusCode, 200);
  const sb = stateB.getJson();
  assert.equal(sb.live, 0);
  assert.equal(sb.pristine, true);
  assert.equal(sb.serverRev, 0);

  const pullB = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/sync/pull?cursor=',
    headers: { authorization: `Bearer ${tokenB}` },
  });
  assert.equal(pullB.statusCode, 200);
  assert.equal(pullB.getJson().changes.length, 0);

  const stateA = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/sync/state?collection=todos',
    headers: { authorization: `Bearer ${tokenA}` },
  });
  assert.equal(stateA.getJson().live, 1);
  assert.equal(stateA.getJson().pristine, false);
  assert.equal(stateA.getJson().serverRev, 1);
});

test('sync/state + migration/* + push/pull contract shapes', async () => {
  const store = createMemoryStore({ serverId: 'srv-contract' });
  const token = store.issueToken({ uid: 'uid-m', deviceId: 'dm' });
  const app = createApp({ listenMode: 'device-port', store });
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const state0 = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/sync/state?collection=todos',
    headers: auth,
  });
  assert.equal(state0.statusCode, 200);
  const s0 = state0.getJson();
  schemaFields(s0);
  for (const key of ['live', 'tombstones', 'changeLogCount', 'serverRev', 'pristine', 'latestUpdatedAt']) {
    assert.ok(key in s0, `missing ${key}`);
  }
  assert.equal(s0.pristine, true);

  const start = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/migration/start',
    headers: auth,
    body: {},
  });
  assert.equal(start.statusCode, 200);
  const started = start.getJson();
  schemaFields(started);
  assert.ok(started.migrationId);
  assert.equal(started.state, 'pending');
  assert.equal(started.snapshotServerRev, 0);

  const getMig = await dispatch(app, {
    method: 'GET',
    url: `/api/v1/migration/${started.migrationId}`,
    headers: auth,
  });
  assert.equal(getMig.statusCode, 200);
  assert.equal(getMig.getJson().state, 'pending');

  const commitConflict = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/migration/commit',
    headers: auth,
    body: { migrationId: started.migrationId, expectedServerRev: 99 },
  });
  assert.equal(commitConflict.statusCode, 409);
  assert.equal(commitConflict.getJson().error, 'cas_conflict');

  const commitOk = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/migration/commit',
    headers: auth,
    body: { migrationId: started.migrationId, expectedServerRev: 0 },
  });
  assert.equal(commitOk.statusCode, 200);
  const committed = commitOk.getJson();
  assert.equal(committed.state, 'committed');
  assert.ok(committed.backupId);

  const badShape = validateMutationShape({ op: 'upsert' });
  assert.equal(badShape, 'missing_schemaVersion');

  const push = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: auth,
    body: {
      mutations: [{
        schemaVersion: SCHEMA_VERSION,
        collection: 'todos',
        entityId: 't1',
        op: 'upsert',
        payload: { text: 'hi', done: false },
        clientMutationId: 'c1',
        deviceId: 'dm',
        baseServerRev: 0,
        clientTime: 1,
      }],
    },
  });
  assert.equal(push.statusCode, 200);
  const pushed = push.getJson();
  schemaFields(pushed);
  assert.ok(Array.isArray(pushed.applied));
  assert.equal(typeof pushed.serverRev, 'number');

  const pull = await dispatch(app, {
    method: 'GET',
    url: '/api/v1/sync/pull?cursor=0',
    headers: auth,
  });
  assert.equal(pull.statusCode, 200);
  const pulled = pull.getJson();
  schemaFields(pulled);
  for (const key of ['changes', 'nextCursor', 'hasMore', 'serverRev']) {
    assert.ok(key in pulled, `missing ${key}`);
  }
  assert.equal(pulled.changes.length, 1);

  const notesAccepted = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: auth,
    body: {
      mutations: [{
        schemaVersion: SCHEMA_VERSION,
        collection: 'notes',
        entityId: 'note:home',
        op: 'upsert',
        payload: { kind: 'home', markdown: 'synced' },
        clientMutationId: 'c2',
        deviceId: 'dm',
        baseServerRev: 0,
        clientTime: 1,
      }],
    },
  });
  assert.equal(notesAccepted.statusCode, 200);

  const commandsAccepted = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: auth,
    body: {
      mutations: [{
        schemaVersion: SCHEMA_VERSION,
        collection: 'commands',
        entityId: 'command:cmd-1',
        op: 'upsert',
        payload: { id: 'cmd-1', text: 'npm test', createdAt: 1 },
        clientMutationId: 'c3',
        deviceId: 'dm',
        baseServerRev: 0,
        clientTime: 1,
      }],
    },
  });
  assert.equal(commandsAccepted.statusCode, 200);

  const layoutRejected = await dispatch(app, {
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: auth,
    body: {
      mutations: [{
        schemaVersion: SCHEMA_VERSION,
        collection: 'homeLayout',
        entityId: 'layout:home',
        op: 'upsert',
        payload: {},
        clientMutationId: 'c4',
        deviceId: 'dm',
        baseServerRev: 0,
        clientTime: 1,
      }],
    },
  });
  assert.equal(layoutRejected.statusCode, 422);
  assert.equal(layoutRejected.getJson().error, 'collection_not_enabled');
});

test('device port listen uses ephemeral port (not hardcoded 5001)', async () => {
  const app = createApp({ listenMode: 'device-port', serverId: 'srv-port' });
  const info = await app.listenDevicePort(0, '127.0.0.1');
  assert.ok(info.port > 0);
  assert.notEqual(info.port, 5001);
  // sanity: real HTTP hit
  const body = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: info.port, path: '/api/v1/health' }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    }).on('error', reject);
  });
  assert.equal(body.serverId, 'srv-port');
  assert.equal(body.listenMode, 'device-port');
  await app.close();
});

test('unix gateway socket serves health', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnos-sock-'));
  const socketPath = path.join(dir, 'test.sock');
  const app = createApp({ listenMode: 'gateway', serverId: 'srv-unix' });
  await app.listenUnix(socketPath);
  const body = await new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath, path: '/api/v1/health', method: 'GET' },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(body.serverId, 'srv-unix');
  assert.equal(body.gatewayMode, true);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveIdentity device-port ignores trim even when store has matching uid', () => {
  const store = createMemoryStore();
  const result = resolveIdentity(
    { 'x-trim-userid': 'uid-x' },
    { listenMode: 'device-port', store },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'device_token_required');
});

test('FPK skeleton files exist (manifest / privilege / resource / cmds / ui / wizard)', () => {
  const root = path.join(__dirname, '..', 'fnos');
  for (const rel of [
    'manifest.json',
    'config/privilege.json',
    'config/resource',
    'config/resource.json',
    'cmd/start.sh',
    'cmd/stop.sh',
    'cmd/status.sh',
    'app/ui/index.html',
    'app/ui/styles.css',
    'app/ui/panel.js',
    'app/server/workspace-view.js',
    'wizard/index.html',
    'app/server/index.js',
    'app/server/createApp.js',
    'app/server/auth.js',
    'app/server/store.js',
    'app/server/routes.js',
    'app/server/schema.js',
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  const start = fs.readFileSync(path.join(root, 'cmd/start.sh'), 'utf8');
  // Forbid assigning a fixed listen port; comments may mention 5001 as banned example.
  assert.equal(/\bFNOS_DEVICE_PORT\s*=\s*5001\b|\blisten\(\s*5001\b/.test(start), false);
  const cmdDir = path.join(root, 'cmd');
  for (const name of fs.readdirSync(cmdDir)) {
    const full = path.join(cmdDir, name);
    if (!fs.statSync(full).isFile()) continue;
    const text = fs.readFileSync(full, 'utf8');
    assert.equal(text.startsWith('#!/bin/bash\n'), true, name);
    assert.equal(text.includes('/usr/bin/env bash'), false, name);
  }
  for (const rel of ['config/resource', 'config/resource.json']) {
    const resource = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    assert.deepEqual(Object.keys(resource), ['data-share'], rel);
    assert.equal(resource['data-share'].shares[0].name, 'pome-panel');
    assert.equal(resource.cpu, undefined);
    assert.equal(resource.memory, undefined);
  }
  const createAppSrc = fs.readFileSync(path.join(root, 'app/server/createApp.js'), 'utf8');
  assert.match(createAppSrc, /NEVER hardcode 5001/);
  assert.equal(/\blisten\(\s*5001\b/.test(createAppSrc), false);
});
