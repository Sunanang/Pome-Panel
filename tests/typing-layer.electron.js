'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { app, BrowserWindow, systemPreferences } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
assert(profile, 'isolated profile required');
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('./provider-usage-fixtures.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Typing layer regression timed out'); app.exit(1); }, 45000);
let started = false;
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(contents).then(() => { clearTimeout(watchdog); console.log('Typing focus, IME candidate layering, collapse and permission restoration passed'); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(contents) {
  const win = BrowserWindow.fromWebContents(contents), js = code => contents.executeJavaScript(code);
  const until = async check => { for (let i = 0; i < 200; i++) { if (await check()) return; await sleep(25); } throw Error('Timed out: '+check); };
  await until(() => js('!!window.NotchWorkspace&&!workspaceReloadPending'));
  // This fixture drives native focus explicitly; focus-loss collapse has its own suite.
  win.removeAllListeners('blur');
  win.show(); win.focus(); contents.focus();
  const calls = [], originalTop = win.setAlwaysOnTop.bind(win);
  win.setAlwaysOnTop = (...args) => { calls.push(args); return originalTop(...args); };
  const normal = process.platform === 'darwin' ? 'status' : 'floating';
  const last = () => calls.at(-1);
  await js('(async()=>{await setMode(true);await setActiveTab("home");document.getElementById("home-note").focus()})()');
  await until(() => last()?.[1] === 'floating');
  assert.equal(win.isAlwaysOnTop(), true);
  await js('document.getElementById("home-note").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:"ni"}))');
  assert.equal(last()[1], 'floating');

  // The actual system IME is optional, explicit, and restores the selected input source.
  const helper = process.env.POME_IME_NATIVE_HELPER;
  if (helper && process.platform === 'darwin') {
    const invoke = async (...args) => (await execFile(helper, args, { timeout: 6000 })).stdout.trim();
    const previous = await invoke('current');
    try {
      app.focus({ steal: true }); win.focus(); contents.focus();
      assert.equal(await invoke('select', 'com.apple.inputmethod.SCIM.ITABC'), '0');
      await sleep(300);
      await js('document.querySelector("#ui-capsule-hint button")?.click();document.getElementById("home-note").value="";document.getElementById("home-note").focus()');
      console.log('Native key access', await invoke('type')); await sleep(800);
      const rows = JSON.parse(await invoke('windows', [process.pid,process.env.POME_IME_FULLSCREEN_PID].filter(Boolean).join(',')));
      
      const own = rows.find(row => row.pid === process.pid && row.bounds.Width > 500);
      const candidates = rows.filter(row => row.pid === process.pid && row.number !== own?.number && row.layer > 0); // AppKit's IME panel can belong to Electron's own PID.
      assert(own && candidates.length, 'real system candidate window must be visible');
      if (process.env.POME_IME_FULLSCREEN_PID) assert(rows.some(row => row.pid === Number(process.env.POME_IME_FULLSCREEN_PID) && row.number === Number(process.env.POME_IME_FULLSCREEN_WINDOW)), 'fixture fullscreen Space remains onscreen during editing');
      assert(candidates.some(row => row.layer > own.layer), 'candidate must be above the editing panel');
      console.log('Native IME window levels', JSON.stringify({ panel: own.layer, candidates: candidates.map(row => row.layer) }));
      const output = process.env.POME_IME_SHOTS;
      if (output) {
        fs.mkdirSync(output, { recursive: true });
        const candidate = candidates.find(row => row.layer > own.layer).bounds;
        const crop = [candidate.X - 8, candidate.Y - 45, candidate.Width + 16, candidate.Height + 60];
        await execFile('/usr/sbin/screencapture', ['-x', '-R', crop.join(','), path.join(output, 'native-ime.png')]);
        fs.writeFileSync(path.join(output, 'native-checks.json'), JSON.stringify({ panel: own, candidates, fullscreen: rows.find(row => row.pid === Number(process.env.POME_IME_FULLSCREEN_PID)) || null }, null, 2));
      }
      await invoke('key', '49'); // Select the first real candidate with Space.
      await until(() => js('document.getElementById("home-note").value==="你好"'));
      console.log('Native IME candidate selection committed the expected Chinese text');
    } finally { assert.equal(await invoke('select', previous), '0', 'restore original input source'); }
  }
  // A permission prompt can finish while focus is still inside an editor.
  if (process.platform === 'darwin') {
    const get = systemPreferences.getMediaAccessStatus, ask = systemPreferences.askForMediaAccess;
    try {
      systemPreferences.getMediaAccessStatus = () => 'not-determined';
      systemPreferences.askForMediaAccess = async () => true;
      await js('document.getElementById("home-note").focus()');
      await until(() => last()?.[1] === 'floating');
      assert.equal(await js('notchAPI.ensureMicrophone()'), true);
      assert.deepEqual(last(), [true, 'floating']);
    } finally { systemPreferences.getMediaAccessStatus = get; systemPreferences.askForMediaAccess = ask; }
  }
  await js('document.getElementById("home-note").blur()');
  await until(() => last()?.[1] === normal);
  await js('document.getElementById("home-note").focus()');
  await until(() => last()?.[1] === 'floating');
  await js('setMode(false)');
  await until(() => last()?.[1] === normal);
  assert.equal(win.isAlwaysOnTop(), true);
  await js('setMode(true)');
  await until(() => js('isExpanded&&!modeBusy'));
  await js('document.getElementById("home-note").focus()');
  await until(() => last()?.[1] === 'floating');
  await js('document.getElementById("home-note").blur()');
  await until(() => last()?.[1] === normal);
}
require('../main.js');
