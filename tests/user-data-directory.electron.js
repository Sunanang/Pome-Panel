'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage, dialog } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
const phase = process.env.POME_PROFILE_PHASE || 'seed';
const appData = path.join(profile, 'application-data');
const legacy = path.join(appData, 'Dynamic Panel'), target = path.join(appData, 'Pome Panel');
fs.mkdirSync(appData, { recursive: true });
app.setPath('appData', appData);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
if (phase === 'seed') {
  fs.mkdirSync(path.join(legacy, 'recordings'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'recordings', 'recording-test.webm'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(legacy, 'workspace.json'), JSON.stringify({ version: 1, localStorage: { 'notch-home-note': 'older disk snapshot' } }));
  fs.writeFileSync(path.join(legacy, 'workspace-settings.json'), JSON.stringify({ path: legacy }));
  app.commandLine.appendSwitch('user-data-dir', legacy);
}
if (phase === 'restart') {
  fs.writeFileSync(path.join(legacy, 'workspace.json'), JSON.stringify({ localStorage: { 'notch-home-note': 'other app changed' } }));
  app.whenReady().then(() => fs.writeFileSync(path.join(legacy, 'sync-credentials.json'), JSON.stringify({
    payload: safeStorage.encryptString(JSON.stringify({ deviceToken: 'other-app-token', deviceId: 'other-app-device', uid: 'other-user', serverId: 'other-server' })).toString('base64'),
  })));
}
if (phase === 'custom') {
  const custom = path.join(profile, 'custom-workspace'); fs.mkdirSync(custom, { recursive: true });
  fs.writeFileSync(path.join(custom, 'workspace.json'), JSON.stringify({ localStorage: { 'notch-home-note': 'custom data retained' } }));
  fs.writeFileSync(path.join(target, 'workspace-settings.json'), JSON.stringify({ path: custom }));
}
if (phase === 'fresh') {
  const fresh = path.join(profile, 'fresh-application-data'); fs.mkdirSync(fresh);
  app.setPath('appData', fresh);
}
const selectedFolders = [];
if (phase === 'switch') {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolders.shift()] });
  dialog.showMessageBox = async () => ({ response: 0 });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Profile migration timed out:', phase); app.exit(1); }, 30000);
let started = false;
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(contents).then(() => { clearTimeout(watchdog); console.log('Profile directory passed:', phase); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));

async function run(contents) {
  const js = code => contents.executeJavaScript(code);
  async function until(expression) {
    for (let i = 0; i < 300; i++) {
      try { if (await js(expression)) return; } catch {}
      await sleep(30);
    }
    throw new Error(`Timed out: ${expression}`);
  }
  const expected = phase === 'seed' ? 'older disk snapshot' : phase === 'custom' ? 'custom data retained' : 'latest browser note';
  for (let i = 0; i < 300; i++) {
    try { if (await js(`!!window.NotchWorkspace && ${phase === 'fresh' ? 'true' : `document.getElementById('home-note').value===${JSON.stringify(expected)}`}`)) break; } catch {}
    await sleep(30);
  }
  if (phase === 'seed') {
    assert.equal(app.getPath('userData'), legacy);
    await js(`clearInterval(workspacePersistenceTimer);localStorage.setItem('notch-home-note','latest browser note');
      localStorage.setItem('notch-workspace-root',${JSON.stringify(legacy)});
      localStorage.setItem('migration-preference','keep-this-value');
      localStorage.setItem('notch-recordings',JSON.stringify([{id:'saved',audioPath:${JSON.stringify(path.join(legacy, 'recordings', 'recording-test.webm'))},title:'原录音'}]));
      document.getElementById('home-note').value='latest browser note'`);
    contents.session.flushStorageData(); await sleep(150);
    fs.writeFileSync(path.join(legacy, 'saved-secret.json'), safeStorage.encryptString('fixture-encrypted-value'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(legacy, 'workspace.json'))).localStorage['notch-home-note'], 'older disk snapshot');
    return;
  }
  assert.equal(path.basename(app.getPath('userData')), 'Pome Panel');
  const workspace = await js('notchAPI.getWorkspace()');
  if (phase !== 'fresh') assert.equal(await js('document.getElementById("home-note").value'), expected);
  if (phase === 'migrate' || phase === 'restart') {
    assert.equal(workspace.path, target); assert.equal(workspace.portable, false);
    assert.equal(await js('localStorage.getItem("migration-preference")'), 'keep-this-value');
    assert.equal(await js('JSON.parse(localStorage.getItem("notch-recordings"))[0].audioPath'), 'recordings/recording-test.webm');
    assert.deepEqual([...((await js('notchAPI.readRecording("recordings/recording-test.webm")')).bytes)], [1, 2, 3]);
    assert.equal(safeStorage.decryptString(fs.readFileSync(path.join(target, 'saved-secret.json'))), 'fixture-encrypted-value');
    assert.equal(JSON.parse(fs.readFileSync(path.join(legacy, 'workspace.json'))).localStorage['notch-home-note'], phase === 'restart' ? 'other app changed' : 'older disk snapshot');
    if (phase === 'restart') assert.equal((await js('notchAPI.syncGetStatus()')).bound, false, 'Never import another app’s new NAS credentials');
  }
  if (phase === 'custom') { assert.equal(workspace.path, path.join(profile, 'custom-workspace')); assert.equal(workspace.portable, true); }
  if (phase === 'switch') {
    await until('!!workspacePersistenceTimer && !workspaceReloadPending');
    const targetFile = path.join(target, 'workspace.json');
    const legacyFile = path.join(legacy, 'workspace.json');
    fs.writeFileSync(legacyFile, JSON.stringify({ localStorage: {
      'notch-home-note': 'other app changed', 'legacy-only-key': 'keep in legacy only',
    } }));
    async function choose(folder, note) {
      selectedFolders.push(folder);
      await js('notchAPI.chooseWorkspace()').catch(() => {});
      await until(`!!workspacePersistenceTimer && !workspaceReloadPending
        && localStorage.getItem('notch-workspace-root')===${JSON.stringify(folder)}
        && document.getElementById('home-note').value===${JSON.stringify(note)}`);
    }
    await choose(legacy, 'other app changed');
    assert.equal(await js('localStorage.getItem("legacy-only-key")'), 'keep in legacy only');
    await choose(target, 'latest browser note');
    assert.equal(await js('localStorage.getItem("legacy-only-key")'), null);
    await sleep(2200);
    assert.equal(JSON.parse(fs.readFileSync(targetFile)).localStorage['notch-home-note'], 'latest browser note');
    assert.equal(JSON.parse(fs.readFileSync(legacyFile)).localStorage['notch-home-note'], 'other app changed');
    assert.equal(fs.existsSync(path.join(target, '.pome-profile-migration.json')), false);
    assert.equal((await js('notchAPI.getWorkspace()')).previousDefaultPath, undefined);
    // Recover even if a crash lost the renderer's explicit-switch event.
    await js(`clearInterval(workspacePersistenceTimer); sessionStorage.clear();
      localStorage.setItem('notch-workspace-root',${JSON.stringify(legacy)});
      localStorage.setItem('notch-home-note','stale old workspace after crash'); location.reload()`);
    await until('!!workspacePersistenceTimer && !workspaceReloadPending && document.getElementById("home-note").value==="latest browser note"');
    await sleep(2200);
    assert.equal(JSON.parse(fs.readFileSync(targetFile)).localStorage['notch-home-note'], 'latest browser note');
  }
  if (phase === 'switched-restart') {
    assert.equal(workspace.path, target);
    assert.equal(workspace.previousDefaultPath, undefined);
    assert.equal(await js('localStorage.getItem("legacy-only-key")'), null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(legacy, 'workspace.json'))).localStorage['notch-home-note'], 'other app changed');
  }
  await js('setMode(true)'); await sleep(650); await js('setActiveTab("settings")'); await sleep(150);
  await js('document.getElementById("settings-workspace-path").scrollIntoView({block:"center"})'); await sleep(100);
  assert.equal(await js('document.getElementById("settings-workspace-path").title'), workspace.path);
  const output = process.env.POME_PROFILE_SCREENSHOTS || path.join(__dirname, '../dist.noindex/profile-directory');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${phase}.png`), (await contents.capturePage()).toPNG());
}
require('../main');
