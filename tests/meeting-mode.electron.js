'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, '.ui-welcome-done'), '1');
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS = '1';
require('./provider-usage-fixtures.cjs');
let clock = 0;
const domain = require('../meetingMode'), create = domain.createMeetingModeMonitor;
domain.createMeetingModeMonitor = options => create({ ...options, now: () => clock });
const output = process.env.POME_REVIEW_SHOTS || path.join(__dirname, '../dist.noindex/meeting-mode');
fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false, port, sequence = 0;
app.on('pome-test-notification-port', value => { port = value; });
const watchdog = setTimeout(() => { console.error('Automatic meeting acceptance timed out'); app.exit(1); }, 60000);
async function until(check, label) {
  for (let index = 0; index < 250; index++) { if (await check()) return; await sleep(25); }
  throw Error('Timed out: ' + label);
}
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(contents).then(() => { clearTimeout(watchdog); console.log('Automatic camera, sharing, Focus, manual precedence, cooldown, history and screenshots passed:', output); app.quit(); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(contents) {
  const js = source => contents.executeJavaScript(source);
  const panel = BrowserWindow.fromWebContents(contents);
  const sample = (at, state) => { clock = at; app.emit('pome-test-meeting-sample', state); };
  const state = () => js('notchAPI.getAppSettings()');
  const bubbleVisible = () => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/renderer/notification.html') && window.isVisible());
  async function send(title) {
    const response = await fetch(`http://127.0.0.1:${port}/notify/codex`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 'auto-meeting-test', 'turn-id': String(++sequence), 'last-assistant-message': title }) });
    assert.equal(response.status, 202);
  }
  async function capture(name) {
    await js('setMode(true)');
    await until(() => js('isExpanded && !modeBusy'), 'expanded capture');
    await js('setActiveTab("settings")');
    await until(() => js('!tabBusy && document.getElementById("tab-settings").classList.contains("active")'), 'settings visible');
    await js('document.getElementById("settings-auto-meeting-mode").scrollIntoView({block:"center"})');
    await sleep(250);
    assert.equal(await js('getComputedStyle(document.getElementById("settings-meeting-status")).display !== "none" && document.getElementById("settings-meeting-status").getBoundingClientRect().width > 200 && document.getElementById("settings-meeting-status").getBoundingClientRect().height > 10'), true);
    fs.writeFileSync(path.join(output, name + '.png'), (await panel.capturePage()).toPNG());
  }
  await until(() => js('!!window.NotchWorkspace && window.NotchAiSources?.getState().ready'), 'startup');
  await until(() => Boolean(port), 'listener');
  await js("setMode(true)"); await sleep(600);
  await js("document.querySelector('#ui-capsule-hint button')?.click(); setActiveTab('settings')");
  sample(0, { camera: false, sharing: false, focus: false });
  await js("document.getElementById('settings-auto-meeting-mode').scrollIntoView({block:'center'})");
  assert.equal((await state()).autoMeetingMode, true);
  await capture('automatic-idle');
  sample(1000, { camera: true, sharing: false, focus: false });
  sample(3999, { camera: true, sharing: false, focus: false }); assert.equal((await state()).meetingStatus.active, false);
  sample(4000, { camera: true, sharing: false, focus: false }); assert.equal((await state()).meetingStatus.active, true);
  await send('摄像头使用中：事件已保存'); await sleep(250); assert.equal(bubbleVisible(), false);
  assert((await js('notchAPI.getTaskInbox()')).items.some(row => row.title === '摄像头使用中：事件已保存'));
  await capture('automatic-camera');
  sample(5000, { camera: false, sharing: true, focus: true });
  assert.deepEqual((await state()).meetingStatus.reasons, ['camera', 'sharing', 'focus']);
  await capture('automatic-sharing-focus');
  sample(35000, { camera: false, sharing: true, focus: false });
  assert.deepEqual((await state()).meetingStatus.reasons, ['sharing', 'focus']);
  sample(65000, { camera: false, sharing: false, focus: false });
  assert.deepEqual((await state()).meetingStatus.reasons, ['sharing']);
  sample(94999, { camera: false, sharing: false, focus: false }); assert.equal((await state()).meetingStatus.active, true);
  sample(95000, { camera: false, sharing: false, focus: false }); assert.equal((await state()).meetingStatus.active, false);
  await sleep(250); assert.equal(bubbleVisible(), false, 'old AI completions do not replay');
  await send('自动会议模式结束：新消息恢复提示'); await until(bubbleVisible, 'new bubble restored');
  sample(96000, { focus: true }); await until(() => !bubbleVisible(), 'existing bubble dismissed');
  sample(97000, { camera: false, sharing: { active: null, available: false, error: 'accessibility_required' }, focus: null });
  assert.equal((await state()).meetingStatus.active, true, 'unavailable does not clear active Focus');
  await capture('automatic-unavailable');
  await js(`(() => {
    for (const category of PRIORITIES) data[category] = [];
    data.P0 = [{id:'meeting-unseen-todo',text:'会议结束后恢复待办提醒',done:false,createdAt:Date.now(),deadline:new Date(Date.now()+1800000).toISOString(),remindedAt:0}];
    renderTodoBoard(); saveData(data); return true;
  })()`);
  await sleep(350);
  assert.equal(await js('data.P0[0].remindedAt'), 0, 'suppressed todo is not consumed');
  assert.equal(bubbleVisible(), false);
  await js('notchAPI.setMeetingMode(true)');
  await js('document.getElementById("settings-auto-meeting-mode").click()');
  await until(async () => (await state()).autoMeetingMode === false, 'automatic preference saved');
  await send('手动模式仍然生效'); await sleep(250); assert.equal(bubbleVisible(), false);
  assert.equal((await state()).meetingMode, true);
  await js('notchAPI.setMeetingMode(false)');
  await until(bubbleVisible, 'unseen todo restored after all meeting conditions clear');
  await until(() => js('data.P0[0].remindedAt > 0'), 'todo display receipt');
  const reminder = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/renderer/notification.html') && window.isVisible());
  await sleep(350); fs.writeFileSync(path.join(output, 'automatic-todo-resumed.png'), (await reminder.capturePage()).toPNG());
  await js('notchAPI.setTaskNotifications(false); notchAPI.setMeetingMode(true); notchAPI.setMeetingMode(false)');
  assert.equal((await state()).taskNotifications, false, 'manual and automatic toggles preserve bubble preference');
  await send('顶部提示原本关闭'); await sleep(250); assert.equal(bubbleVisible(), false);
  await new Promise(resolve => { contents.once('did-finish-load', resolve); contents.reload(); });
  await until(() => js('!!window.NotchWorkspace'), 'reload');
  assert.equal((await state()).autoMeetingMode, false);
  assert.equal((await state()).meetingMode, false);
  assert.equal((await state()).taskNotifications, false);
  await js('setActiveTab("settings"); document.getElementById("settings-auto-meeting-mode").scrollIntoView({block:"center"})');
  await capture('automatic-off');
}
require('../main.js');
