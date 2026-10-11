'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readAuthToken } = require('../cursor-usage');

function fixture(t, rows = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-cursor-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, 'state.vscdb');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
  const insert = db.prepare('INSERT INTO ItemTable VALUES (?, ?)');
  for (const [key, value] of rows) insert.run(key, value);
  db.close();
  return dbPath;
}

test('Cursor credentials are read from SQLite without changing the database', (t) => {
  const dbPath = fixture(t, [['cursorAuth/accessToken', 'fixture-cursor-token']]);
  const before = fs.readFileSync(dbPath);
  const result = readAuthToken(dbPath);
  assert.equal(result.ok, true);
  assert.equal(result.token, 'fixture-cursor-token');
  assert.deepEqual(fs.readFileSync(dbPath), before);
});

test('missing Cursor install and signed-out Cursor have distinct results', (t) => {
  const dbPath = fixture(t);
  assert.equal(readAuthToken(`${dbPath}.missing`).error, 'cursor_db_missing');
  assert.equal(readAuthToken(dbPath).error, 'cursor_token_missing');
});

test('an unreadable Cursor database returns a failure without a token', (t) => {
  const dbPath = fixture(t);
  fs.writeFileSync(dbPath, 'invalid sqlite database');
  const result = readAuthToken(dbPath);
  assert.equal(result.error, 'cursor_db_read_failed');
  assert.equal(Object.hasOwn(result, 'token'), false);
});
