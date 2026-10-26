'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createCipheriv, pbkdf2Sync } = require('node:crypto');
const { app, BrowserWindow, safeStorage } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
const { readCursorAuthToken: realRead } = require('./provider-usage-fixtures.cjs');
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });

const { PREFIX, createCursorTokenDecoder } = require('../platform-adapters/cursor-secrets');
const password = 'fixture-cursor-keychain';
const token = 'fixture-cursor-current';
const cipher = createCipheriv('aes-128-cbc', pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1'), Buffer.alloc(16, 32));
const stored = PREFIX + Buffer.concat([Buffer.from('v10'), cipher.update(token), cipher.final()]).toString('base64');
const dbPath = path.join(profile, 'cursor-state.vscdb');
const db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('cursorAuth/accessToken', stored); db.close();
const originalDb = fs.readFileSync(dbPath);
let allowed = true;
const newDecoder = () => createCursorTokenDecoder({ platform: 'darwin', readPassword: () => {
  if (!allowed) throw new Error('fixture-denied'); return password;
} });
let decoder = newDecoder();
const cursor = require('../cursor-usage');
const read = (_db, options = {}) => realRead(dbPath, { ...options, decryptToken: decoder });
cursor.readAuthToken = read;
const requests = [];
async function fetchFixture(url, options) {
  assert(!options.headers.Authorization.includes('cursor-safe-storage:'));
  requests.push(options.headers.Authorization === `Bearer ${token}` ? 'current' : 'old');
  if (options.headers.Authorization !== `Bearer ${token}`) return new Response('{"code":"unauthenticated"}', { status: 401 });
  return new Response(JSON.stringify(url.endsWith('GetSandUsageStatus')
    ? { usagePercent: 25, nextResetTimestampUtc: Date.now() / 1000 + 86400 }
    : { planUsage: { autoPercentUsed: 40, apiPercentUsed: 20 }, billingCycleEnd: Date.now() + 86400000 }));
}
const service = cursor.createCursorUsageService({ readAuth: read, fetchImpl: fetchFixture });
cursor.fetchCursorUsage = options => service.getUsage(options);
cursor.resetCursorUsage = () => service.reset();
const grokbot = require('../grokbot-usage');
const createGrokbot = grokbot.createGrokbotUsageService;
grokbot.createGrokbotUsageService = options => createGrokbot({ ...options, readAuth: read, fetchImpl: fetchFixture });
// Reproduce the old Pome copy, encrypted under Pome's own key, without ever
// touching the real Pome settings or the real Cursor profile/Keychain.
app.whenReady().then(() => fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({
  encryptedCursorToken: safeStorage.encryptString(stored).toString('base64'),
})));
const shots = path.join(__dirname, '../dist.noindex/cursor-credential-fix');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('Cursor encrypted credentials acceptance timed out'); app.exit(1); }, 80000);
let started = false;
app.on('web-contents-created', (_event, c) => c.on('did-finish-load', () => {
  if (started || !c.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(c).then(() => { clearTimeout(watchdog); console.log('Cursor/Grok Bot encrypted login: legacy recovery, acquisition/save, fallback, denied access/retry, no secret projection and UI passed'); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(c) {
  const js = source => c.executeJavaScript(source);
  async function until(source) {
    for (let i = 0; i < 300; i++) { if (await js(source).catch(() => false)) return; await sleep(20); }
    const state = await js(`({cards:[...document.querySelectorAll('.ai-usage-provider')].map(n=>({id:n.dataset.provider,state:n.dataset.state}))})`);
    throw new Error('Timed out: ' + source + '; ' + JSON.stringify(state));
  }
  async function capture(name) {
    await js('document.fonts.ready'); await sleep(900);
    const rect = await js(`(()=>{const r=document.getElementById('home-cursor').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
    fs.mkdirSync(shots, { recursive: true }); fs.writeFileSync(path.join(shots, name + '.png'), (await c.capturePage(rect)).toPNG());
  }
  async function refresh() { await js('NotchAiUsage.refresh({force:true})'); }
  await until('!!window.NotchAiUsage && !!window.NotchWorkspace');
  BrowserWindow.fromWebContents(c).showInactive();
  await js(`document.querySelector('#ui-capsule-hint button')?.click();setMode(true);setActiveTab('home');
    hiddenHomeModules=HOME_MODULE_REGISTRY.filter(id=>id!=='cursor');homeSizes.cursor='medium';homeWorkingLayout=null;
    applyHomeLayout(NotchDomain.resolveHomeWidgetLayout(homeOrder,homeSizes,hiddenHomeModules),{reason:'initial'});`);
  await refresh();
  await until(`document.querySelector('#ai-provider-cursor[data-state="ok"]') && document.querySelector('#ai-provider-grokbot[data-state="ok"]')`);
  assert.equal((await js('notchAPI.getCursorTokenStatus()')).configured, false, 'legacy ciphertext is not a usable manual token');
  assert.equal((await js(`notchAPI.setCursorToken(${JSON.stringify(stored)})`)).error, 'cursor_token_decrypt_failed');
  await capture('01-legacy-local-recovered');

  await js('setActiveTab("settings");NotchUi.openManual("cursor")');
  await js('document.getElementById("settings-cursor-token-fetch").click()');
  await until('!document.getElementById("settings-cursor-token-fetch").disabled');
  assert.equal((await js('notchAPI.getCursorTokenStatus()')).configured, true);
  const envelope = JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'), 'utf8'));
  assert.equal(safeStorage.decryptString(Buffer.from(envelope.encryptedCursorToken, 'base64')), token);
  assert.equal(await js('document.getElementById("settings-cursor-token").value'), '');
  assert.equal(await js(`JSON.stringify(collectLocalStorageSnapshot()).includes(${JSON.stringify(token)})`), false);

  await js('notchAPI.setCursorToken("fixture-cursor-expired")');
  await js('setActiveTab("home")'); await refresh();
  await until(`document.querySelector('#ai-provider-cursor[data-state="ok"]') && document.querySelector('#ai-provider-grokbot[data-state="ok"]')`);
  assert(requests.includes('old')); await capture('02-expired-manual-local-fallback');

  await js('notchAPI.clearCursorToken()'); allowed = false; decoder = newDecoder();
  await refresh();
  await until(`document.querySelector('#ai-provider-cursor[data-state="error"]') && document.querySelector('#ai-provider-grokbot[data-state="error"]')`);
  const failed = await js('notchAPI.getCursorUsage({force:true})');
  assert.equal(failed.error, 'cursor_token_decrypt_failed'); assert.equal(failed.detected, true); assert.equal(failed.status, undefined);
  assert.equal(await js(`document.getElementById('ai-provider-cursor').getAttribute('aria-description').includes('无法解密 Cursor')`), true);
  assert.equal(await js(`!!document.querySelector('#ai-provider-cursor [data-quota-settings]')`), true);
  assert.equal(await js(`document.getElementById('home-cursor').textContent.includes('需重新获取 Token')`), false);
  await capture('03-system-access-denied');
  const originalStyle = await js(`document.getElementById('home-cursor').style.cssText`);
  await js(`Object.assign(document.getElementById('home-cursor').style,{position:'fixed',left:'24px',top:'110px',width:'196px',height:'118px'});document.getElementById('home-cursor').dataset.widgetSize='mini'`);
  await until(`document.querySelector('#ai-usage-footer[data-quota-settings="cursor"]') && document.getElementById('ai-usage-footer').textContent.includes('读取受限')`);
  await capture('03b-system-access-denied-mini');
  await js('document.getElementById("ai-usage-footer").click()');
  await until('document.getElementById("tab-button-settings").classList.contains("active")');

  await js('setActiveTab("settings");NotchUi.openManual("cursor")');
  await js('document.getElementById("settings-cursor-token-fetch").click()');
  await until('!document.getElementById("settings-cursor-token-fetch").disabled');
  assert.equal(await js('document.body.textContent.includes("无法解密 Cursor")'), true);
  allowed = true;
  await js('document.getElementById("settings-cursor-token-fetch").click()');
  await until('!document.getElementById("settings-cursor-token-fetch").disabled');
  assert.equal((await js('notchAPI.getCursorTokenStatus()')).configured, true);
  await js(`document.getElementById('home-cursor').style.cssText=${JSON.stringify(originalStyle)};document.getElementById('home-cursor').dataset.widgetSize='medium'`);
  await js('setActiveTab("home")'); await refresh();
  await until(`document.querySelector('#ai-provider-cursor[data-state="ok"]') && document.querySelector('#ai-provider-grokbot[data-state="ok"]')`);
  await capture('04-acquired-and-saved');
  assert.deepEqual(fs.readFileSync(dbPath), originalDb);
}
require('../main');
