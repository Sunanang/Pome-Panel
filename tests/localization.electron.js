'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
process.env.POME_TEST_LANGUAGE = 'en-US';
process.env.POME_TEST_NOTIFICATIONS = '1';
require('../cursor-usage').readAuthToken = () => ({ ok: false });
require('../cursor-usage').fetchCursorUsage = async () => ({ ok: false });
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const adapters = require('../platform-adapters'), original = adapters.loadAdapter;
adapters.loadAdapter = (...args) => { const adapter = original(...args); adapter.windows.list = async () => ({ items: [], error: null }); return adapter; };
let bound = false, state = 'unbound', paused = false, lostToken = false;
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => handle(channel, {
  'sync:get-status': () => ({ bound, baseUrl: bound ? 'https://nas.example' : null, recovery: { paused }, schemaIncompatible: state === 'schema_incompatible' }),
  'sync:get-dashboard': () => ({ ok: true, credentials: { bound, recovery: { paused } }, settings: { endpoints: bound || lostToken ? [{ endpointId: 'fixture', baseUrl: 'https://nas.example' }] : [] },
    uiState: state, uiLabel: require('../packages/sync-protocol/endpoints').syncUiStateLabel(state), outboxCount: 2,
    contentResults: { '待办': { message: '上次同步已确认', at: 1700000000000 }, '录音音频': { message: '尚未确认全部音频传输' } }, recovery: { paused } }),
}[channel] || fn);
let port, started = false;
app.on('pome-test-notification-port', value => { port = value; });
const errors = [];
const output = process.env.POME_LOCALIZATION_SCREENSHOTS || path.join(__dirname, '../dist.noindex/localization'); fs.mkdirSync(output, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const withoutLanguageNames = text => require('../localization/languages.json').reduce((value, row) => value.replaceAll(row.name, ''), text);
const watchdog = setTimeout(() => { console.error('Localization integration timed out', errors); app.exit(1); }, 90000);
app.on('web-contents-created', (_event, c) => {
  c.on('console-message', detail => { if (detail.level === 'error' && !detail.message.includes('ERR_')) errors.push(detail.message); });
  c.once('did-finish-load', () => {
    if (started || !c.getURL().endsWith('/renderer/index.html')) return;
    started = true;
    run(c).then(() => { clearTimeout(watchdog); console.log('Ten-language production UI, preferences, drafts, sync states and notification lifecycle passed'); app.exit(0); })
      .catch(error => { console.error(error, errors); app.exit(1); });
  });
});
async function run(c) {
  const js = value => c.executeJavaScript(value);
  async function until(value) { for (let i = 0; i < 300; i++) { if (await js(value).catch(() => false)) return; await sleep(20); } throw new Error('Timed out: ' + value); }
  await until('!!window.NotchWorkspace && !!window.NotchTaskInbox');
  assert.equal(await js('document.documentElement.lang'), 'en-US');
  await js('setMode(true)'); await sleep(650); await js('setActiveTab("settings")'); await sleep(450);
  assert.equal(await js('document.getElementById("settings-language").value'), 'system');
  await js('document.getElementById("settings-cursor-token").value="unsaved-token-draft"');
  const enBody = await js('document.body.innerText');
  fs.writeFileSync(path.join(output, 'english-settings.txt'), enBody);
  assert(enBody.includes('NAS sync')); assert(enBody.includes('Language'));
  assert.equal(await js('document.getElementById("settings-nas-sync-open").disabled'), true);
  await js('window.notchAPI.setLanguage("zh-CN")');
  await until('document.documentElement.lang === "zh-CN"');
  assert.equal(await js('document.getElementById("settings-cursor-token").value'), 'unsaved-token-draft');
  await js('window.notchAPI.setDefaultTab("notes")');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'))).language, 'zh-CN');
  assert.equal((await js('window.notchAPI.setLanguage("../../bad")')).ok, false);
  assert.equal(await js('document.getElementById("settings-language").options.length'), 11);
  for (const { id } of require('../localization/languages.json')) {
    await js(`{ const select=document.getElementById('settings-language');select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change')); }`);
    await until(`document.documentElement.lang===${JSON.stringify(id)}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'))).language, id);
    assert.equal(await js('document.getElementById("settings-cursor-token").value'), 'unsaved-token-draft');
    await js('document.querySelectorAll(".settings-column").forEach(column => column.scrollTop=0)');
    await sleep(100);
    assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true, id + ' page stays within viewport');
    fs.writeFileSync(path.join(output, `${id}-settings.png`), (await c.capturePage()).toPNG());
    await js('document.getElementById("settings-language").scrollIntoView({block:"center"})'); await sleep(80);
    assert.equal(await js('(()=>{const r=document.getElementById("settings-language").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()'), true, id + ' language control visible');
    fs.writeFileSync(path.join(output, `${id}-language.png`), (await c.capturePage()).toPNG());
  }
  await js('document.querySelectorAll(".settings-column").forEach(column => column.scrollTop=0)');
  await js('window.notchAPI.setLanguage("en-US")'); await until('document.documentElement.lang === "en-US"');
  await js('window.notchAPI.setTranscriptionConfig({region:"beijing",transcriptionLanguage:"en",llmBaseUrl:"https://api.deepseek.com"})');
  await js('window.notchAPI.setLanguage("zh-CN")'); await until('document.documentElement.lang === "zh-CN"');
  assert.equal((await js('window.notchAPI.getTranscriptionConfig()')).transcriptionLanguage, 'en');
  await js('window.notchAPI.setLanguage("en-US")'); await until('document.documentElement.lang === "en-US"');
  bound = true; state = 'synced';
  c.send('sync:status', { bound, recovery: { paused } });
  await until('document.getElementById("settings-nas-content-results").textContent.includes("Last sync confirmed")');
  assert.equal(await js('document.getElementById("settings-nas-content-results").children.length'), 10);
  paused = true; c.send('sync:status', { bound, recovery: { paused } });
  await until('!document.getElementById("settings-nas-recovery").hidden && document.getElementById("settings-nas-sync-status").textContent === "Sync paused"');
  await sleep(120);
  fs.writeFileSync(path.join(output, 'english-nas-paused.png'), (await c.capturePage()).toPNG());
  await js('document.getElementById("settings-nas-certificate-hint")?.textContent');
  paused = false; bound = false; lostToken = true; state = 'unbound'; c.send('sync:status', { bound, recovery: { paused } });
  await until('document.getElementById("settings-nas-status-hint").textContent.includes("token is missing")'); await sleep(120);
  fs.writeFileSync(path.join(output, 'english-nas-lost-token.png'), (await c.capturePage()).toPNG());
  // Keep user-authored Chinese data intact while switching every product label.
  await js('setActiveTab("home"); document.getElementById("home-note").value="用户原文，不要翻译"');
  const pageText = {};
  for (const tab of ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'settings']) {
    await js(`setActiveTab(${JSON.stringify(tab)})`); await sleep(450);
    pageText[tab] = await js('document.body.innerText');
    // README explicitly preserves traditional almanac content in its original
    // language. Windows shows this widget by default; keep checking all UI labels.
    const productText = await js(`document.body.innerText.replace(document.getElementById('home-almanac')?.innerText || '', '')`);
    assert.doesNotMatch(withoutLanguageNames(productText), /[\p{sc=Han}]/u, `untranslated product labels on ${tab}: ${withoutLanguageNames(productText).match(/[\p{sc=Han}]+/gu)?.join(', ')}`);
    if (tab === 'home' && await js(`document.getElementById('home-almanac')?.checkVisibility()`)) {
      assert.match(await js(`document.getElementById('home-almanac').innerText`), /[\p{sc=Han}]/u, 'traditional almanac content retains its original language');
    }
    fs.writeFileSync(path.join(output, `english-${tab}.png`), (await c.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(output, 'page-text.json'), JSON.stringify(pageText, null, 2));
  assert.equal(await js('document.getElementById("home-note").value'), '用户原文，不要翻译');
  assert(port, 'isolated notification listener must be ready');
  const response = await fetch(`http://127.0.0.1:${port}/notify/codex`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: 'locale-awaiting', status: 'awaiting', title: '保留实际 AI 摘要' }) });
  assert.equal(response.status, 202);
  let bubble;
  for (let i = 0; i < 200; i++) { bubble = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/renderer/notification.html')); if (bubble && await bubble.webContents.executeJavaScript('typeof currentNotification !== "undefined" && !!currentNotification').catch(() => false)) break; await sleep(20); }
  assert(bubble);
  const readBubble = code => bubble.webContents.executeJavaScript(code);
  const before = await readBubble('({id:currentNotification.eventId,status:currentNotification.status,title:titleElement.textContent,remaining:timing?.remainingMs})');
  assert.equal(before.status, 'awaiting'); assert.equal(before.title, '保留实际 AI 摘要');
  await js('window.notchAPI.setLanguage("zh-CN")'); await sleep(120);
  assert.equal(await readBubble('document.documentElement.lang'), 'zh-CN');
  assert.equal(await readBubble('currentNotification.eventId'), before.id);
  assert.equal(await readBubble('titleElement.textContent'), before.title);
  await js('window.notchAPI.setLanguage("de-DE")');await sleep(150);
  assert.equal(await readBubble('document.documentElement.lang'),'de-DE','non-English locale broadcasts reach the notification window');
  assert.equal(await readBubble('currentNotification.eventId'),before.id);
  assert.equal(await readBubble('titleElement.textContent'),before.title);
  fs.writeFileSync(path.join(output,'german-awaiting.png'),(await bubble.webContents.capturePage()).toPNG());
  await js('window.notchAPI.setLanguage("en-US")'); await sleep(150);
  assert.equal(await readBubble('isVisible && !isHiding'), true);
  fs.writeFileSync(path.join(output, 'english-awaiting.png'), (await bubble.webContents.capturePage()).toPNG());
  await readBubble('document.getElementById("notification-close").click()');
  await verifyNasPage();
  assert.deepEqual(errors, []);
}
async function verifyNasPage() {
  const http = require('node:http');
  const { tryServeStatic, stripGatewayPrefix } = require('../fnos/app/server/gatewayHttp');
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = stripGatewayPrefix(new URL(req.url, 'http://localhost').pathname);
    if (tryServeStatic(req, res, url, path.join(__dirname, '../fnos/app/ui'))) return;
    requests.push(url);
    const replies = {
      '/api/v1/me': { uid: 'isolated-user', username: 'Test user' },
      '/api/v1/pair/csrf': { csrfToken: 'isolated-test-only' },
      '/api/v1/device-port': { port: 5001, host: '127.0.0.1', enabled: true },
      '/api/v1/devices': { devices: [] },
      '/api/v1/workspace': { notes: { archive: [{ id: 'user-note', title: '用户原文标题', content: '保留用户原文' }] } },
      '/api/v1/pair/start': { error: 'csrf_expired' },
    };
    res.writeHead(url.endsWith('/pair/start') ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(replies[url] || {}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const nas = new BrowserWindow({ width: 1240, height: 720, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await nas.loadURL(`http://127.0.0.1:${server.address().port}/app/pome-panel/`);
    const js = value => nas.webContents.executeJavaScript(value);
    for (let i = 0; i < 200; i++) { if (await js('!document.getElementById("pair-start-btn").disabled')) break; await sleep(20); }
    await js('window.dispatchEvent(new CustomEvent("pome:host-language", {detail:"en-US"}))');
    assert.equal(await js('document.documentElement.lang'), 'en-US');
    assert.match(await js('document.getElementById("session-pill").textContent'), /Signed in/);
    assert.doesNotMatch(withoutLanguageNames(await js('document.body.innerText')), /[\p{sc=Han}]/u);
    await sleep(100);
    fs.writeFileSync(path.join(output, 'english-nas-web.png'), (await nas.webContents.capturePage()).toPNG());
    await js('document.getElementById("pair-start-btn").click()');
    for (let i = 0; i < 200; i++) { if (await js('document.getElementById("pair-status").textContent.includes("expired")')) break; await sleep(20); }
    assert.match(await js('document.getElementById("pair-status").textContent'), /expired/);
    await js('{ const select=document.querySelector("[data-language-preference]"); select.value="zh-CN"; select.dispatchEvent(new Event("change")); }');
    assert.equal(await js('document.documentElement.lang'), 'zh-CN');
    await js('window.dispatchEvent(new CustomEvent("pome:host-language", {detail:"en-US"}))');
    assert.equal(await js('document.documentElement.lang'), 'zh-CN', 'manual preference overrides host changes');
    assert.match(await js('document.getElementById("pair-status").textContent'), /过期/);
    await sleep(100);
    fs.writeFileSync(path.join(output, 'chinese-nas-web.png'), (await nas.webContents.capturePage()).toPNG());
    await js('document.getElementById("tab-button-notes").click()'); await sleep(100);
    assert.match(await js('document.body.innerText'), /用户原文标题/);
    for (const { id } of require('../localization/languages.json')) {
      await js(`{ const select=document.querySelector('[data-language-preference]');select.value=${JSON.stringify(id)};select.dispatchEvent(new Event('change')); }`);
      assert.equal(await js('document.documentElement.lang'), id);
      assert.equal(await js('document.querySelector("[data-language-preference]").options.length'), 11);
      assert.match(await js('document.body.innerText'), /用户原文标题/);
      await js('document.getElementById("tab-button-devices").click()'); await sleep(80);
      assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'), true, id + ' NAS page stays within viewport');
      fs.writeFileSync(path.join(output, `${id}-nas.png`), (await nas.webContents.capturePage()).toPNG());
      await js('document.getElementById("tab-button-notes").click()'); await sleep(80);
    }
    assert(requests.includes('/api/v1/pair/start'));
  } finally { nas.destroy(); await new Promise(resolve => server.close(resolve)); }
}
require('../main');
