const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, clipboard, dialog } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken = () => ({ ok: false, error: 'fixture_missing' });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false, error: 'fixture_offline' });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false, error: 'fixture_missing' });

// Isolated fake clipboard: never overwrite or read the user's system clipboard.
let clipboardItems = [];
let stripMarker = false;
clipboard.write = async items => { clipboardItems = items; };
clipboard.writeText = async text => { clipboardItems = [{ types: ['text/plain'], getType: async () => new Blob([text]) }]; };
clipboard.read = async () => clipboardItems.map(item => stripMarker
  ? { types: ['text/plain'], getType: type => item.getType(type) } : item);
clipboard.readText = async () => clipboardItems.length ? (await clipboardItems[0].getType('text/plain')).text() : '';
clipboard.clear = () => { clipboardItems = []; };

const sourceFile = path.join(profile, 'workspace.json');
const target = path.join(profile, 'existing-workspace');
fs.mkdirSync(target);
fs.writeFileSync(sourceFile, JSON.stringify({ version: 1, localStorage: { 'notch-home-note': 'Source workspace' } }));
fs.writeFileSync(path.join(target, 'workspace.json'), JSON.stringify({ version: 1, localStorage: {
  'notch-home-note': 'Target workspace',
  'notch-todo-data': JSON.stringify({ P0: [], P1: [], P2: [], P3: [] }),
} }));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
dialog.showMessageBox = async () => ({ response: 0 });
const errors = [];
dialog.showErrorBox = (title, message) => { errors.push(`${title}: ${message}`); };
const watchdog = setTimeout(() => { console.error('Security/recovery checks timed out', errors); process.exit(1); }, 20000);
async function until(contents, expression) {
  for (let i = 0; i < 200; i++) {
    try { if (await contents.executeJavaScript(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${expression}`);
}
let started = false;
app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(contents).then(() => { clearTimeout(watchdog); console.log('Password exclusion and existing workspace switching checks passed'); process.exit(0); })
      .catch(error => { console.error(error, errors); process.exit(1); });
  });
});

async function run(contents) {
  await until(contents, `!!window.NotchWorkspace && document.getElementById('home-note').value === 'Source workspace'`);
  await contents.executeJavaScript(`window.notchAPI.setFeature('clip', true)`);
  await new Promise(resolve => setTimeout(resolve, 700));
  await contents.executeJavaScript(`(async () => {
    const saved = await window.notchAPI.saveCredential({service:'Fixture', account:'test', password:'fixture-secret-must-not-be-recorded'});
    if (!saved.ok) throw new Error(saved.error);
    await window.notchAPI.copyCredential(saved.item.id, 'password');
  })()`);
  assert(clipboardItems[0].types.some(type => /ConcealedType|ExcludeClipboardContentFromMonitorProcessing/.test(type)));
  stripMarker = true;
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(await contents.executeJavaScript(`JSON.stringify(collectLocalStorageSnapshot()).includes('fixture-secret-must-not-be-recorded')`), false);
  await contents.executeJavaScript(`localStorage.setItem('source-only-key','must disappear'); localStorage.setItem('notch-home-note','Latest source edit'); document.getElementById('home-note').value='Latest source edit';`);
  // The result may be lost when the renderer reloads; verify durable state instead.
  await contents.executeJavaScript(`window.notchAPI.chooseWorkspace()`).catch(() => {});
  await until(contents, `!!window.NotchWorkspace && document.getElementById('home-note').value === 'Target workspace'`);
  assert.equal(JSON.parse(fs.readFileSync(sourceFile)).localStorage['notch-home-note'], 'Latest source edit');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'workspace.json'))).localStorage['notch-home-note'], 'Target workspace');
  assert.equal(await contents.executeJavaScript(`localStorage.getItem('source-only-key')`), null);
  const staleWrite = await contents.executeJavaScript(`window.notchAPI.saveWorkspaceData({'notch-home-note':'stale'}, ${JSON.stringify(profile)})`);
  assert.equal(staleWrite, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'workspace.json'))).localStorage['notch-home-note'], 'Target workspace');
  // A crash between changing the main-process path and receiving its renderer
  // event loses sessionStorage. The persistent local root marker still recovers.
  await contents.executeJavaScript(`sessionStorage.clear(); localStorage.setItem('notch-workspace-root', ${JSON.stringify(profile)});
    localStorage.setItem('notch-home-note','Stale page after crash'); location.reload();`);
  await until(contents, `!!window.NotchWorkspace && document.getElementById('home-note').value === 'Target workspace'`);
  assert.equal(await contents.executeJavaScript(`collectLocalStorageSnapshot()['notch-workspace-root']`), undefined);
  assert.deepEqual(errors, []);
}

require('../main.js');
