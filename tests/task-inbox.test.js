'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskInbox, READ_RETENTION_MS } = require('../taskInbox');

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
test('cleanup removes expired read events and never drops old unread events', (t) => {
  const filePath = fixture(t);
  let clock = 10000;
  const inbox = createTaskInbox({ filePath, now: () => clock });
  const read = inbox.accept({ completedAt: 1, source: 'cursor', taskId: 'read' }).record;
  inbox.accept({ completedAt: 1, source: 'cursor', taskId: 'unread' });
  inbox.markRead(read.id);
  clock += READ_RETENTION_MS - 1;
  assert.equal(inbox.list().total, 2);
  inbox.markRead(read.id);
  clock++;
  assert.equal(inbox.list().total, 1);
  assert.equal(inbox.list().items[0].taskId, 'unread');
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
