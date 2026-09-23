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
  assert.ok(
    files.includes('workspace-sync.js'),
    'build.files must include workspace-sync.js (full workspace sync)'
  );
  assert.ok(
    files.includes('sync-settings.js'),
    'build.files must include sync-settings.js (T6 endpoint settings)'
  );
});

function localRequireSpecs(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  return [...source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)].map((match) => match[1]);
}

function resolveLocalModule(fromAbs, spec) {
  let target = path.resolve(path.dirname(fromAbs), spec);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const pkgPath = path.join(target, 'package.json');
    const mainName = fs.existsSync(pkgPath) ? (require(pkgPath).main || 'index.js') : 'index.js';
    target = path.resolve(target, mainName);
  }
  if (!path.extname(target)) {
    if (fs.existsSync(`${target}.js`)) target = `${target}.js`;
    else if (fs.existsSync(path.join(target, 'index.js'))) target = path.join(target, 'index.js');
  }
  return target;
}

function fileCoveredByBuild(relPath, files) {
  const normalized = relPath.split(path.sep).join('/');
  return files.some((entry) => {
    if (typeof entry !== 'string' || entry.startsWith('!')) return false;
    if (entry === normalized) return true;
    if (entry.endsWith('/**/*')) return normalized.startsWith(entry.slice(0, -'/**/*'.length));
    if (entry.endsWith('/**')) {
      const prefix = entry.slice(0, -3);
      return normalized.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
    }
    return false;
  });
}

function mainProcessLocalModules() {
  const seen = new Set();
  const queue = [path.join(projectRoot, 'main.js')];
  while (queue.length) {
    const abs = queue.pop();
    if (seen.has(abs) || !fs.existsSync(abs)) continue;
    seen.add(abs);
    for (const spec of localRequireSpecs(abs)) {
      queue.push(resolveLocalModule(abs, spec));
    }
  }
  return [...seen].map((abs) => path.relative(projectRoot, abs));
}

test('build.files includes every local module the main process requires', () => {
  const files = packageConfig.build.files;
  const missing = mainProcessLocalModules().filter((rel) => !fileCoveredByBuild(rel, files));
  assert.deepEqual(
    missing,
    [],
    `electron-builder would omit modules required at launch: ${missing.join(', ')}`
  );
  assert.ok(mainProcessLocalModules().includes('workspace-sync.js'));
});

test('test-desktop.js node --check list covers sync-protocol, sqliteProbe, and sync-store', () => {
  const source = fs.readFileSync(testDesktopPath, 'utf8');
  assert.match(source, /sqliteProbe\.js/);
  assert.match(source, /sync-store\.js/);
  assert.match(source, /sync-migration\.js/);
  assert.match(source, /todos-sync\.js/);
  assert.match(source, /workspace-sync\.js/);
  assert.match(source, /sync-settings\.js/);
  assert.match(source, /packages\/sync-protocol\/migration\.js/);
  assert.match(source, /packages\/sync-protocol\/endpoints\.js/);
  assert.match(source, /renderer\/nas-sync-migration\.js/);
  assert.match(source, /renderer\/nas-sync-settings\.js/);
  assert.match(source, /packages\/sync-protocol\/index\.js/);
  assert.match(source, /packages\/sync-protocol\/schema\.js/);
  assert.match(source, /packages\/sync-protocol\/collections\.js/);
  assert.match(source, /packages\/sync-protocol\/mutation\.js/);
  assert.match(source, /packages\/sync-protocol\/pull\.js/);
  assert.match(source, /packages\/sync-protocol\/pairing\.js/);
  assert.match(source, /fnos\/app\/server\/pairing\.js/);
  assert.match(source, /fnos\/app\/ui\/pair\.js/);
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
