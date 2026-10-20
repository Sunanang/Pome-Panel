const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
// Never read the user's actual Cursor credentials in an integration test.
const cursorUsage = require('../cursor-usage');
let localCursorAuth = { ok: true, token: 'fixture-cursor-local-token' };
cursorUsage.readAuthToken = () => localCursorAuth;
cursorUsage.fetchCursorUsage = async () => ({ ok: false, error: 'fixture_offline' });
// Only synthetic Codex telemetry is used; never scan the real user's sessions.
const codexUsage = require('../codex-usage');
let codexTelemetry = { ok: true, detected: false, primary: null, secondary: null };
codexUsage.readCodexUsage = async ({ configured }) => ({ ...codexTelemetry, configured });
// Exercise the real remote service with fixture responses, never a live login or network request.
const codexRemote = require('../codex-usage-remote');
const makeCodexService = codexRemote.createCodexUsageService;
let codexRemoteStatus = 200;
let holdCodexRequest = false;
let finishCodexRequest;
let codexRemoteRequests = 0;
const remoteBody = { plan_type: 'plus', rate_limit: {
  primary_window: { used_percent: 67, reset_at: Date.now() / 1000 + 3600, limit_window_seconds: 18000 },
  secondary_window: { used_percent: 20, reset_at: Date.now() / 1000 + 86400, limit_window_seconds: 604800 },
} };
codexRemote.createCodexUsageService = (options) => makeCodexService({ ...options, fetchImpl: async (url, request) => {
  assert.equal(url, codexRemote.USAGE_URL);
  assert.match(request.headers.Authorization, /^Bearer fixture-codex/);
  codexRemoteRequests++;
  if (holdCodexRequest) return new Promise((resolve) => { finishCodexRequest = resolve; });
  return new Response(JSON.stringify(remoteBody), { status: codexRemoteStatus });
} });
const codexAuth = require('../codex-auth');
let localCodexAuth = { ok: true, token: 'fixture-codex-token' };
let codexAuthReads = 0;
codexAuth.readLocalCodexToken = async () => { codexAuthReads++; return localCodexAuth; };
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-recordings':JSON.stringify([{id:'startup-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/retained.webm',mimeType:'audio/webm',title:'Saved recording',category:'未分类'}]),
}}));
const errors = [];
const EXPECTED = {home:true,workspace:true,note:'Recovered workspace note',recordings:1};
const READ_STATE = `({home:!!window.NotchHome,workspace:!!window.NotchWorkspace,note:document.getElementById('home-note')?.value ?? null,recordings:document.querySelectorAll('.recording-item').length})`;
const deadline = Date.now() + 20000;
const watchdog = setTimeout(() => { console.error('Production startup timed out', errors); process.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.once('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    waitForRecovery(contents);
  });
});
// hydratePortableWorkspace() reloads the page after importing workspace.json,
// so poll for the recovered state instead of sampling one moment after first load.
async function waitForRecovery(contents) {
  let state = null;
  while (Date.now() < deadline) {
    try {
      if (!contents.isDestroyed()) state = await contents.executeJavaScript(READ_STATE);
      if (state && state.note === EXPECTED.note && state.recordings === EXPECTED.recordings) break;
    } catch (error) { state = {error: String((error && error.message) || error)}; }
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
  clearTimeout(watchdog);
  try {
    assert.deepEqual(errors, []);
    assert.deepEqual(state, EXPECTED);
    await checkCursorTokenFlow(contents);
    await checkCodexTokenFlow(contents);
    console.log('Production workspace recovery checks passed');
    process.exit(0);
  } catch (error) { console.error(error); process.exit(1); }
}

async function checkCursorTokenFlow(contents) {
  await contents.executeJavaScript(`setActiveTab('settings')`);
  const acquired = await contents.executeJavaScript(`
    (async () => {
      const button = document.getElementById('settings-cursor-token-fetch');
      const input = document.getElementById('settings-cursor-token');
      button.click();
      for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
      return { value: input.value, type: input.type, disabled: button.disabled,
        status: await window.notchAPI.getCursorTokenStatus(),
        leaked: JSON.stringify(collectLocalStorageSnapshot()).includes('fixture-cursor-local-token') };
    })()
  `);
  assert.equal(acquired.value, 'fixture-cursor-local-token');
  assert.equal(acquired.type, 'password');
  assert.equal(acquired.disabled, false);
  assert.equal(acquired.status.configured, false, '获取不能自动保存');
  assert.equal(acquired.leaked, false, '凭证不能写入 LocalStorage');
  const saved = await contents.executeJavaScript(`
    (async () => {
      const button = document.getElementById('settings-cursor-token-save');
      button.click();
      for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
      return { value: document.getElementById('settings-cursor-token').value,
        status: await window.notchAPI.getCursorTokenStatus() };
    })()
  `);
  assert.equal(saved.status.configured, true);
  assert.equal(saved.value, '');
  const file = fs.readFileSync(path.join(profile, 'app-settings.json'), 'utf8');
  assert.ok(JSON.parse(file).encryptedCursorToken);
  assert.equal(file.includes('fixture-cursor-local-token'), false, '本机配置只能存密文');
  localCursorAuth = { ok: false, error: 'cursor_token_missing', detail: 'must-not-reach-renderer' };
  const failed = await contents.executeJavaScript(`
    (async () => {
      const input = document.getElementById('settings-cursor-token');
      input.value = 'keep-existing-input';
      const button = document.getElementById('settings-cursor-token-fetch');
      button.click();
      for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
      return { value: input.value, disabled: button.disabled,
        hint: document.getElementById('settings-cursor-token-hint').textContent,
        response: await window.notchAPI.readLocalCursorToken() };
    })()
  `);
  assert.equal(failed.value, 'keep-existing-input');
  assert.equal(failed.disabled, false);
  assert.match(failed.hint, /尚未登录/);
  assert.deepEqual(failed.response, { ok: false, error: 'cursor_token_missing' });
  const cleared = await contents.executeJavaScript(`
    (async () => {
      const button = document.getElementById('settings-cursor-token-clear');
      button.click();
      for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
      return { value: document.getElementById('settings-cursor-token').value,
        status: await window.notchAPI.getCursorTokenStatus() };
    })()
  `);
  assert.equal(cleared.value, '');
  assert.equal(cleared.status.configured, false);
  console.log('Cursor token acquisition, encrypted save and clear checks passed');
}
async function checkCodexTokenFlow(contents) {
  assert.equal(codexAuthReads, 0, 'settings and quota refreshes must never auto-read login credentials');
  const acquired = await contents.executeJavaScript(`(async () => {
    const input = document.getElementById('settings-codex-token');
    const button = document.getElementById('settings-codex-token-fetch');
    button.click();
    for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
    return { value: input.value, type: input.type, disabled: button.disabled,
      status: await window.notchAPI.getCodexTokenStatus(),
      sameCard: input.closest('#settings-ai-sources') === document.getElementById('settings-cursor-token').closest('#settings-ai-sources'),
      leaked: JSON.stringify(collectLocalStorageSnapshot()).includes('fixture-codex-token') };
  })()`);
  assert.equal(acquired.value, 'fixture-codex-token');
  assert.equal(acquired.type, 'password');
  assert.equal(acquired.disabled, false);
  assert.equal(acquired.status.configured, false, 'acquisition must not automatically save');
  assert.equal(acquired.sameCard, true, 'both providers must be in one settings card');
  assert.equal(acquired.leaked, false);
  assert.equal(codexAuthReads, 1);

  const saved = await contents.executeJavaScript(`(async () => {
    const button = document.getElementById('settings-codex-token-save');
    button.click();
    for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
    await window.NotchAiUsage.refresh({ force: true });
    for (let i = 0; i < 50 && !/^更新于/.test(document.getElementById('codex-usage-footnote')?.textContent || ''); i++) {
      await new Promise(r => setTimeout(r, 40));
    }
    return { status: await window.notchAPI.getCodexTokenStatus(),
      value: document.getElementById('settings-codex-token').value,
      settings: await window.notchAPI.getAppSettings(),
      usage: await window.notchAPI.getCodexUsage({ force: true }),
      percent: document.querySelector('#codex-usage-rows strong').textContent,
      footer: document.getElementById('codex-usage-footnote').textContent,
      leaked: JSON.stringify(collectLocalStorageSnapshot()).includes('fixture-codex-token') };
  })()`);
  assert.equal(saved.status.configured, true);
  assert.equal(saved.value, '');
  assert.equal(saved.leaked, false);
  assert.equal(Object.hasOwn(saved.settings, 'encryptedCodexToken'), false);
  assert.equal(Object.hasOwn(saved.usage, 'token'), false);
  assert.match(saved.footer, /^更新于/);
  assert.equal(saved.usage.primary.percent, 67);
  assert.equal(saved.percent, '33%');
  assert.equal(saved.usage.authSource, 'manual');
  assert.ok(codexRemoteRequests > 0);
  const stored = fs.readFileSync(path.join(profile, 'app-settings.json'), 'utf8');
  assert.ok(JSON.parse(stored).encryptedCodexToken);
  assert.equal(stored.includes('fixture-codex-token'), false);
  codexRemoteStatus = 401;
  const invalid = await contents.executeJavaScript(`(async () => {
    await window.NotchAiUsage.refresh({force:true});
    return { status: await window.notchAPI.getCodexTokenStatus(),
      label: document.getElementById('ai-codex-source').textContent,
      percent: document.querySelector('#codex-usage-rows strong').textContent,
      guideVisible: !document.getElementById('settings-codex-token-guide').hidden,
      footer: document.getElementById('codex-usage-footnote').textContent };
  })()`);
  assert.equal(invalid.status.manualTokenInvalid, true);
  assert.equal(invalid.label, 'Token 失效'); assert.equal(invalid.percent, '--%');
  assert.equal(invalid.guideVisible, true);
  assert.match(invalid.footer, /Token 失效.*去设置/);
  codexTelemetry = { ok:true, detected:true, updatedAt:new Date(Date.now()-60000).toISOString(),
    primary:{percent:45}, secondary:{percent:15}, plan:'plus' };
  const fallback = await contents.executeJavaScript(`(async () => {
    await window.NotchAiUsage.refresh({force:true});
    return { label:document.getElementById('ai-codex-source').textContent,
      percent:document.querySelector('#codex-usage-rows strong').textContent };
  })()`);
  assert.equal(fallback.label, 'Token 失效 · 已改用本机'); assert.equal(fallback.percent, '55%');
  codexRemoteStatus = 200; holdCodexRequest = true;
  const resaved = await contents.executeJavaScript(`(async () => {
    document.getElementById('settings-codex-token').value = 'fixture-codex-new-token';
    const button=document.getElementById('settings-codex-token-save'); button.click();
    for(let i=0;i<100&&button.disabled;i++) await new Promise(r=>setTimeout(r,20));
    return {status:await window.notchAPI.getCodexTokenStatus(),
      guideVisible:!document.getElementById('settings-codex-token-guide').hidden};
  })()`);
  assert.equal(resaved.status.manualTokenInvalid, false);
  assert.equal(resaved.guideVisible, false, 'invalid state clears immediately, before the network request finishes');
  assert.ok(finishCodexRequest);
  holdCodexRequest = false; finishCodexRequest(new Response(JSON.stringify(remoteBody)));
  await contents.executeJavaScript('window.NotchAiUsage.refresh({force:true})');
  localCodexAuth = { ok: false, error: 'codex_token_missing', detail: 'must-not-reach-renderer' };
  const failed = await contents.executeJavaScript(`(async () => {
    const input = document.getElementById('settings-codex-token'); input.value = 'keep-codex-input';
    const button = document.getElementById('settings-codex-token-fetch'); button.click();
    for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
    return { value: input.value, disabled: button.disabled,
      hint: document.getElementById('settings-codex-token-hint').textContent,
      response: await window.notchAPI.readLocalCodexToken() };
  })()`);
  assert.equal(failed.value, 'keep-codex-input');
  assert.equal(failed.disabled, false);
  assert.match(failed.hint, /没有可用 Token/);
  assert.deepEqual(failed.response, { ok: false, error: 'codex_token_missing' });
  const cleared = await contents.executeJavaScript(`(async () => {
    const button = document.getElementById('settings-codex-token-clear'); button.click();
    for (let i = 0; i < 100 && button.disabled; i++) await new Promise(r => setTimeout(r, 20));
    return window.notchAPI.getCodexTokenStatus();
  })()`);
  assert.equal(cleared.configured, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'))).encryptedCodexToken, '');
  console.log('Codex local token acquisition, merged settings, encrypted save and clear checks passed');
}
require('../main.js');
