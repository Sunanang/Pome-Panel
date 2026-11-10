'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, safeStorage } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
app.disableHardwareAcceleration();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let decrypts = 0, usageReads = 0, availabilityChecks = 0;
const readProviders = new Set();
const originalAvailability = safeStorage.isEncryptionAvailable.bind(safeStorage);
safeStorage.isEncryptionAvailable = () => { availabilityChecks++; return originalAvailability(); };
const originalDecrypt = safeStorage.decryptString.bind(safeStorage);
safeStorage.decryptString = value => { decrypts++; return originalDecrypt(value); };
// All credentials and service calls are synthetic. Never open real tool stores.
require('../codex-usage').readCodexUsage = async () => ({ ok: true, detected: false });
require('../codex-auth').readLocalCodexToken = async () => ({ ok: false });
const cursor = require('../cursor-usage');
cursor.readAuthToken = async () => ({ ok: false });
cursor.fetchCursorUsage = async options => { usageReads++; return { ok: false, detected: false,
  error: !options.allowLocalAuth && !options.manualToken ? 'credential_access_required' : 'fixture_no_usage' }; };
for (const [file, factory] of [['grokbot-usage','createGrokbotUsageService'], ['claude-usage','createClaudeUsageService'], ['copilot-usage','createCopilotUsageService'], ['grok-usage','createGrokUsageService'], ['antigravity-usage','createAntigravityUsageService'], ['manus-usage','createManusUsageService']]) {
  require(`../${file}`)[factory] = () => ({ reset() {}, async getUsage() { usageReads++; readProviders.add(file.replace('-usage', '')); return { ok: false, detected: false }; } });
}
const files = new Map();
app.whenReady().then(() => {
  fs.mkdirSync(profile, { recursive: true });
  const encrypted = value => safeStorage.encryptString(value).toString('base64');
  const bag = { encryptedCursorToken: encrypted('fixture-cursor'), encryptedCodexToken: encrypted('fixture-codex'),
    encryptedProviderTokens: Object.fromEntries(['copilot','grok','antigravity','manus'].map(id => [id, encrypted(`fixture-${id}`)])), grokTeamId: 'fixture-team' };
  for (const [name, value] of [
    ['app-settings.json', bag],
    ['transcription-settings.json', { encryptedApiKey: encrypted('fixture-asr'), encryptedLlmApiKey: encrypted('fixture-llm') }],
    ['credentials.vault.json', { version: 1, payload: encrypted(JSON.stringify([{ id: 'fixture', service: 'Demo', account: 'demo', password: 'fixture', createdAt: 1 }])) }],
  ]) {
    const target = path.join(profile, name); fs.writeFileSync(target, JSON.stringify(value));
    if (name !== 'app-settings.json') files.set(target, fs.readFileSync(target));
  }
});
let started = false;
const watchdog = setTimeout(() => { console.error('Credential access timed out'); app.exit(1); }, 60000);
app.on('web-contents-created', (_event, c) => c.once('did-finish-load', () => {
  if (started || !c.getURL().endsWith('/renderer/index.html')) return;
  started = true;
  run(c).then(() => { clearTimeout(watchdog); console.log('On-demand credentials: startup, status, consent, denial, retry and lazy vault passed'); app.exit(0); })
    .catch(error => { console.error(error); app.exit(1); });
}));
async function run(c) {
  const js = code => c.executeJavaScript(code);
  async function until(code) { for (let i = 0; i < 400; i++) { if (await js(code)) return; await delay(20); } throw Error(code); }
  await until('!!window.NotchWorkspace && !!window.NotchAiSources?.getState().ready');
  await js('NotchAiUsage.refresh({force:true})');
  await js(`Promise.all([notchAPI.getCursorTokenStatus(),notchAPI.getCodexTokenStatus(),notchAPI.getAiProviderTokenStatus('manus'),notchAPI.getTranscriptionConfig()])`);
  assert.equal(decrypts, 0, 'boot, refresh and configured status must not decrypt');
  assert.equal(availabilityChecks, 0, 'even checking availability can initialize OS crypto; passive status must not probe it');
  assert.equal(usageReads, 0, 'boot must not read third-party credential services');
  assert.equal((await js('notchAPI.getAiCredentialAccessStatus()')).enabled, false);
  assert.equal((await js('notchAPI.getCursorUsage({force:true})')).credentialAccessRequired, true);
  BrowserWindow.fromWebContents(c).showInactive();
  await js(`document.querySelector('#ui-capsule-hint button')?.click();setMode(true)`);
  await js(`setActiveTab('settings');NotchSettings.select('ai')`);
  await until(`!modeBusy && document.getElementById('settings-group-ai').hidden===false`);
  assert.equal(decrypts, 0, 'opening settings and showing explanations is not consent');
  await js(`NotchAiUsage.openSettings('cursor')`);
  assert.equal(await js('document.activeElement.id'), 'settings-ai-credential-enable', 'paused quota links must reach the explanation and action');
  const shots = path.join(__dirname, '..', 'dist.noindex', 'credential-access'); fs.mkdirSync(shots, { recursive: true });
  async function capture(name) {
    await js('document.fonts.ready'); await delay(600);
    assert(await js(`document.getElementById('panel').getBoundingClientRect().height > 400 && getComputedStyle(document.getElementById('app')).opacity !== '0'`));
    const img = await BrowserWindow.fromWebContents(c).capturePage(); fs.writeFileSync(path.join(shots, name + '.png'), img.toPNG());
  }
  await capture('ai-before-access');
  await js(`document.getElementById('settings-api-configure').click()`);
  await until(`document.getElementById('transcription-settings-backdrop').hidden===false`);
  assert(await js(`document.querySelector('[data-i18n="privacy.recording.onDemand"]').textContent.length > 0`));
  await capture('recording-on-demand');
  assert.equal(decrypts, 0, 'opening the recording configuration remains metadata-only');
  assert.equal(availabilityChecks, 0);
  await js(`document.getElementById('transcription-settings-close').click()`);
  await until(`document.getElementById('transcription-settings-backdrop').hidden===true`);
  assert.equal((await js(`notchAPI.setAiProviderToken('grok','fixture-new-grok',{teamId:'fixture-team'})`)).ok, true);
  await js('NotchAiUsage.refresh({force:true})');
  assert.deepEqual([...readProviders], ['grok'], 'saving one source must not authorize unrelated credential readers');
  assert.equal((await js('notchAPI.getCursorUsage()')).credentialAccessRequired, true);
  assert.equal((await js(`notchAPI.setCursorToken('fixture-replacement')`)).ok, true);
  assert.equal((await js('notchAPI.clearCursorToken()')).ok, true);
  assert.equal((await js('notchAPI.getCursorUsage()')).credentialAccessRequired, true, 'clearing a saved token does not implicitly unlock the local login');
  const beforeDenial = decrypts;
  // Simulated native refusal: polling must not request the same secret again.
  safeStorage.decryptString = () => { decrypts++; throw Error('fixture-denied'); };
  await js(`document.getElementById('settings-ai-credential-enable').click()`);
  await until(`!document.getElementById('settings-ai-credential-enable').disabled`);
  assert(usageReads > 0);
  const deniedReads = decrypts;
  assert.equal(deniedReads - beforeDenial, 1, 'one failed Pome item must pause the other automatic secret reads too');
  await js('NotchAiUsage.refresh({force:true})');
  assert.equal(decrypts, deniedReads, 'background retries must reuse a refusal');
  await capture('ai-after-access');
  // An explicit retry can recover without changing encrypted data.
  safeStorage.decryptString = value => { decrypts++; return originalDecrypt(value); };
  await js(`document.getElementById('settings-ai-credential-enable').click()`);
  await until(`!document.getElementById('settings-ai-credential-enable').disabled`);
  assert(decrypts > deniedReads);
  const beforeVault = decrypts;
  await js(`setActiveTab('credentials')`);
  await until(`document.querySelectorAll('.credential-item').length===1`);
  assert(decrypts > beforeVault);
  await capture('vault-on-demand');
  const beforeStatus = decrypts;
  await js('notchAPI.getTranscriptionConfig()');
  assert.equal(decrypts, beforeStatus);
  for (const [target, value] of files) assert.deepEqual(fs.readFileSync(target), value, 'reads/refusal must preserve saved ciphertext');
}
require('../main.js');
