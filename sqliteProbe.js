'use strict';

/**
 * SQLite backend probe for SyncStore (T4).
 *
 * Selection conclusion (T0, 2026-09-21):
 * - Prefer built-in `node:sqlite` (Node 22+ / Electron 44 with Node sqlite).
 * - Do NOT add better-sqlite3 or other native modules unless this probe fails
 *   in the Electron main process and CI can rebuild + codesign `.node` files.
 * - Host Node and Electron (ELECTRON_RUN_AS_NODE) both expose DatabaseSync here.
 *
 * Usage: call probeSqliteSupport() at SyncStore init; refuse to open sync.db
 * if available === false.
 */

const SQLITE_BACKEND_NODE_BUILTIN = 'node:sqlite';
const SQLITE_BACKEND_UNAVAILABLE = 'unavailable';

/**
 * @returns {{
 *   available: boolean,
 *   backend: 'node:sqlite' | 'unavailable',
 *   DatabaseSync: (new (path: string, options?: object) => object) | null,
 *   detail: string,
 * }}
 */
function probeSqliteSupport() {
  try {
    // eslint-disable-next-line import/no-unresolved -- built-in when Node/Electron ships sqlite
    const sqlite = require('node:sqlite');
    if (typeof sqlite.DatabaseSync !== 'function') {
      return {
        available: false,
        backend: SQLITE_BACKEND_UNAVAILABLE,
        DatabaseSync: null,
        detail: 'node:sqlite loaded but DatabaseSync is missing',
      };
    }
    return {
      available: true,
      backend: SQLITE_BACKEND_NODE_BUILTIN,
      DatabaseSync: sqlite.DatabaseSync,
      detail: 'node:sqlite DatabaseSync is available',
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return {
      available: false,
      backend: SQLITE_BACKEND_UNAVAILABLE,
      DatabaseSync: null,
      detail: `node:sqlite unavailable: ${message}`,
    };
  }
}

/**
 * Open an in-memory DatabaseSync when available; used by unit tests and
 * SyncStore smoke checks. Throws if sqlite is unavailable.
 *
 * @returns {object} DatabaseSync instance
 */
function openProbeDatabase() {
  const probe = probeSqliteSupport();
  if (!probe.available || !probe.DatabaseSync) {
    throw new Error(probe.detail);
  }
  const db = new probe.DatabaseSync(':memory:');
  db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY); INSERT INTO probe (id) VALUES (1);');
  const row = db.prepare('SELECT id FROM probe WHERE id = 1').get();
  if (!row || row.id !== 1) {
    db.close();
    throw new Error('node:sqlite probe query failed');
  }
  return db;
}

module.exports = {
  SQLITE_BACKEND_NODE_BUILTIN,
  SQLITE_BACKEND_UNAVAILABLE,
  probeSqliteSupport,
  openProbeDatabase,
};
