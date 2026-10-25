'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createCredentialsVaultStore, switchPanelShortcut } = require('../main-services');
const row = { id: 'key-one', service: 'Fixture', account: 'fixture-account', password: 'fixture-secret', createdAt: 1 };
function vault(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-vault-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'vault.json');
  const safeStorage = { isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(`cipher:${text}`),
    decryptString: bytes => { const value = bytes.toString(); if (!value.startsWith('cipher:')) throw Error('bad_cipher'); return value.slice(7); }, ...options.safeStorage };
  return { filePath, safeStorage, store: createCredentialsVaultStore({ filePath, safeStorage, ...options }) };
}
function encrypted(value) { return JSON.stringify({ version: 1, payload: Buffer.from(`cipher:${JSON.stringify(value)}`).toString('base64') }); }
test('a missing vault initializes, persists encrypted rows and supports an explicit empty vault', t => {
  const { store, filePath } = vault(t);
  assert.deepEqual(store.read(), []); assert.equal(store.write([row]), true);
  assert.deepEqual(store.read(), [row]); assert(!fs.readFileSync(filePath, 'utf8').includes('fixture-secret'));
  assert.equal(store.write([]), true); assert.deepEqual(store.read(), []);
});
test('damaged, undecryptable and malformed vaults never become empty data or permit overwrite', t => {
  const { store, filePath } = vault(t);
  const bad = ['{broken', JSON.stringify({ version: 99, payload: 'unused' }),
    JSON.stringify({ version: 1, payload: Buffer.from('not-ciphertext').toString('base64') }),
    encrypted({}), encrypted([null]), encrypted([{ ...row, password: '' }]), encrypted([row, row])];
  for (const bytes of bad) {
    fs.writeFileSync(filePath, bytes);
    assert.throws(() => store.read(), { code: 'credentials_unreadable' });
    assert.throws(() => store.write([{ ...row, id: 'replacement' }]), { code: 'credentials_unreadable' });
    assert.throws(() => store.write([]), { code: 'credentials_unreadable' });
    assert.equal(fs.readFileSync(filePath, 'utf8'), bytes);
  }
});
test('a locked secure store protects existing bytes and does not initialize new encrypted data', t => {
  const { filePath, store, safeStorage } = vault(t);
  assert.equal(store.write([row]), true); const bytes = fs.readFileSync(filePath);
  safeStorage.isEncryptionAvailable = () => false;
  assert.throws(() => store.read(), { code: 'secure_storage_unavailable' });
  assert.throws(() => store.write([]), { code: 'secure_storage_unavailable' });
  assert.deepEqual(fs.readFileSync(filePath), bytes);
  fs.unlinkSync(filePath);
  assert.deepEqual(store.read(), [], 'ordinary sync can still read a genuinely absent vault');
  assert.throws(() => store.write([row]), { code: 'secure_storage_unavailable' }); assert(!fs.existsSync(filePath));
});
test('vault I/O, encryption and pre-rename write failures retain existing bytes', t => {
  const base = vault(t); base.store.write([row]); const bytes = fs.readFileSync(base.filePath);
  const disk = Object.create(fs); disk.readFileSync = () => { throw Object.assign(Error('denied'), { code: 'EACCES' }); };
  const unreadable = createCredentialsVaultStore({ ...base, disk });
  assert.throws(() => unreadable.read(), { code: 'credentials_unreadable' });
  assert.throws(() => unreadable.write([]), { code: 'credentials_unreadable' });
  const noEncrypt = createCredentialsVaultStore({ ...base, safeStorage: { ...base.safeStorage, encryptString() { throw Error('locked'); } } });
  assert.throws(() => noEncrypt.write([]), { code: 'credentials_save_failed' });
  const noRename = Object.create(fs); noRename.renameSync = () => { throw Error('disk_full'); };
  assert.throws(() => createCredentialsVaultStore({ ...base, disk: noRename }).write([]), { code: 'credentials_save_failed' });
  assert.deepEqual(fs.readFileSync(base.filePath), bytes);
  assert.deepEqual(fs.readdirSync(path.dirname(base.filePath)), ['vault.json']);
});
test('a vault write committed before a directory sync error is acknowledged without inviting a duplicate new record', t => {
  for (const phase of ['rename', ...(process.platform === 'win32' ? [] : ['directory-fsync'])]) {
    const base = vault(t);
    let fail = true;
    const disk = Object.create(fs);
    disk.renameSync = (from, to) => {
      fs.renameSync(from, to);
      if (fail && phase === 'rename') { fail = false; throw Error('after_rename_failure'); }
    };
    disk.fsyncSync = fd => {
      if (fail && phase === 'directory-fsync' && fs.fstatSync(fd).isDirectory()) {
        fail = false; throw Error('directory_fsync_failure');
      }
      fs.fsyncSync(fd);
    };
    const store = createCredentialsVaultStore({ ...base, disk });
    assert.equal(store.write([row]), true, phase);
    assert.deepEqual(store.read(), [row]);
    assert.deepEqual(createCredentialsVaultStore(base).read(), [row]);
    assert.deepEqual(fs.readdirSync(path.dirname(base.filePath)), ['vault.json']);
  }
});
test('a post-rename error cannot claim success when the visible vault differs from the intended write', t => {
  const base = vault(t), disk = Object.create(fs);
  const externallyChanged = encrypted([{ ...row, id: 'other-key' }]);
  disk.renameSync = (from, to) => {
    fs.renameSync(from, to); fs.writeFileSync(to, externallyChanged); throw Error('after_rename_failure');
  };
  const store = createCredentialsVaultStore({ ...base, disk });
  assert.throws(() => store.write([row]), { code: 'credentials_save_failed' });
  assert.equal(fs.readFileSync(base.filePath, 'utf8'), externallyChanged);
});
function shortcut(options = {}) {
  const registered = new Set(['Command+Shift+P']), events = [];
  const input = { currentShortcut: 'Command+Shift+P', nextShortcut: 'Command+Shift+K',
    isRegistered: key => registered.has(key),
    register: key => { events.push(`register:${key}`); registered.add(key); return true; },
    unregister: key => { events.push(`unregister:${key}`); registered.delete(key); },
    persist: () => { events.push('persist'); return true; }, ...options };
  return { registered, events, run: () => switchPanelShortcut(input) };
}
test('a conflicting or throwing shortcut registration preserves the original wake-up binding', () => {
  for (const register of [() => false, () => { throw Error('reserved'); }]) {
    const fixture = shortcut({ register }); assert.equal(fixture.run().error, 'register_failed');
    assert.deepEqual([...fixture.registered], ['Command+Shift+P']); assert.deepEqual(fixture.events, []);
  }
});
test('shortcut settings failures remove only the new binding and retain the previous one', () => {
  for (const persist of [() => false, () => { throw Error('disk_full'); }]) {
    const fixture = shortcut({ persist }); assert.equal(fixture.run().error, 'save_failed');
    assert.deepEqual([...fixture.registered], ['Command+Shift+P']);
    assert.deepEqual(fixture.events, ['register:Command+Shift+K', 'unregister:Command+Shift+K']);
  }
});
test('shortcut changes commit settings before removing the previous binding; selecting the same binding is safe', () => {
  const fixture = shortcut(); assert.equal(fixture.run().ok, true);
  assert.deepEqual(fixture.events, ['register:Command+Shift+K', 'persist', 'unregister:Command+Shift+P']);
  const same = shortcut({ nextShortcut: 'Command+Shift+P' }); assert.equal(same.run().ok, true);
  assert.deepEqual(same.events, ['persist']); assert.deepEqual([...same.registered], ['Command+Shift+P']);
});
test('switching from a global shortcut to hover-Space waits for durable settings before unbinding', () => {
  const failed = shortcut({ nextShortcut: 'Space', persist: () => false }); assert.equal(failed.run().ok, false);
  assert.deepEqual([...failed.registered], ['Command+Shift+P']);
  const good = shortcut({ nextShortcut: 'Space' }); assert.equal(good.run().ok, true);
  assert.deepEqual(good.events, ['persist', 'unregister:Command+Shift+P']);
});
