'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readAuthToken } = require('../cursor-usage');

function fixture(t, rows = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-cursor-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, 'state.vscdb');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
  const insert = db.prepare('INSERT INTO ItemTable VALUES (?, ?)');
  for (const [key, value] of rows) insert.run(key, value);
  db.close();
  return dbPath;
}

test('Cursor credentials are read from SQLite without changing the database', async (t) => {
  const dbPath = fixture(t, [['cursorAuth/accessToken', 'fixture-cursor-token']]);
  const before = fs.readFileSync(dbPath);
  const result = await readAuthToken(dbPath);
  assert.equal(result.ok, true);
  assert.equal(result.token, 'fixture-cursor-token');
  assert.deepEqual(fs.readFileSync(dbPath), before);
});

test('missing Cursor install and signed-out Cursor have distinct results', async (t) => {
  const dbPath = fixture(t);
  assert.equal((await readAuthToken(`${dbPath}.missing`)).error, 'cursor_db_missing');
  assert.equal((await readAuthToken(dbPath)).error, 'cursor_token_missing');
});

test('an unreadable Cursor database returns a failure without a token', async (t) => {
  const dbPath = fixture(t);
  fs.writeFileSync(dbPath, 'invalid sqlite database');
  const result = await readAuthToken(dbPath);
  assert.equal(result.error, 'cursor_db_read_failed');
  assert.equal(Object.hasOwn(result, 'token'), false);
});

test('encrypted Cursor login is decoded before use; failed decoding preserves detection and database bytes', async t => {
  const value = 'cursor-safe-storage:v1:fixture-ciphertext';
  const dbPath = fixture(t, [['cursorAuth/accessToken', value]]);
  const before = fs.readFileSync(dbPath);
  const decoded = await readAuthToken(dbPath, { force: true, decryptToken: (stored, options) => {
    assert.equal(stored, value); assert.equal(options.dbPath, dbPath); assert.equal(options.force, true);
    return 'fixture-plaintext-token';
  } });
  assert.equal(decoded.token, 'fixture-plaintext-token');
  for (const decryptToken of [() => { throw new Error('private password'); }, () => value]) {
    const result = await readAuthToken(dbPath, { decryptToken });
    assert.equal(result.ok, false); assert.equal(result.detected, true);
    assert.equal(result.error, 'cursor_token_decrypt_failed');
    assert(!JSON.stringify(result).includes(value)); assert(!JSON.stringify(result).includes('private password'));
  }
  assert.deepEqual(fs.readFileSync(dbPath), before);
});

const { createCursorUsageService, buildSnapshot } = require('../cursor-usage');
for (const create of [createCursorUsageService, require('../grokbot-usage').createGrokbotUsageService]) {
  test(`${create.name}: clearing credentials during an async login read cannot start a stale request`, async () => {
    let finish, calls = 0;
    const service = create({ readAuth: () => new Promise(resolve => { finish = resolve; }), fetchImpl: async () => { calls++; throw Error(); } });
    const result = service.getUsage(); service.reset();
    finish({ ok: true, token: 'fixture-old-token' });
    assert.deepEqual(await result, { superseded: true }); assert.equal(calls, 0);
  });
  test(`${create.name}: an older delayed login read cannot replace a newer signed-out account`, async () => {
    let finish, reads = 0, calls = 0;
    const service = create({ readAuth: () => ++reads === 1 ? new Promise(resolve => { finish = resolve; }) : { ok: false },
      fetchImpl: async () => { calls++; throw Error(); } });
    const result = service.getUsage(); await service.getUsage();
    finish({ ok: true, token: 'fixture-old-token' });
    assert.deepEqual(await result, { superseded: true }); assert.equal(calls, 0);
  });
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const signedOut = () => ({ ok: false, error: 'cursor_token_missing' });
const period = percent => ({ planUsage: { autoPercentUsed: percent, apiPercentUsed: 20 } });
function fetcher(handler) { return async (_url, options) => handler(options); }

test('Cursor preserves unknown percentages instead of fabricating full remaining quota', () => {
  for (const value of [null, undefined, '', ' ', true, false, 'bad', Infinity]) {
    const data = buildSnapshot({ planUsage: { autoPercentUsed: value, apiPercentUsed: value } }, {});
    assert.equal(data.auto.percent, null); assert.equal(data.other.percent, null);
    assert.equal(data.grokBot, undefined);
  }
  assert.equal(buildSnapshot(period(0), {}).auto.percent, 0);
});
test('Cursor cache fingerprints the whole token and never leaks credentials', async () => {
  let calls = 0;
  const service = createCursorUsageService({ readAuth: signedOut, fetchImpl: fetcher(async options => {
    calls++; assert.equal(options.redirect, 'error');
    return response(period(options.headers.Authorization.endsWith('A') ? 10 : 80));
  }) });
  assert.equal((await service.getUsage({ manualToken: 'identical-prefix-A' })).auto.percent, 10);
  const b = await service.getUsage({ manualToken: 'identical-prefix-B' });
  assert.equal(b.auto.percent, 80); assert.equal(calls, 2);
  assert.equal(JSON.stringify(b).includes('identical-prefix'), false);
  assert.equal((await service.getUsage({ manualToken: 'identical-prefix-B' })).cached, true);
});
test('Cursor period usage no longer embeds Grok Bot sand pool', async () => {
  const service = createCursorUsageService({ readAuth: signedOut, fetchImpl: async () => response(period(42)) });
  const result = await service.getUsage({ manualToken: 'fixture' });
  assert.equal(result.ok, true); assert.equal(result.auto.percent, 42);
  assert.equal(result.grokBot, undefined); assert.equal(result.poolWarnings, undefined);
});
test('Cursor transient failure keeps original data/time, while invalid credentials clear it', async () => {
  let time = 100000, status = 200;
  const service = createCursorUsageService({ readAuth: signedOut, now: () => time,
    fetchImpl: fetcher(async () => response(period(40), status)) });
  const first = await service.getUsage({ manualToken: 'fixture' });
  status = 503; time += 61000;
  const stale = await service.getUsage({ manualToken: 'fixture' });
  assert.equal(stale.stale, true); assert.equal(stale.fetchedAt, first.fetchedAt); assert.equal(stale.auto.percent, 40);
  status = 401;
  const invalid = await service.getUsage({ manualToken: 'fixture', force: true });
  assert.equal(invalid.ok, false); assert.equal(invalid.manualTokenInvalid, true); assert.equal(invalid.auto, undefined);
});
test('Cursor local account switches and sign-out bypass fresh cache', async () => {
  let token = 'A';
  const service = createCursorUsageService({ readAuth: () => token ? { ok: true, token } : signedOut(),
    fetchImpl: fetcher(async options => response(period(options.headers.Authorization.endsWith('A') ? 10 : 80))) });
  assert.equal((await service.getUsage()).auto.percent, 10);
  token = 'B'; assert.equal((await service.getUsage()).auto.percent, 80);
  token = ''; const out = await service.getUsage(); assert.equal(out.ok, false); assert.equal(out.auto, undefined);
});
test('Cursor concurrent reads share requests; account switch aborts and discards late results', async () => {
  let finish, signal, calls = 0;
  const service = createCursorUsageService({ readAuth: signedOut, fetchImpl: fetcher(async options => {
    calls++;
    if (options.headers.Authorization.endsWith('old')) { signal = options.signal; return new Promise(resolve => { finish = resolve; }); }
    return response(period(80));
  }) });
  const old = service.getUsage({ manualToken: 'old' });
  const shared = service.getUsage({ manualToken: 'old' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  const fresh = await service.getUsage({ manualToken: 'new' });
  assert.equal(signal.aborted, true); assert.equal(fresh.auto.percent, 80);
  finish(response({}, 401));
  assert.deepEqual(await old, { superseded: true }); assert.deepEqual(await shared, { superseded: true });
  assert.equal((await service.getUsage({ manualToken: 'new' })).auto.percent, 80);
});
test('Cursor error bodies and exception messages cannot leak tokens over IPC', async () => {
  const secret = 'fixture-secret-token';
  const service = createCursorUsageService({ readAuth: signedOut, fetchImpl: async () => { throw new Error(secret); } });
  assert.equal(JSON.stringify(await service.getUsage({ manualToken: secret })).includes(secret), false);
});
test('Cursor credential reset cancels a request started in the same event turn', async () => {
  let finish, signal;
  const service = createCursorUsageService({ readAuth: signedOut, fetchImpl: fetcher(async options => {
    signal = options.signal; return new Promise(resolve => { finish = resolve; });
  }) });
  const result = service.getUsage({ manualToken: 'fixture' });
  service.reset(); assert.equal(signal.aborted, true);
  finish(response(period(20))); assert.deepEqual(await result, { superseded: true });
});
test('Cursor invalid state survives transient retries until login/token changes', async () => {
  let status = 401;
  const service = createCursorUsageService({ readAuth: signedOut, fetchImpl: fetcher(async () => response({}, status)) });
  assert.equal((await service.getUsage({manualToken:'fixture'})).manualTokenInvalid,true);
  status = 503;
  assert.equal((await service.getUsage({manualToken:'fixture',force:true})).manualTokenInvalid,true);
  assert.equal((await service.getUsage({manualToken:'new-fixture',force:true})).manualTokenInvalid,false);
});


test('Cursor period snapshots preserve the API billing timestamp down to seconds', () => {
  const time = new Date(2026, 9, 28, 13, 4, 9).getTime();
  for (const value of [time, String(time), time / 1000]) {
    const data = buildSnapshot({ billingCycleEnd: value }, {});
    assert.equal(data.billing.cycleEnd, new Date(time).toISOString());
  }
  assert.equal(buildSnapshot({ billingCycleEnd: 'invalid' }, {}).billing.cycleEnd, null);
});

const { createGrokbotUsageService } = require('../grokbot-usage');
const D = require('../renderer/ai-usage-domain');
for (const [provider, create, body] of [['cursor', createCursorUsageService, period(40)],
  ['grokbot', createGrokbotUsageService, { usagePercent: 25 }]]) {
  test(`${provider}: legacy saved ciphertext is ignored and successful local fallback remains visible`, async () => {
    const requests = [];
    const service = create({ readAuth: () => ({ ok: true, token: 'fixture-local' }), fetchImpl: fetcher(async options => {
      requests.push(options.headers.Authorization);
      if (options.headers.Authorization.endsWith('fixture-expired')) return response({}, 401);
      assert.equal(options.headers.Authorization, 'Bearer fixture-local'); return response(body);
    }) });
    const recovered = await service.getUsage({ manualToken: 'fixture-expired' });
    assert.equal(recovered.ok, true); assert.equal(recovered.authSource, 'local');
    assert.equal(recovered.manualTokenInvalid, false); assert(recovered.warning);
    assert.notEqual(D.status({ ...recovered, detected: true }, provider), 'error');
    requests.length = 0;
    const encrypted = await service.getUsage({ manualToken: 'cursor-safe-storage:v1:fixture-ciphertext', force: true });
    assert.equal(encrypted.ok, true); assert.deepEqual(requests, ['Bearer fixture-local']);
  });
  test(`${provider}: a locked encrypted login returns a repairable failure without network traffic`, async () => {
    let calls = 0;
    const service = create({ readAuth: () => ({ ok: false, detected: true, error: 'cursor_token_decrypt_failed' }),
      fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
    const result = await service.getUsage({ manualToken: 'cursor-safe-storage:v1:fixture-ciphertext' });
    assert.equal(result.ok, false); assert.equal(result.error, 'cursor_token_decrypt_failed'); assert.equal(calls, 0);
    assert.equal(result.manualTokenInvalid, false);
    const summary = D.miniSummary({ [provider]: { ...result, detected: true } });
    assert.equal(summary.repair, provider); assert.equal(summary.retry, undefined);
    assert(summary.text.includes('读取受限'));
  });
}
