'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskInbox, MAX_RECORDS } = require('../taskInbox');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-inbox-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'inbox.json');
}
test('50 unread events survive restart and page beyond the first 20', (t) => {
  const filePath = fixture(t);
  let inbox = createTaskInbox({ filePath });
  for (let i = 0; i < 50; i++) inbox.accept({ completedAt: 1, source: 'codex', taskId: `task-${i}`, title: `完成 ${i}` });
  inbox = createTaskInbox({ filePath });
  assert.equal(inbox.list().items.length, 20);
  assert.equal(inbox.list().unread, 50);
  assert.equal(inbox.list({ offset: 40 }).items.length, 10);
});
test('dedupe and first read timestamp persist, but a later genuine event is accepted', (t) => {
  const filePath = fixture(t);
  let clock = 10000;
  const now = () => clock;
  let inbox = createTaskInbox({ filePath, now });
  const event = { completedAt: 1, source: 'claude', taskId: 'same-session', title: '完成' };
  const first = inbox.accept(event).record;
  clock++;
  inbox.markRead(first.id);
  inbox = createTaskInbox({ filePath, now });
  assert.equal(inbox.accept(event).duplicate, true);
  assert.equal(inbox.get(first.id).readAt, clock);
  clock += 10000;
  assert.equal(inbox.accept({ ...event, completedAt: 2 }).duplicate, false);
  assert.equal(inbox.list().total, 2);
  assert.equal(inbox.list().unread, 1);
});
test('capacity evicts the oldest read and unread records and their dedupe keys', (t) => {
  const filePath = fixture(t);
  let clock = 10000;
  const inbox = createTaskInbox({ filePath, now: () => clock++ });
  const read = inbox.accept({ source: 'cursor', eventId: 'read' }).record;
  const unread = inbox.accept({ source: 'cursor', eventId: 'unread' }).record;
  inbox.markRead(read.id);
  for (let i = 0; i < MAX_RECORDS; i++) inbox.accept({ source: 'codex', eventId: `new-${i}` });
  assert.equal(inbox.list().total, MAX_RECORDS);
  assert.equal(inbox.list().unread, MAX_RECORDS);
  assert.equal(inbox.get(read.id), null);
  assert.equal(inbox.get(unread.id), null);
  const saved = JSON.parse(fs.readFileSync(filePath));
  assert.equal(saved.records.length, MAX_RECORDS);
  assert.equal(Object.keys(saved.dedupe).length, MAX_RECORDS);
  assert.equal(inbox.accept({ source: 'codex', eventId: 'new-99' }).duplicate, true);
  assert.equal(inbox.accept({ source: 'cursor', eventId: 'read' }).duplicate, false);
});
test('startup trims unsorted oversized historical files without new events', (t) => {
  const filePath = fixture(t);
  const records = Array.from({ length: 140 }, (_, i) => ({ id: `old-${i}`, source: 'claude', receivedAt: i, readAt: i % 2 ? null : i }));
  const dedupe = Object.fromEntries(records.map(row => [`event:${row.id}`, { id: row.id, at: row.receivedAt, stable: true }]));
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, records, dedupe }));
  const inbox = createTaskInbox({ filePath });
  assert.equal(inbox.list().total, MAX_RECORDS);
  assert.equal(inbox.list().items[0].id, 'old-139');
  assert.equal(inbox.list({offset: 99}).items[0].id, 'old-40');
  assert.equal(inbox.list().unread, 50);
  const saved = JSON.parse(fs.readFileSync(filePath));
  assert.equal(saved.records.length, MAX_RECORDS);
  assert.equal(Object.keys(saved.dedupe).length, MAX_RECORDS);
  assert.equal(createTaskInbox({filePath}).get('old-39'), null);
});
test('records below capacity no longer expire based on age or read status', (t) => {
  const filePath = fixture(t);
  let clock = 10000;
  let inbox = createTaskInbox({filePath, now: () => clock});
  const row = inbox.accept({source:'codex', eventId:'read'}).record;
  inbox.markRead(row.id);
  clock += 365 * 86400000;
  inbox = createTaskInbox({filePath, now: () => clock});
  assert.equal(inbox.list().total, 1);
  assert.equal(inbox.accept({source:'codex', eventId:'read'}).duplicate, true);
});
test('write failure does not claim acceptance or damage previous records', (t) => {
  const filePath = fixture(t);
  const original = createTaskInbox({ filePath });
  original.accept({ completedAt: 1, source: 'codex', taskId: 'saved' });
  const before = fs.readFileSync(filePath);
  const disk = { ...fs, writeFileSync() { throw new Error('ENOSPC'); } };
  const failing = createTaskInbox({ filePath, disk });
  assert.throws(() => failing.accept({ completedAt: 1, source: 'codex', taskId: 'failed' }), /ENOSPC/);
  assert.deepEqual(fs.readFileSync(filePath), before);
  assert.equal(createTaskInbox({ filePath }).list().total, 1);
});
test('errors after atomic rename retain committed records without pausing later reads or retries', t => {
  for (const phase of ['rename', ...(process.platform === 'win32' ? [] : ['directory-fsync'])]) {
    const filePath = fixture(t);
    let fail = false;
    const disk = Object.create(fs);
    disk.renameSync = (from, to) => {
      fs.renameSync(from, to);
      if (fail && phase === 'rename') { fail = false; throw new Error('after_rename_failure'); }
    };
    disk.fsyncSync = fd => {
      if (fail && phase === 'directory-fsync' && fs.fstatSync(fd).isDirectory()) {
        fail = false; throw new Error('directory_fsync_failure');
      }
      fs.fsyncSync(fd);
    };
    const inbox = createTaskInbox({ filePath, disk });
    inbox.accept({ source: 'codex', eventId: 'before', title: 'Before' });
    fail = true;
    const event = { source: 'codex', eventId: 'during', title: 'During' };
    assert.throws(() => inbox.accept(event), error => error.taskInboxCommitted === true);
    assert.equal(JSON.parse(fs.readFileSync(filePath)).records.length, 2);
    assert.equal(inbox.list().total, 2, phase);
    const retry = inbox.accept(event);
    assert.equal(retry.duplicate, true); assert.equal(retry.record.title, 'During');
    assert.equal(inbox.markRead(retry.record.id).ok, true);
    assert.equal(inbox.accept({ source: 'codex', eventId: 'after', title: 'After' }).ok, true);
    assert.equal(inbox.list().total, 3);
    assert.equal(createTaskInbox({ filePath }).list().total, 3);
  }
});
test('a failure before rename does not adopt uncommitted data and remains retryable in the same instance', t => {
  const filePath = fixture(t);
  let fail = false;
  const disk = Object.create(fs);
  disk.renameSync = (from, to) => { if (fail) throw new Error('before_rename_failure'); fs.renameSync(from, to); };
  const inbox = createTaskInbox({ filePath, disk });
  inbox.accept({ source: 'codex', eventId: 'before', title: 'Before' });
  const before = fs.readFileSync(filePath);
  const event = { source: 'codex', eventId: 'during', title: 'During' };
  fail = true;
  assert.throws(() => inbox.accept(event), error => !error.taskInboxCommitted && /before_rename/.test(error.message));
  assert.deepEqual(fs.readFileSync(filePath), before); assert.equal(inbox.list().total, 1);
  fail = false;
  assert.equal(inbox.accept(event).duplicate, false); assert.equal(inbox.list().total, 2);
});
test('corrupt and unsupported inbox files remain untouched', (t) => {
  const filePath = fixture(t);
  for (const bytes of ['{broken', '{"version":999,"records":[],"dedupe":{}}']) {
    fs.writeFileSync(filePath, bytes);
    assert.throws(() => createTaskInbox({ filePath }), /损坏/);
    assert.equal(fs.readFileSync(filePath, 'utf8'), bytes);
  }
});
test('normalized fields exclude commands and untrusted window IDs but retain app identity and cwd', (t) => {
  const inbox = createTaskInbox({ filePath: fixture(t) });
  assert.equal(inbox.accept({ source: 'other' }).ok, false);
  const record = inbox.accept({ completedAt: 1, source: 'codex', taskId: 'id', command: 'run-me',
    window: { id: 'obsolete', app: 'Editor', title: 'Project', bundleId: 'actual.editor', cwd: '/Users/test/full/workspace' } }).record;
  assert.equal(record.command, undefined);
  assert.equal(record.window.id, undefined);
  assert.equal(record.window.bundleId, 'actual.editor');
  assert.equal(record.window.cwd, '/Users/test/full/workspace');
});

test('old records with missing window identity or null fields remain readable', t => {
  const filePath = fixture(t);
  const inbox = createTaskInbox({ filePath });
  const noWindow = inbox.accept({ source: 'codex', eventId: 'legacy-null', window: null }).record;
  const oldWindow = inbox.accept({ source: 'cursor', eventId: 'legacy-window', window: { app: 'Cursor' } }).record;
  const reopened = createTaskInbox({ filePath });
  assert.equal(reopened.get(noWindow.id).window, null);
  assert.equal(reopened.get(oldWindow.id).window.bundleId, null);
  assert.equal(reopened.get(oldWindow.id).window.cwd, null);
});

test('metadata touches and identical atomic replacements do not pause the inbox', (t) => {
  const filePath = fixture(t);
  const inbox = createTaskInbox({ filePath });
  inbox.accept({ completedAt: 1, source: 'codex', taskId: 'original' });
  const original = fs.readFileSync(filePath);
  fs.utimesSync(filePath, new Date(0), new Date(0));
  assert.equal(inbox.list().total, 1);
  fs.writeFileSync(`${filePath}.replacement`, original);
  fs.renameSync(`${filePath}.replacement`, filePath);
  assert.equal(inbox.accept({ completedAt: 1, source: 'codex', taskId: 'next' }).ok, true);
  assert.equal(createTaskInbox({ filePath }).list().total, 2);
});

test('external content changes remain protected even when valid JSON', (t) => {
  const filePath = fixture(t);
  const inbox = createTaskInbox({ filePath });
  inbox.accept({ completedAt: 1, source: 'codex', taskId: 'original' });
  const changed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  changed.records[0].title = '外部修改';
  const bytes = JSON.stringify(changed);
  fs.writeFileSync(filePath, bytes);
  assert.throws(() => inbox.accept({ completedAt: 1, source: 'codex', taskId: 'next' }), { code: 'storage_changed' });
  assert.equal(fs.readFileSync(filePath, 'utf8'), bytes);
  assert.equal(createTaskInbox({ filePath }).list().items[0].title, '外部修改');
});

test('inbox persists status, native session title and bounded full summary across restart', t => {
  const filePath = fixture(t); let inbox = createTaskInbox({ filePath });
  for (const status of ['completed', 'failed', 'awaiting', 'due']) {
    const row = inbox.accept({ source: 'cursor', eventId: status, status, sessionTitle: '会话名称',
      title: '长标题'.repeat(150), completionSummary: '完整内容'.repeat(2000) }).record;
    assert.equal(row.status, status); assert.ok(row.title.length > 240); assert.equal(row.completionSummary.length, 4096);
  }
  inbox = createTaskInbox({ filePath });
  assert.deepEqual(new Set(inbox.list().items.map(row => row.status)), new Set(['completed', 'failed', 'awaiting', 'due']));
  assert.equal(inbox.list().items[0].sessionTitle, '会话名称');
});
test('old records without status or a window remain readable as completed', t => {
  const filePath = fixture(t), inbox = createTaskInbox({ filePath });
  const row = inbox.accept({ source: 'codex', title: '旧记录' }).record;
  const data = JSON.parse(fs.readFileSync(filePath)); delete data.records[0].status;
  fs.writeFileSync(filePath, JSON.stringify(data));
  assert.equal(createTaskInbox({ filePath }).get(row.id).status, 'completed');
  assert.equal(createTaskInbox({ filePath }).get(row.id).window, null);
});
