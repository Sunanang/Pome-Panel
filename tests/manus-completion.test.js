'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManusApi } = require('../manusApi');
const {
  reduceTaskSnapshot, completionIdentity, taskOpenUrl, matchesOfficialTaskUrl, normalizeListTask,
} = require('../manusCompletionAdapter');
const { createManusCompletionStore } = require('../manusCompletionStore');
const { createManusCompletionService } = require('../manusCompletionService');
const { classifyAiEvent, MANUS_TRUSTED_ADAPTER } = require('../aiEventPolicy');
const catalog = require('../aiProviderCatalog');
const { normalizeSyncedCompletion } = require('../packages/sync-protocol/ai-completions');

const userMe = require('./fixtures/manus-user-me.json');
const taskList = require('./fixtures/manus-task-list.json');
const detail = require('./fixtures/manus-task-detail-stopped.json');
const completed = require('./fixtures/manus-messages-completed.json');
const failed = require('./fixtures/manus-messages-failed.json');
const cancelled = require('./fixtures/manus-messages-user-stop.json');
const waiting = require('./fixtures/manus-messages-waiting.json');
const background = require('./fixtures/manus-messages-background.json');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-manus-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('catalog marks Manus completion partial without opening HTTP notify', () => {
  assert.equal(catalog.get('manus').capabilities.completion, 'partial');
  assert.equal(catalog.get('manus').hookable, false);
  assert.equal(catalog.get('manus').connection, 'api');
  assert.ok(catalog.completionIds().includes('manus'));
  assert.ok(!catalog.httpNotifyIds().includes('manus'));
  assert.ok(catalog.httpNotifyIds().includes('claude'));
});

test('sync allowlist accepts manus completion history', () => {
  const row = normalizeSyncedCompletion({
    id: 'local-1', source: 'manus', receivedAt: 1, readAt: null,
    completionEventId: 'abc', title: 'Done', status: 'completed', taskId: 'task_1',
  });
  assert.equal(row.source, 'manus');
  assert.equal(row.taskId, 'task_1');
});

test('API client refuses redirects, budgets endpoints, and parses official shapes', async () => {
  const calls = [];
  const api = createManusApi({
    budgetPerMinute: 2,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['x-manus-api-key'], 'secret-key');
      if (String(url).includes('user.me')) {
        return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(userMe) };
      }
      if (String(url).includes('task.list')) {
        return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(taskList) };
      }
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(detail) };
    },
  });
  const me = await api.userMe('secret-key');
  assert.equal(me.userId, 'user_fixture_manus_001');
  assert.match(me.accountKey, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(me).includes('fixture@example.invalid'));
  const list = await api.taskList('secret-key');
  assert.equal(list.tasks.length, 4);
  assert.equal((await api.taskList('secret-key')).tasks.length, 4);
  await assert.rejects(() => api.taskList('secret-key'), (error) => error.code === 'manus_rate_budget');
});

test('adapter emits stable identities for completed turns and ignores subtasks/waiting/cancel', () => {
  const accountKey = 'account';
  const done = reduceTaskSnapshot({
    accountKey,
    task: detail.task,
    messages: completed.messages,
    listenStartedAtMs: 1,
  });
  assert.equal(done.action, 'emit');
  assert.equal(done.event.kind, 'turn.completed');
  assert.equal(done.event.completionSummary, 'Release notes summarized into three bullets.');
  assert.equal(done.event.eventId, completionIdentity(accountKey, 'task_fixture_done', 'evt_stop_1'));
  assert.equal(done.event.evidence.adapter, MANUS_TRUSTED_ADAPTER);

  assert.equal(normalizeListTask(taskList.data.find((row) => row.task_type === 'agent_subtask')), null);

  assert.equal(reduceTaskSnapshot({
    accountKey, task: { id: 'task_fixture_waiting', status: 'waiting', task_type: 'standard', title: 'Wait' },
    messages: waiting.messages, listenStartedAtMs: 1,
  }).action, 'track');

  assert.equal(reduceTaskSnapshot({
    accountKey, task: { id: 'task_fixture_cancelled', status: 'stopped', task_type: 'standard', title: 'Cancel', has_running_background_jobs: false },
    messages: cancelled.messages, listenStartedAtMs: 1,
  }).action, 'cancel');

  const fail = reduceTaskSnapshot({
    accountKey, task: { id: 'task_fixture_failed', status: 'error', task_type: 'standard', title: 'Fail', has_running_background_jobs: false },
    messages: failed.messages, listenStartedAtMs: 1,
  });
  assert.equal(fail.action, 'emit');
  assert.equal(fail.event.kind, 'turn.failed');

  assert.equal(reduceTaskSnapshot({
    accountKey, task: { id: 'task_fixture_bg', status: 'stopped', task_type: 'standard', title: 'BG', has_running_background_jobs: true },
    messages: background.messages, listenStartedAtMs: 1,
  }).internal, 'background');

  const baseline = reduceTaskSnapshot({
    accountKey, task: detail.task, messages: completed.messages, listenStartedAtMs: 1760922300001,
  });
  assert.equal(baseline.action, 'baseline');
});

test('official task URLs are constructed safely', () => {
  assert.equal(taskOpenUrl('task_abc'), 'https://manus.im/app/task_abc');
  assert.equal(taskOpenUrl('task/../evil'), null);
  assert.equal(matchesOfficialTaskUrl('https://manus.im/app/task_abc', 'task_abc'), true);
  assert.equal(matchesOfficialTaskUrl('https://evil.example/app/task_abc', 'task_abc'), false);
});

test('trusted policy accepts Manus API events only with main-process adapter context', () => {
  const event = reduceTaskSnapshot({
    accountKey: 'account', task: detail.task, messages: completed.messages, listenStartedAtMs: 1,
  }).event;
  assert.equal(classifyAiEvent(event, 'manus').category, 'ignore');
  assert.equal(classifyAiEvent(event, 'manus', { trustedAdapter: MANUS_TRUSTED_ADAPTER }).category, 'completion');
  assert.equal(classifyAiEvent({ ...event, evidence: { ...event.evidence, adapter: 'forged' } }, 'manus', {
    trustedAdapter: MANUS_TRUSTED_ADAPTER,
  }).category, 'ignore');
});

test('store keeps outbox durable across reopen and respects backlog limit', (t) => {
  const dir = tempDir(t);
  const dbPath = path.join(dir, 'manus-completions.db');
  let store = createManusCompletionStore({ dbPath });
  store.setEnabled(true);
  store.beginListenPeriod('acct', 1000);
  const event = {
    eventId: 'e1', taskId: 'task_1', sessionId: 'task_1', kind: 'turn.completed', source: 'manus',
  };
  assert.equal(store.enqueue('acct', event).ok, true);
  assert.equal(store.enqueue('acct', event).duplicate, true);
  store.close();
  store = createManusCompletionStore({ dbPath });
  assert.equal(store.enabled(), true);
  assert.equal(store.listPending('acct')[0].eventId, 'e1');
  store.confirm('acct', 'e1');
  assert.equal(store.listPending('acct').length, 0);
  store.close();
});

test('service discovers completions through injected API and delivers once', async (t) => {
  const dir = tempDir(t);
  const delivered = [];
  const api = createManusApi({
    fetchImpl: async (url) => {
      const target = String(url);
      let body = taskList;
      if (target.includes('user.me')) body = userMe;
      else if (target.includes('task.listMessages')) {
        const id = new URL(target).searchParams.get('task_id');
        body = id === 'task_fixture_done' ? completed : {
          ok: true, request_id: 'msg', task_id: id, messages: [
            { id: 'evt_run', type: 'status_update', timestamp: 1760925660000, status_update: { agent_status: 'running' } },
          ], has_more: false,
        };
      } else if (target.includes('task.detail')) {
        const id = new URL(target).searchParams.get('task_id');
        const row = taskList.data.find((item) => item.id === id) || detail.task;
        body = { ok: true, request_id: 'detail', task: row };
      } else if (target.includes('task.list')) body = taskList;
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify(body) };
    },
  });
  const store = createManusCompletionStore({ dbPath: path.join(dir, 'manus-completions.db') });
  const timers = [];
  const service = createManusCompletionService({
    userDataPath: dir,
    getToken: () => 'secret-key',
    api,
    store,
    now: () => 1760921000000,
    setTimeoutFn: (fn) => { timers.push(fn); return 1; },
    clearTimeoutFn: () => {},
    deliverEvent: async (event) => { delivered.push(event); return 'accepted'; },
  });
  const enabled = await service.setListening(true);
  assert.equal(enabled.ok, true);
  await service.tick();
  assert.ok(delivered.length >= 1);
  assert.equal(delivered[0].source, 'manus');
  assert.equal(delivered[0].taskId, 'task_fixture_done');
  const before = delivered.length;
  await service.tick();
  assert.equal(delivered.length, before);
  await service.stop({ disable: true });
  service.close();
});
