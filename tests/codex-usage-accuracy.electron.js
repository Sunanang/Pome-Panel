'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const home = path.join(profile, 'codex-telemetry');
const dir = path.join(home, 'sessions', '2026', '10', '23');
fs.mkdirSync(dir, { recursive: true });
const current = path.join(dir, 'rollout-current.jsonl');
const old = path.join(dir, 'rollout-resumed.jsonl');
const base = Date.now() - 5_000;
const line = (used, at) => JSON.stringify({ timestamp: new Date(at).toISOString(), type: 'event_msg', payload: {
  type: 'token_count', rate_limits: {
    primary: { used_percent: used, window_minutes: 300, resets_at: base / 1000 + 3600 },
    secondary: { used_percent: 20, window_minutes: 10080, resets_at: base / 1000 + 86400 },
    plan_type: 'plus',
  },
} }) + '\n';
fs.writeFileSync(old, line(20, base - 60_000));
fs.writeFileSync(current, line(50, base));
fs.utimesSync(old, 1, 1); fs.utimesSync(current, 2, 2);
const usage = require('../codex-usage'), readLocal = usage.readCodexUsage;
usage.readCodexUsage = options => readLocal({ ...options, homes: [home] });
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const output = process.env.CODEX_USAGE_SCREENSHOTS;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Codex accuracy test timed out'); app.exit(1); }, 60000);
let started = false;
app.on('web-contents-created', (_event, contents) => contents.once('did-finish-load', () => {
  if (started || !contents.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  verify(contents).then(() => {
    clearTimeout(watchdog);
    console.log('Codex accuracy: real IPC/local telemetry stays at 50% after old-session writes, then shows fresh 40% and legitimate reset 95%');
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}));
async function verify(contents) {
  const js = source => contents.executeJavaScript(source);
  async function until(source) {
    for (let i = 0; i < 150; i++) { if (await js(source)) return; await sleep(30); }
    throw new Error('Timed out: ' + source);
  }
  contents.debugger.attach('1.3');
  await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until('!!window.NotchAiUsage');
  await js(`setMode(true);setActiveTab('home');PomeI18n.setState(PomeI18n.snapshot('zh-CN',['zh-CN']));window.dispatchEvent(new Event('pome:language-changed'))`);
  await until('isExpanded && !modeBusy');
  await js(`hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='cursor');homeSizes.cursor='medium';homeWorkingLayout=null;applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});document.getElementById('ui-capsule-hint').hidden=true`);
  await js('document.fonts.ready');
  await js('Promise.allSettled(homeLayoutMotionAnimations.map(animation=>animation.finished))');
  async function check(remaining, imageName) {
    await js('NotchAiUsage.refresh({force:true})');
    await until(`document.querySelector('#ai-provider-codex .q-ring')?.getAttribute('aria-valuenow')==='${remaining}'`);
    assert.equal(await js(`document.querySelector('#ai-provider-codex [data-main-number]').textContent`), remaining + '%');
    if (output) {
      fs.mkdirSync(output, { recursive: true });
      await sleep(100);
      const clip = await js(`(()=>{const r=document.getElementById('home-cursor').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
      const win = BrowserWindow.fromWebContents(contents);
      fs.writeFileSync(path.join(output, imageName + '.png'), (await win.webContents.capturePage(clip)).toPNG());
    }
  }
  await check(50, '01-initial-50');
  fs.appendFileSync(old, JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'fixture activity without a quota update' } }) + '\n');
  await check(50, '02-old-session-still-50');
  fs.appendFileSync(current, line(60, base + 1000));
  await check(40, '03-fresh-40');
  fs.appendFileSync(old, line(5, base + 2000));
  await check(95, '04-legitimate-reset-95');
}
require('../main');
