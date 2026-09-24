'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MIGRATION_DECISIONS,
  AUTHORITY,
  classifyMigrationDecision,
  resolveMigrationChoice,
  normalizeNasSyncState,
} = require('../packages/sync-protocol/migration');

const {
  parseLocalTodosStrict,
  selectMigrationLocalTodos,
  classifyFromLocalAndNas,
  isInsideSyncBackupDir,
  resolveSyncBackupsRoot,
  writeMigrationBackupAtomic,
  readMigrationBackup,
  runMigrationAttempt,
  transitionMigrationState,
  localTodosToEntities,
} = require('../sync-migration');

const { openSyncStore } = require('../sync-store');
const { createMemoryStore } = require('../fnos/app/server/store');

function emptyTodos() {
  return { P0: [], P1: [], P2: [], P3: [] };
}

function liveTodos(count = 1) {
  const data = emptyTodos();
  for (let i = 0; i < count; i += 1) {
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

test('parseLocalTodosStrict: empty ok; corrupt blocks; live counts', () => {
  assert.equal(parseLocalTodosStrict(null).live, 0);
  assert.equal(parseLocalTodosStrict(null).ok, true);
  assert.equal(parseLocalTodosStrict('{').corrupt, true);
  assert.equal(parseLocalTodosStrict('[]').corrupt, true);
  assert.equal(parseLocalTodosStrict(JSON.stringify({ P0: [] })).corrupt, true);
  const ok = parseLocalTodosStrict(JSON.stringify(liveTodos(2)));
  assert.equal(ok.ok, true);
  assert.equal(ok.live, 2);
  const legacy = { P0: ['买菜'], P1: [], P2: [], P3: [{ text: '还没有 id' }] };
  const coerced = parseLocalTodosStrict(JSON.stringify(legacy));
  assert.equal(coerced.ok, true);
  assert.equal(coerced.live, 2);
  assert.equal(coerced.data.P0[0].text, '买菜');
  assert.ok(coerced.data.P3[0].id);
});

test('empty screen todos fall back to workspace.json; corrupt screen does not', () => {
  const workspace = JSON.stringify(liveTodos(3));
  const empty = JSON.stringify({ P0: [], P1: [], P2: [], P3: [] });
  const picked = selectMigrationLocalTodos(empty, workspace);
  assert.equal(picked.ok, true);
  assert.equal(picked.live, 3);
  assert.equal(picked.source, 'workspace');
  const screen = selectMigrationLocalTodos(JSON.stringify(liveTodos(1)), workspace);
  assert.equal(screen.live, 1);
  assert.equal(screen.source, 'screen');
  const corrupt = selectMigrationLocalTodos('{', workspace);
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.corrupt, true);
});

test('four-state + history-empty + corrupt decision table (§5/§7)', () => {
  const pristine = { live: 0, tombstones: 0, changeLogCount: 0, serverRev: 0, pristine: true };
  const historyEmpty = { live: 0, tombstones: 2, changeLogCount: 3, serverRev: 5, pristine: false };
  const nasLive = { live: 2, tombstones: 0, changeLogCount: 2, serverRev: 2, pristine: false };

  assert.equal(
    classifyFromLocalAndNas(JSON.stringify(liveTodos(1)), pristine).decision,
    MIGRATION_DECISIONS.AUTO_UPLOAD_LOCAL,
  );
  assert.equal(
    classifyFromLocalAndNas(JSON.stringify(emptyTodos()), nasLive).decision,
    MIGRATION_DECISIONS.AUTO_DOWNLOAD_NAS,
  );
  assert.equal(
    classifyFromLocalAndNas(JSON.stringify(liveTodos(1)), nasLive).decision,
    MIGRATION_DECISIONS.BOTH_LIVE_CONFIRM,
  );
  assert.equal(
    classifyFromLocalAndNas(JSON.stringify(emptyTodos()), pristine).decision,
    MIGRATION_DECISIONS.SKIP_EMPTY,
  );
  assert.equal(
    classifyFromLocalAndNas(JSON.stringify(emptyTodos()), historyEmpty).decision,
    MIGRATION_DECISIONS.ENTER_SYNC_NAS_HISTORY,
  );
  assert.equal(
    classifyFromLocalAndNas(JSON.stringify(liveTodos(1)), historyEmpty).decision,
    MIGRATION_DECISIONS.HISTORY_EMPTY_CHOICE,
  );
  assert.equal(
    classifyFromLocalAndNas('{bad', pristine).decision,
    MIGRATION_DECISIONS.BLOCK_CORRUPT_LOCAL,
  );
});

test('history-empty choice maps to authority; both-live requires choice', () => {
  assert.deepEqual(
    resolveMigrationChoice(MIGRATION_DECISIONS.HISTORY_EMPTY_CHOICE, 'restore_local'),
    { ok: true, authority: AUTHORITY.LOCAL },
  );
  assert.deepEqual(
    resolveMigrationChoice(MIGRATION_DECISIONS.HISTORY_EMPTY_CHOICE, 'keep_nas_deletes'),
    { ok: true, authority: AUTHORITY.NAS },
  );
  assert.equal(
    resolveMigrationChoice(MIGRATION_DECISIONS.BOTH_LIVE_CONFIRM, null).ok,
    false,
  );
});

test('backup path whitelist rejects sibling escape', () => {
  const root = resolveSyncBackupsRoot('/tmp/user-data-x');
  assert.equal(isInsideSyncBackupDir(root, path.join(root, 'mig1', 'todos.json')), true);
  assert.equal(isInsideSyncBackupDir(root, path.join(root, '..', 'evil.json')), false);
  assert.equal(isInsideSyncBackupDir(root, `${root}-sibling/todos.json`), false);
});

test('write/read migration backup + prune keeps recent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-mig-bak-'));
  const json = JSON.stringify(liveTodos(1));
  const written = writeMigrationBackupAtomic(dir, 'mig-a', json);
  assert.equal(written.ok, true);
  const read = readMigrationBackup(dir, 'mig-a');
  assert.equal(read.ok, true);
  assert.equal(read.live, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('transitionMigrationState rejects illegal jumps', () => {
  assert.equal(transitionMigrationState('pending', 'applied').ok, false);
  assert.equal(transitionMigrationState('pending', 'prepared').ok, true);
  assert.equal(transitionMigrationState('failed', 'pending').ok, true);
});

test('runMigrationAttempt: auto upload local with CAS; 409 reclassify', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-mig-run-'));
  const store = openSyncStore(':memory:');
  store.ensureAccount({ accountId: 'acc1', uid: 'u1', deviceId: 'd1', serverId: 's1' });

  let serverRev = 0;
  const migrations = new Map();
  const api = {
    async startMigration() {
      const migrationId = 'm1';
      migrations.set(migrationId, { state: 'pending', snapshotServerRev: serverRev });
      return { migrationId, snapshotServerRev: serverRev, state: 'pending' };
    },
    async commitMigration(body) {
      if (Number(body.expectedServerRev) !== serverRev) {
        return { ok: false, status: 409, error: 'cas_conflict', body: { currentServerRev: serverRev } };
      }
      serverRev += body.entities ? body.entities.length : 0;
      return { ok: true, body: { state: 'committed', serverRev, backupId: 'bak' } };
    },
    async getMigration() {
      return { state: 'committed' };
    },
    async pullAll() {
      return { changes: [], nextCursor: '0', hasMore: false, serverRev };
    },
  };

  const decision = classifyFromLocalAndNas(JSON.stringify(liveTodos(2)), {
    live: 0,
    tombstones: 0,
    changeLogCount: 0,
    serverRev: 0,
    pristine: true,
  });

  let applied = null;
  const ok = await runMigrationAttempt({
    decision,
    authority: AUTHORITY.LOCAL,
    localRaw: JSON.stringify(liveTodos(2)),
    userDataPath: dir,
    accountId: 'acc1',
    deviceId: 'd1',
    api,
    store,
    applyLocalProjection(json) {
      applied = json;
    },
  });
  assert.equal(ok.ok, true);
  assert.ok(applied);
  assert.equal(store.getMigration('m1').state, 'applied');

  // CAS conflict path
  serverRev = 9;
  const conflict = await runMigrationAttempt({
    decision,
    authority: AUTHORITY.LOCAL,
    localRaw: JSON.stringify(liveTodos(1)),
    userDataPath: dir,
    accountId: 'acc1',
    deviceId: 'd1',
    api: {
      ...api,
      async startMigration() {
        return { migrationId: 'm2', snapshotServerRev: 0, state: 'pending' };
      },
    },
    store,
    applyLocalProjection() {},
  });
  assert.equal(conflict.error, 'cas_conflict');
  assert.equal(conflict.reclassify, true);

  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runMigrationAttempt: apply failure rolls back from backup (no half-apply)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-mig-rb-'));
  const store = openSyncStore(':memory:');
  store.ensureAccount({ accountId: 'acc1', uid: 'u1', deviceId: 'd1', serverId: 's1' });
  const original = JSON.stringify(liveTodos(3));

  const decision = classifyFromLocalAndNas(original, {
    live: 1,
    tombstones: 0,
    changeLogCount: 1,
    serverRev: 1,
    pristine: false,
  });

  let projection = original;
  const result = await runMigrationAttempt({
    decision,
    authority: AUTHORITY.NAS,
    localRaw: original,
    userDataPath: dir,
    accountId: 'acc1',
    deviceId: 'd1',
    api: {
      async startMigration() {
        return { migrationId: 'm-fail', snapshotServerRev: 1, state: 'pending' };
      },
      async commitMigration() {
        return { ok: true, body: { state: 'committed', serverRev: 1, backupId: 'b' } };
      },
      async getMigration() {
        return { state: 'committed' };
      },
      async pullAll() {
        throw new Error('boom');
      },
    },
    store,
    applyLocalProjection(json) {
      projection = json;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'apply_failed');
  assert.equal(result.rolledBack, true);
  assert.equal(parseLocalTodosStrict(projection).live, 3);
  assert.equal(store.getMigration('m-fail').state, 'failed');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fnos commitMigration: local authority replaces live; CAS 409', () => {
  const mem = createMemoryStore({ serverId: 'srv' });
  mem.applyPush('uid', [
    {
      schemaVersion: 1,
      collection: 'todos',
      entityId: 'old',
      op: 'upsert',
      payload: { text: 'old', categoryId: 'P0' },
      clientMutationId: 'c0',
      deviceId: 'd0',
      baseServerRev: 0,
      clientTime: 1,
    },
  ], { deviceId: 'd0' });
  const started = mem.startMigration('uid');
  const conflict = mem.commitMigration('uid', {
    migrationId: started.migrationId,
    expectedServerRev: 99,
    authority: 'local',
    entities: [],
  });
  assert.equal(conflict.error, 'cas_conflict');

  const started2 = mem.startMigration('uid');
  const ok = mem.commitMigration('uid', {
    migrationId: started2.migrationId,
    expectedServerRev: mem.syncState('uid').serverRev,
    authority: 'local',
    entities: [
      {
        entityId: 'new1',
        op: 'upsert',
        payload: { id: 'new1', text: 'from local', categoryId: 'P1' },
      },
    ],
    deviceId: 'desk',
  });
  assert.equal(ok.ok, true);
  const state = mem.syncState('uid');
  assert.equal(state.live, 1);
  assert.equal(state.pristine, false);
});

test('localTodosToEntities preserves categoryId', () => {
  const entities = localTodosToEntities(liveTodos(1));
  assert.equal(entities.length, 1);
  assert.equal(entities[0].payload.categoryId, 'P0');
});

test('normalizeNasSyncState rejects garbage', () => {
  assert.equal(normalizeNasSyncState(null).ok, false);
  assert.equal(normalizeNasSyncState({ live: 0, tombstones: 0, changeLogCount: 0, serverRev: 0 }).ok, true);
});

test('classifyMigrationDecision both-live needsUserChoice', () => {
  const d = classifyMigrationDecision({
    localOk: true,
    localLive: 2,
    nas: { live: 3, tombstones: 0, changeLogCount: 3, serverRev: 3, pristine: false },
  });
  assert.equal(d.needsUserChoice, true);
  assert.equal(d.decision, MIGRATION_DECISIONS.BOTH_LIVE_CONFIRM);
});
