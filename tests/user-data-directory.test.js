'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareUserDataDirectory } = require('../userDataDirectory');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'Dynamic Panel'), target = path.join(root, 'Pome Panel');
  const write = (name, content) => { const file = path.join(source, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  return { root, source, target, write };
}

test('new installs get Pome Panel, explicit profiles never inspect legacy data', t => {
  const { root, source, target, write } = setup(t);
  assert.equal(prepareUserDataDirectory({ appDataPath: root }).path, target);
  write('do-not-read', 'other app');
  fs.writeFileSync(path.join(source, 'invalid-file'), 'other-app-data');
  const overridePath = path.join(root, 'isolated-test-profile');
  assert.deepEqual(prepareUserDataDirectory({ appDataPath: root, overridePath }), { path: overridePath, migrated: false });
});

test('migration preserves Chromium state, encryption envelopes, media and sync database identities', t => {
  const { root, source, target, write } = setup(t);
  const { DatabaseSync } = require('node:sqlite');
  const entries = {
    'workspace.json': JSON.stringify({ localStorage: { 'notch-home-note': '用户原文' } }),
    'Local State': '{"os_crypt":{"encrypted_key":"fixture-master-key"}}',
    'Local Storage/leveldb/000001.log': 'fixture-browser-storage-newer-than-workspace',
    'app-settings.json': '{"encryptedProviderTokens":{"manus":"encrypted-fixture"},"language":"de-DE"}',
    'sync-credentials.json': '{"payload":"encrypted-nas-identity-fixture"}',
    'recordings/recording-test.webm': Buffer.from([0, 1, 2, 255]),
    'clipboard-images/clip-test.png': Buffer.from([3, 4, 5]),
    'Cache/disposable': 'cache',
  };
  for (const [file, content] of Object.entries(entries)) write(file, content);
  const db = new DatabaseSync(path.join(source, 'sync.db'));
  db.exec('CREATE TABLE identity (id TEXT); INSERT INTO identity VALUES (\'same-device\')'); db.close();
  write('SingletonLock', 'host-999999');
  const result = prepareUserDataDirectory({ appDataPath: root });
  assert.equal(result.migrated, true); assert.equal(result.previousPath, source);
  for (const [file, content] of Object.entries(entries)) {
    assert.deepEqual(fs.readFileSync(path.join(source, file)), Buffer.from(content), 'old data untouched');
    if (file.startsWith('Cache/')) continue;
    assert.deepEqual(fs.readFileSync(path.join(target, file)), Buffer.from(content));
  }
  assert.equal(fs.existsSync(path.join(target, 'SingletonLock')), false);
  assert.equal(fs.existsSync(path.join(target, 'Cache')), false);
  const migrated = new DatabaseSync(path.join(target, 'sync.db'));
  assert.equal(migrated.prepare('SELECT id FROM identity').get().id, 'same-device'); migrated.close();
  write('workspace.json', 'old app changed later');
  assert.equal(prepareUserDataDirectory({ appDataPath: root }).migrated, false);
  assert.equal(prepareUserDataDirectory({ appDataPath: root }).previousPath, source);
  assert.equal(fs.readFileSync(path.join(target, 'workspace.json'), 'utf8'), entries['workspace.json']);
});

test('custom folders are retained, old-default references and recovery roots move to Pome', t => {
  const { root, source, target, write } = setup(t);
  const custom = path.join(root, 'custom-workspace');
  write('workspace-settings.json', JSON.stringify({ path: custom }));
  write('sync-recovery.json', JSON.stringify({ paused: true, root: source, operationId: 'same-operation' }));
  prepareUserDataDirectory({ appDataPath: root });
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'workspace-settings.json'))).path, custom);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'sync-recovery.json'))), { paused: true, root: target, operationId: 'same-operation' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(source, 'sync-recovery.json'))).root, source);
});

test('partial or changing copies are never published and can be retried', t => {
  const { root, target, write } = setup(t);
  write('workspace.json', 'original');
  assert.throws(() => prepareUserDataDirectory({ appDataPath: root, copy: () => { throw new Error('disk_full'); } }), /disk_full/);
  assert.equal(fs.existsSync(target), false);
  assert.throws(() => prepareUserDataDirectory({ appDataPath: root, copy: (...args) => {
    fs.cpSync(...args); write('workspace.json', 'changed during copy');
  } }), /profile_changed_during_copy/);
  assert.equal(fs.existsSync(target), false);
  assert.equal(prepareUserDataDirectory({ appDataPath: root }).migrated, true);
  assert.equal(fs.readFileSync(path.join(target, 'workspace.json'), 'utf8'), 'changed during copy');
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.pome-panel-migration-')), false);
});

test('an existing Pome profile wins and is never merged with the old app', t => {
  const { root, target, write } = setup(t);
  write('workspace.json', 'old app data');
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'workspace.json'), 'Pome data');
  assert.equal(prepareUserDataDirectory({ appDataPath: root }).migrated, false);
  assert.equal(fs.readFileSync(path.join(target, 'workspace.json'), 'utf8'), 'Pome data');
});

test('explicitly selected old default is rebased without changing the original settings', t => {
  const { root, source, target, write } = setup(t);
  write('workspace-settings.json', JSON.stringify({ path: source }));
  prepareUserDataDirectory({ appDataPath: root });
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'workspace-settings.json'))).path, target);
  assert.equal(JSON.parse(fs.readFileSync(path.join(source, 'workspace-settings.json'))).path, source);
});

test('uncheckpointed SQLite WAL data remains readable in the independent copy', t => {
  const { root, source, target, write } = setup(t);
  write('workspace.json', '{}');
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(path.join(source, 'sync.db'));
  let copied;
  try {
    old.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE identity(id TEXT); INSERT INTO identity VALUES('retained-in-wal')");
    assert(fs.statSync(path.join(source, 'sync.db-wal')).size > 0);
    prepareUserDataDirectory({ appDataPath: root });
    copied = new DatabaseSync(path.join(target, 'sync.db'));
    assert.equal(copied.prepare('SELECT id FROM identity').get().id, 'retained-in-wal');
    assert.equal(old.prepare('SELECT id FROM identity').get().id, 'retained-in-wal');
  } finally { copied?.close(); old.close(); }
});
