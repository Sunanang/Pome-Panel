'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');
const packageConfig = require(path.join(projectRoot, 'package.json'));
const testDesktopPath = path.join(projectRoot, 'scripts', 'test-desktop.js');
const sqliteProbe = require('../sqliteProbe');

test('electron-builder build.files whitelists packages/sync-protocol', () => {
  const files = packageConfig.build.files;
  assert.ok(Array.isArray(files), 'build.files must be an array whitelist');
  const matched = files.some(
    (entry) =>
      entry === 'packages/sync-protocol/**/*' ||
      entry === 'packages/sync-protocol/**' ||
      entry === 'packages/sync-protocol/'
  );
  assert.equal(
    matched,
    true,
    'build.files must include packages/sync-protocol so DMG/EXE ship the shared contract'
  );
  assert.ok(
    files.includes('sqliteProbe.js'),
    'build.files must include sqliteProbe.js for SyncStore selection'
  );
  assert.ok(
    files.includes('sync-store.js'),
    'build.files must include sync-store.js (T4 SyncStore + outbox)'
  );
  assert.ok(
    files.includes('sync-migration.js'),
    'build.files must include sync-migration.js (T5b migration)'
  );
  assert.ok(
    files.includes('todos-sync.js'),
    'build.files must include todos-sync.js (T5 todos dual-write + push/pull)'
  );
});

test('test-desktop.js node --check list covers sync-protocol, sqliteProbe, and sync-store', () => {
  const source = fs.readFileSync(testDesktopPath, 'utf8');
  assert.match(source, /sqliteProbe\.js/);
  assert.match(source, /sync-store\.js/);
  assert.match(source, /sync-migration\.js/);
  assert.match(source, /todos-sync\.js/);
  assert.match(source, /packages\/sync-protocol\/migration\.js/);
  assert.match(source, /renderer\/nas-sync-migration\.js/);
  assert.match(source, /packages\/sync-protocol\/index\.js/);
  assert.match(source, /packages\/sync-protocol\/schema\.js/);
  assert.match(source, /packages\/sync-protocol\/collections\.js/);
  assert.match(source, /packages\/sync-protocol\/mutation\.js/);
  assert.match(source, /packages\/sync-protocol\/pull\.js/);
  assert.match(source, /packages\/sync-protocol\/pairing\.js/);
  assert.match(source, /fnos\/app\/server\/pairing\.js/);
  assert.match(source, /renderer\/nas-sync-pair\.js/);
});

test('package sharing stays relative-require (no workspaces)', () => {
  assert.equal(packageConfig.workspaces, undefined);
  const protocolPkg = require(path.join(projectRoot, 'packages', 'sync-protocol', 'package.json'));
  assert.equal(protocolPkg.name, '@pome-panel/sync-protocol');
  assert.equal(protocolPkg.main, 'index.js');
  // Desktop resolves via relative path, not a hoisted dependency name.
  assert.equal(
    packageConfig.dependencies?.['@pome-panel/sync-protocol'],
    undefined
  );
});

test('sqlite probe selects node:sqlite without native modules', () => {
  const probe = sqliteProbe.probeSqliteSupport();
  assert.equal(probe.available, true);
  assert.equal(probe.backend, sqliteProbe.SQLITE_BACKEND_NODE_BUILTIN);
  assert.equal(typeof probe.DatabaseSync, 'function');

  const db = sqliteProbe.openProbeDatabase();
  try {
    const row = db.prepare('SELECT id FROM probe WHERE id = 1').get();
    assert.equal(row.id, 1);
  } finally {
    db.close();
  }

  assert.equal(
    packageConfig.dependencies?.['better-sqlite3'],
    undefined,
    'T0 must not introduce better-sqlite3 while node:sqlite works'
  );
});

test('Electron main-equivalent Node can load node:sqlite', () => {
  const electronPath = require('electron');
  const script = `
    const { probeSqliteSupport, openProbeDatabase } = require(${JSON.stringify(
      path.join(projectRoot, 'sqliteProbe.js')
    )});
    const probe = probeSqliteSupport();
    if (!probe.available) {
      console.error(probe.detail);
      process.exit(2);
    }
    const db = openProbeDatabase();
    db.close();
    process.stdout.write(probe.backend);
  `;
  const result = spawnSync(electronPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'node:sqlite');
});
