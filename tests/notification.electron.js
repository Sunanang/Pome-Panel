'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const adapters = require('../platform-adapters');
const originalAdapter = adapters.loadAdapter;
const activated = [];
let launchFailure = false;
adapters.loadAdapter = (...args) => {
  const adapter = originalAdapter(...args);
  adapter.windows.resolveTaskApp = async () => null;
  adapter.taskApps.open = async record => { activated.push(record.source); return launchFailure ? { ok: false, message: '未找到 Cursor。' } : { ok: true }; };
  return adapter;
};
process.env.POME_TEST_NOTIFICATIONS = '1';
const output = process.env.POME_NOTIFICATION_SCREENSHOTS || path.join(__dirname, '..', 'dist.noindex', 'notification-design');
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let port, started = false, sequence = 0;
const errors = [], timings = [];
app.on('pome-test-notification-port', value => { port = value; });
const watchdog = setTimeout(() => { console.error('Notification integration timed out', errors); app.exit(1); }, 90000);
async function until(check, label) {
  for (let index = 0; index < 300; index++) { if (await check()) return; await delay(20); }
  throw new Error(`Timed out: ${label}`);
}
function notificationWindow() {
  return BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/notification.html') && !win.isDestroyed());
}
const evaluate = (win, source) => win.webContents.executeJavaScript(source);
async function send(source, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/notify/${source}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: source === 'codex' ? 'agent-turn-complete' : 'Stop', event_id: `notification-fixture-${++sequence}`, ...payload }),
  });
  assert.equal(response.status, 202, await response.text());
}
async function shown(title) {
  await until(async () => {
    const win = notificationWindow();
    return win && await evaluate(win, `!document.getElementById('notification-root').hidden && document.getElementById('notification-title').textContent===${JSON.stringify(title)}`);
  }, title);
  const win = notificationWindow();
  await delay(470);
  return win;
}
async function dismiss(win, open = false) {
  await evaluate(win, `document.getElementById(${JSON.stringify(open ? 'notification-open' : 'notification-close')}).click()`);
  await delay(600);
}
async function capture(win, name) {
  const snapshot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(output, `${name}.png`), snapshot.toPNG());
  if (/-enter-|-exit-/.test(name)) {
    const pixels = snapshot.getSize(), bitmap = snapshot.toBitmap();
    const x = Math.floor(2*pixels.width/400), y = Math.floor(pixels.height*0.7);
    assert.equal(bitmap[(y*pixels.width+x)*4+3],0,`${name}: animated outer edge must stay transparent`);
  }
}
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  contents.on('ipc-message', (_event, channel, ...args) => { if (channel === 'task-notification:shown') timings.push({eventId:args[0], at:Date.now()}); });
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(contents).then(() => { clearTimeout(watchdog); console.log('Notification production lifecycle, rendering, hover, queue and screenshots passed:', output); app.exit(0); })
      .catch(error => { console.error(error, errors); app.exit(1); });
  });
});
async function run(mainContents) {
  await until(async () => port && await mainContents.executeJavaScript('!!window.NotchWorkspace'), 'production startup');
  assert.equal((await fetch(`http://127.0.0.1:${port}/notify/gpt`, {method:'POST'})).status,404);
  // Each known source enters through the real HTTP receiver and source identity service.
  const variants = [
    ['codex-completed', 'codex', { title: '重构通知队列，补齐悬停暂停逻辑', project: 'Pome-Panel' }],
    ['claude-completed', 'claude', { last_assistant_message: '已为设置页补上接入状态的空态插画', project: 'Pome-Panel' }],
    ['cursor-completed', 'cursor', { title: '修复剪贴板图片预览在 Retina 下模糊', project: 'notch-todo' }],
    ['codex-failed', 'codex', { title: '构建失败：类型检查未通过（3 处错误）', project: 'Pome-Panel', status: 'failed' }],
    ['claude-completed-long-title', 'claude', { title: '已将通知窗口的倒计时、悬停暂停与队列徽标重构为独立模块，同时修复了 Windows 首次启动时的边界问题，并补齐回归测试。', project: 'Pome-Panel', completed_at: Date.now()-120000 }],
    ['codex-full-summary', 'codex', { last_assistant_message: '已完成\n\n' + '修复布局与同步。'.repeat(30) + '\n测试全部通过。', session_title: '原生会话短标题', project: 'Pome-Panel' }],
    ['codex-completed-fallback', 'codex', { project: 'Pome-Panel' }],
  ];
  for (const [name, source, payload] of variants) {
    await send(source, payload);
    const title = require('../main-services').taskNotificationIdentity(payload, source).title;
    const win = await shown(title);
    assert.equal(win.getBounds().width, 400);
    assert.equal(win.hasShadow(), false, 'native window cannot add a second outer shadow');
    const edge = await evaluate(win, `({shadow:getComputedStyle(shell.querySelector('.notification-shape')).boxShadow,
      mask:getComputedStyle(shell.querySelector('.notification-shape'),'::after').maskImage,
      border:getComputedStyle(shell.querySelector('.notification-shape'),'::after').borderBottomWidth})`);
    if (process.platform === 'darwin') { assert.equal(edge.shadow,'none'); assert.equal(edge.mask,'none'); assert.equal(edge.border,'1px'); }
    const image = await win.webContents.capturePage(), bitmap = image.toBitmap(), pixels = image.getSize();
    const x = Math.floor(2*pixels.width/400), y = Math.floor(pixels.height*0.7);
    assert.equal(bitmap[(y*pixels.width+x)*4+3], 0, 'outside edge stays fully transparent without a second shadow silhouette');

    const state = await evaluate(win, `({titleHeight:document.getElementById('notification-title').offsetHeight,detail:document.getElementById('notification-detail').textContent,status:document.getElementById('notification-shell').dataset.status,mask:getComputedStyle(document.getElementById('notification-brand')).maskImage})`);
    assert.equal(state.detail, payload.project);
    assert.equal(state.status, payload.status || 'completed');
    assert(state.mask.includes(`/inbox/${source}.svg`));
    assert.equal(win.getBounds().height, (process.platform === 'win32' ? 96 : 92) + (state.titleHeight > 18 ? 18 : 0));
    if (name.includes('long-title')) { assert.equal(state.titleHeight, 36); assert.equal(await evaluate(win, 'document.getElementById("notification-time").textContent'), '2 分钟前'); }
    if (name === 'codex-full-summary') {
      const tooltip = await evaluate(win, 'titleElement.title');
      assert(tooltip.includes('原生会话短标题')); assert(tooltip.includes('测试全部通过。'));
      const stored = JSON.parse(fs.readFileSync(path.join(profile, 'task-inbox.json'))).records[0];
      assert.equal(stored.status, 'completed'); assert(stored.completionSummary.includes('测试全部通过。'));
    }
    await capture(win, name);
    const count = activated.length;
    await dismiss(win, source === 'cursor');
    assert.equal(activated.length, count + (source === 'cursor' && process.platform === 'darwin' ? 1 : 0), '× must never activate an app');
  }
  // Use the real forwarder, not a hand-authored completion envelope: promptId,
  // teardown and subagent filtering must survive the complete delivery chain.
  const sample = require('./fixtures/grok-stop.json');
  const triggerGrok = payload => new Promise((resolve, reject) => {
    const child = require('node:child_process').spawn(process.execPath, [path.join(__dirname, '../scripts/grok-notify.js')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', POME_NOTIFY_PORT: String(port), GROK_HOOK_EVENT: payload.hookEventName },
      stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
    });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Grok forwarder failed')));
    child.stdin.end(JSON.stringify({ ...payload, cwd: profile }));
  });
  const grokStart = JSON.parse(fs.readFileSync(path.join(profile, 'task-inbox.json'))).records.length;
  for (const [promptId, message, failure] of [['one', 'Grok 第一轮完成'], ['two', 'Grok 第二轮完成'], ['three', 'Grok 请求失败', true]]) {
    const payload = { ...sample, promptId, lastAssistantMessage: message,
      hookEventName: failure ? 'stop_failure' : 'stop', hook_event_name: failure ? 'StopFailure' : 'Stop' };
    await triggerGrok(payload);
    const win = await shown(message);
    assert.equal(await evaluate(win, 'sourceElement.textContent'), 'Grok');
    assert.equal(await evaluate(win, 'currentNotification.sourceKey'), 'grok');
    assert.equal(await evaluate(win, 'currentNotification.status'), failure ? 'failed' : 'completed');
    assert((await evaluate(win, 'getComputedStyle(document.getElementById("notification-brand")).maskImage')).includes('/inbox/grok.svg'));
    await until(async () => (await mainContents.executeJavaScript('document.querySelector(".home-inbox-source-wrap[data-source=grok] img")?.getAttribute("src")')) === 'assets/inbox/grok.svg', 'Grok inbox icon');
    await capture(win, `grok-${promptId}`);
    const count = activated.length;
    await dismiss(win, true);
    assert.equal(activated.length, count + (process.platform === 'darwin' ? 1 : 0));
    await triggerGrok(payload); // Retrying the same real event must remain silent.
  }
  await triggerGrok({ ...sample, promptId: 'nested', hookEventName: 'stop_failure', subagentType: 'explore' });
  await triggerGrok({ ...sample, promptId: undefined, reason: 'shutdown' });
  const grokRecords = JSON.parse(fs.readFileSync(path.join(profile, 'task-inbox.json'))).records;
  assert.equal(grokRecords.length, grokStart + 3);
  assert.equal(grokRecords.filter(row => row.source === 'grok').length, 3);
  // A failed launch retains the actionable notification and preserves its error.
  if (process.platform === 'darwin') {
    launchFailure = true;
    await send('cursor', { title: '软件打开失败仍可重试' });
    const failed = await shown('软件打开失败仍可重试');
    await dismiss(failed, true);
    assert.equal(await evaluate(failed, 'isVisible && !isHiding'), true);
    assert.equal(await evaluate(failed, 'detailElement.textContent'), '未找到 Cursor。');
    assert.equal(await evaluate(failed, 'timing.paused'), true);
    await delay(6200);
    assert.equal(await evaluate(failed, 'isVisible && !isHiding'), true, 'failed launch must survive normal timeout');
    await capture(failed, 'activation-failure-retained');
    launchFailure = false;
    await dismiss(failed, true);
    assert.equal(failed.isDestroyed() || !failed.isVisible(), true);
  }
  // Awaiting has no countdown, survives Escape and the entire normal 6000ms lifetime.
  const awaitingTitle = '需要你确认：允许运行 npm install 吗？';
  await send('claude', { title: awaitingTitle, project: 'Pome-Panel', status: 'awaiting' });
  let win = await shown(awaitingTitle);
  assert.equal(await evaluate(win, 'document.getElementById("notification-progress").hidden'), true);
  await capture(win, 'claude-awaiting-confirmation');
  // A different renderer cannot close or resize the active notification.
  const eventId = await evaluate(win, 'currentNotification.eventId');
  await mainContents.executeJavaScript(`notchAPI.dismissTaskNotification(${JSON.stringify(eventId)});notchAPI.taskNotificationResize({eventId:${JSON.stringify(eventId)},height:999})`);
  await evaluate(win, `document.getElementById('notification-shell').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await delay(6400);
  assert.equal(await evaluate(win, 'isVisible && !isHiding'), true, 'awaiting must never auto dismiss');
  // Real queue count and delayed event time are retained when the next item is shown.
  const queuedTitle = '五分钟前完成，等待前一条确认';
  await send('codex', { title: queuedTitle, project: 'Pome-Panel', completed_at: Date.now()-300000 });
  await delay(60); await capture(win, 'claude-awaiting-confirmation');
  await send('cursor', { title: '排队二', project: 'Pome-Panel' });
  await send('claude', { title: '排队三', project: 'Pome-Panel' });
  await until(() => evaluate(win, 'document.getElementById("notification-queue").textContent === "+3"'), 'queue count');
  // Capture the specified completed +3 and hover designs through the real renderer.
  await evaluate(win, `document.getElementById('notification-close').click()`);
  await delay(50);
  assert.equal(await evaluate(win, `root.classList.contains('is-visible') && !root.classList.contains('is-hiding')`),true,'queued notifications keep the island open');
  await delay(550);
  win = await shown(queuedTitle);
  assert.equal(await evaluate(win, 'document.getElementById("notification-time").textContent'), '5 分钟前');
  await capture(win, 'queued-event-relative-time');
  await dismiss(win);
  win = await shown('排队二'); await dismiss(win);
  win = await shown('排队三'); await dismiss(win);
  // Legacy status-less completion auto dismisses, with a paused and resumed real timer.
  const hoverTitle = '悬停期间进度暂停';
  await send('codex', { title: hoverTitle, project: 'Pome-Panel' });
  win = await shown(hoverTitle);
  await delay(300);
  await evaluate(win, 'reportHover(true)');
  await delay(100);
  const paused = await evaluate(win, '({remaining:timing.remainingMs,bar:progressFill.style.transform})');
  assert.equal(await evaluate(win, 'timing.paused'), true);
  await delay(6200);
  assert.equal(await evaluate(win, 'isVisible && !isHiding'), true);
  assert.deepEqual(await evaluate(win, '({remaining:timing.remainingMs,bar:progressFill.style.transform})'), paused);
  await capture(win, 'production-hover-paused');
  await evaluate(win, 'reportHover(false)');
  await until(() => evaluate(win, '!timing.paused'), 'countdown resumes after hover');
  assert.equal(await evaluate(win, 'timing.remainingMs'), paused.remaining, 'leaving hover must preserve the remaining lifetime');
  // Hover again near expiry, where the old 1500ms grace period extended the timer.
  await until(() => evaluate(win, 'timing.remainingMs - (Date.now() - timing.startedAt) < 1000'), 'countdown reaches its final second');
  await evaluate(win, 'reportHover(true)');
  await until(() => evaluate(win, 'timing.paused'), 'near-expiry hover pauses countdown');
  const nearExpiry = await evaluate(win, '({remaining:timing.remainingMs,bar:parseFloat(progressFill.style.transform.slice(7))})');
  assert.ok(nearExpiry.remaining > 0 && nearExpiry.remaining < 1500);
  await delay(100);
  await evaluate(win, 'reportHover(false)');
  await until(() => evaluate(win, '!timing.paused'), 'near-expiry countdown resumes');
  assert.equal(await evaluate(win, 'timing.remainingMs'), nearExpiry.remaining, 'leaving hover near expiry must not add time');
  assert.ok(await evaluate(win, 'parseFloat(progressFill.style.transform.slice(7))') <= nearExpiry.bar, 'progress bar must not grow when leaving hover');
  await until(() => !notificationWindow() || !notificationWindow().isVisible(), 'normal countdown resumes and closes');
  // Exercise the real todo IPC rather than creating a completion record for a reminder.
  const before = JSON.parse(fs.readFileSync(path.join(profile, 'task-inbox.json'))).records.length;
  await mainContents.executeJavaScript(`notchAPI.scheduleTodoReminders([{id:'notification-due',text:'提交 Pome Panel 1.4 发布说明',deadline:new Date(Date.now()+1800000).toISOString(),done:false,remindedAt:0}])`);
  win = await shown('提交 Pome Panel 1.4 发布说明');
  assert.equal(await evaluate(win, 'currentNotification.status'), 'due');
  assert.equal(await evaluate(win, 'detailElement.textContent'), '将在 1 小时内截止');
  await capture(win, 'todo-due-soon'); await dismiss(win);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'task-inbox.json'))).records.length, before);
  assert(timings.length > 5);
  await previewVariants();
  assert.deepEqual(errors, []);
}

async function previewVariants() {
  // Render historical/generic sources and Windows design on this Mac using the
  // production HTML, preload and IPC. Only application activation is stubbed.
  let preview = null;
  const resize = (event, value) => { if (event.sender === preview?.webContents && [92,110,96,114].includes(value.height)) preview.setSize(400, value.height); };
  const clock = (event, eventId) => {
    if (event.sender === preview?.webContents) preview.webContents.send('task-notification:timing', {eventId,durationMs:6000,remainingMs:3840,startedAt:Date.now(),paused:true});
  };
  ipcMain.on('task-notification:resize', resize);
  ipcMain.on('task-notification:shown', clock);
  try {
    const specs = [
      ['codex-completed-queue','darwin',{source:'codex',title:'重构通知队列，补齐悬停暂停逻辑',project:'Pome-Panel',queueCount:3}],
      ['codex-completed-hover','darwin',{source:'codex',title:'重构通知队列，补齐悬停暂停逻辑',project:'Pome-Panel',queueCount:3},true],
      ['gpt-completed-no-project','darwin',{source:'gpt',title:'周报摘要已生成，共 6 条要点',completedAt:Date.now()-300000}],
      ['task-completed','darwin',{source:'task',title:'导出 10 月账单 CSV',project:'Pome-Panel'}],
      ['windows-codex-completed','win32',{source:'codex',title:'重构通知队列，补齐悬停暂停逻辑',project:'Pome-Panel',queueCount:3}],
      ['windows-codex-completed-hover','win32',{source:'codex',title:'重构通知队列，补齐悬停暂停逻辑',project:'Pome-Panel',queueCount:3},true],
      ['windows-grok-native-off','win32',{source:'grok',title:'Grok 完成测试',project:'Pome-Panel'}],
      ['windows-copilot-native-off','win32',{source:'copilot',title:'Copilot 完成测试',project:'Pome-Panel'}],
      ['windows-antigravity-native-off','win32',{source:'antigravity',title:'Antigravity 完成测试',project:'Pome-Panel'}],
    ];
    for (const [name, platform, fixture, hover] of specs) {
      const caps = {platform,features:{windowFocus:false}};
      preview = new BrowserWindow({width:400,height:platform==='win32'?96:92,frame:false,transparent:true,focusable:false,show:false,hasShadow:false,
        webPreferences:{preload:path.join(__dirname,'..','preload.js'),sandbox:true,contextIsolation:true,backgroundThrottling:false,
          additionalArguments:[`--pome-caps=${Buffer.from(JSON.stringify(caps)).toString('base64')}`]}});
      await preview.loadFile(path.join(__dirname,'..','renderer','notification.html'));
      preview.webContents.send('task-notification:show', {...fixture,eventId:name,completedAt:fixture.completedAt||Date.now()});
      preview.showInactive();
      if (name === 'windows-codex-completed' || name === 'task-completed') {
        for (const frame of [40, 100, 180]) { await delay(frame); await capture(preview, `${name}-enter-${frame}`); }
      } else await delay(500);
      if (hover) await evaluate(preview, 'reportHover(true)');
      await delay(160);
      await capture(preview,name);
      assert.equal(await evaluate(preview, 'timeElement.textContent'), name.startsWith('gpt') ? '5 分钟前':'刚刚');
      if (name.startsWith('gpt')) assert.equal(await evaluate(preview,'document.getElementById("notification-separator").hidden'),true);
      if (platform==='win32') assert.equal(await evaluate(preview,'getComputedStyle(document.querySelector(".notification-cap")).display'),'none');
      if (name.endsWith('-native-off')) {
        assert.equal(await evaluate(preview, 'sourceElement.textContent'), require('../aiProviderCatalog').get(fixture.source).label);
        assert.equal(await evaluate(preview, 'openButton.getAttribute("aria-label")'), '打开任务对应窗口');
        const count = activated.length;
        await evaluate(preview, 'openButton.click()');
        // Preview windows are not the live notificationWindow, so activate IPC is rejected
        // before taskApps.open. The renderer must still attempt open (not silent-dismiss).
        assert.equal(activated.length, count);
        assert.equal(await evaluate(preview, 'activationError'), true);
      }
      // Reduced motion keeps every piece of content and uses only a fade.
      preview.webContents.debugger.attach('1.3');
      await preview.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await delay(140);
      assert.equal(await evaluate(preview,'getComputedStyle(root).transform'),'none');
      if (name === 'windows-codex-completed' || name === 'task-completed') {
        await preview.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
        preview.webContents.send('task-notification:hide',{eventId:name});
        for (const frame of [40, 100, 180]) { await delay(frame); await capture(preview, `${name}-exit-${frame}`); }
      }
      preview.destroy(); preview=null;
    }
  } finally {
    if (preview && !preview.isDestroyed()) preview.destroy();
    ipcMain.removeListener('task-notification:resize',resize);
    ipcMain.removeListener('task-notification:shown',clock);
  }
}
require('../main');
