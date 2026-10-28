'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createTodoReminderReceipts, reminderKey, mergeReminderMark } = require('../todoReminders');
const { openSyncStore } = require('../sync-store');
const { ensureBoundAccount, buildTodoEntityPayload, applyTodosPullPage, writeTodoUpsert } = require('../todos-sync');
const { createPersistentStore } = require('../fnos/app/server/persistentStore');
const { mutationFromEntity } = require('../workspace-sync');
const vm = require('node:vm');
const crypto = require('node:crypto');

const todo = (overrides = {}) => ({ id: 't1', text: 'Task', deadline: '2026-10-28T12:00:00.000Z', done: false, createdAt: 1, remindedAt: 0, ...overrides });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-todo-receipts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'todo-reminders.json');
}
test('receipt survives process restart and stale NAS projection; equivalent ISO dates share identity', t => {
  const filePath = fixture(t), store = createTodoReminderReceipts({ filePath });
  assert.equal(store.merge([todo()])[0].remindedAt, 0);
  assert.equal(fs.existsSync(filePath), false, 'queueing cannot persist consumption');
  store.markShown([todo()], 12345);
  const reopened = createTodoReminderReceipts({ filePath });
  assert.equal(reopened.merge([todo()])[0].remindedAt, 12345);
  assert.equal(reopened.merge([todo({ deadline: '2026-10-28T20:00:00+08:00' })])[0].remindedAt, 12345);
  assert.notEqual(reminderKey(todo()), reminderKey(todo({ deadline: '2026-10-28T12:01:00Z' })));
});
test('deadline change invalidates the old receipt, including changing back before another display', t => {
  const filePath = fixture(t), store = createTodoReminderReceipts({ filePath });
  store.markShown([todo()], 12345);
  assert.equal(store.merge([todo({ deadline: '2026-10-29T12:00:00Z' })])[0].remindedAt, 0);
  assert.equal(createTodoReminderReceipts({ filePath }).merge([todo()])[0].remindedAt, 0);
});
test('storage failure retains original bytes and can retry; corruption is not silently overwritten', t => {
  const filePath = fixture(t), store = createTodoReminderReceipts({ filePath });
  store.markShown([todo()], 100);
  const before = fs.readFileSync(filePath, 'utf8'), disk = Object.create(fs);
  disk.renameSync = () => { throw Object.assign(new Error('fixture ENOSPC'), { code: 'ENOSPC' }); };
  assert.throws(() => createTodoReminderReceipts({ filePath, disk }).markShown([todo({ id: 't2' })], 200), /ENOSPC/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), before);
  store.markShown([todo({ id: 't2' })], 200);
  assert.equal(store.merge([todo({ id: 't2' })])[0].remindedAt, 200);
  fs.writeFileSync(filePath, '{broken');
  assert.throws(() => store.merge([todo()]), /损坏/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{broken');
});
test('a durability error after rename adopts exactly the committed receipt', t => {
  const filePath = fixture(t), disk = Object.create(fs);
  disk.renameSync = (...args) => { fs.renameSync(...args); throw new Error('fixture error after rename'); };
  createTodoReminderReceipts({ filePath, disk }).markShown([todo()], 100);
  assert.equal(createTodoReminderReceipts({ filePath }).merge([todo()])[0].remindedAt, 100);
});
test('workspace receipts are isolated and only merge matching task deadlines', t => {
  const filePath = fixture(t);
  createTodoReminderReceipts({ filePath }).markShown([todo()], 100);
  assert.equal(createTodoReminderReceipts({ filePath: filePath + '.other' }).merge([todo()])[0].remindedAt, 0);
  assert.equal(mergeReminderMark(todo({ remindedAt: 100 }), todo({ text: 'Changed', remindedAt: 0 })).text, 'Changed');
  assert.equal(mergeReminderMark(todo({ remindedAt: 100 }), todo({ deadline: '2026-10-29T12:00:00Z' })).remindedAt, 0);
});
test('SQLite pull and stale local upserts retain marks only for the same deadline', () => {
  const store = openSyncStore(':memory:');
  try {
    const ctx = ensureBoundAccount(store, { serverId: 'review', uid: 'u', deviceId: 'a' });
    const pull = (row, rev) => applyTodosPullPage(store, { accountId: ctx.accountId, pull: {
      changes: [{ entityId: row.id, op: 'upsert', payload: buildTodoEntityPayload(row, 'P0'), serverRev: rev }],
      nextCursor: String(rev), hasMore: false, serverRev: rev,
    } });
    assert(pull(todo({ remindedAt: 100 }), 1).ok);
    assert.equal(pull(todo({ text: 'Remote text' }), 2).projection.todos.P0[0].remindedAt, 100);
    const local = writeTodoUpsert(store, ctx, { item: todo({ text: 'Local text' }), categoryId: 'P0' });
    assert(local.ok);
    assert.equal(local.projection.todos.P0[0].remindedAt, 100);
    assert.equal(store.listPendingOutbox(ctx.accountId)[0].payload.remindedAt, 100);
    assert.equal(pull(todo({ deadline: '2026-10-29T12:00:00Z' }), 3).projection.todos.P0[0].remindedAt, 0);
  } finally { store.close(); }
});
test('NAS persists reminder marks across stale device writes and restarts without preventing a new deadline', t => {
  const filePath = fixture(t), server = createPersistentStore({ filePath, serverId: 'todo-nas', maintenanceIntervalMs: Infinity });
  let sequence = 0;
  const push = (target, row) => target.applyPush('u', [mutationFromEntity({ collection: 'todos', entityId: row.id, payload: buildTodoEntityPayload(row, 'P0') }, {
    deviceId: 'a', clientMutationId: `receipt-${++sequence}`, baseServerRev: target.bucket('u').serverRev,
  })], { deviceId: 'a' });
  push(server, todo({ remindedAt: 100 }));
  push(server, todo({ text: 'Offline device edit' }));
  assert.equal(server.bucket('u').live.get('t1').payload.remindedAt, 100);
  const reopened = createPersistentStore({ filePath, serverId: 'todo-nas', maintenanceIntervalMs: Infinity });
  assert.equal(reopened.bucket('u').live.get('t1').payload.remindedAt, 100);
  push(reopened, todo({ deadline: '2026-10-29T12:00:00Z' }));
  assert.equal(reopened.bucket('u').live.get('t1').payload.remindedAt, 0);
});

test('production display acknowledgement queues fresh sync payloads atomically and retries without duplicate writes', () => {
  const store = openSyncStore(':memory:');
  try {
    const ctx = { ok: true, store, ...ensureBoundAccount(store, { serverId: 'review', uid: 'u', deviceId: 'a' }) };
    for (const id of ['t1', 't2']) assert(writeTodoUpsert(store, ctx, { item: todo({ id, text: 'Newest text ' + id }), categoryId: 'P0' }).ok);
    const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const code = main.slice(main.indexOf('function syncTodoReminderReceipts('), main.indexOf('function acknowledgeTodoReminder('));
    let pushes = 0;
    const sandbox = { readBoundSyncContext: () => ctx, reminderKey, buildTodoEntityPayload, crypto, Date,
      workspaceSwitching: false, migrationSession: { readonly: false }, recoveryStore: () => ({ read: () => ({ paused: false }) }),
      runBoundTodosSyncCycle: () => { pushes++; return Promise.resolve({ ok: true }); } };
    vm.createContext(sandbox); vm.runInContext(code, sandbox);
    const original = store.writeLocalMutation;
    let attempts = 0;
    store.writeLocalMutation = input => { if (++attempts === 2) throw new Error('fixture sync disk full'); return original(input); };
    const receipts = ['t1', 't2'].map(id => todo({ id, remindedAt: 100 }));
    assert.throws(() => sandbox.syncTodoReminderReceipts(receipts), /disk full/);
    assert.equal(store.getEntity(ctx.accountId, 'todos', 't1').payload.remindedAt, 0, 'whole receipt batch rolls back');
    store.writeLocalMutation = original;
    sandbox.syncTodoReminderReceipts(receipts);
    assert.equal(pushes, 1);
    assert.equal(store.getEntity(ctx.accountId, 'todos', 't1').payload.text, 'Newest text t1');
    assert.equal(store.getEntity(ctx.accountId, 'todos', 't2').payload.remindedAt, 100);
    const count = store.listPendingOutbox(ctx.accountId).length;
    sandbox.syncTodoReminderReceipts(receipts);
    assert.equal(store.listPendingOutbox(ctx.accountId).length, count);
    assert.equal(pushes, 1, 'no network attempt for an unchanged receipt');
    sandbox.migrationSession.readonly = true;
    sandbox.syncTodoReminderReceipts(receipts.map(row => ({ ...row, remindedAt: 200 })));
    assert.equal(store.listPendingOutbox(ctx.accountId).length, count, 'first-bind readonly blocks reminder writes');
    sandbox.migrationSession.readonly = false;
    sandbox.recoveryStore = () => ({ read: () => ({ paused: true }) });
    sandbox.syncTodoReminderReceipts(receipts.map(row => ({ ...row, remindedAt: 200 })));
    assert.equal(store.listPendingOutbox(ctx.accountId).length, count, 'restore recovery pause blocks reminder writes');
  } finally { store.close(); }
});
