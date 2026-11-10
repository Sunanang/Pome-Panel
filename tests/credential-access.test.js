'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAuthToken, createClaudeUsageService } = require('../claude-usage');

test('an unpaired NAS status does not initialize secure storage; existing credentials still require it', t => {
  const fs = require('node:fs'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pome-lazy-status-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let probes = 0;
  const store = require('../main-services').createSyncCredentialsStore({ getUserDataPath: () => root, fs, path, lazyStatus: true,
    safeStorage: { isEncryptionAvailable() { probes++; return false; } } });
  assert.equal(store.getStatus().secureStorage, null);
  assert.equal(store.read().bound, false);
  assert.equal(store.getDeviceToken(), null);
  assert.equal(probes, 0);
  fs.writeFileSync(store.credentialsPath(), JSON.stringify({ payload: 'fixture' }));
  assert.equal(store.getStatus().secureStorage, false);
  assert(probes > 0);
});

test('Claude uses a usable file without querying another application Keychain', async () => {
  for (const expiresAt of [null, Date.now() + 60000]) {
    const file = { ok: true, token: 'fixture-file', source: 'file', expiresAt };
    assert.deepEqual(await readAuthToken({ readFile: () => file, readKeychain: () => { throw Error('must not request Keychain'); } }), file);
  }
  assert.equal((await readAuthToken({ readFile: () => ({ ok: true, token: 'old', expiresAt: 1 }),
    readKeychain: async () => ({ ok: true, token: 'new', expiresAt: Date.now() + 60000, source: 'keychain' }) })).token, 'new');
});

test('an async Claude authorization cannot return an obsolete request after reset', async () => {
  let finish, fetches = 0;
  const service = createClaudeUsageService({ readAuth: () => new Promise(resolve => { finish = resolve; }),
    fetchImpl: async () => { fetches++; return new Response('{}'); } });
  const pending = service.getUsage();
  service.reset();
  finish({ ok: true, token: 'obsolete' });
  assert.deepEqual(await pending, { superseded: true });
  assert.equal(fetches, 0);
});

test('saving a Cursor or Grok Bot token does not authorize a local Keychain read', async () => {
  for (const [file, factory] of [['cursor-usage', 'createCursorUsageService'], ['grokbot-usage', 'createGrokbotUsageService']]) {
    let reads = 0;
    const service = require(`../${file}`)[factory]({ readAuth: () => { reads++; throw Error('must not read login'); },
      fetchImpl: async () => new Response(JSON.stringify(file === 'cursor-usage' ? { planUsage: { autoPercentUsed: 10 } } : { usagePercent: 10 })) });
    assert.equal((await service.getUsage({ manualToken: 'fixture', allowLocalAuth: false })).ok, true);
    assert.equal(reads, 0);
  }
});

test('the actual Cursor writer preserves paused access for a NAS import and enables only an explicit save', () => {
  // Like the transcription IPC harness, execute the real main-process function
  // with storage/OS boundaries injected; no production export or test bypass.
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../main'), 'utf8');
  const providers = new Set();
  const context = vm.createContext({
    isCursorEncryptedToken: () => false, retryStoredSecretReads() {}, checkSecureStorageAvailability: () => true,
    readAppSettings: () => ({}), readCursorManualToken: () => '', encryptStoredSecret: () => 'fixture-cipher',
    saveAppSettings: () => true, aiCredentialProviders: providers, resetCursorUsage() {},
    grokbotUsageService: { reset() {} }, cursorTokenStatus: () => ({ ok: true }), mainWindow: null,
  });
  vm.runInContext(source.slice(source.indexOf('function writeCursorManualToken('), source.indexOf('function codexTokenStatus(')), context);
  assert.equal(context.writeCursorManualToken('fixture-nas-import').ok, true);
  assert.equal(providers.size, 0);
  assert.equal(context.writeCursorManualToken('fixture-user-save', { activateUsage: true }).ok, true);
  assert.deepEqual([...providers], ['cursor', 'grokbot']);
});
