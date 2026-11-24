'use strict';
// Acceptance for the 2026-03 AI attention / source visibility bugfix pack:
// 1) fully-hidden quota sources show dedicated empty copy
// 2) damaged config with Pome traces still offers disconnect and clears after apply
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const profile = process.env.TODO_TEST_USER_DATA;
const home = path.join(profile, 'isolated-home');
fs.mkdirSync(home);
// 跳过首次欢迎引导，保证截图能看到额度空态与设置页本身。
fs.writeFileSync(path.join(profile, '.first-run-done'), String(Date.now()));
fs.writeFileSync(path.join(profile, '.ui-welcome-done'), String(Date.now()));
process.env.POME_HOOK_TEST_HOME = home;
process.env.POME_TEST_NOTIFICATIONS = '1';
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });

const output = process.env.POME_BUGFIX_SHOTS || path.join(__dirname, '../dist.noindex/bugfix-ai-attention');
fs.mkdirSync(output, { recursive: true });

const mainText = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
assert.match(mainText, /if \(result\.source === 'codex'\) stopCodexAttentionBridge\(\)/, 'disconnect must stop the app-server observer');
assert.match(mainText, /autoRestartMs:/, 'unexpected proxy exit must reconnect inside the bridge');
assert.doesNotMatch(mainText, /scheduleCodexAttentionBridgeRestart/, 'a second main-level restart would stack observers');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let started = false;
const errors = [];
const watchdog = setTimeout(() => {
  console.error('bugfix-ai-attention timed out', errors);
  app.exit(1);
}, 90000);

app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', details => {
    if (details.level === 'error' && !details.message.includes('ERR_')) errors.push(details.message);
  });
  contents.once('did-finish-load', () => {
    if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(contents).then(() => {
      clearTimeout(watchdog);
      console.log('bugfix-ai-attention passed:', output);
      app.exit(0);
    }).catch(error => {
      console.error(error, errors);
      app.exit(1);
    });
  });
});

async function run(contents) {
  const js = code => contents.executeJavaScript(code);
  async function until(expr, label = expr) {
    for (let i = 0; i < 400; i++) {
      try { if (await js(expr)) return; } catch {}
      await sleep(25);
    }
    throw new Error('Timeout: ' + label);
  }
  async function capture(name) {
    await sleep(400);
    fs.writeFileSync(path.join(output, `${name}.png`), (await contents.capturePage()).toPNG());
  }

  await until('!!window.NotchAiUsage && !!window.NotchAiSourceVisibility && !!window.NotchAiSources?.getState().ready');
  // 关掉首次提示，并把额度组件放到可见布局，方便定点截图。
  await js(`localStorage.setItem('pome-capsule-hints-v1', '99')`);
  await js('setMode(true)');
  await until(`document.getElementById('home-cursor') && document.getElementById('ai-usage-empty')`);
  await js(`(() => { const hint = document.getElementById('ui-capsule-hint'); if (hint) hint.hidden = true; })()`);
  await js(`(() => {
    hiddenHomeModules = HOME_MODULE_REGISTRY.filter(id => !['cursor', 'inbox', 'note'].includes(id));
    homeSizes = { ...homeSizes, cursor: 'small' };
    homeWorkingLayout = NotchDomain.resolveHomeWidgetLayout(homeOrder, homeSizes, hiddenHomeModules);
    applyHomeLayout(homeWorkingLayout, { reason: 'initial' });
  })()`);
  await until(`!document.getElementById('home-cursor').hidden`);

  // Hide every usage provider so the empty state must stop saying Cursor/Codex undetected.
  await js(`(() => {
    const ids = window.NotchAiProviders.usageProviders().map(row => row.id);
    for (const id of ids) window.NotchAiSourceVisibility.hide(id);
    return window.NotchAiUsage.refresh({ force: true });
  })()`);
  await until(`!document.getElementById('ai-usage-empty').hidden && document.querySelector('#ai-usage-empty .ai-empty-title')?.textContent === 'AI 来源已隐藏'`);
  assert.equal(await js(`document.querySelector('#ai-usage-empty .ai-empty-body').textContent.includes('设置 → AI 来源')`), true);
  assert.equal(await js(`document.querySelector('#ai-usage-empty .ai-empty-bars')?.innerHTML || ''`), '');
  const quotaRect = await js(`(() => {
    const r = document.getElementById('home-cursor').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, dpr: devicePixelRatio };
  })()`);
  await sleep(400);
  {
    const shot = await contents.capturePage();
    fs.writeFileSync(path.join(output, 'quota-all-hidden.png'), shot.crop({
      x: Math.max(0, Math.round(quotaRect.x * quotaRect.dpr)),
      y: Math.max(0, Math.round(quotaRect.y * quotaRect.dpr)),
      width: Math.max(1, Math.round(quotaRect.width * quotaRect.dpr)),
      height: Math.max(1, Math.round(quotaRect.height * quotaRect.dpr)),
    }).toPNG());
  }

  await js(`(() => {
    window.NotchAiSourceVisibility.clear();
    return window.NotchAiUsage.refresh({ force: true });
  })()`);
  await until(`document.querySelector('#ai-usage-empty .ai-empty-title')?.textContent !== 'AI 来源已隐藏'`);

  for (const dir of ['.codex', '.claude', '.cursor']) fs.mkdirSync(path.join(home, dir));
  const config = path.join(home, '.codex/config.toml');
  const damaged = 'not [ valid { config\nnotify = ["node", "/tmp/codex-notify.js", "--pome-panel-hook=codex"]\n';
  fs.writeFileSync(config, damaged);

  await js(`setActiveTab('settings')`);
  await until(`activeTab==='settings'`);
  await js(`NotchSettings.select('ai')`);
  await js('NotchAiSources.refresh()');
  await until(`NotchAiSources.getState().sources.find(row => row.source === 'codex')?.installed === true`);
  const row = await js(`(() => {
    const source = NotchAiSources.getState().sources.find(row => row.source === 'codex');
    const buttons = Array.from(document.querySelectorAll('.ai-source-row[data-source="codex"] button')).map(button => button.textContent);
    return { state: source.state, installed: source.installed, repairable: source.repairable, buttons };
  })()`);
  assert.equal(row.state, 'error');
  assert.equal(row.installed, true);
  assert.equal(row.repairable, false);
  assert.ok(row.buttons.includes('断开'), `expected disconnect on damaged config, got ${row.buttons.join(',')}`);
  await capture('settings-damaged-codex-disconnect');

  await js(`Array.from(document.querySelectorAll('.ai-source-row[data-source="codex"] button')).find(button => button.textContent === '断开').click()`);
  await until(`document.getElementById('ai-source-confirm').open`);
  assert.match(await js(`document.getElementById('ai-source-confirm-content').textContent`), /损坏|空配置|痕迹/);
  await capture('settings-damaged-codex-confirm');
  await js(`document.getElementById('ai-source-confirm-apply').click()`);
  await until(`NotchAiSources.getState().sources.find(row => row.source === 'codex')?.installed === false`);
  assert.equal(fs.readFileSync(config, 'utf8'), '');
  assert.ok(fs.readdirSync(path.dirname(config)).some(name => name.includes('.pome-backup-')));
  await capture('settings-damaged-codex-cleared');

  // 通知窗与主窗共用 preload：敏感 IPC 必须拒绝非主窗 sender。
  const { BrowserWindow } = require('electron');
  const outsider = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: require('path').join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await new Promise((resolve, reject) => {
    outsider.webContents.once('did-finish-load', resolve);
    outsider.webContents.once('did-fail-load', (_e, code, desc) => reject(new Error(desc || String(code))));
    outsider.loadURL('about:blank');
  });
  const denied = await outsider.webContents.executeJavaScript(
    `notchAPI.getCredential('any').then(r => r, e => ({ threw: String(e && e.message || e) }))`
  );
  outsider.destroy();
  assert.ok(
    denied?.threw?.includes('workspace_owner_required') || denied?.error === 'workspace_owner_required',
    `notification-like sender must not read credentials: ${JSON.stringify(denied)}`
  );
  await capture('settings-ipc-owner-guard');

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    hiddenEmptyCopy: true,
    damagedDisconnect: true,
    bridgeStopOnDisconnect: true,
    ipcOwnerGuard: true,
    consoleErrors: errors,
  }, null, 2));
}

require('../main.js');
