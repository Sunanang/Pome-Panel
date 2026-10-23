'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const USER_DATA_DIRECTORY = 'Pome Panel';
const LEGACY_DIRECTORY = 'Dynamic Panel';
const MIGRATION_FILE = '.pome-profile-migration.json';
// Chromium recreates these process locks and disposable caches. Storage,
// Local State (including Windows encryption metadata), databases and media stay.
const DISPOSABLE = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'GrShaderCache', 'ShaderCache', 'Crashpad', 'Crash Reports', 'logs', '.DS_Store',
  'SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort']);

function profileManifest(root) {
  const files = new Map();
  function visit(relative) {
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('profile_contains_symlink');
    if (stat.isDirectory()) {
      files.set(relative, { type: 'directory' });
      for (const name of fs.readdirSync(file).sort()) {
        if (!relative && DISPOSABLE.has(name)) continue;
        visit(path.join(relative, name));
      }
    } else if (stat.isFile()) {
      const hash = crypto.createHash('sha256');
      const fd = fs.openSync(file, 'r');
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let count;
        while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
      } finally { fs.closeSync(fd); }
      files.set(relative, { type: 'file', size: stat.size, hash: hash.digest('hex') });
    } else throw new Error('profile_contains_special_file');
  }
  visit('');
  return JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)));
}

function prepareUserDataDirectory({ appDataPath, overridePath, copy = fs.cpSync } = {}) {
  // Explicit profiles must never inspect or import from the user's real profile.
  if (overridePath) return { path: path.resolve(overridePath), migrated: false };
  const target = path.join(appDataPath, USER_DATA_DIRECTORY);
  const source = path.join(appDataPath, LEGACY_DIRECTORY);
  const current = () => {
    let previousPath;
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(target, MIGRATION_FILE), 'utf8'));
      if (marker.version === 1 && marker.from === source && marker.to === target) previousPath = source;
    } catch {}
    return { path: target, migrated: false, previousPath };
  };
  const targetStat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (targetStat) {
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new Error('profile_target_invalid');
    if (fs.readdirSync(target).length > 0) return current();
  }
  if (!fs.lstatSync(source, { throwIfNoEntry: false })) {
    fs.mkdirSync(target, { recursive: true });
    return { path: target, migrated: false };
  }

  const expected = profileManifest(source);
  const stage = fs.mkdtempSync(path.join(appDataPath, '.pome-panel-migration-'));
  try {
    copy(source, stage, { recursive: true, force: false, errorOnExist: true,
      filter: file => !DISPOSABLE.has(path.relative(source, file)) });
    // A running old app may change its SQLite/WAL or Chromium storage during
    // the copy. Never publish a mixed snapshot or silently fall back to sharing.
    if (profileManifest(source) !== expected || profileManifest(stage) !== expected) throw new Error('profile_changed_during_copy');
    // Only references to the old default change. Explicit custom folders,
    // encryption envelopes, sync identities and user content stay byte-for-byte.
    for (const filename of ['workspace-settings.json', 'sync-recovery.json']) {
      const file = path.join(stage, filename);
      if (!fs.existsSync(file)) continue;
      let record;
      try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
      const key = filename === 'workspace-settings.json' ? 'path' : 'root';
      if (typeof record?.[key] === 'string' && path.resolve(record[key]) === path.resolve(source)) {
        record[key] = target;
        fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
      }
    }
    fs.writeFileSync(path.join(stage, MIGRATION_FILE), JSON.stringify({ version: 1, from: source, to: target }), { mode: 0o600 });
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || !fs.statSync(target).isDirectory()) throw new Error('profile_target_invalid');
      if (fs.readdirSync(target).length > 0) return current();
      fs.rmdirSync(target);
    }
    fs.renameSync(stage, target);
    return { path: target, migrated: true, previousPath: source };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { USER_DATA_DIRECTORY, LEGACY_DIRECTORY, MIGRATION_FILE, prepareUserDataDirectory };
