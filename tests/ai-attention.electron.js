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
const attentionStorage = require('../aiAttentionStore'), createAttention = attentionStorage.createAiAttentionStore;
let attentionWriteFailure = null, attentionWrites = 0;
const attentionDisk = Object.create(fs);
attentionDisk.renameSync = (from, to) => {
  if (to === path.join(profile, 'ai-attention.json')) {
    attentionWrites++;
    if (attentionWriteFailure === 'before') throw new Error('fixture_write_before_rename');
    fs.renameSync(from, to);
    if (attentionWriteFailure === 'after') throw new Error('fixture_write_after_rename');
  } else fs.renameSync(from, to);
};
attentionStorage.createAiAttentionStore = options => createAttention({ ...options, disk: attentionDisk });
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
const shownDisplays = new Set();
ipcMain.on('task-notification:shown', (_event, eventId) => shownDisplays.add(eventId));
const hoverEvents = [];
ipcMain.on('task-notification:hover', (_event, value) => {
  hoverEvents.push({ at: Date.now(), ...value });
  if (hoverEvents.length > 30) hoverEvents.shift();
});
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
  const win = window();
  const id = await evaluate(win, 'currentNotification.eventId');
  // Entry synchronizes native hover with the new generation. Wait for that
  // acknowledgement before setting the fixture's hover state.
  await until(() => shownDisplays.has(id), `entry acknowledged: ${title}`);
  await evaluate(win, 'reportHover(false)'); return win;
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
  const visibleAfterHide = event('select', 'cursor', { question: '隐藏项不计入排队' });
  await send(visibleAfterHide); const visibleWindow = await shown(visibleAfterHide.question);
  assert.equal(await evaluate(visibleWindow, 'document.getElementById("attention-queue").hidden'), true);
  assert.equal((await pending()).items.length, 2, 'hidden request remains in pending list');
  await resolve(visibleAfterHide); await delay(650);
  await mainEval(`setMode(true)`);
  await until(async()=>await mainEval(`isExpanded && !modeBusy && innerWidth>500 && innerHeight>300 && Number(getComputedStyle(document.getElementById('panels')).opacity)>.99`),'expanded main window ready');
  await mainEval(`setActiveTab('home')`);
  await mainEval(`document.querySelector('.ai-attention-entry').click()`);
  assert.equal(await mainEval(`document.querySelector('.ai-attention-section').open`),true);
  assert.equal(await mainEval(`document.querySelector('.tab-panel.active').id`),'tab-home','pending list stays on home');
  assert.equal(await mainEval(`document.querySelector('#settings-ai-sources .ai-attention-section')`),null);
  await until(async()=>await mainEval(`(()=>{const dialog=document.querySelector('.ai-attention-section'),r=dialog.getBoundingClientRect(),row=dialog.querySelector('.ai-attention-row');return dialog.open && r.width>200 && r.height>90 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && row?.innerText.includes(${JSON.stringify(hidden.question)});})()`),'visible pending list with its question');
  await mainEval(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  const mainWindow=BrowserWindow.fromWebContents(mainContents);
  const pendingImage=await mainWindow.webContents.capturePage();
  assert(pendingImage.getSize().width>=600 && pendingImage.getSize().height>=300,'pending screenshot must show an expanded window');
  fs.writeFileSync(path.join(output,'home-pending-list.png'),pendingImage.toPNG());
  fs.writeFileSync(path.join(output,'home-pending-list.json'),JSON.stringify({bounds:mainWindow.getBounds(),image:pendingImage.getSize(),question:hidden.question}));
  await mainEval(`document.dispatchEvent(new CustomEvent('notch:modechange',{detail:{expanded:false}}))`);
  assert.equal(await mainEval(`document.querySelector('.ai-attention-section').open`),false,'collapse closes pending dialog');
  await mainEval(`setMode(true)`);
  await until(async()=>await mainEval(`isExpanded && !modeBusy && innerWidth>500 && innerHeight>300 && Number(getComputedStyle(document.getElementById('panels')).opacity)>.99`),'expanded main window ready');
  await mainEval(`setActiveTab('home')`);
  await mainEval(`document.querySelector('.ai-attention-entry').click()`);
  assert.equal(await mainEval(`document.querySelector('.ai-attention-section').open`),true);
  await mainEval(`Array.from(document.querySelectorAll('.ai-attention-actions button')).find(b=>b.textContent===PomeI18n.t('attention.reopen')).click()`); await shown(hidden.question);
  await mainEval(`document.querySelector('.ai-attention-heading button').click()`);
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
  // Rotation includes an 8s slot plus the outgoing animation/IPC fallback.
  // Observe the next display generation instead of racing it at exactly 8.3s.
  try {
    await until(async () => await evaluate(win, 'currentNotification.eventId') !== after, 'stale hover cannot stop current rotation', 12000);
  } catch (error) {
    console.error('Rotation state:', await evaluate(win, '({id:currentNotification.eventId,title:currentNotification.title,isHovering,hover:shell.matches(":hover"),focus:shell.matches(":focus-within"),isVisible,isHiding,timing})'));
    console.error('Recent hover events:', hoverEvents);
    throw error;
  }
  const selected = (await pending()).items.find(row => row.event.question === b.question);
  await mainEval(`notchAPI.showAiAttention(${JSON.stringify(selected.key)})`); await shown(b.question);
  await resolve(a); await resolve(b); await delay(650);
  // Completion temporarily yields to a new waiting request and then returns.
  await send({ source: 'codex', event_id: 'mixed-completion', type: 'agent-turn-complete', title: '普通完成仍展示' });
  const completionWindow = await shown('普通完成仍展示');
  await evaluate(completionWindow, 'reportHover(true)');
  const newer = event('input', 'claude', { question: '新等待优先' }); await send(newer); await delay(200);
  assert.equal(await evaluate(completionWindow, 'currentNotification.title'), '普通完成仍展示');
  assert.equal(await evaluate(completionWindow, 'document.getElementById("notification-queue").textContent'), '+1',
    'completion bubble +N includes a waiting request that will show next');
  await evaluate(completionWindow, 'reportHover(false)'); await shown(newer.question); await resolve(newer);
  const resumed = await shown('普通完成仍展示'); assert.equal(await evaluate(resumed, 'progressElement.hidden'), false);
  await evaluate(resumed, 'document.getElementById("notification-close").click()'); await delay(650);
  await previewWindows();
  await verifyClaudeObservations();
  const attentionPath = path.join(profile, 'ai-attention.json'); fs.writeFileSync(attentionPath, '{corrupt fixture');
  assert.equal((await pending()).ok, false);
  const { dialog } = require('electron'), originalDialog = dialog.showMessageBox;
  try {
    dialog.showMessageBox = async () => ({ response: 0 });
    assert.equal((await mainEval('notchAPI.rebuildAiAttention()')).canceled, true);
    assert.equal(fs.readFileSync(attentionPath, 'utf8'), '{corrupt fixture');
    dialog.showMessageBox = async () => ({ response: 1 });
    await mainEval(`document.dispatchEvent(new CustomEvent('notch:tabchange',{detail:{tab:'home'}}))`);
    await until(async()=>await mainEval(`document.querySelector('.ai-attention-entry').textContent===PomeI18n.t('attention.repairStorage')`),'home repair entry');
    await mainEval(`document.querySelector('.ai-attention-entry').click()`);
    await until(async()=>await mainEval(`document.querySelector('#ai-attention-list button')?.textContent===PomeI18n.t('attention.repairStorage')`),'home repair action');
    await mainEval(`document.querySelector('#ai-attention-list button').click()`);
    await until(async()=>(await pending()).ok,'repaired from home');
    const backup = fs.readdirSync(profile).find(name=>name.startsWith('ai-attention.json.corrupt-'));
    assert(backup,'repair keeps corrupt-file backup');
    assert.equal(fs.readFileSync(path.join(profile,backup), 'utf8'), '{corrupt fixture'); assert.deepEqual((await pending()).items, []);
    await mainEval(`document.querySelector('.ai-attention-section').close()`);
  } finally { dialog.showMessageBox = originalDialog; }
  assert.deepEqual(errors, []);
}
async function verifyClaudeObservations() {
  const { observation } = require('../scripts/claude-attention');
  const post = async (payload, status = 202) => {
    const response = await fetch(`http://127.0.0.1:${port}/notify/claude`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const body = await response.json(); assert.equal(response.status,status,JSON.stringify(body)); return body;
  };
  const base = {session_id:'claude-batch-test',prompt_id:'p',hook_event_name:'Notification',notification_type:'permission_prompt'};
  const first = observation({...base,message:'Allow npm install --token=PRIVATE_ONE'});
  const second = observation({...base,message:'Allow npm install --token=PRIVATE_TWO'});
  await post(first); await post(second); await post(first);
  let rows = (await pending()).items.filter(row => row.event.sessionId===base.session_id);
  assert.equal(rows.length,2);assert.notEqual(rows[0].event.requestId,rows[1].event.requestId);
  assert(rows.every(row => row.event.commandPreview==='npm install'));
  const file = path.join(profile,'ai-attention.json'), before = fs.readFileSync(file);
  const stop = observation({...base,hook_event_name:'Stop'});
  let writes = attentionWrites;
  attentionWriteFailure = 'before';
  await post(stop,503);
  attentionWriteFailure = null;
  assert.equal(attentionWrites,writes+1);assert.deepEqual(fs.readFileSync(file),before);
  assert.equal((await pending()).items.filter(row => row.event.sessionId===base.session_id).length,2);
  writes = attentionWrites;
  await post(stop);
  assert.equal(attentionWrites,writes+1);assert.equal((await pending()).items.length,0);
  // A fresh invocation of the same command is a new request after continuation.
  await post(observation({...base,message:'Allow npm install --token=PRIVATE_ONE'}));
  assert.equal((await pending()).items.length,1);
  attentionWriteFailure = 'after';
  await post(stop,503);
  attentionWriteFailure = null;
  assert.equal((await pending()).items.length,0);
  writes = attentionWrites;
  await post(stop);assert.equal(attentionWrites,writes,'adapter must not roll back an already committed batch');
  assert(!fs.readFileSync(file,'utf8').includes('PRIVATE_ONE'));
  assert(!fs.readFileSync(file,'utf8').includes('PRIVATE_TWO'));
  await delay(650);
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
