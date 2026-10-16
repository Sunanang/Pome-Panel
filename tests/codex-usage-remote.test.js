'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRemoteUsage, requestRemoteUsage, createCodexUsageService, USAGE_URL, ALLOWED_HOSTS, TIMEOUT_MS, CACHE_TTL_MS } = require('../codex-usage-remote');
const { providers } = require('../renderer/ai-usage-domain');
const { buildWorkspaceEntities, projectWorkspaceEntities } = require('../workspace-sync');
const now = Date.parse('2026-10-09T03:53:00Z');
const body = { plan_type: 'plus', rate_limit: {
  primary_window: { used_percent: 86, reset_at: now / 1000 + 3600, limit_window_seconds: 18000 },
  secondary_window: { used_percent: 15, reset_at: now / 1000 + 86400, limit_window_seconds: 604800 },
}, credits: { has_credits: true, unlimited: false, balance: '12.5' } };
const local = { ok: true, detected: true, updatedAt: '2026-10-09T02:00:00.000Z', primary: { percent: 40 }, secondary: { percent: 20 }, plan: 'plus' };
const missing = { ok: true, detected: false, primary: null, secondary: null, updatedAt: null };
function response(status = 200, payload = body) { return new Response(JSON.stringify(payload), { status }); }
function service(fetchImpl, data = local, options = {}) { return createCodexUsageService({ fetchImpl, readLocal: async () => data, now: () => now, ...options }); }

test('remote response becomes the same quota shape as local records', () => {
  const result = parseRemoteUsage(body, now);
  assert.equal(result.updatedAt, new Date(now).toISOString());
  assert.equal(result.plan, 'plus'); assert.equal(result.authSource, 'manual');
  assert.deepEqual(result.primary, { percent: 86, windowMinutes: 300, resetsAt: now / 1000 + 3600, expired: false });
  assert.equal(result.secondary.windowMinutes, 10080);
  assert.deepEqual(result.credits, { hasCredits: true, unlimited: false, balance: 12.5 });
});
test('missing fields and null credits tolerate empty data without fabricating zero percentages', () => {
  for (const input of [null, {}, { credits: null }, { rate_limit: null }, { rate_limit: { primary_window: {} }, credits: {} }]) {
    const result = parseRemoteUsage(input, now);
    assert.equal(result.ok, true); assert.equal(result.secondary, null);
    assert.equal(result.primary?.percent ?? null, null);
  }
  assert.equal(parseRemoteUsage({ credits: null }, now).credits, null);
  assert.equal(parseRemoteUsage({ rate_limit: { primary_window: { used_percent: 20, reset_at: now / 1000 - 1 } } }, now).primary.expired, true);
});
test('only fixed chatgpt.com HTTPS endpoint receives the token; redirects are rejected and timeout is 10 seconds', async () => {
  let request;
  const result = await requestRemoteUsage('fixture-access-token', { now: () => now, fetchImpl: async (url, options) => {
    request = { url, options }; return response();
  } });
  assert.equal(result.ok, true); assert.equal(request.url, USAGE_URL);
  assert.deepEqual(ALLOWED_HOSTS, ['chatgpt.com']); assert.equal(TIMEOUT_MS, 10000);
  assert.equal(request.options.method, 'GET'); assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer fixture-access-token');
  assert.equal(request.url.includes('fixture-access-token'), false);
  assert.ok(request.options.signal instanceof AbortSignal);
});
test('only 401/403 classify authentication as invalid; 5xx, 429 and network errors do not', async () => {
  for (const status of [401, 403, 500, 503, 429]) {
    const result = await requestRemoteUsage('fixture-token', { fetchImpl: async () => response(status) });
    assert.equal(result.ok, false); assert.equal(result.manualTokenInvalid, [401, 403].includes(status));
  }
  const result = await requestRemoteUsage('fixture-token', { fetchImpl: async () => { throw new Error('fixture-token in unsafe exception'); } });
  assert.deepEqual(result, { ok: false, error: 'codex_network_failed', manualTokenInvalid: false });
});
test('timeouts and malformed successful responses are recoverable network failures', async (t) => {
  const keepAlive = setTimeout(() => {}, 100);
  t.after(() => clearTimeout(keepAlive));
  const timedOut = await requestRemoteUsage('fixture-token', { timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  assert.equal(timedOut.manualTokenInvalid, false); assert.equal(timedOut.error, 'codex_network_failed');
  assert.equal((await requestRemoteUsage('fixture-token', { fetchImpl: async () => new Response('not JSON') })).error, 'codex_network_failed');
});
test('manual token uses remote quotas first; success does not read local telemetry', async () => {
  let reads = 0;
  const reader = service(async () => response(), local, { readLocal: async () => { reads++; return local; } });
  const result = await reader.getUsage({ manualToken: 'fixture-token' });
  assert.equal(result.primary.percent, 86); assert.equal(result.authSource, 'manual'); assert.equal(reads, 0);
});
test('401/403 fall back to local data, retaining invalid state', async () => {
  for (const status of [401, 403]) {
    const reader = service(async () => response(status));
    const result = await reader.getUsage({ manualToken: 'fixture-token' });
    assert.equal(result.primary.percent, 40); assert.equal(result.updatedAt, local.updatedAt);
    assert.equal(result.authSource, 'local'); assert.equal(result.manualTokenInvalid, true);
    assert.equal(reader.tokenState().manualTokenInvalid, true);
  }
});
test('invalid token with no local data remains visible with empty quotas', async () => {
  const result = await service(async () => response(401), missing).getUsage({ manualToken: 'fixture-token' });
  assert.equal(result.primary, null); assert.equal(result.secondary, null);
  assert.equal(result.configured, true); assert.equal(result.manualTokenInvalid, true);
  assert.deepEqual(providers(null, result), ['codex']);
});
test('network errors and 5xx prefer local records and never mark a valid token invalid', async () => {
  for (const fetchImpl of [async () => response(500), async () => { throw new Error('offline'); }]) {
    const result = await service(fetchImpl).getUsage({ manualToken: 'fixture-token' });
    assert.equal(result.authSource, 'local'); assert.equal(result.primary.percent, 40);
    assert.equal(result.updatedAt, local.updatedAt); assert.equal(result.remoteError, 'codex_network_failed');
    assert.equal(result.manualTokenInvalid, false);
  }
});
test('offline without local data keeps the last successful remote snapshot and its real timestamp', async () => {
  let fail = false; let time = now;
  const reader = service(async () => response(fail ? 503 : 200), missing, { now: () => time });
  const good = await reader.getUsage({ manualToken: 'fixture-token' });
  fail = true; time += 100000;
  const offline = await reader.getUsage({ manualToken: 'fixture-token', force: true });
  assert.equal(offline.primary.percent, good.primary.percent); assert.equal(offline.updatedAt, good.updatedAt);
  assert.equal(offline.authSource, 'manual'); assert.equal(offline.cached, true); assert.equal(offline.manualTokenInvalid, false);
});
test('network failure without any record keeps configured provider; neither token nor local data hides Codex', async () => {
  let calls = 0;
  const reader = service(async () => { calls++; return response(503); }, missing);
  const result = await reader.getUsage({ manualToken: 'fixture-token' });
  assert.deepEqual(providers(null, result), ['codex']); assert.equal(result.manualTokenInvalid, false);
  const empty = await reader.getUsage();
  assert.deepEqual(providers(null, empty), []); assert.equal(calls, 1);
});
test('without token only local telemetry is read', async () => {
  const result = await service(async () => { throw new Error('must not fetch'); }).getUsage();
  assert.equal(result.primary.percent, 40); assert.equal(result.authSource, 'local'); assert.equal(result.remoteError, null);
});
test('repeated readers use cache, force bypasses it, and there is no additional polling timer', async () => {
  let calls = 0; let time = now;
  const reader = service(async () => { calls++; return response(); }, local, { now: () => time });
  await reader.getUsage({ manualToken: 'fixture-token' });
  assert.equal((await reader.getUsage({ manualToken: 'fixture-token' })).cached, true);
  assert.equal(calls, 1);
  await reader.getUsage({ manualToken: 'fixture-token', force: true }); assert.equal(calls, 2);
  time += CACHE_TTL_MS + 1;
  await reader.getUsage({ manualToken: 'fixture-token' }); assert.equal(calls, 3);
});
test('invalid token discards old remote quotas; resetting or replacing it immediately clears invalid state', async () => {
  let status = 200;
  const reader = service(async () => response(status), missing);
  await reader.getUsage({ manualToken: 'fixture-token' });
  status = 401;
  const invalid = await reader.getUsage({ manualToken: 'fixture-token', force: true });
  assert.equal(invalid.primary, null); assert.equal(invalid.manualTokenInvalid, true);
  status = 500;
  assert.equal((await reader.getUsage({ manualToken: 'fixture-token', force: true })).manualTokenInvalid, true);
  reader.reset(); assert.equal(reader.tokenState().manualTokenInvalid, false);
  status = 200;
  assert.equal((await reader.getUsage({ manualToken: 'replacement-token' })).manualTokenInvalid, false);
});
test('changing a token cancels old requests and ignores their late invalid responses', async () => {
  let finishOld; let oldSignal;
  const reader = service(async (_url, options) => {
    if (options.headers.Authorization.endsWith('old-token')) {
      oldSignal = options.signal; return new Promise((resolve) => { finishOld = resolve; });
    }
    return response();
  });
  const old = reader.getUsage({ manualToken: 'old-token' });
  reader.reset(); assert.equal(oldSignal.aborted, true);
  const good = await reader.getUsage({ manualToken: 'new-token' });
  finishOld(response(401)); assert.deepEqual(await old, { superseded: true });
  assert.equal(reader.tokenState().manualTokenInvalid, false);
  assert.equal((await reader.getUsage({ manualToken: 'new-token' })).updatedAt, good.updatedAt);
});
test('concurrent settings and homepage requests share one network request', async () => {
  let calls = 0; let finish;
  const reader = service(async () => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const first = reader.getUsage({ manualToken: 'fixture-token' });
  const second = reader.getUsage({ manualToken: 'fixture-token' });
  assert.equal(calls, 1); finish(response());
  assert.equal((await first).ok, true); assert.equal((await second).ok, true);
});
test('sensitive errors and tokens never enter logs or returned snapshots', async (t) => {
  const logs = [];
  for (const name of ['log', 'warn', 'error', 'debug']) t.mock.method(console, name, (...args) => logs.push(args));
  const secret = 'fixture-must-never-leak';
  const result = await service(async () => { throw new Error(secret); }, missing).getUsage({ manualToken: secret });
  assert.equal(JSON.stringify(result).includes(secret), false); assert.deepEqual(logs, []);
});
test('Codex tokens are excluded from workspace entities, even if a caller supplies them', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const entities = buildWorkspaceEntities({ aiSettings: { apiKey: 'allowed-ai-key', codexToken: 'never-sync-codex-token', encryptedCodexToken: 'never-sync-ciphertext' } }, { accountKey: key }).entities;
  const projected = projectWorkspaceEntities(entities, { accountKey: key });
  assert.equal(JSON.stringify(projected).includes('never-sync'), false);
});
test('production Codex code never accesses renewal or ID credentials or token renewal endpoints; CSP stays closed', () => {
  for (const file of ['codex-auth.js', 'codex-usage.js', 'codex-usage-remote.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(source, /refresh_token|id_token|oauth\/token/);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer/index.html'), 'utf8'), /connect-src 'none'/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const snapshot = main.slice(main.indexOf('function assembleWorkspaceSnapshot'), main.indexOf('function writeSyncedBytes'));
  assert.doesNotMatch(snapshot, /[Cc]odex[Tt]oken|encryptedCodex/);
});

test('additional model limits retain their own names and real window cadence', () => {
  const snapshot = parseRemoteUsage({ ...body, additional_rate_limits: [{ limit_name: 'Spark', rate_limit: {
    primary_window: { used_percent: 42, limit_window_seconds: 604800, reset_at: now / 1000 + 300 },
  } }] }, now);
  assert.equal(snapshot.windows.length, 3);
  assert.equal(snapshot.windows[2].label, 'Spark'); assert.equal(snapshot.windows[2].windowMinutes, 10080);
  assert.equal(snapshot.windows[2].percent, 42);
});
