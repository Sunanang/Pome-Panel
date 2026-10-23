'use strict';
const assert = require('node:assert/strict');
const { app, ipcMain } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_NOTIFICATIONS = '1';
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const adapters = require('../platform-adapters'), originalAdapter = adapters.loadAdapter;
adapters.loadAdapter = (...args) => {
  const adapter = originalAdapter(...args);
  adapter.windows.list = async () => ({ items: [], error: null });
  adapter.windows.resolveTaskApp = async () => null;
  return adapter;
};
let records = [], launchFailure = false;
const launches = [], queries = [];
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
  if (channel === 'tasks:inbox') handler = async (_event, options = {}) => {
    queries.push(options);
    const offset = options.offset || 0, limit = options.limit || 20;
    return { items: records.slice(offset, offset + limit), total: records.length,
      unread: records.filter(row => row.readAt === null).length, hasMore: offset + limit < records.length };
  };
  if (channel === 'tasks:read') handler = async (_event, id) => {
    const record = records.find(row => row.id === id); record.readAt = Date.now(); return { ok: true, record };
  };
  if (channel === 'tasks:open-source') handler = async (_event, id) => {
    const record = records.find(row => row.id === id); launches.push(record);
    return { ok: !launchFailure, message: launchFailure ? '未找到 Codex。' : '已打开来源软件。' };
  };
  return originalHandle(channel, handler);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
let started = false;
const watchdog = setTimeout(() => { console.error('Inbox pagination timed out', errors); app.exit(1); }, 60000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', details => { if (details.level === 'error' && !details.message.includes('ERR_')) errors.push(details.message); });
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(contents).then(() => { clearTimeout(watchdog); console.log('Inbox pagination boundaries, current page on new events, source clicks, hover labels and fixed height passed'); app.exit(0); })
      .catch(error => { console.error(error, errors); app.exit(1); });
  });
});
async function run(contents) {
  const js = code => contents.executeJavaScript(code);
  async function until(expression) { for (let i = 0; i < 250; i++) { if (await js(expression).catch(() => false)) return; await sleep(20); } throw new Error(expression); }
  function record(id, source = 'codex') { return { id, source, title: `完成 ${id}`, project: 'fixture', receivedAt: Date.now(), readAt: null, window: null }; }
  async function setCount(count) {
    records = Array.from({ length: count }, (_, index) => record(`record-${index}`, ['codex', 'cursor', 'claude'][index % 3]));
    await js('NotchTaskInbox.refresh()');
    await until(`document.getElementById('home-inbox-unread').textContent==='${count}'`);
  }
  async function paging() { return js(`({hidden:document.getElementById('home-inbox-pagination').hidden,buttons:Array.from(document.querySelectorAll('.home-inbox-pagination button'),b=>b.textContent),label:document.querySelector('.home-inbox-pagination span')?.textContent||'',page:document.getElementById('home-inbox').dataset.inboxPage})`); }
  async function next(page) { await js(`document.querySelector('.home-inbox-next').click()`); await until(`document.getElementById('home-inbox').dataset.inboxPage==='${page}'`); }
  await until('!!window.NotchTaskInbox'); await js('setMode(true)'); await sleep(650);
  assert.equal(await js(`document.getElementById('task-inbox-more')===null`), true);
  await setCount(11);
  for (const [size, limit] of [['mini', 1], ['small', 3], ['medium', 5], ['large', 10]]) {
    await js(`document.getElementById('home-inbox').dataset.widgetSize='${size}'`);
    await until(`document.querySelectorAll('.home-inbox-row').length===${size === 'mini' ? 0 : limit} && document.getElementById('home-inbox-pagination').hidden===${size === 'mini'}`);
    assert.equal(queries.at(-1).limit, limit, `${size} keeps its existing page size`);
    assert.equal(queries.at(-1).offset, 0);
    const state = await paging();
    assert.equal(state.hidden, size === 'mini');
    assert.deepEqual(state.buttons, size === 'mini' ? [] : ['下一页']);
    if (size === 'mini') {
      assert.equal(await js(`document.getElementById('home-inbox-mini').hidden`), false);
      assert.equal(await js(`document.getElementById('home-inbox-unread').textContent`), '11');
      assert.equal(await js(`document.getElementById('home-inbox-latest').title`), '打开 Codex · 已完成 · 完成 record-0');
      await js(`document.getElementById('home-inbox-latest').click()`);
      await until(`document.getElementById('task-inbox-status').textContent==='已打开来源软件。'`);
      assert.equal(launches.at(-1).id, 'record-0', 'mini still opens the latest record');
      assert.equal((await paging()).hidden, true);
    }
  }
  await js(`document.getElementById('home-inbox').dataset.widgetSize='medium'`);
  await until(`document.querySelectorAll('.home-inbox-row').length===5`);
  for (const count of [0, 3, 5]) {
    await setCount(count); assert.equal((await paging()).hidden, true);
    assert.equal(await js(`document.querySelectorAll('.home-inbox-row').length`), count);
  }
  await setCount(10);
  assert.deepEqual((await paging()).buttons, ['下一页']); assert.equal((await paging()).label, '');
  const height = await js(`document.getElementById('home-inbox').getBoundingClientRect().height`);
  await js(`document.getElementById('task-inbox-list').style.maxHeight='60px';document.getElementById('task-inbox-list').scrollTop=40`);
  await next(2);
  assert.deepEqual((await paging()).buttons, ['上一页']); assert.equal((await paging()).label, '第 2 页');
  assert.equal(await js(`document.getElementById('task-inbox-list').scrollTop`), 0);
  assert.equal(await js(`document.querySelectorAll('.home-inbox-row').length`), 5, 'exact full last page has no empty next page');
  assert.equal(await js(`document.getElementById('home-inbox').getBoundingClientRect().height`), height);
  await setCount(11); assert.deepEqual((await paging()).buttons, ['上一页', '下一页']);
  await next(3); assert.equal((await paging()).label, '第 3 页'); assert.deepEqual((await paging()).buttons, ['上一页']);
  assert.equal(await js(`document.querySelectorAll('.home-inbox-row').length`), 1);
  assert.equal(await js(`document.getElementById('home-inbox').getBoundingClientRect().height`), height);
  records.unshift(record('new-on-last-page'));
  contents.send('task-completion:new', records[0]);
  await until(`document.getElementById('home-inbox-unread').textContent==='12'`);
  assert.equal((await paging()).page, '3', 'new completion keeps the current page');
  for (let page = 2; page >= 1; page--) { await js(`document.querySelector('.home-inbox-pagination button').click()`); await until(`document.getElementById('home-inbox').dataset.inboxPage==='${page}'`); }
  records.unshift(record('new-on-first-page'));
  contents.send('task-completion:new', records[0]);
  await until(`document.querySelector('.home-inbox-row')?.dataset.id==='new-on-first-page'`);
  assert.equal((await paging()).page, '1');
  await setCount(3);
  for (const [index, source] of [[0, 'codex'], [1, 'cursor'], [2, 'claude']]) {
    assert.match(await js(`document.querySelectorAll('.home-inbox-row')[${index}].getAttribute('aria-label')`), source === 'codex' ? /打开 Codex/ : source === 'cursor' ? /打开 Cursor/ : /打开终端/);
    await js(`document.querySelectorAll('.home-inbox-row')[${index}].click()`);
    await until(`document.querySelectorAll('.home-inbox-row')[${index}].dataset.unread==='false' && document.getElementById('task-inbox-status').textContent==='已打开来源软件。'`);
    assert.equal(launches.at(-1).source, source); assert.equal(launches.at(-1).window, null);
  }
  launchFailure = true;
  await js(`document.querySelector('.home-inbox-row').click()`);
  await until(`document.getElementById('task-inbox-status').textContent==='未找到 Codex。'`);
  assert.equal(await js(`document.querySelector('.home-inbox-detail')===null`), true);
  assert(queries.some(query => query.offset === 5 && query.limit === 5));
  records[0] = { ...records[0], status: 'awaiting', sessionTitle: '原生会话', completionSummary: '完整摘要内容' };
  await js('NotchTaskInbox.refresh()');
  assert.equal(await js(`document.querySelector('.home-inbox-row').dataset.status`), 'awaiting');
  assert.equal(await js(`document.querySelector('.home-inbox-event-status').textContent`), '等待确认');
  assert.equal(await js(`document.querySelector('.home-inbox-row').title`), '原生会话\n完整摘要内容');
  assert.equal(await js(`document.querySelector('.home-inbox-copy strong').title`), '');
  records[0].status = 'failed'; await js('NotchTaskInbox.refresh()');
  assert.equal(await js(`document.querySelector('.home-inbox-event-status').textContent`), '出错');
  assert.deepEqual(errors, []);
}
require('../main.js');
