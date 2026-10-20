'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS = '1';
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const usageModule = require('../manus-usage'), createUsage = usageModule.createManusUsageService;
usageModule.createManusUsageService = options => createUsage({ ...options,
  fetchImpl: async () => new Response(JSON.stringify({ ok: true, data: { total_credits: 60 } })),
});
const adapters = require('../platform-adapters'), loadAdapter = adapters.loadAdapter;
adapters.loadAdapter = (...args) => {
  const adapter = loadAdapter(...args);
  adapter.windows.list = async () => ({ items: [], error: null });
  return adapter;
};
let clock = Date.now(), offline = false, rateLimited = false, lastDelay = 0, tasks = [], messages = [], controller;
const opened = [];
shell.openExternal = async url => { opened.push(url); };
const serviceModule = require('../manusCompletionService'), create = serviceModule.createManusCompletionService;
serviceModule.createManusCompletionService = options => {
  controller = create({ ...options, now: () => clock, setTimeoutFn: (_fn, delay) => { lastDelay = delay; return 1; }, clearTimeoutFn: () => {}, fetchImpl: async address => {
    if (offline) throw new Error('fixture offline');
    if (rateLimited) return new Response('{"ok":false,"error":{"code":"rate_limited"}}', { status: 429, headers: { 'Retry-After': '120' } });
    const url = new URL(address); let body;
    if (url.pathname.endsWith('user.me')) body = { ok: true, user_id: 'fixture-manus-user' };
    else if (url.pathname.endsWith('task.list')) body = { ok: true, data: tasks, has_more: false };
    else if (!tasks.length) return new Response('{"ok":false,"error":{"code":"not_found"}}', { status: 404 });
    else if (url.pathname.endsWith('task.detail')) body = { ok: true, task: tasks[0] };
    else {
      const start = url.searchParams.get('start_event_id'), index = start ? Math.max(0, messages.findIndex(row => row.id === start)) : 0;
      body = { ok: true, task_id: tasks[0].id, messages: messages.slice(index), has_more: false };
    }
    return new Response(JSON.stringify(body));
  } });
  return controller;
};
const { createPersistentStore } = require('../fnos/app/server/persistentStore');
const nasStore = createPersistentStore({ filePath: path.join(profile, 'nas.bin'), serverId: 'manus-nas' });
const nas = require('../fnos/app/server/createApp').createApp({ listenMode: 'device-port', store: nasStore });
const listening = new Promise(resolve => nas.server.listen(0, '127.0.0.1', resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.join(__dirname, '..', 'dist.noindex', 'manus-completion');
fs.mkdirSync(output, { recursive: true });
let started = false;
const watchdog = setTimeout(() => { console.error('Manus completion integration timed out'); app.exit(1); }, 60000);
app.on('web-contents-created', (_event, content) => content.once('did-finish-load', () => {
  if (started || !content.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(content).then(() => { clearTimeout(watchdog); nas.server.close(); controller.close(); console.log('Manus settings, live status, completion/failure, source opening, private preview, NAS sync and retention passed'); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(content) {
  const js = code => content.executeJavaScript(code);
  async function until(code) { for (let i = 0; i < 350; i++) { if (await js(code)) return; await delay(20); } throw new Error('Timed out: ' + code); }
  await until('!!window.NotchAiSources?.getState().ready && !!window.NotchTaskInbox');
  await js('setMode(true)');
  await until('!modeBusy');
  await js("setActiveTab('settings')");
  await until("activeTab==='settings' && !tabBusy");
  assert.equal((await js("notchAPI.setAiProviderToken('manus','fixture-manus-key')")).ok, true);
  await until("!document.getElementById('settings-manus-completion-enabled').checked");
  await js("document.getElementById('settings-manus-completion-check').click()");
  await until("document.getElementById('settings-manus-completion-status').textContent===PomeI18n.t('providers.manus.connectionOk')");
  assert.equal(controller.status().enabled, false);
  await js("document.getElementById('settings-manus-completion-enabled').click()");
  await until("document.getElementById('settings-manus-completion-enabled').checked && !document.getElementById('settings-manus-completion-enabled').disabled");
  await controller.tick();
  await until("document.querySelector('.ai-source-row[data-source=manus]').dataset.state==='connected'");
  await js("document.getElementById('settings-manus-token-card').scrollIntoView({block:'center'})");
  await delay(250);
  fs.writeFileSync(path.join(output, 'settings-connected.png'), (await content.capturePage()).toPNG());
  const startedAt = clock;
  tasks = [{ id: 'manus-primary', task_type: 'standard', title: 'api_key=SECRET_SENTINEL_NOT_REAL', status: 'stopped', updated_at: Math.floor(clock / 1000), has_running_background_jobs: false }];
  messages = [
    { id: 'u1', timestamp: clock + 100, type: 'user_message', user_message: { content: 'Summarize' } },
    { id: 'a1', timestamp: clock + 200, type: 'assistant_message', assistant_message: { content: 'Manus integration result', delivery_kind: 'result' } },
    { id: 's1', timestamp: clock + 300, type: 'status_update', status_update: { agent_status: 'stopped' } },
  ];
  clock += 61000; await controller.tick();
  let inbox = await js('notchAPI.getTaskInbox({limit:100})');
  assert.equal(inbox.total, 1); assert.equal(inbox.items[0].source, 'manus');
  assert.equal(inbox.items[0].sessionTitle, ''); assert.equal(controller.status().backlogCount, 0);
  assert(!fs.readFileSync(path.join(profile, 'task-inbox.json'), 'utf8').includes('SECRET_SENTINEL'));
  const { BrowserWindow } = require('electron');
  let notification;
  for (let i = 0; i < 200; i++) {
    notification = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/notification.html'));
    if (notification && await notification.webContents.executeJavaScript("isVisible && !isHiding && currentNotification?.sourceKey==='manus'")) break;
    await delay(20);
  }
  assert(notification); await delay(500);
  fs.writeFileSync(path.join(output, 'completed.png'), (await notification.webContents.capturePage()).toPNG());
  await notification.webContents.executeJavaScript('activateNotification()');
  assert.equal(opened.at(-1), 'https://manus.im/app/manus-primary');
  await js(`notchAPI.openTaskSource(${JSON.stringify(inbox.items[0].id)})`);
  assert.equal(opened.at(-1), 'https://manus.im/app/manus-primary');
  const account = controller._store.getMeta('current_account'), period = controller._store.getAccount(account).listenStartedAt;
  await js("notchAPI.setAiProviderToken('manus','fixture-manus-key-rotated')");
  assert.equal(controller._store.getAccount(account).listenStartedAt, period);
  await listening;
  const pair = await js(`notchAPI.syncPairClaim(${JSON.stringify({ baseUrl: `http://127.0.0.1:${nas.server.address().port}`, pairingCode: nasStore.startPairing({ uid: 'u' }).code })})`);
  assert.equal(pair.ok, true);
  assert.equal((await js('notchAPI.syncRunMigration({localTodosJson:localStorage.getItem("notch-todo-data"),workspace:getWorkspaceSnapshotForSync()})')).ok, true);
  const live = () => [...nasStore.bucket('u').live.values()].filter(row => row.collection === 'aiCompletions');
  assert.equal(live().length, 1); assert.equal(live()[0].payload.source, 'manus');
  assert(!JSON.stringify(live()).includes('SECRET_SENTINEL'));
  messages.push({ id: 'u2', timestamp: clock + 100, type: 'user_message', user_message: { content: 'Next' } },
    { id: 'error2', timestamp: clock + 200, type: 'error_message', error_message: { content: 'The task could not finish' } },
    { id: 's2', timestamp: clock + 300, type: 'status_update', status_update: { agent_status: 'error' } });
  tasks[0].status = 'error'; clock += 61000; await controller.tick();
  inbox = await js('notchAPI.getTaskInbox({limit:100})');
  assert.equal(inbox.total, 2); assert.equal(inbox.items[0].status, 'failed');
  const { CONFIRMED_OUTBOX_KEEP, TASK_RETENTION_MS } = require('../manusCompletionStore');
  clock += 1;
  controller._store.runInTransaction(() => { for (let i = 0; i <= CONFIRMED_OUTBOX_KEEP; i++) {
    controller._store.enqueue(account, { eventId: 'retention-fixture-' + i, taskId: 'filler' });
    controller._store.confirm(account, 'retention-fixture-' + i);
  } });
  const previousTasks = tasks; tasks = [];
  clock += TASK_RETENTION_MS + 1000; await controller.tick();
  tasks = previousTasks; clock += 61000; await controller.tick();
  assert.equal((await js('notchAPI.getTaskInbox({limit:100})')).total, 2, 'retention and task reappearance must not replay prior completions');
  await js("setActiveTab('home')"); await until("activeTab==='home' && !tabBusy"); await delay(250);
  fs.writeFileSync(path.join(output, 'history-after-retention.png'), (await content.capturePage()).toPNG());
  rateLimited = true; clock += 61000; await controller.tick();
  assert.ok(lastDelay >= 120000, 'Retry-After must not be shortened by due tasks');
  await until("document.getElementById('settings-manus-completion-status').textContent===PomeI18n.t('providers.manus.networkError')");
  rateLimited = false;
  offline = true; clock += 61000; await controller.tick();
  await until("document.getElementById('settings-manus-completion-status').textContent===PomeI18n.t('providers.manus.networkError')");
  await js("setActiveTab('settings')");
  await until("activeTab==='settings' && !tabBusy");
  await js("document.getElementById('settings-manus-token-card').scrollIntoView({block:'center'})");
  await delay(200);
  fs.writeFileSync(path.join(output, 'settings-offline.png'), (await content.capturePage()).toPNG());
  const preview = await js('notchAPI.previewManusCompletion()'); assert.equal(preview.ok, true);
  assert.equal((await js('notchAPI.getTaskInbox({limit:100})')).total, 2);
  const { normalizeSyncedCompletion } = require('../packages/sync-protocol');
  const remote = Array.from({ length: 115 }, (_, i) => normalizeSyncedCompletion({ id: 'remote-' + i, source: 'manus', taskId: 'manus-remote',
    completionEventId: 'manus-remote-' + i, title: 'Remote result ' + i, receivedAt: Date.now() + 1000 + i, readAt: null }));
  nasStore.applyPush('u', remote.map(row => ({ collection: 'aiCompletions', entityId: 'completion:' + row.id, op: 'upsert', payload: row,
    clientMutationId: 'remote-' + row.id, deviceId: 'remote', baseServerRev: nasStore.bucket('u').serverRev })), { deviceId: 'remote' });
  await js('notchAPI.syncRetry()');
  await until("document.getElementById('home-inbox-unread').textContent==='100'");
  assert.equal(live().length, 100); assert.equal((await js('notchAPI.getTaskInbox({limit:100})')).total, 100);
  assert.ok(clock > startedAt);
}
require('../main');
