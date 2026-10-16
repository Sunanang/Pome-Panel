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

test('Cursor credentials are read from SQLite without changing the database', (t) => {
  const dbPath = fixture(t, [['cursorAuth/accessToken', 'fixture-cursor-token']]);
  const before = fs.readFileSync(dbPath);
  const result = readAuthToken(dbPath);
  assert.equal(result.ok, true);
  assert.equal(result.token, 'fixture-cursor-token');
  assert.deepEqual(fs.readFileSync(dbPath), before);
});

test('missing Cursor install and signed-out Cursor have distinct results', (t) => {
  const dbPath = fixture(t);
  assert.equal(readAuthToken(`${dbPath}.missing`).error, 'cursor_db_missing');
  assert.equal(readAuthToken(dbPath).error, 'cursor_token_missing');
});

test('an unreadable Cursor database returns a failure without a token', (t) => {
  const dbPath = fixture(t);
  fs.writeFileSync(dbPath, 'invalid sqlite database');
  const result = readAuthToken(dbPath);
  assert.equal(result.error, 'cursor_db_read_failed');
  assert.equal(Object.hasOwn(result, 'token'), false);
});

const { createCursorUsageService, buildSnapshot } = require('../cursor-usage');
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const signedOut = () => ({ ok: false, error: 'cursor_token_missing' });
const period = percent => ({ planUsage: { autoPercentUsed: percent, apiPercentUsed: 20 } });
function fetcher(handler) { return async (url, options) => url.endsWith('GetSandUsageStatus') ? response({ usagePercent: 30 }) : handler(options); }

test('Cursor preserves unknown percentages instead of fabricating full remaining quota', () => {
  for (const value of [null, undefined, '', ' ', true, false, 'bad', Infinity]) {
    const data = buildSnapshot({ planUsage: { autoPercentUsed: value, apiPercentUsed: value } }, null, {});
    assert.equal(data.auto.percent, null); assert.equal(data.other.percent, null); assert.equal(data.grokBot.percent, null);
  }
  assert.equal(buildSnapshot(period(0), {}, {}).auto.percent, 0);
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
test('optional Grok failure preserves Cursor main pools and exposes a pool warning', async () => {
  const service = createCursorUsageService({ readAuth: signedOut, fetchImpl: async url =>
    url.endsWith('GetSandUsageStatus') ? response({}, 503) : response(period(42)) });
  const result = await service.getUsage({ manualToken: 'fixture' });
  assert.equal(result.ok, true); assert.equal(result.auto.percent, 42);
  assert.equal(result.grokBot.percent, null); assert.ok(result.poolWarnings.grokBot);
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
