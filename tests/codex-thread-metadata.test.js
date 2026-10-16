'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readCodexThreadTitle } = require('../codex-thread-metadata');
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-thread-title-'));
  t.after(() => fs.rmSync(home, { force: true, recursive: true })); return home;
}
test('native thread names use exact IDs and newest index entry without writing files', t => {
  const home = fixture(t), index = path.join(home, 'session_index.jsonl');
  fs.writeFileSync(index, [{id:'a',thread_name:'旧名称'},{id:'b',thread_name:'其他会话'},{id:'a',thread_name:'原生短标题'}].map(JSON.stringify).join('\n'));
  const before = fs.readFileSync(index);
  assert.equal(readCodexThreadTitle('a', { homes: [home] }), '原生短标题');
  assert.equal(readCodexThreadTitle('absent', { homes: [home] }), ''); assert.deepEqual(fs.readFileSync(index), before);
});
test('readonly SQLite fallback chooses current schema, binds IDs and bounds prompt-sized titles', t => {
  const home = fixture(t), file = path.join(home, 'state_9.sqlite'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)');
  db.prepare('INSERT INTO threads VALUES (?, ?)').run('thread', '长标题'.repeat(200)); db.close();
  const before = fs.readFileSync(file);
  assert.equal(readCodexThreadTitle('thread', { homes: [home] }).length, 256);
  assert.equal(readCodexThreadTitle("' OR 1=1 --", { homes: [home] }), '');
  assert.deepEqual(fs.readFileSync(file), before);
});
test('missing or malformed metadata never prevents a completion notification', t => {
  const home = fixture(t); fs.writeFileSync(path.join(home, 'session_index.jsonl'), '{broken');
  assert.equal(readCodexThreadTitle('thread', { homes: [home] }), '');
});
