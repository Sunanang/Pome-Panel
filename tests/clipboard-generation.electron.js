'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, clipboard, systemPreferences } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
// No real clipboard contents or native media permission prompts are used.
let currentText = 'fixture baseline', nextRead = null, readCount = 0;
const items = text => [{ types: ['text/plain'], getType: async () => new Blob([text]) }];
clipboard.read = async () => {
  readCount++;
  if (nextRead) { const read = nextRead; nextRead = null; return read(); }
  return items(currentText);
};
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false;
const watchdog = setTimeout(() => { console.error('Clipboard generation integration timed out'); app.exit(1); }, 30000);
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(contents).then(() => { clearTimeout(watchdog); console.log('Clipboard restart drops stale reads; permission requests restore floating; panel reset reports write failure and retries'); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(contents) {
  const js = code => contents.executeJavaScript(code);
  const until = async check => {
    for (let i = 0; i < 250; i++) { if (await check()) return; await delay(25); }
    throw new Error('Timed out: ' + String(check));
  };
  const shots = process.env.POME_CLIPBOARD_SHOTS || path.join(__dirname, '../dist.noindex/clipboard-generation');
  fs.mkdirSync(shots, { recursive: true });
  const capture = async name => {
    await js('document.fonts.ready;document.querySelector("#ui-capsule-hint button")?.click()');
    await delay(500);
    fs.writeFileSync(path.join(shots, `${name}.png`), (await contents.capturePage()).toPNG());
  };
  await until(() => js('!!window.NotchWorkspace && !workspaceReloadPending'));
  assert.equal((await js('notchAPI.setFeature("clip",true)')).ok, true);
  await until(() => readCount > 0);
  let resolveOld, oldStarted = false;
  nextRead = () => { oldStarted = true; return new Promise(resolve => { resolveOld = resolve; }); };
  await until(() => oldStarted);
  await js('notchAPI.setFeature("clip",false)');
  currentText = 'fixture new baseline';
  const beforeBaseline = readCount;
  await js('notchAPI.setFeature("clip",true)');
  await until(() => readCount > beforeBaseline);
  resolveOld(items('fixture stale disabled observation'));
  await delay(650);
  const history = () => js('getWorkspaceSnapshotForSync().clipboard.history');
  assert.deepEqual(await history(), [], 'neither the old read nor the new baseline may become history');
  currentText = '新周期有效的剪贴板内容';
  await until(async () => (await history()).some(row => row.text === currentText));
  assert.equal((await history()).length, 1);
  await js('(async()=>{await setMode(true);await setActiveTab("clip")})()');
  await capture('clipboard-current-generation');

  const win = BrowserWindow.fromWebContents(contents);
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus, request = systemPreferences.askForMediaAccess;
    const setTop = win.setAlwaysOnTop.bind(win), calls = [];
    try {
      systemPreferences.getMediaAccessStatus = () => 'not-determined';
      systemPreferences.askForMediaAccess = async () => true;
      win.setAlwaysOnTop = (...args) => { calls.push(args); return setTop(...args); };
      assert.equal(await js('notchAPI.ensureMicrophone()'), true);
      assert.deepEqual(calls.at(-1), [true, 'floating']);
      assert.equal(win.isAlwaysOnTop(), true);
    } finally {
      systemPreferences.getMediaAccessStatus = status;
      systemPreferences.askForMediaAccess = request;
      win.setAlwaysOnTop = setTop;
    }
  }
  await js('setActiveTab("settings")');
  const rename = fs.renameSync, beforeBounds = win.getBounds();
  let fail = true;
  try {
    fs.renameSync = (from, to) => {
      if (fail && to === path.join(profile, 'app-settings.json')) { fail = false; throw new Error('fixture_reset_write_failed'); }
      return rename(from, to);
    };
    await js('document.getElementById("settings-reset-panel-position").click()');
    await until(() => js('!document.getElementById("settings-reset-panel-position").disabled && !document.getElementById("ui-error-bar").hidden'));
    assert.deepEqual(win.getBounds(), beforeBounds);
    await capture('panel-reset-write-failure');
    await js('document.getElementById("settings-reset-panel-position").click()');
    await until(() => js('!document.getElementById("settings-reset-panel-position").disabled && document.getElementById("ui-error-bar").hidden'));
  } finally { fs.renameSync = rename; }
}
require('../main.js');
