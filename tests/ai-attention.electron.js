'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const adapters = require('../platform-adapters'), original = adapters.loadAdapter;
let activations = 0, launchFailure = false;
adapters.loadAdapter = (...args) => {
  const adapter = original(...args); adapter.windows.resolveTaskApp = async () => null;
  adapter.taskApps.open = async () => { activations++; return { ok: !launchFailure, message: launchFailure ? 'fixture unavailable' : '' }; }; return adapter;
};
process.env.POME_TEST_NOTIFICATIONS = '1';
const output = process.env.POME_ATTENTION_SCREENSHOTS || path.join(__dirname, '../dist.noindex/ai-attention-design');
fs.mkdirSync(output, { recursive: true });
const errors = []; let port, started = false, sequence = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win, script) => win.webContents.executeJavaScript(script);
const mainEval = script => mainContents.executeJavaScript(script);
let mainContents;
const watchdog = setTimeout(() => { console.error('Attention integration timed out', errors); app.exit(1); }, 120000);
function window() { return BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && win.webContents.getURL().endsWith('/renderer/notification.html')); }
async function until(check, label, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(25); }
  throw new Error(`Timed out: ${label}`);
}
function event(action = 'input', source = 'codex', extra = {}) {
  const n = ++sequence;
  return { schemaVersion: 2, kind: 'attention.required', source, eventId: `e${n}`, sessionId: `session${n}`, turnId: `turn${n}`, requestId: `request${n}`, action,
    question: { input: '请填写测试 NAS 的访问地址', select: '这次修改直接上线，还是先预览？', approve: '允许运行 npm install 吗？' }[action], project: 'Pome-Panel',
    occurredAt: Date.now() - 120000, sequence: 1, evidence: { adapter: 'integration-fixture', surface: 'bridge', providerVersion: 'fixture-only', signal: 'required' }, ...extra };
}
async function send(payload) {
  const response = await fetch(`http://127.0.0.1:${port}/notify/${payload.source}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json(); assert.equal(response.status, 202, JSON.stringify(result)); return result;
}
async function resolve(payload) { return send({ ...payload, kind: 'attention.resolved', eventId: payload.eventId + '-resolved', reason: 'answered', sequence: payload.sequence + 1 }); }
async function shown(title) {
  await until(async () => { const win = window(); return win && await evaluate(win, `isVisible && !isHiding && currentNotification?.title === ${JSON.stringify(title)}`); }, title);
  const win = window(); await delay(500); await evaluate(win, 'reportHover(false)'); return win;
}
const pending = () => mainEval('window.notchAPI.getAiAttention()');
async function capture(win, name) { fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG()); }
app.on('pome-test-notification-port', value => { port = value; });
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true; mainContents = contents;
    run().then(() => { clearTimeout(watchdog); console.log('Attention HTTP/state/UI/scheduler integration passed. Screenshots:', output); app.exit(0); })
      .catch(error => { console.error(error, errors); app.exit(1); });
  });
});
async function run() {
  await until(async () => port && await mainEval('!!window.NotchWorkspace'), 'startup');
  const initial = await mainEval('window.notchAPI.getTaskInbox()');
  for (const [action, source] of [['input', 'codex'], ['select', 'cursor'], ['approve', 'claude'], ['input', 'claude'], ['approve', 'cursor']]) {
    const payload = event(action, source); await send(payload); const win = await shown(payload.question);
    assert.equal(win.getBounds().height, process.platform === 'win32' ? 114 : 146);
    const state = await evaluate(win, `({kind:currentNotification.attentionKind,bar:progressElement.hidden,chip:document.getElementById('attention-label').textContent,
      action:document.getElementById('attention-action-label').textContent,brand:document.getElementById('attention-brand').src,
      color:getComputedStyle(document.getElementById('attention-action')).backgroundColor,title:getComputedStyle(document.getElementById('attention-title')).fontSize})`);
    assert.equal(state.bar, true); assert(state.brand.includes(`/inbox/${source}.svg`)); assert.equal(state.title, '15px');
    if (process.platform === 'darwin') assert.equal(state.color, 'rgb(47, 111, 224)');
    await capture(win, `${action}-${source}`);
    if (action === 'input' && source === 'codex') {
      const id = await evaluate(win, 'currentNotification.eventId');
      await evaluate(win, `PomeI18n.setState({preference:'en-US',effectiveLocale:'en-US'});window.dispatchEvent(new Event('pome:language-changed'))`);
      assert.equal(await evaluate(win, 'document.getElementById("attention-title").textContent'), payload.question);
      assert.equal(await evaluate(win, 'document.getElementById("attention-label").textContent'), 'Input needed');
      assert.equal(await evaluate(win, 'currentNotification.eventId'), id);
      await capture(win, 'input-english');
      await evaluate(win, `PomeI18n.setState({preference:'zh-CN',effectiveLocale:'zh-CN'});window.dispatchEvent(new Event('pome:language-changed'))`);
    }
    const count = activations;
    if (process.platform === 'darwin') {
      await evaluate(win, 'document.getElementById("attention-action").click()'); await delay(150);
      assert.equal(activations, count + 1); assert.equal((await pending()).items.length, 1, 'returning never resolves');
      assert.equal(await evaluate(win, 'isVisible && !isHiding'), true);
    }
    await resolve(payload);
    await until(async () => (await pending()).items.length === 0, 'matching resolution'); await delay(650);
  }
  assert.equal((await mainEval('window.notchAPI.getTaskInbox()')).unread, initial.unread, 'waiting creates no completed unread');
  if (process.platform === 'darwin') {
    const retry = event('select', 'cursor', { question: '返回失败可以重试' }); await send(retry); const failed = await shown(retry.question);
    launchFailure = true; await evaluate(failed, 'document.getElementById("attention-action").click()'); await delay(150);
    assert.equal(await evaluate(failed, 'document.getElementById("attention-hint").textContent'), 'fixture unavailable');
    assert.equal((await pending()).items.length, 1);
    launchFailure = false; await evaluate(failed, 'document.getElementById("attention-action").click()'); await delay(150);
    assert.equal(await evaluate(failed, 'isVisible && !isHiding'), true); await resolve(retry); await delay(650);
  }
  const secret = event('approve', 'claude', { question: 'npm install --token=TOPSECRET' }); await send(secret);
  const safe = require('../localization/runtime').t('attention.commandMasked', { command: 'npm install' }); const masked = await shown(safe);
  await capture(masked, 'authorization-masked');
  assert.equal(await evaluate(masked, 'document.getElementById("attention-title").offsetHeight'), 21);
  await evaluate(masked, `PomeI18n.setState({preference:'en-US',effectiveLocale:'en-US'});window.dispatchEvent(new Event('pome:language-changed'))`);
  assert.equal(await evaluate(masked, 'document.getElementById("attention-title").textContent'), 'Allow npm install ••••?');
  await evaluate(masked, `PomeI18n.setState({preference:'zh-CN',effectiveLocale:'zh-CN'});window.dispatchEvent(new Event('pome:language-changed'))`);
  assert(!fs.readFileSync(path.join(profile, 'ai-attention.json'), 'utf8').includes('TOPSECRET')); await resolve(secret); await delay(650);
  const hidden = event(); await send(hidden); const hiddenWindow = await shown(hidden.question);
  const hiddenId = await evaluate(hiddenWindow, 'currentNotification.eventId');
  await evaluate(hiddenWindow, 'document.getElementById("attention-close").click()'); await delay(650);
  let rows = (await pending()).items; assert.equal(rows.length, 1); assert.equal(rows[0].hidden, true); assert.equal(rows[0].state, 'pending');
  await until(async () => await mainEval('!document.querySelector(".ai-attention-entry").hidden && document.querySelectorAll(".ai-attention-row").length === 1'), 'pending UI survives hiding');
  assert.equal((await send(hidden)).result, 'duplicate'); await delay(200); assert(!window()?.isVisible());
  await mainEval(`window.notchAPI.showAiAttention(${JSON.stringify(rows[0].key)})`); await shown(hidden.question);
  assert.notEqual(await evaluate(window(), 'currentNotification.eventId'), hiddenId, 'every display has a fresh generation');
  await resolve(hidden); await delay(650);
  const fallback = event('input', 'codex', { question: '原生能力关闭时只隐藏' }); await send(fallback); const fallbackWindow = await shown(fallback.question);
  const countBeforeFallback = activations;
  fallbackWindow.webContents.send('capabilities:changed', { platform: process.platform, features: { windowFocus: false } }); await delay(100);
  assert.equal(await evaluate(fallbackWindow, 'document.getElementById("attention-action-label").textContent'), '请返回来源软件');
  await evaluate(fallbackWindow, 'document.getElementById("attention-action").click()'); await delay(650);
  assert.equal(activations, countBeforeFallback); assert.equal((await pending()).items[0].hidden, true);
  await resolve(fallback);
  // Real 8-second slot and hover budget, including a stale hover IPC.
  const a = event('input', 'codex', { question: '轮换 A' }), b = event('select', 'cursor', { question: '轮换 B' });
  await send(a); const win = await shown(a.question); await evaluate(win, 'reportHover(true)'); await send(b);
  assert.equal(await evaluate(win, 'document.getElementById("attention-queue").textContent'), '+1'); await capture(win, 'queue-hover');
  if (process.platform === 'darwin') { await evaluate(win, 'document.getElementById("attention-action").click()'); await delay(150); }
  await delay(8300); assert.equal(await evaluate(win, 'currentNotification.title'), a.question, 'hover must stop rotation');
  const oldId = await evaluate(win, 'currentNotification.eventId');
  await evaluate(win, 'reportHover(false)'); await shown(b.question);
  await evaluate(win, `window.notchAPI.taskNotificationHover(true, ${JSON.stringify(oldId)})`); await delay(100);
  assert.equal(await evaluate(win, 'timing.paused'), true, 'waiting has no countdown even while scheduling slots');
  const after = await evaluate(win, 'currentNotification.eventId');
  await delay(8300); assert.notEqual(await evaluate(win, 'currentNotification.eventId'), after, 'stale hover cannot stop current rotation');
  const selected = (await pending()).items.find(row => row.event.question === b.question);
  await mainEval(`notchAPI.showAiAttention(${JSON.stringify(selected.key)})`); await shown(b.question);
  await resolve(a); await resolve(b); await delay(650);
  // Completion temporarily yields to a new waiting request and then returns.
  await send({ source: 'codex', event_id: 'mixed-completion', type: 'agent-turn-complete', title: '普通完成仍展示' });
  const completionWindow = await shown('普通完成仍展示');
  await evaluate(completionWindow, 'reportHover(true)');
  const newer = event('input', 'claude', { question: '新等待优先' }); await send(newer); await delay(200);
  assert.equal(await evaluate(completionWindow, 'currentNotification.title'), '普通完成仍展示');
  await evaluate(completionWindow, 'reportHover(false)'); await shown(newer.question); await resolve(newer);
  const resumed = await shown('普通完成仍展示'); assert.equal(await evaluate(resumed, 'progressElement.hidden'), false);
  await evaluate(resumed, 'document.getElementById("notification-close").click()'); await delay(650);
  await previewWindows();
  const attentionPath = path.join(profile, 'ai-attention.json'); fs.writeFileSync(attentionPath, '{corrupt fixture');
  assert.equal((await pending()).ok, false);
  const { dialog } = require('electron'), originalDialog = dialog.showMessageBox;
  try {
    dialog.showMessageBox = async () => ({ response: 0 });
    assert.equal((await mainEval('notchAPI.rebuildAiAttention()')).canceled, true);
    assert.equal(fs.readFileSync(attentionPath, 'utf8'), '{corrupt fixture');
    dialog.showMessageBox = async () => ({ response: 1 });
    const repaired = await mainEval('notchAPI.rebuildAiAttention()'); assert.equal(repaired.ok, true);
    assert.equal(fs.readFileSync(repaired.backupPath, 'utf8'), '{corrupt fixture'); assert.deepEqual((await pending()).items, []);
  } finally { dialog.showMessageBox = originalDialog; }
  assert.deepEqual(errors, []);
}
async function previewWindows() {
  for (const focus of [true, false]) {
    const caps = { platform: 'win32', features: { windowFocus: focus } };
    const win = new BrowserWindow({ width: 384, height: 114, frame: false, transparent: true, show: false, focusable: false, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, '../preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false,
        additionalArguments: [`--pome-caps=${Buffer.from(JSON.stringify(caps)).toString('base64')}`] } });
    await win.loadFile(path.join(__dirname, '../renderer/notification.html'));
    win.webContents.send('task-notification:show', { source: 'codex', status: 'awaiting', attentionKind: 'input', title: '请填写测试 NAS 的访问地址', project: 'Pome-Panel', eventId: `windows-${focus}`, occurredAt: Date.now() - 120000 });
    win.showInactive(); await delay(550); await evaluate(win, 'reportHover(false)');
    assert.equal(await evaluate(win, 'getComputedStyle(document.querySelector(".notification-cap")).display'), 'none');
    if (!focus) assert.equal(await evaluate(win, 'document.getElementById("attention-action-label").textContent'), '请返回来源软件');
    await capture(win, focus ? 'windows' : 'windows-native-off');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await delay(180);
    assert.equal(await evaluate(win, 'getComputedStyle(document.querySelector(".attention-dot"),"::after").animationName'), 'none');
    assert.equal(await evaluate(win, 'document.getElementById("attention-brand").complete && document.getElementById("attention-brand").naturalWidth > 0'), true);
    await capture(win, focus ? 'windows-reduced-motion' : 'windows-native-off-reduced-motion');
    win.destroy();
  }
}
require('../main');
