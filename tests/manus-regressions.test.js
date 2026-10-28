'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManusApi } = require('../manusApi');
const { createManusCompletionStore } = require('../manusCompletionStore');
const { createManusCompletionService } = require('../manusCompletionService');
const { reduceTaskSnapshot, buildTrustedEvent } = require('../manusCompletionAdapter');

const task = (id = 't') => ({ id, task_type: 'standard', status: 'stopped', title: 'Task', has_running_background_jobs: false, updated_at: 3 });
const messages = (suffix = '', at = 2000) => [
  { id: `user${suffix}`, type: 'user_message', timestamp: at, user_message: { content: 'Do work' } },
  { id: `result${suffix}`, type: 'assistant_message', timestamp: at + 100, assistant_message: { content: `Result${suffix}`, delivery_kind: 'result' } },
  { id: `stop${suffix}`, type: 'status_update', timestamp: at + 200, status_update: { agent_status: 'stopped' } },
];
function harness(t, { tasks = [task()], delivery = 'queued', budget = 20, pageSize = 50 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-manus-regression-'));
  let clock = 1000, user = 'account-a', broken = false, details = 0;
  const histories = new Map(tasks.map(row => [row.id, messages()]));
  const delivered = [], requests = [], delays = [];
  const api = createManusApi({ now: () => clock, budgetPerMinute: budget, fetchImpl: async (address, options) => {
    const url = new URL(address); requests.push(url);
    if (broken) throw new Error('simulated network failure');
    let body;
    if (url.pathname.endsWith('user.me')) body = { ok: true, user_id: user };
    else if (url.pathname.endsWith('task.list')) {
      const offset = Number(url.searchParams.get('cursor') || 0);
      body = { ok: true, data: tasks.slice(offset, offset + 100), has_more: offset + 100 < tasks.length, next_cursor: String(offset + 100) };
    } else if (url.pathname.endsWith('task.detail')) {
      details++; body = { ok: true, task: tasks.find(row => row.id === url.searchParams.get('task_id')) };
    } else {
      const id = url.searchParams.get('task_id'), all = histories.get(id) || [];
      const start = url.searchParams.get('start_event_id');
      const offset = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : start ? Math.max(0, all.findIndex(row => row.id === start)) : 0;
      const limit = Math.min(pageSize, Number(url.searchParams.get('limit')));
      body = { ok: true, task_id: id, messages: all.slice(offset, offset + limit), has_more: offset + limit < all.length, next_cursor: String(offset + limit) };
    }
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(body));
  } });
  const store = createManusCompletionStore({ dbPath: path.join(dir, 'manus.db'), now: () => clock });
  const service = createManusCompletionService({ userDataPath: dir, api, store, now: () => clock,
    getToken: () => `fixture-${user}`, setTimeoutFn: (_fn, delay) => { delays.push(delay); return 1; }, clearTimeoutFn: () => {},
    deliverEvent: async event => { delivered.push(event); return delivery; } });
  const resources = [service];
  t.after(() => { for (const resource of resources.reverse()) resource.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, store, tasks, histories, delivered, requests, delays, dir, resources,
    advance(ms) { clock += ms; },
    get details() { return details; }, setUser(value) { user = value; }, setBroken(value) { broken = value; },
    async tick(count = 1) { for (let i = 0; i < count; i++) { clock += 61000; await service.tick(); } },
  };
}

test('25 tasks make fair progress under budget and pending delivery survives network errors', async t => {
  const h = harness(t, { tasks: Array.from({ length: 25 }, (_, i) => task(`t${i}`)) });
  await h.service.setListening(true); await h.tick(12);
  assert.equal(new Set(h.delivered.map(row => row.taskId)).size, 25);
  assert.equal(h.service.status().backlogCount, 0);
  const key = h.store.getMeta('current_account');
  h.store.enqueue(key, { eventId: 'persisted-before-offline', taskId: 't', source: 'manus' });
  h.setBroken(true); await h.tick();
  assert.ok(h.delivered.some(row => row.eventId === 'persisted-before-offline'));
  assert.equal(h.service.status().connectionState, 'network_error');
});

test('background completion retains its terminal across trailing messages and restart', async t => {
  const row = { ...task(), has_running_background_jobs: true }, h = harness(t, { tasks: [row] });
  h.histories.set('t', [...messages(), { id: 'tail', type: 'assistant_message', timestamp: 2500, assistant_message: { content: 'Background progress', delivery_kind: 'progress' } }]);
  await h.service.setListening(true); await h.tick(); assert.equal(h.delivered.length, 0);
  await h.service.stop(); row.has_running_background_jobs = false;
  await h.service.start(); await h.tick(2);
  assert.equal(h.delivered.length, 1); assert.equal(h.delivered[0].completionSummary, 'Result');
});

test('missing background metadata retries without consuming the terminal', async t => {
  const row = task(); delete row.has_running_background_jobs;
  const h = harness(t, { tasks: [row] }); await h.service.setListening(true); await h.tick();
  assert.equal(h.delivered.length, 0); row.has_running_background_jobs = false; await h.tick(2);
  assert.equal(h.delivered.length, 1);
});

test('long message pagination resumes across ticks and reaches a terminal beyond 1000 messages', async t => {
  const h = harness(t, { pageSize: 50 });
  h.histories.set('t', [...Array.from({ length: 1050 }, (_, i) => ({ id: `p${i}`, type: 'assistant_message', timestamp: 2000 + i,
    assistant_message: { content: 'Progress', delivery_kind: 'progress' } })), ...messages('-long', 4000)]);
  await h.service.setListening(true); await h.tick(35);
  assert.equal(h.delivered.length, 1); assert.equal(h.delivered[0].completionSummary, 'Result-long');
  assert.ok(h.requests.some(url => url.pathname.endsWith('task.listMessages') && Number(url.searchParams.get('cursor')) >= 1000));
});

test('same account credentials preserve listen period, pending work and completed identity', async t => {
  const h = harness(t, { delivery: 'save_failed' }); await h.service.setListening(true); await h.tick();
  const before = h.store.getAccount(h.store.getMeta('current_account'));
  assert.equal(h.service.status().backlogCount, 1);
  await h.service.setListening(true);
  assert.equal(h.store.getAccount(h.store.getMeta('current_account')).listenStartedAt, before.listenStartedAt);
  assert.equal(h.service.status().backlogCount, 1);
});

test('switching accounts does not deliver another account outbox', async t => {
  const h = harness(t); await h.service.setListening(true);
  const key = h.store.getMeta('current_account');
  h.store.enqueue(key, { eventId: 'private-a', taskId: 't', source: 'manus' });
  h.setUser('account-b'); await h.service.refreshCredentials(); await h.tick();
  assert.ok(!h.delivered.some(row => row.eventId === 'private-a'));
});

test('queued success is acknowledged immediately, and confirmed payloads are removed', async t => {
  const h = harness(t); await h.service.setListening(true); await h.tick();
  assert.equal(h.delivered.length, 1); assert.equal(h.service.status().backlogCount, 0);
  const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(h.store.dbPath);
  h.resources.push(db);
  assert.equal(db.prepare("SELECT count(*) n FROM outbox WHERE status='confirmed' AND payload_json != '{}'").get().n, 0);
});

test('secret task names never enter task state, pending events, or synced history', async t => {
  const h = harness(t, { tasks: [{ ...task(), title: 'api_key=TEST_SECRET_SENTINEL_123456789' }], delivery: 'save_failed' });
  await h.service.setListening(true); await h.tick();
  assert.ok(!JSON.stringify(h.delivered).includes('TEST_SECRET_SENTINEL'));
  assert.ok(!fs.readFileSync(h.store.dbPath).includes(Buffer.from('TEST_SECRET_SENTINEL')));
});

test('summary and cancellation searches cannot cross a terminal boundary', () => {
  const verdict = reduceTaskSnapshot({ accountKey: 'a', task: task(), messages: [...messages(),
    { id: 'run2', type: 'status_update', timestamp: 3000, status_update: { agent_status: 'running' } },
    { id: 'stop2', type: 'status_update', timestamp: 3500, status_update: { agent_status: 'stopped' } }],
  alreadyEmittedTerminalIds: new Set(['stop']), listenStartedAtMs: 1 });
  assert.equal(verdict.action, 'emit'); assert.equal(verdict.event.completionSummary, '');
  assert.equal(buildTrustedEvent({ accountKey: 'a', task: { id: 't', title: 'Bearer ABC_TEST_SECRET' }, terminalEventId: 'e', occurredAt: 1 }).sessionTitle, '');
});

test('HTTP auth status wins over business spelling; streamed response cap cancels reading', async () => {
  for (const status of [401, 403]) {
    const api = createManusApi({ fetchImpl: async () => new Response('{"ok":false,"error":{"code":"other"}}', { status }) });
    await assert.rejects(api.userMe('fixture'), error => error.code === (status === 401 ? 'manus_unauthenticated' : 'manus_permission_denied'));
  }
  let cancelled = false;
  const api = createManusApi({ maxBodyBytes: 10, fetchImpl: async () => ({ ok: true, status: 200, headers: new Map(), body: new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; },
  }) }) });
  await assert.rejects(api.userMe('fixture'), error => error.code === 'manus_body_too_large'); assert.equal(cancelled, true);
});

test('mismatched task messages and missing pagination cursors are rejected', async () => {
  let body = { ok: true, task_id: 'other', messages: [], has_more: false };
  const api = createManusApi({ fetchImpl: async () => new Response(JSON.stringify(body)) });
  await assert.rejects(api.listMessages('fixture', 't'), /manus_invalid_messages/);
  body = { ok: true, data: [], has_more: true };
  await assert.rejects(api.taskList('fixture'), /manus_invalid_cursor/);
  await assert.rejects(api.taskDetail('fixture', 'x'.repeat(161)), /manus_invalid_task_id/);
  body = { ok: true, task_id: 't', messages: [{ id: 'stop', type: 'status_update', timestamp: null }], has_more: false };
  await assert.rejects(api.listMessages('fixture', 't'), /manus_invalid_messages/);
  body = { ok: true, task_id: 't', messages: [], has_more: true, next_cursor: 'same' };
  await assert.rejects(api.listMessages('fixture', 't', { cursor: 'same' }), /manus_invalid_cursor/);
});

test('disabled during identity lookup cannot be re-enabled by the late response', async t => {
  const h = harness(t); let resolve;
  h.service._api.userMe = () => new Promise(done => { resolve = done; });
  const enabling = h.service.setListening(true); await h.service.setListening(false);
  resolve({ accountKey: 'late' }); await enabling;
  assert.equal(h.service.status().enabled, false); assert.equal(h.store.getAccount('late'), null);
});

test('background candidates survive closing and reopening the actual database', async t => {
  const h = harness(t, { tasks: [{ ...task(), has_running_background_jobs: true }] });
  await h.service.setListening(true); await h.tick();
  const dbPath = h.store.dbPath, api = h.service._api;
  h.service.close(); h.tasks[0].has_running_background_jobs = false;
  const reopened = createManusCompletionStore({ dbPath, now: () => 200000 }), delivered = [];
  const service = createManusCompletionService({ userDataPath: h.dir, store: reopened, api, now: () => 200000,
    getToken: () => 'fixture-account-a', setTimeoutFn: () => 1, clearTimeoutFn: () => {},
    deliverEvent: async event => { delivered.push(event); return 'queued'; } });
  try { await service.start(); await service.tick(); assert.equal(delivered.length, 1); }
  finally { service.close(); }
});

test('terminal outbox and checkpoint changes roll back together; full backlog still recognizes duplicates', async t => {
  const h = harness(t); await h.service.setListening(true);
  const account = h.store.getMeta('current_account');
  assert.throws(() => h.store.runInTransaction(() => {
    h.store.enqueue(account, { eventId: 'rolled-back', taskId: 't' });
    h.store.saveTask({ accountKey: account, taskId: 't', lastEventId: 'not-committed' });
    throw new Error('injected disk failure');
  }), /injected disk failure/);
  assert.equal(h.store.getTask(account, 't'), null); assert.equal(h.store.listPending(account).length, 0);
  h.store.runInTransaction(() => { for (let i = 0; i < 1000; i++) h.store.enqueue(account, { eventId: 'backlog-' + i, taskId: 't', title: 'Result ' + i }); });
  assert.equal(h.store.enqueue(account, { eventId: 'overflow', taskId: 't' }).error, 'outbox_backlog');
  assert.equal(h.store.enqueue(account, { eventId: 'backlog-0', taskId: 't' }).duplicate, true);
  h.store.runInTransaction(() => { for (let i = 0; i < 1000; i++) h.store.confirm(account, 'backlog-' + i); });
  assert.equal(h.store.listPending(account).length, 0);
});

test('multiple turns complete once each; cancelled turns and older results are never reused', async t => {
  const h = harness(t);
  h.histories.set('t', [...messages('-one'),
    { id: 'u-cancel', type: 'user_message', timestamp: 3000, user_message: { content: 'Cancel this' } },
    { id: 'cancel', type: 'user_stop', timestamp: 3100 },
    { id: 'stop-cancel', type: 'status_update', timestamp: 3200, status_update: { agent_status: 'stopped' } },
    ...messages('-two', 4000)]);
  await h.service.setListening(true); await h.tick(2);
  assert.equal(h.delivered.length, 2);
  assert.deepEqual(h.delivered.map(row => row.completionSummary), ['Result-one', 'Result-two']);
});

test('unknown or contradictory current state never consumes a terminal candidate', async t => {
  const h = harness(t);
  h.histories.set('t', [...messages(), { id: 'new-run', type: 'status_update', timestamp: 3000, status_update: { agent_status: 'running' } }]);
  await h.service.setListening(true); await h.tick(); assert.equal(h.delivered.length, 0);
  h.histories.get('t').push(...messages('-next', 4000)); await h.tick(2);
  assert.equal(h.delivered.length, 2);
});

test('sync projections strip Manus secrets while preserving ordinary JSON and other sources', () => {
  const { normalizeSyncedCompletion } = require('../packages/sync-protocol/ai-completions');
  const base = { id: 'r', source: 'manus', receivedAt: 1, readAt: null, title: '{"items":[1,2]}', sessionTitle: 'api_key=TEST_ONLY_SECRET' };
  const normalized = normalizeSyncedCompletion(base);
  assert.equal(normalized.sessionTitle, ''); assert.equal(normalized.title, base.title);
  assert.equal(normalizeSyncedCompletion({ ...base, source: 'claude' }).sessionTitle, base.sessionTitle);
});

test('ignored delivery acknowledges the row so later pending events still deliver', async t => {
  const results = new Map();
  const h = harness(t, { tasks: [], delivery: 'queued' });
  const deliveredIds = [];
  h.service.close();
  const store = createManusCompletionStore({ dbPath: path.join(h.dir, 'manus.db'), now: () => 1000 });
  const api = createManusApi({ now: () => 70_000, budgetPerMinute: 20, fetchImpl: async (address) => {
    const url = new URL(address);
    let body;
    if (url.pathname.endsWith('user.me')) body = { ok: true, user_id: 'account-a' };
    else body = { ok: true, data: [], has_more: false };
    return new Response(JSON.stringify(body));
  } });
  const service = createManusCompletionService({
    userDataPath: h.dir, store, api, now: () => 70_000,
    getToken: () => 'fixture-account-a', setTimeoutFn: () => 1, clearTimeoutFn: () => {},
    deliverEvent: async event => {
      deliveredIds.push(event.eventId);
      return results.get(event.eventId) || 'queued';
    },
  });
  h.resources.push(service);
  await service.setListening(true);
  const key = store.getMeta('current_account');
  results.set('poison', 'ignored');
  results.set('survivor', 'queued');
  store.enqueue(key, { eventId: 'poison', taskId: 't-bad', source: 'manus', title: 'bad' });
  store.enqueue(key, { eventId: 'survivor', taskId: 't-good', source: 'manus', title: 'good' });
  await service.tick();
  assert.deepEqual(deliveredIds, ['poison', 'survivor']);
  assert.equal(service.status().backlogCount, 0);
});

test('empty summary schedules verifyAfter on nextPollAt instead of the active interval', async t => {
  const { VERIFY_SUMMARY_MS, DISCOVERY_ACTIVE_MS } = require('../manusCompletionService');
  const h = harness(t);
  h.histories.set('t', [
    { id: 'user', type: 'user_message', timestamp: 2000, user_message: { content: 'Do work' } },
    { id: 'stop', type: 'status_update', timestamp: 2200, status_update: { agent_status: 'stopped' } },
  ]);
  await h.service.setListening(true);
  await h.tick();
  const row = h.store.getTask(h.store.getMeta('current_account'), 't');
  assert.equal(h.delivered.length, 0);
  assert.ok(row.messageState?.verifyAfter);
  assert.equal(row.nextPollAt, row.messageState.verifyAfter);
  assert.ok(row.nextPollAt - row.lastPolledAt <= VERIFY_SUMMARY_MS);
  assert.ok(row.nextPollAt - row.lastPolledAt < DISCOVERY_ACTIVE_MS);
  // Trailing result after the stop updates the retained candidate once verifyAfter elapses.
  h.histories.get('t').push({
    id: 'late-result', type: 'assistant_message', timestamp: 2300,
    assistant_message: { content: 'Late result', delivery_kind: 'result' },
  });
  await h.tick();
  assert.equal(h.delivered.length, 1);
  assert.equal(h.delivered[0].completionSummary, 'Late result');
});

test('emittedTerminalIds block re-settlement even when outbox history is wiped', async t => {
  const h = harness(t);
  await h.service.setListening(true);
  await h.tick();
  assert.equal(h.delivered.length, 1);
  const key = h.store.getMeta('current_account');
  const row = h.store.getTask(key, 't');
  assert.deepEqual(row.emittedTerminalIds, ['stop']);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(h.store.dbPath);
  db.prepare('DELETE FROM outbox').run();
  db.close();
  h.store.saveTask({ ...row, lastEventId: '', messageState: null, nextPollAt: 0, emittedTerminalIds: row.emittedTerminalIds });
  await h.tick();
  assert.equal(h.delivered.length, 1);
  assert.deepEqual(h.store.getTask(key, 't').emittedTerminalIds, ['stop']);
});

test('confirmed identities are pruned while cold checkpoints are compacted without losing live work', async t => {
  const { CONFIRMED_OUTBOX_KEEP, TASK_RETENTION_MS } = require('../manusCompletionStore');
  let clock = 1_700_000_000_000; // Wall-clock-sized so retention subtraction stays positive.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-manus-prune-'));
  const resources = [];
  t.after(() => { for (const resource of resources.reverse()) resource.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const store = createManusCompletionStore({ dbPath: path.join(dir, 'manus.db'), now: () => clock });
  resources.push(store);
  store.beginListenPeriod('acc', clock);
  store.runInTransaction(() => {
    for (let i = 0; i < CONFIRMED_OUTBOX_KEEP + 25; i++) {
      store.enqueue('acc', { eventId: `old-${i}`, taskId: 't', source: 'manus', title: `R${i}` });
      store.confirm('acc', `old-${i}`);
    }
  });
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(store.dbPath);
  resources.push(db);
  assert.equal(db.prepare("SELECT count(*) n FROM outbox WHERE status='confirmed'").get().n, CONFIRMED_OUTBOX_KEEP);
  assert.equal(db.prepare("SELECT count(*) n FROM outbox WHERE event_id='old-0'").get().n, 0);
  assert.equal(db.prepare(`SELECT count(*) n FROM outbox WHERE event_id='old-${CONFIRMED_OUTBOX_KEEP + 24}'`).get().n, 1);

  clock = 1_700_000_000_000 - TASK_RETENTION_MS - 5_000;
  store.saveTask({
    accountKey: 'acc', taskId: 'cold', title: 'Cold', status: 'stopped', internalState: 'completed',
    hasBackground: false, backgroundKnown: true, lastPolledAt: clock, nextPollAt: Number.MAX_SAFE_INTEGER, messageState: null,
  });
  clock = 1_700_000_000_000;
  store.saveTask({
    accountKey: 'acc', taskId: 'live', title: 'Live', status: 'stopped', internalState: 'background',
    hasBackground: true, backgroundKnown: true, lastPolledAt: clock, nextPollAt: clock,
    messageState: { candidates: [{ id: 'stop' }], lastEventId: 'stop' },
  });
  store.saveTask({
    accountKey: 'acc', taskId: 'fresh-deleted', title: 'Gone', status: 'deleted', internalState: 'deleted',
    hasBackground: false, backgroundKnown: true, lastPolledAt: clock, nextPollAt: Number.MAX_SAFE_INTEGER, messageState: null,
  });
  const pruned = store.pruneRetention('acc');
  assert.equal(pruned.tasksDeleted, 0);
  assert.equal(pruned.tasksCompacted, 1);
  assert.equal(store.getTask('acc', 'cold').title, '');
  assert.ok(store.getTask('acc', 'live'));
  assert.ok(store.getTask('acc', 'fresh-deleted'));
});

test('due tasks cannot shorten server Retry-After or offline backoff', async t => {
  const h = harness(t); await h.service.setListening(true);
  const account = h.store.getMeta('current_account');
  h.store.saveTask({ accountKey: account, taskId: 'due', nextPollAt: 0, status: 'running', internalState: 'running' });
  h.service._api.taskList = async () => { throw Object.assign(new Error('rate limited'), { code: 'manus_rate_limited', status: 429, retryAfterMs: 120000 }); };
  await h.tick(); assert.ok(h.delays.at(-1) >= 120000, 'server delay must win over overdue work');
  h.service._api.taskList = async () => { throw new Error('offline'); };
  await h.tick(); assert.ok(h.delays.at(-1) >= 15000, 'network failure must not cause a 50ms retry loop');
});

test('cold checkpoint compaction prevents replay after confirmed identity eviction and task reappearance', async t => {
  const { CONFIRMED_OUTBOX_KEEP, TASK_RETENTION_MS } = require('../manusCompletionStore');
  const h = harness(t); await h.service.setListening(true); await h.tick();
  assert.equal(h.delivered.length, 1);
  const account = h.store.getMeta('current_account');
  h.advance(1);
  h.store.runInTransaction(() => { for (let i = 0; i <= CONFIRMED_OUTBOX_KEEP; i++) {
    h.store.enqueue(account, { eventId: 'filler-' + i, taskId: 'filler' }); h.store.confirm(account, 'filler-' + i);
  } });
  const oldTask = h.tasks.pop();
  h.advance(TASK_RETENTION_MS + 1000); await h.tick();
  h.tasks.push(oldTask); await h.tick(2);
  assert.equal(h.delivered.length, 1, 'an already processed old terminal must not become a fresh completion');
  assert.equal(h.store.getTask(account, 't').messageState.lastEventId, 'stop');
});
