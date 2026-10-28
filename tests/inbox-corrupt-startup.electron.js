'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, dialog, systemPreferences } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'task-inbox.json'), 'cold-start-corrupt-inbox');
// Run the normal bootstrap, while preventing host permissions/login changes.
delete process.env.TODO_TEST_USER_DATA;
app.getPreferredSystemLanguages = () => ['zh-CN'];
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
app.getLoginItemSettings = () => ({ openAtLogin: false });
app.setLoginItemSettings = () => {};
systemPreferences.subscribeNotification = () => 1;
systemPreferences.unsubscribeNotification = () => {};
const adapters = require('../platform-adapters'), loadAdapter = adapters.loadAdapter;
adapters.loadAdapter = (...args) => {
  const adapter = loadAdapter(...args);
  if (adapter.permissions) adapter.permissions.selfCheck = async () => new Promise(() => {});
  return adapter;
};
let cancel = true, rejectReads = false, rejected = 0, started = false;
dialog.showMessageBox = async () => ({ response: cancel ? 0 : 1 });
// Keep the real storage/error event, but also exercise a rejected IPC response
// after that event. This used to erase its recoverable flag in the renderer.
const register = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => register(channel, (event, ...args) => {
  const result = handler(event, ...args);
  if (channel === 'tasks:inbox' && rejectReads && result.ok === false) {
    rejected++;
    throw new Error('fixture_transport_rejection');
  }
  return result;
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Corrupt cold startup timed out'); app.exit(1); }, 30000);
app.on('web-contents-created', (_event, c) => c.once('did-finish-load', () => {
  if (started || !c.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(c).then(() => { clearTimeout(watchdog); console.log('Corrupt cold startup: recovery button, rejected IPC metadata, cancel and rebuild passed'); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(c) {
  const js = code => c.executeJavaScript(code);
  for (let i = 0; i < 200; i++) {
    if (await js(`!!window.NotchTaskInbox && !document.getElementById('task-inbox-rebuild').hidden`)) break;
    await sleep(25);
  }
  assert.equal(await js(`document.getElementById('task-inbox-rebuild').hidden`), false, 'B1: rebuild visible immediately on cold startup');
  assert.equal(await js(`document.getElementById('home-inbox-read-all').hidden`), true);
  assert.match(await js(`document.getElementById('task-inbox-status').textContent`), /文件损坏.*备份.*重建/);
  assert.equal(await js(`document.getElementById('task-inbox-status').textContent.includes('请打开收件箱')`), false);
  rejectReads = true;
  await js(`window.NotchTaskInbox.refresh()`);
  assert(rejected > 0);
  assert.equal(await js(`document.getElementById('task-inbox-rebuild').hidden`), false, 'B1: IPC rejection preserves recovery metadata');
  rejectReads = false;
  await js(`setMode(true)`);
  const artifacts = path.join(__dirname, '../dist.noindex/inbox-bento');
  fs.mkdirSync(artifacts, { recursive: true });
  await sleep(700);
  fs.writeFileSync(path.join(artifacts, 'cold-start-corrupt.png'), (await c.capturePage()).toPNG());
  await js(`document.getElementById('task-inbox-rebuild').click()`);
  await sleep(100);
  assert.equal(fs.readFileSync(path.join(profile, 'task-inbox.json'), 'utf8'), 'cold-start-corrupt-inbox');
  cancel = false;
  await js(`document.getElementById('task-inbox-rebuild').click()`);
  for (let i = 0; i < 200; i++) {
    if ((await js(`window.notchAPI.getTaskInbox()`)).ok) break;
    await sleep(25);
  }
  const state = await js(`window.notchAPI.getTaskInbox()`);
  assert.equal(state.ok, true); assert.equal(state.total, 0);
  const backup = fs.readdirSync(profile).find(name => name.startsWith('task-inbox.json.corrupt-'));
  assert(backup); assert.equal(fs.readFileSync(path.join(profile, backup), 'utf8'), 'cold-start-corrupt-inbox');
}
require('../main.js');
