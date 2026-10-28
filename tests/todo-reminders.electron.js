'use strict';
// Production IPC + actual notification entry acknowledgements, isolated disk.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { app, BrowserWindow } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS = '1';
process.env.POME_TEST_LANGUAGE = 'zh-CN';
const output = path.join(__dirname, '../dist.noindex/todo-reminders');
fs.mkdirSync(output, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const notification = () => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().endsWith('/renderer/notification.html'));
const evaluate = (win, code) => win.webContents.executeJavaScript(code, true);
async function until(check, label) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(20); }
  throw new Error('Timed out: ' + label);
}
let started = false;
const watchdog = setTimeout(() => { console.error('Todo reliability timeout'); app.exit(1); }, 75000);
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(contents).then(() => { clearTimeout(watchdog); console.log('Todo reminders: ' + (process.env.POME_TODO_RESTART ? 'durable restart' : 'display receipts, queue recovery, deadline edits, deletion, summary and storage retry') + ' passed'); app.exit(0); })
    .catch(async error => { console.error(error); try { fs.writeFileSync(path.join(output, 'failure.png'), (await contents.capturePage()).toPNG()); } catch {} app.exit(1); });
}));
async function run(c) {
  const js = code => c.executeJavaScript(code, true);
  await until(() => js('!!window.NotchWorkspace && !workspaceReloadPending && !tabBusy'), 'workspace startup');
  const root = (await js('notchAPI.getWorkspace()')).path;
  const receiptPath = path.join(root, 'todo-reminders.json');
  const rows = () => js('PRIORITIES.flatMap(p=>data[p]||[])');
  const toggle = value => js(`notchAPI.setTaskNotifications(${value})`);
  async function shown(title) {
    await until(async () => { const w = notification(); return w && await evaluate(w, `currentNotification?.title===${JSON.stringify(title)} && isVisible && !isHiding`); }, title);
    const w = notification();
    await delay(500);
    return w;
  }
  async function dismiss(w) { await evaluate(w, "document.getElementById('notification-close').click()"); await delay(650); }
  async function capture(w, name) {
    if (w.webContents.getURL().endsWith('/renderer/index.html')) {
      await evaluate(w, `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      await evaluate(w, `Promise.allSettled([...document.querySelectorAll('#app,#panel,.tab-panel')].flatMap(el=>el.getAnimations()).filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime)).map(a=>a.finished))`);
      await until(() => evaluate(w, `[...document.querySelectorAll('.tab-panel:not(.active)')].every(el=>getComputedStyle(el).visibility==='hidden' && Number(getComputedStyle(el).opacity)===0)`), 'inactive pages finished fading');
      await delay(60);
    }
    fs.writeFileSync(path.join(output, name + '.png'), (await w.capturePage()).toPNG());
  }
  const item = (id, offset = 1800000) => ({ id, text: id, done: false, createdAt: Date.now(), deadline: new Date(Date.now() + offset).toISOString(), remindedAt: 0 });
  async function install(items) {
    await js(`(() => { for(const p of PRIORITIES)data[p]=[];data.P0=${JSON.stringify(items)};renderTodoBoard();saveData(data);return true;})()`);
  }
  if (process.env.POME_TODO_RESTART) {
    await until(async () => (await rows()).some(row => row.id === 'restart-unseen'), 'restart data restored');
    assert.equal((await rows()).find(row => row.id === 'storage-retry').remindedAt > 0, true, 'receipt restores stale persisted projection after restart');
    assert.equal((await rows()).find(row => row.id === 'restart-unseen').remindedAt, 0);
    await toggle(true);
    const w = await shown('restart-unseen');
    assert.equal(await evaluate(w, 'queueElement.hidden || !queueElement.textContent'), true, 'already shown task never queues again');
    await capture(w, 'restart-unseen-recovered'); await dismiss(w);
    return;
  }
  await js('window.todoReceiptEvents=[];notchAPI.onTodoReminder(p=>todoReceiptEvents.push(p));true');
  assert.equal((await js(`notchAPI.scheduleTodoReminders([],${JSON.stringify(root + '-old-workspace')})`)).error, 'stale_workspace');
  await toggle(false);
  const queued = [item('队列恢复 A'), item('队列恢复 B')];
  await install(queued); await delay(150);
  assert((await rows()).every(row => row.remindedAt === 0), 'disabled must not consume');
  await toggle(true); let w = await shown(queued[0].text);
  assert((await rows()).find(row => row.id === queued[0].id).remindedAt > 0);
  assert.equal((await rows()).find(row => row.id === queued[1].id).remindedAt, 0, 'queued but unseen remains unconsumed');
  assert.equal(await evaluate(w, 'queueElement.textContent'), '+1');
  await capture(w, 'unseen-queue');
  await toggle(false); await delay(350); await toggle(true);
  w = await shown(queued[1].text);
  assert.equal(await js(`todoReceiptEvents.filter(p=>p.id===${JSON.stringify(queued[0].id)}).length`), 1);
  await dismiss(w);

  const edited = item('快速修改截止时间'); await install([edited]); w = await shown(edited.text);
  const nextDeadline = new Date(Date.parse(edited.deadline) + 60000).toISOString();
  await js(`editTodo('P0',${JSON.stringify(edited.id)},'修改后的新提醒',${JSON.stringify(nextDeadline)})`);
  assert.equal((await rows())[0].remindedAt, 0);
  await dismiss(w); w = await shown('修改后的新提醒');
  assert.equal((await rows())[0].deadline, nextDeadline);
  assert((await rows())[0].remindedAt > 0);
  await capture(w, 'edited-deadline'); await dismiss(w);

  const cancelled = [item('保留正在显示项'), item('删除尚未展示项')];
  await install(cancelled); w = await shown(cancelled[0].text);
  await js(`data.P0=data.P0.filter(row=>row.id!==${JSON.stringify(cancelled[1].id)});saveData(data);true`);
  await dismiss(w);
  assert(!notification() || !notification().isVisible(), 'deleted queued task cannot appear');

  const overdue = Array.from({ length: 4 }, (_, i) => item('过期待办 ' + (i + 1), -60000 * (i + 1)));
  await install(overdue); w = await shown('4 项待办已过期');
  assert.equal(await evaluate(w, 'detailElement.textContent'), '打开待办，一起查看并处理');
  assert((await rows()).every(row => row.remindedAt > 0));
  assert.equal(await evaluate(w, 'queueElement.hidden || !queueElement.textContent'), true);
  await capture(w, 'overdue-summary');
  const summaryEvent = await evaluate(w, 'currentNotification.eventId');
  await js("notchAPI.setLanguage('en-US')");
  await until(async () => await evaluate(w, "titleElement.textContent==='4 overdue tasks' && detailElement.textContent==='Open Tasks to review them together'"), 'active summary changes language');
  assert.equal(await evaluate(w, 'currentNotification.eventId'), summaryEvent);
  await capture(w, 'overdue-summary-live-en');
  await js("notchAPI.setLanguage('zh-CN')");
  const canFocus = await js('notchAPI.capabilities.features.windowFocus');
  await evaluate(w, 'void activateNotification()');
  if (!canFocus) {
    await until(() => !notification() || !notification().isVisible(), 'native-off notification only dismisses');
    c.send('app:open-todo', { id: overdue[0].id, ids: overdue.map(row => row.id) });
  }
  await until(() => js("isExpanded && !modeBusy && activeTab==='todo' && document.querySelectorAll('.todo-item.is-reminder-focus').length===4"), 'summary opens and highlights all tasks');
  await js("document.querySelector('#ui-capsule-hint button')?.click();true");
  await capture(BrowserWindow.fromWebContents(c), 'summary-open-tasks');
  await delay(600);
  await js("notchAPI.setLanguage('en-US')");
  await install(Array.from({ length: 3 }, (_, i) => item('English overdue ' + i, -60000)));
  w = await shown('3 overdue tasks'); await capture(w, 'overdue-summary-en'); await dismiss(w);
  await js("notchAPI.setLanguage('zh-CN')");

  const failed = item('storage-retry'), rename = fs.renameSync, before = fs.readFileSync(receiptPath, 'utf8');
  fs.renameSync = (from, to) => { if (to === receiptPath) throw Object.assign(new Error('fixture ENOSPC'), { code: 'ENOSPC' }); return rename(from, to); };
  try {
    await install([failed]); w = await shown(failed.text);
    await until(() => js("!document.getElementById('ui-error-bar').hidden"), 'persistent storage error');
    assert.equal((await rows())[0].remindedAt, 0);
    assert.equal(fs.readFileSync(receiptPath, 'utf8'), before);
    assert.equal(await js("document.getElementById('ui-error-bar').textContent.includes('数据文件夹权限')"), true);
    assert.equal(await js("document.querySelector('#ui-error-details pre').textContent.includes('ENOSPC')"), true);
    assert.equal((await js('notchAPI.scheduleTodoReminders(PRIORITIES.flatMap(p=>data[p]||[]))')).ok, false, 'retry while disk is still failing cannot report success');
    assert.equal(await js("document.getElementById('ui-error-bar').hidden"), false);
    await capture(BrowserWindow.fromWebContents(c), 'receipt-write-failure');
  } finally { fs.renameSync = rename; }
  await js("document.querySelector('#ui-error-bar button').click();true");
  await until(async () => (await rows())[0].remindedAt > 0, 'storage retry persists receipt');
  await until(() => js("document.getElementById('ui-error-bar').hidden"), 'successful retry clears scoped error');
  await dismiss(w);
  await toggle(false);
  // Persist a deliberately stale projection: only the durable receipt can
  // prevent its already displayed task from replaying in the next process.
  const restartRows = [failed, item('restart-unseen')];
  await install(restartRows); await delay(120);
  await js(`(() => { data.P0=${JSON.stringify(restartRows)};localStorage.setItem(STORAGE_KEY,JSON.stringify(data));return true;})()`);
  assert.equal(await js('notchAPI.saveWorkspaceData(collectLocalStorageSnapshot())'), true);
  c.session.flushStorageData();
}
require('../main');
