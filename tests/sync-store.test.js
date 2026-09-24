'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SYNC_DB_FILENAME,
  TODO_STORAGE_KEY,
  TODO_CATEGORY_KEY,
  TODO_PRIORITIES,
  TODO_ITEM_FIELDS,
  resolveSyncDbPath,
  planBoundStartupHydration,
  applyStartupHydrationOrder,
  categoryEntityId,
  openSyncStore,
} = require('../sync-store');
const { SCHEMA_VERSION, COLLECTIONS } = require('../packages/sync-protocol');

function memoryStore(accountOverrides = {}) {
  const store = openSyncStore(':memory:');
  const accountId = accountOverrides.accountId || 'acct-1';
  store.ensureAccount({
    accountId,
    uid: 'uid-1',
    serverId: 'srv-1',
    deviceId: 'dev-1',
    ...accountOverrides,
  });
  return { store, accountId };
}

function mutationInput(accountId, overrides = {}) {
  return {
    accountId,
    schemaVersion: SCHEMA_VERSION,
    collection: overrides.collection || COLLECTIONS.TODOS,
    entityId: overrides.entityId || 'todo-1',
    op: overrides.op || 'upsert',
    payload:
      overrides.payload !== undefined
        ? overrides.payload
        : {
            id: overrides.entityId || 'todo-1',
            text: 'hello',
            done: false,
            createdAt: 1000,
            deadline: '',
            remindedAt: 0,
            categoryId: 'P0',
          },
    clientMutationId: overrides.clientMutationId || 'cm-1',
    deviceId: overrides.deviceId || 'dev-1',
    baseServerRev: overrides.baseServerRev ?? 0,
    clientTime: overrides.clientTime || 1_700_000_000_000,
  };
}

test('resolveSyncDbPath stays under fixed userData (not custom workspace)', () => {
  const userData = path.join(os.tmpdir(), 'pome-userdata');
  assert.equal(resolveSyncDbPath(userData), path.join(userData, SYNC_DB_FILENAME));
  assert.throws(() => resolveSyncDbPath(''), /sync_db_user_data_required/);
});

test('bound startup order is hydrate then SQLite projection', () => {
  const unbound = planBoundStartupHydration({ bound: false });
  assert.deepEqual(unbound.steps, ['hydratePortableWorkspace']);
  assert.equal(unbound.projectionOverridesWorkspace, false);

  const bound = planBoundStartupHydration({ bound: true });
  assert.deepEqual(bound.steps, [
    'hydratePortableWorkspace',
    'rebuildLocalStorageProjectionFromSyncDb',
  ]);
  assert.equal(bound.projectionOverridesWorkspace, true);
});

test('bound startup: workspace.json hydrate then SQLite projection wins', () => {
  const bag = new Map();
  const storage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => {
      bag.set(key, value);
    },
  };

  const staleTodos = JSON.stringify({
    P0: [{ id: 'stale', text: 'from-workspace', done: false, createdAt: 1, deadline: '', remindedAt: 0 }],
    P1: [],
    P2: [],
    P3: [],
  });
  const liveTodos = JSON.stringify({
    P0: [{ id: 'live', text: 'from-sqlite', done: false, createdAt: 2, deadline: '', remindedAt: 0 }],
    P1: [],
    P2: [],
    P3: [],
  });
  const categoryNames = JSON.stringify({
    P0: '课程',
    P1: '自媒体&写作',
    P2: 'Vibe coding',
    P3: '日常',
  });

  applyStartupHydrationOrder({
    bound: true,
    workspaceSnapshot: {
      [TODO_STORAGE_KEY]: staleTodos,
      [TODO_CATEGORY_KEY]: categoryNames,
    },
    projection: {
      todosJson: liveTodos,
      categoryNamesJson: categoryNames,
    },
    storage,
  });

  assert.equal(storage.getItem(TODO_STORAGE_KEY), liveTodos);
  const parsed = JSON.parse(storage.getItem(TODO_STORAGE_KEY));
  assert.equal(parsed.P0[0].id, 'live');
  assert.deepEqual(Object.keys(parsed).sort(), [...TODO_PRIORITIES].sort());
});

test('unbound startup: hydrate only; no SQLite overwrite', () => {
  const bag = new Map();
  const storage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => {
      bag.set(key, value);
    },
  };
  const staleTodos = JSON.stringify({ P0: [], P1: [], P2: [], P3: [] });
  applyStartupHydrationOrder({
    bound: false,
    workspaceSnapshot: { [TODO_STORAGE_KEY]: staleTodos },
    projection: {
      todosJson: JSON.stringify({
        P0: [{ id: 'x', text: 'should-not-apply', done: false, createdAt: 1, deadline: '', remindedAt: 0 }],
        P1: [],
        P2: [],
        P3: [],
      }),
      categoryNamesJson: '{}',
    },
    storage,
  });
  assert.equal(storage.getItem(TODO_STORAGE_KEY), staleTodos);
});

test('writeLocalMutation updates entity + outbox in one transaction', () => {
  const { store, accountId } = memoryStore();
  try {
    const result = store.writeLocalMutation(mutationInput(accountId));
    assert.equal(result.ok, true);
    assert.equal(result.deduped, false);

    const entity = store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-1');
    assert.ok(entity);
    assert.equal(entity.payload.text, 'hello');
    assert.equal(entity.deletedAt, null);

    const pending = store.listPendingOutbox(accountId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].clientMutationId, 'cm-1');
    assert.equal(pending[0].op, 'upsert');
  } finally {
    store.close();
  }
});

test('writeLocalMutation rolls back entity when outbox insert would leave partial state', () => {
  const { store, accountId } = memoryStore();
  try {
    // First successful write.
    assert.equal(store.writeLocalMutation(mutationInput(accountId, { clientMutationId: 'cm-ok' })).ok, true);

    // Force a mid-transaction failure after entity upsert by using a closed-path
    // helper: begin, write entity, throw before outbox — exposed via abort helper pattern.
    const now = Date.now();
    assert.throws(() => {
      store._runInTransaction(() => {
        store.db.prepare(`
          INSERT INTO entities (
            account_id, collection, entity_id, payload_json, server_rev, deleted_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(account_id, collection, entity_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `).run(accountId, COLLECTIONS.TODOS, 'todo-crash', JSON.stringify({ text: 'ghost' }), 0, now);
        throw new Error('simulated_crash');
      });
    }, /simulated_crash/);

    assert.equal(store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-crash'), null);
    assert.equal(store.listPendingOutbox(accountId).length, 1);
  } finally {
    store.close();
  }
});

test('clientMutationId dedupes outbox writes (idempotent)', () => {
  const { store, accountId } = memoryStore();
  try {
    const first = store.writeLocalMutation(
      mutationInput(accountId, {
        clientMutationId: 'same-id',
        payload: {
          id: 'todo-1',
          text: 'one',
          done: false,
          createdAt: 1,
          deadline: '',
          remindedAt: 0,
          categoryId: 'P0',
        },
      })
    );
    assert.equal(first.ok, true);
    assert.equal(first.deduped, false);

    const second = store.writeLocalMutation(
      mutationInput(accountId, {
        clientMutationId: 'same-id',
        payload: {
          id: 'todo-1',
          text: 'two',
          done: true,
          createdAt: 1,
          deadline: '',
          remindedAt: 0,
          categoryId: 'P0',
        },
      })
    );
    assert.equal(second.ok, true);
    assert.equal(second.deduped, true);

    const pending = store.listPendingOutbox(accountId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].payload.text, 'one');
    assert.equal(store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-1').payload.text, 'one');
  } finally {
    store.close();
  }
});

test('file-backed crash: uncommitted transaction does not persist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pome-sync-db-'));
  const dbPath = resolveSyncDbPath(dir);
  const store = openSyncStore(dbPath);
  const accountId = 'acct-file';
  try {
    store.ensureAccount({ accountId, uid: 'u', serverId: 's', deviceId: 'd' });
    assert.equal(store.writeLocalMutation(mutationInput(accountId)).ok, true);

    assert.throws(() => {
      store._runInTransaction(() => {
        store.db.prepare(`
          INSERT INTO entities (
            account_id, collection, entity_id, payload_json, server_rev, deleted_at, updated_at
          ) VALUES (?, ?, ?, ?, 0, NULL, ?)
        `).run(accountId, COLLECTIONS.TODOS, 'ghost-todo', JSON.stringify({ text: 'nope' }), Date.now());
        throw new Error('crash');
      });
    }, /crash/);
    store.close();

    const reopened = openSyncStore(dbPath);
    try {
      assert.equal(reopened.getEntity(accountId, COLLECTIONS.TODOS, 'ghost-todo'), null);
      assert.ok(reopened.getEntity(accountId, COLLECTIONS.TODOS, 'todo-1'));
      assert.equal(reopened.listPendingOutbox(accountId).length, 1);
    } finally {
      reopened.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pull cursor commits only after full page succeeds', () => {
  const { store, accountId } = memoryStore();
  try {
    assert.deepEqual(store.getPullCursor(accountId), { cursor: null, serverRev: 0 });

    const page = {
      changes: [
        {
          entityId: 'todo-a',
          op: 'upsert',
          payload: {
            id: 'todo-a',
            text: 'A',
            done: false,
            createdAt: 10,
            deadline: '',
            remindedAt: 0,
            categoryId: 'P1',
          },
          serverRev: 1,
        },
        {
          entityId: 'todo-b',
          op: 'upsert',
          payload: {
            id: 'todo-b',
            text: 'B',
            done: false,
            createdAt: 11,
            deadline: '',
            remindedAt: 0,
            categoryId: 'P2',
          },
          serverRev: 2,
        },
      ],
      nextCursor: 'cur-2',
      hasMore: false,
      serverRev: 2,
    };

    const applied = store.applyPullPage({ accountId, pull: page });
    assert.equal(applied.ok, true);
    assert.equal(applied.cursor, 'cur-2');
    assert.equal(applied.serverRev, 2);
    assert.deepEqual(store.getPullCursor(accountId), { cursor: 'cur-2', serverRev: 2 });
    assert.ok(store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-a'));
    assert.ok(store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-b'));
  } finally {
    store.close();
  }
});

test('pull page abort before cursor leaves no partial entities or cursor advance', () => {
  const { store, accountId } = memoryStore();
  try {
    const page = {
      changes: [
        {
          entityId: 'todo-partial',
          op: 'upsert',
          payload: { id: 'todo-partial', text: 'x', categoryId: 'P0', done: false, createdAt: 1, deadline: '', remindedAt: 0 },
          serverRev: 5,
        },
      ],
      nextCursor: 'should-not-stick',
      hasMore: false,
      serverRev: 5,
    };

    assert.throws(
      () => store.applyPullPageAbortBeforeCursorCommit({ accountId, pull: page }),
      /simulated_crash_before_cursor/
    );

    assert.equal(store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-partial'), null);
    assert.deepEqual(store.getPullCursor(accountId), { cursor: null, serverRev: 0 });
  } finally {
    store.close();
  }
});

test('pull rebases pending outbox baseServerRev', () => {
  const { store, accountId } = memoryStore();
  try {
    assert.equal(
      store.writeLocalMutation(mutationInput(accountId, { clientMutationId: 'local-1', baseServerRev: 0 })).ok,
      true
    );

    const applied = store.applyPullPage({
      accountId,
      pull: {
        changes: [
          {
            entityId: 'remote-1',
            op: 'upsert',
            payload: {
              id: 'remote-1',
              text: 'remote',
              done: false,
              createdAt: 9,
              deadline: '',
              remindedAt: 0,
              categoryId: 'P3',
            },
            serverRev: 7,
          },
        ],
        nextCursor: 'c7',
        hasMore: false,
        serverRev: 7,
      },
    });
    assert.equal(applied.ok, true);

    const pending = store.listPendingOutbox(accountId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].baseServerRev, 7);
  } finally {
    store.close();
  }
});

test('pull is idempotent on equal serverRev and ignores older revs', () => {
  const { store, accountId } = memoryStore();
  try {
    store.applyPullPage({
      accountId,
      pull: {
        changes: [
          {
            entityId: 'todo-1',
            op: 'upsert',
            payload: { id: 'todo-1', text: 'v2', categoryId: 'P0', done: false, createdAt: 1, deadline: '', remindedAt: 0 },
            serverRev: 2,
          },
        ],
        nextCursor: 'c2',
        hasMore: false,
        serverRev: 2,
      },
    });

    store.applyPullPage({
      accountId,
      pull: {
        changes: [
          {
            entityId: 'todo-1',
            op: 'upsert',
            payload: { id: 'todo-1', text: 'v1-old', categoryId: 'P0', done: false, createdAt: 1, deadline: '', remindedAt: 0 },
            serverRev: 1,
          },
        ],
        nextCursor: 'c2b',
        hasMore: false,
        serverRev: 2,
      },
    });

    assert.equal(store.getEntity(accountId, COLLECTIONS.TODOS, 'todo-1').payload.text, 'v2');
  } finally {
    store.close();
  }
});

test('todos LS projection keeps P0–P3 shell and item field set', () => {
  const { store, accountId } = memoryStore();
  try {
    store.writeLocalMutation(
      mutationInput(accountId, {
        entityId: 'todo-p0',
        clientMutationId: 'm1',
        payload: {
          id: 'todo-p0',
          text: 'course',
          done: false,
          createdAt: 5,
          deadline: '2026-09-21T15:30:00.000Z',
          remindedAt: 0,
          categoryId: 'P0',
        },
      })
    );
    store.writeLocalMutation(
      mutationInput(accountId, {
        entityId: categoryEntityId('P0'),
        clientMutationId: 'm-cat',
        payload: { name: '课程改名' },
      })
    );

    const projection = store.buildTodosLocalStorageProjection(accountId);
    assert.deepEqual(Object.keys(projection.todos).sort(), [...TODO_PRIORITIES].sort());
    assert.equal(projection.todos.P0.length, 1);
    const item = projection.todos.P0[0];
    assert.deepEqual(Object.keys(item).sort(), [...TODO_ITEM_FIELDS].sort());
    assert.equal(item.text, 'course');
    assert.equal(item.id, 'todo-p0');
    // Sync metadata must not leak into LS projection.
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'serverRev'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'clientMutationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'categoryId'), false);
    assert.equal(projection.categoryNames.P0, '课程改名');

    const parsed = JSON.parse(projection.todosJson);
    assert.deepEqual(Object.keys(parsed).sort(), [...TODO_PRIORITIES].sort());
  } finally {
    store.close();
  }
});

test('accepts commands and notes; home layout stays unwired', () => {
  const { store, accountId } = memoryStore();
  try {
    const write = store.writeLocalMutation(
      mutationInput(accountId, {
        collection: 'commands',
        clientMutationId: 'cmd-1',
        entityId: 'command:cmd-1',
        payload: { id: 'cmd-1', text: 'npm test', createdAt: 1 },
      })
    );
    assert.equal(write.ok, true);

    const notes = store.writeLocalMutation(
      mutationInput(accountId, {
        collection: 'notes',
        clientMutationId: 'note-1',
        entityId: 'note:home',
        payload: { kind: 'home', markdown: 'hello' },
      })
    );
    assert.equal(notes.ok, true);

    const pull = store.applyPullPage({
      accountId,
      collection: 'homeLayout',
      pull: { changes: [], nextCursor: null, hasMore: false, serverRev: 0 },
    });
    assert.equal(pull.ok, false);
    assert.equal(pull.reason, 'collection_not_enabled');
  } finally {
    store.close();
  }
});

test('acknowledgeOutbox clears pending queue for push completion', () => {
  const { store, accountId } = memoryStore();
  try {
    store.writeLocalMutation(mutationInput(accountId, { clientMutationId: 'a' }));
    store.writeLocalMutation(
      mutationInput(accountId, {
        clientMutationId: 'b',
        entityId: 'todo-2',
        payload: {
          id: 'todo-2',
          text: 'two',
          done: false,
          createdAt: 2,
          deadline: '',
          remindedAt: 0,
          categoryId: 'P1',
        },
      })
    );
    assert.equal(store.listPendingOutbox(accountId).length, 2);
    store.acknowledgeOutbox(accountId, ['a']);
    const pending = store.listPendingOutbox(accountId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].clientMutationId, 'b');
  } finally {
    store.close();
  }
});
