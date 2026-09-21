'use strict';

/**
 * T8-19 — disconnect/restart and kill-mid-migration recovery fixtures.
 * T8-15 — no post-migration dual-queue guard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { openSyncStore } = require('../sync-store');
const { ensureBoundAccount, writeTodoUpsert, pushTodosOutbox } = require('../todos-sync');
const {
  runMigrationAttempt,
  transitionMigrationState,
  AUTHORITY,
  classifyFromLocalAndNas,
  MIGRATION_DECISIONS,
} = require('../sync-migration');

function liveTodos(n = 1) {
  const data = { P0: [], P1: [], P2: [], P3: [] };
  for (let i = 0; i < n; i += 1) {
    data.P0.push({
      id: `t${i}`,
      text: `task ${i}`,
      done: false,
      createdAt: 1000 + i,
      deadline: '',
      remindedAt: 0,
    });
  }
  return data;
}

test('T8-19: offline outbox survives process restart (reopen SyncStore)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-outbox-restart-'));
  const dbPath = path.join(dir, 'sync.db');
  const store1 = openSyncStore(dbPath);
  const bound = ensureBoundAccount(store1, {
    serverId: 'srv',
    uid: 'uid',
    deviceId: 'dev',
    boundAt: Date.now(),
  });
  writeTodoUpsert(store1, { accountId: bound.accountId, deviceId: bound.deviceId }, {
    item: {
      id: 'todo-offline',
      text: 'offline edit',
      done: false,
      createdAt: 1,
      deadline: '',
      remindedAt: 0,
    },
    categoryId: 'P0',
  });
  const pendingBefore = store1.listPendingOutbox(bound.accountId);
  assert.ok(pendingBefore.length >= 1);
  const mutationIds = pendingBefore.map((row) => row.clientMutationId);
  store1.close();

  const store2 = openSyncStore(dbPath);
  const pendingAfter = store2.listPendingOutbox(bound.accountId);
  assert.equal(pendingAfter.length, pendingBefore.length);
  assert.deepEqual(
    pendingAfter.map((row) => row.clientMutationId).sort(),
    mutationIds.slice().sort(),
  );

  const push = await pushTodosOutbox(store2, {
    accountId: bound.accountId,
    pushMutations: async (mutations) => ({
      ok: true,
      applied: mutations.map((m) => ({
        clientMutationId: m.clientMutationId,
        status: 'applied',
        serverRev: 1,
      })),
      serverRev: 1,
    }),
  });
  assert.equal(push.ok, true);
  assert.equal(store2.listPendingOutbox(bound.accountId).length, 0);

  const second = await pushTodosOutbox(store2, {
    accountId: bound.accountId,
    pushMutations: async () => {
      throw new Error('should_not_push_after_restart_drain');
    },
  });
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);

  store2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('T8-19: kill mid-migration leaves recoverable store row; failed→pending retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-mig-kill-'));
  const dbPath = path.join(dir, 'sync.db');
  const store = openSyncStore(dbPath);
  store.ensureAccount({ accountId: 'acc1', uid: 'u1', deviceId: 'd1', serverId: 's1' });

  // Simulate crash after prepared (before commit returned).
  store.upsertMigration({
    migrationId: 'mig-killed',
    accountId: 'acc1',
    state: 'prepared',
    snapshotServerRev: 0,
  });
  store.close();

  const reopened = openSyncStore(dbPath);
  const row = reopened.getMigration('mig-killed');
  assert.ok(row);
  assert.equal(row.state, 'prepared');
  assert.equal(row.snapshotServerRev, 0);

  // Cannot jump prepared → applied; must fail then retry from pending.
  assert.equal(transitionMigrationState('prepared', 'applied').ok, false);
  reopened.updateMigrationState('mig-killed', 'failed', { reason: 'process_killed' });
  assert.equal(transitionMigrationState('failed', 'pending').ok, true);
  reopened.updateMigrationState('mig-killed', 'pending');
  assert.equal(reopened.getMigration('mig-killed').state, 'pending');

  // Fresh attempt after "restart" succeeds (new migrationId from server).
  const localRaw = JSON.stringify(liveTodos(1));
  const decision = classifyFromLocalAndNas(localRaw, {
    live: 0,
    tombstones: 0,
    changeLogCount: 0,
    serverRev: 0,
    pristine: true,
  });
  assert.equal(decision.decision, MIGRATION_DECISIONS.AUTO_UPLOAD_LOCAL);

  const result = await runMigrationAttempt({
    decision,
    authority: AUTHORITY.LOCAL,
    localRaw,
    userDataPath: dir,
    accountId: 'acc1',
    deviceId: 'd1',
    api: {
      async startMigration() {
        return { migrationId: 'mig-retry', snapshotServerRev: 0, state: 'pending' };
      },
      async commitMigration() {
        return { ok: true, body: { state: 'committed', serverRev: 1, backupId: 'b1' } };
      },
      async getMigration() {
        return { state: 'committed' };
      },
    },
    store: reopened,
    applyLocalProjection() {},
  });
  assert.equal(result.ok, true);
  assert.equal(reopened.getMigration('mig-retry').state, 'applied');
  reopened.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('T8-15 guard: no post-migration dual-queue in sync sources', () => {
  const sources = [
    'sync-migration.js',
    'todos-sync.js',
    'main.js',
    'renderer/nas-sync-migration.js',
  ].map((rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /post[_-]?migration[_-]?outbox/i);
  assert.doesNotMatch(sources, /dual[_-]?queue/i);
  assert.doesNotMatch(sources, /postMigrationOutbox/);
});
