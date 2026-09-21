'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { openSyncStore, TODO_ITEM_FIELDS, TODO_PRIORITIES, categoryEntityId } = require('../sync-store');
const { SCHEMA_VERSION, COLLECTIONS } = require('../packages/sync-protocol');
const {
  accountIdFromBinding,
  createClientMutationId,
  buildTodoEntityPayload,
  assertTodosProjectionContract,
  assertCategoryNamesProjectionContract,
  assertTodosOnlyCollection,
  notesCollectionIsNotWired,
  writeTodoUpsert,
  writeTodoDelete,
  writeCategoryUpsert,
  writeTodosLocalMutation,
  applyTodosPullPage,
  pushTodosOutbox,
  runTodosSyncCycle,
  applyTodosProjectionToStorage,
  ensureBoundAccount,
  normalizePullResponse,
  outboxRowToMutation,
} = require('../todos-sync');

function memoryBound(overrides = {}) {
  const store = openSyncStore(':memory:');
  const binding = {
    serverId: 'srv-t5',
    uid: 'uid-t5',
    deviceId: 'dev-t5',
    boundAt: Date.now(),
    ...overrides,
  };
  const { accountId, deviceId } = ensureBoundAccount(store, binding);
  return { store, accountId, deviceId, binding, ctx: { accountId, deviceId } };
}

test('notes collection is not wired for P0', () => {
  assert.equal(notesCollectionIsNotWired(), true);
  const rejected = assertTodosOnlyCollection(COLLECTIONS.NOTES);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'collection_not_enabled');
});

test('accountIdFromBinding is stable per serverId+uid', () => {
  assert.equal(
    accountIdFromBinding({ serverId: 's1', uid: 'u1' }),
    accountIdFromBinding({ serverId: 's1', uid: 'u1' })
  );
  assert.notEqual(
    accountIdFromBinding({ serverId: 's1', uid: 'u1' }),
    accountIdFromBinding({ serverId: 's2', uid: 'u1' })
  );
  assert.throws(() => accountIdFromBinding({ serverId: '', uid: 'u1' }), /sync_binding_identity_required/);
});

test('LS projection contract keeps P0–P3 keys and item field set', () => {
  const todos = { P0: [], P1: [], P2: [], P3: [] };
  todos.P0.push({
    id: 't1',
    text: 'hello',
    done: false,
    createdAt: 1,
    deadline: '',
    remindedAt: 0,
  });
  assert.equal(assertTodosProjectionContract(todos).ok, true);

  const leaked = {
    ...todos,
    P0: [{ ...todos.P0[0], serverRev: 9 }],
  };
  assert.equal(assertTodosProjectionContract(leaked).ok, false);

  const badKeys = { P0: [], P1: [], extras: [] };
  assert.equal(assertTodosProjectionContract(badKeys).ok, false);

  const names = { P0: 'a', P1: 'b', P2: 'c', P3: 'd' };
  assert.equal(assertCategoryNamesProjectionContract(names).ok, true);
  assert.equal(assertCategoryNamesProjectionContract({ P0: 'a' }).ok, false);
});

test('dual-write upsert/delete/category rebuilds projection without sync meta in LS', () => {
  const { store, ctx } = memoryBound();
  try {
    const item = {
      id: 'todo-a',
      text: 'read',
      done: false,
      createdAt: 10,
      deadline: '2026-09-21T15:30:00.000Z',
      remindedAt: 0,
    };
    const up = writeTodoUpsert(store, ctx, { item, categoryId: 'P0' });
    assert.equal(up.ok, true);
    assert.equal(up.deduped, false);
    assert.equal(up.pendingCount, 1);

    const cat = writeCategoryUpsert(store, ctx, { priority: 'P0', name: '课程改' });
    assert.equal(cat.ok, true);

    const projection = up.projection;
    // After category write, use latest projection.
    const latest = store.buildTodosLocalStorageProjection(ctx.accountId);
    const contract = assertTodosProjectionContract(latest.todos);
    assert.equal(contract.ok, true);
    assert.equal(latest.todos.P0[0].text, 'read');
    assert.equal(Object.keys(latest.todos.P0[0]).sort().join(','), [...TODO_ITEM_FIELDS].sort().join(','));
    assert.equal(latest.categoryNames.P0, '课程改');
    assert.equal(Object.prototype.hasOwnProperty.call(latest.todos.P0[0], 'categoryId'), false);

    const del = writeTodoDelete(store, ctx, { entityId: 'todo-a' });
    assert.equal(del.ok, true);
    const afterDelete = store.buildTodosLocalStorageProjection(ctx.accountId);
    assert.equal(afterDelete.todos.P0.length, 0);
    assert.equal(store.listPendingOutbox(ctx.accountId).length, 3);
  } finally {
    store.close();
  }
});

test('tombstone blocks stale upsert resurrection and cancels conflicting outbox', () => {
  const { store, accountId, ctx } = memoryBound();
  try {
    writeTodoUpsert(store, ctx, {
      item: {
        id: 'todo-z',
        text: 'gone',
        done: false,
        createdAt: 1,
        deadline: '',
        remindedAt: 0,
      },
      categoryId: 'P1',
      clientMutationId: 'local-up-1',
    });

    // Remote tombstone at rev 5.
    const pulled = applyTodosPullPage(store, {
      accountId,
      pull: {
        changes: [{ entityId: 'todo-z', op: 'delete', payload: {}, serverRev: 5 }],
        nextCursor: '5',
        hasMore: false,
        serverRev: 5,
      },
    });
    assert.equal(pulled.ok, true);
    assert.equal(pulled.projection.todos.P1.length, 0);

    // Stale upsert at rev 3 must not resurrect.
    const stale = applyTodosPullPage(store, {
      accountId,
      pull: {
        changes: [
          {
            entityId: 'todo-z',
            op: 'upsert',
            payload: buildTodoEntityPayload(
              {
                id: 'todo-z',
                text: 'zombie',
                done: false,
                createdAt: 1,
                deadline: '',
                remindedAt: 0,
              },
              'P1'
            ),
            serverRev: 3,
          },
        ],
        nextCursor: '5',
        hasMore: false,
        serverRev: 5,
      },
    });
    assert.equal(stale.ok, true);
    assert.equal(stale.projection.todos.P1.length, 0);

    const entity = store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-z');
    assert.ok(entity);
    assert.ok(entity.deletedAt != null);

    // Pending local upsert for tombstoned entity should have been cancelled.
    const pending = store.listPendingOutbox(accountId);
    assert.equal(
      pending.some((row) => row.entityId === 'todo-z' && row.op === 'upsert'),
      false
    );
  } finally {
    store.close();
  }
});

test('offline outbox reconnect push dedupes by clientMutationId', async () => {
  const { store, accountId, ctx } = memoryBound();
  try {
    const clientMutationId = createClientMutationId(1_700_000_000_111);
    const first = writeTodoUpsert(store, ctx, {
      item: {
        id: 'todo-off',
        text: 'offline',
        done: false,
        createdAt: 2,
        deadline: '',
        remindedAt: 0,
      },
      categoryId: 'P2',
      clientMutationId,
    });
    assert.equal(first.ok, true);
    assert.equal(first.deduped, false);

    const again = writeTodosLocalMutation(store, {
      accountId,
      deviceId: ctx.deviceId,
      entityId: 'todo-off',
      op: 'upsert',
      payload: buildTodoEntityPayload(
        {
          id: 'todo-off',
          text: 'offline',
          done: false,
          createdAt: 2,
          deadline: '',
          remindedAt: 0,
        },
        'P2'
      ),
      clientMutationId,
    });
    assert.equal(again.ok, true);
    assert.equal(again.deduped, true);
    assert.equal(store.listPendingOutbox(accountId).length, 1);

    const seenBatches = [];
    const push = await pushTodosOutbox(store, {
      accountId,
      pushMutations: async (mutations) => {
        seenBatches.push(mutations.map((m) => m.clientMutationId));
        return {
          ok: true,
          applied: mutations.map((m) => ({
            clientMutationId: m.clientMutationId,
            status: 'applied',
            serverRev: 1,
          })),
          serverRev: 1,
        };
      },
    });
    assert.equal(push.ok, true);
    assert.equal(push.pushed, 1);
    assert.deepEqual(seenBatches, [[clientMutationId]]);
    assert.equal(store.listPendingOutbox(accountId).length, 0);

    // Re-push after ack is a no-op (offline queue drained).
    const secondPush = await pushTodosOutbox(store, {
      accountId,
      pushMutations: async () => {
        throw new Error('should_not_push');
      },
    });
    assert.equal(secondPush.ok, true);
    assert.equal(secondPush.skipped, true);
  } finally {
    store.close();
  }
});

test('runTodosSyncCycle pull then push with mock transport', async () => {
  const { store, accountId, ctx } = memoryBound();
  try {
    writeTodoUpsert(store, ctx, {
      item: {
        id: 'todo-sync',
        text: 'local',
        done: false,
        createdAt: 3,
        deadline: '',
        remindedAt: 0,
      },
      categoryId: 'P3',
      clientMutationId: 'cm-local-1',
    });

    let pullCalls = 0;
    const result = await runTodosSyncCycle(store, {
      accountId,
      pullPage: async ({ cursor }) => {
        pullCalls += 1;
        assert.equal(cursor, null);
        return {
          ok: true,
          body: {
            schemaVersion: SCHEMA_VERSION,
            minSupported: SCHEMA_VERSION,
            maxSupported: SCHEMA_VERSION,
            changes: [
              {
                entityId: 'todo-remote',
                op: 'upsert',
                payload: buildTodoEntityPayload(
                  {
                    id: 'todo-remote',
                    text: 'from-nas',
                    done: false,
                    createdAt: 9,
                    deadline: '',
                    remindedAt: 0,
                  },
                  'P0'
                ),
                serverRev: 2,
              },
              {
                entityId: categoryEntityId('P0'),
                op: 'upsert',
                payload: { name: '远端课程' },
                serverRev: 3,
              },
            ],
            nextCursor: '3',
            hasMore: false,
            serverRev: 3,
          },
        };
      },
      pushMutations: async (mutations) => {
        assert.ok(mutations.length >= 1);
        for (const mutation of mutations) {
          assert.equal(mutation.collection, COLLECTIONS.TODOS);
          assert.equal(mutation.schemaVersion, SCHEMA_VERSION);
          assert.ok(mutation.clientMutationId);
        }
        return {
          ok: true,
          applied: mutations.map((m) => ({
            clientMutationId: m.clientMutationId,
            status: 'duplicate',
          })),
          serverRev: 4,
          body: {
            schemaVersion: SCHEMA_VERSION,
            minSupported: SCHEMA_VERSION,
            maxSupported: SCHEMA_VERSION,
            applied: mutations.map((m) => ({
              clientMutationId: m.clientMutationId,
              status: 'duplicate',
            })),
            serverRev: 4,
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(pullCalls, 1);
    assert.equal(result.projection.todos.P0.some((t) => t.id === 'todo-remote'), true);
    assert.equal(result.projection.todos.P3.some((t) => t.id === 'todo-sync'), true);
    assert.equal(result.projection.categoryNames.P0, '远端课程');
    assert.equal(assertTodosProjectionContract(result.projection.todos).ok, true);
    assert.equal(result.pendingCount, 0);
  } finally {
    store.close();
  }
});

test('applyTodosProjectionToStorage writes only projection keys', () => {
  const bag = new Map();
  const storage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => {
      bag.set(key, value);
    },
  };
  const todos = { P0: [], P1: [], P2: [], P3: [] };
  const categoryNames = { P0: '课程', P1: '自媒体&写作', P2: 'Vibe coding', P3: '日常' };
  applyTodosProjectionToStorage(storage, {
    todos,
    categoryNames,
    todosJson: JSON.stringify(todos),
    categoryNamesJson: JSON.stringify(categoryNames),
  });
  assert.equal(bag.size, 2);
  assert.ok(bag.has('notch-todo-data'));
  assert.ok(bag.has('notch-todo-category-names-v1'));
  assert.deepEqual(Object.keys(JSON.parse(bag.get('notch-todo-data'))).sort(), [...TODO_PRIORITIES].sort());
});

test('normalizePullResponse strips extras and empties delete payload', () => {
  const normalized = normalizePullResponse({
    changes: [
      {
        entityId: 'x',
        op: 'delete',
        payload: { nope: true },
        serverRev: 1,
        tombstone: true,
        collection: 'todos',
      },
    ],
    nextCursor: '1',
    hasMore: false,
    serverRev: 1,
    schemaVersion: 1,
  });
  // Top-level unknown fields dropped for SyncStore validatePullResponse.
  assert.deepEqual(Object.keys(normalized).sort(), ['changes', 'hasMore', 'nextCursor', 'serverRev']);
  assert.deepEqual(normalized.changes[0].payload, {});
});

test('outboxRowToMutation keeps protocol fields only', () => {
  const mutation = outboxRowToMutation({
    schemaVersion: SCHEMA_VERSION,
    collection: COLLECTIONS.TODOS,
    entityId: 'e1',
    op: 'upsert',
    payload: { id: 'e1', text: 't', done: false, createdAt: 1, deadline: '', remindedAt: 0, categoryId: 'P0' },
    clientMutationId: 'cm',
    deviceId: 'd',
    baseServerRev: 0,
    clientTime: 9,
    status: 'pending',
    createdAt: 9,
  });
  assert.deepEqual(Object.keys(mutation).sort(), [
    'baseServerRev',
    'clientMutationId',
    'clientTime',
    'collection',
    'deviceId',
    'entityId',
    'op',
    'payload',
    'schemaVersion',
  ]);
});

test('packaging includes todos-sync.js', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('todos-sync.js'));
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'test-desktop.js'), 'utf8');
  assert.match(desktop, /todos-sync\.js/);
});
