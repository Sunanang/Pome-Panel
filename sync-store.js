'use strict';

/**
 * Desktop SyncStore + outbox (T4).
 *
 * - SQLite via node:sqlite (see sqliteProbe.js); path must live under fixed userData.
 * - No Electron dependency — pass an absolute dbPath from the main process.
 * - Protocol validation uses packages/sync-protocol only.
 * - LocalStorage notch-todo-data remains a projection (outer P0–P3 keys intact).
 *
 * Startup (bound): hydratePortableWorkspace → rebuild LS projection from this DB.
 * Pull cursor advances only after a full page is applied in one transaction.
 */

const fs = require('node:fs');
const path = require('node:path');
const { probeSqliteSupport } = require('./sqliteProbe');
const {
  SCHEMA_VERSION,
  COLLECTIONS,
  assertP0Collection,
  validateMutation,
  createMutation,
  validatePullResponse,
  validatePullCursor,
} = require('./packages/sync-protocol');

const SYNC_DB_FILENAME = 'sync.db';
const TODO_STORAGE_KEY = 'notch-todo-data';
const TODO_CATEGORY_KEY = 'notch-todo-category-names-v1';
const TODO_PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
const CATEGORY_ENTITY_PREFIX = 'category:';
const OUTBOX_STATUS_PENDING = 'pending';
const OUTBOX_STATUS_ACKED = 'acked';

const TODO_ITEM_FIELDS = Object.freeze([
  'id',
  'text',
  'done',
  'createdAt',
  'deadline',
  'remindedAt',
]);

/**
 * Fixed userData path for sync.db (never custom workspace root).
 * @param {string} userDataPath
 * @returns {string}
 */
function resolveSyncDbPath(userDataPath) {
  if (typeof userDataPath !== 'string' || userDataPath.trim() === '') {
    throw new Error('sync_db_user_data_required');
  }
  return path.join(userDataPath, SYNC_DB_FILENAME);
}

/**
 * Bound-device startup order: portable hydrate first, then SQLite → LS projection.
 * Unbound devices skip the SQLite projection step.
 *
 * @param {{ bound?: boolean }} [options]
 * @returns {{ steps: string[], projectionOverridesWorkspace: boolean }}
 */
function planBoundStartupHydration(options = {}) {
  const bound = options.bound === true;
  if (!bound) {
    return {
      steps: ['hydratePortableWorkspace'],
      projectionOverridesWorkspace: false,
    };
  }
  return {
    steps: [
      'hydratePortableWorkspace',
      'rebuildLocalStorageProjectionFromSyncDb',
    ],
    projectionOverridesWorkspace: true,
  };
}

/**
 * Simulate the bound startup write order for tests / bootstrap helpers.
 * Mutates `localStorageLike` (Map or plain object with getItem/setItem or string bag).
 *
 * @param {{
 *   bound: boolean,
 *   workspaceSnapshot?: Record<string, string>,
 *   projection?: { todosJson: string, categoryNamesJson: string },
 *   storage: { getItem(key: string): string | null, setItem(key: string, value: string): void },
 * }} args
 */
function applyStartupHydrationOrder(args) {
  const { bound, workspaceSnapshot = {}, projection, storage } = args;
  const plan = planBoundStartupHydration({ bound });

  for (const step of plan.steps) {
    if (step === 'hydratePortableWorkspace') {
      for (const [key, value] of Object.entries(workspaceSnapshot)) {
        if (typeof value === 'string' && storage.getItem(key) === null) {
          storage.setItem(key, value);
        }
      }
      continue;
    }
    if (step === 'rebuildLocalStorageProjectionFromSyncDb') {
      if (!projection) {
        throw new Error('sync_projection_required_when_bound');
      }
      storage.setItem(TODO_STORAGE_KEY, projection.todosJson);
      storage.setItem(TODO_CATEGORY_KEY, projection.categoryNamesJson);
    }
  }

  return plan;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function categoryEntityId(priority) {
  return `${CATEGORY_ENTITY_PREFIX}${priority}`;
}

function parseCategoryEntityId(entityId) {
  if (!isNonEmptyString(entityId) || !entityId.startsWith(CATEGORY_ENTITY_PREFIX)) {
    return null;
  }
  const priority = entityId.slice(CATEGORY_ENTITY_PREFIX.length);
  return TODO_PRIORITIES.includes(priority) ? priority : null;
}

function projectTodoItemFields(payload, entityId) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const item = {
    id: isNonEmptyString(source.id) ? source.id : entityId,
    text: typeof source.text === 'string' ? source.text : '',
    done: source.done === true,
    createdAt: Number.isFinite(source.createdAt) ? source.createdAt : 0,
  };
  if (typeof source.deadline === 'string' && source.deadline) {
    item.deadline = source.deadline;
  } else {
    item.deadline = '';
  }
  item.remindedAt = Math.max(0, Number(source.remindedAt) || 0);
  return item;
}

function assertTodoItemFieldSet(item) {
  const keys = Object.keys(item).sort();
  const expected = [...TODO_ITEM_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`todo_projection_field_set_invalid:${keys.join(',')}`);
  }
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  server_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  bound_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS endpoints (
  endpoint_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'gateway',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  allow_insecure_http INTEGER NOT NULL DEFAULT 0,
  last_health TEXT,
  last_error TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);

CREATE TABLE IF NOT EXISTS entities (
  account_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  server_rev INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, collection, entity_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  account_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  device_id TEXT NOT NULL,
  base_server_rev INTEGER NOT NULL,
  client_time INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (account_id, client_mutation_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  account_id TEXT NOT NULL,
  collection TEXT NOT NULL,
  pull_cursor TEXT,
  server_rev INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, collection)
);

CREATE TABLE IF NOT EXISTS migrations (
  migration_id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  state TEXT NOT NULL,
  snapshot_server_rev INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id)
);
`;

/**
 * @param {string} dbPath absolute path under userData, or ':memory:'
 * @param {{ DatabaseSync?: new (path: string, options?: object) => object }} [options]
 */
function openSyncStore(dbPath, options = {}) {
  if (dbPath !== ':memory:') {
    if (typeof dbPath !== 'string' || dbPath.trim() === '') {
      throw new Error('sync_db_path_required');
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const probe = probeSqliteSupport();
  const DatabaseSync = options.DatabaseSync || probe.DatabaseSync;
  if (!probe.available && !options.DatabaseSync) {
    throw new Error(probe.detail || 'sqlite_unavailable');
  }
  if (typeof DatabaseSync !== 'function') {
    throw new Error('sqlite_DatabaseSync_missing');
  }

  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);

  return createSyncStore(db, { dbPath });
}

/**
 * @param {object} db DatabaseSync instance
 * @param {{ dbPath?: string }} [meta]
 */
function createSyncStore(db, meta = {}) {
  const statements = {
    upsertAccount: db.prepare(`
      INSERT INTO accounts (account_id, uid, server_id, device_id, bound_at, created_at)
      VALUES (@account_id, @uid, @server_id, @device_id, @bound_at, @created_at)
      ON CONFLICT(account_id) DO UPDATE SET
        uid = excluded.uid,
        server_id = excluded.server_id,
        device_id = excluded.device_id,
        bound_at = excluded.bound_at
    `),
    getAccount: db.prepare('SELECT * FROM accounts WHERE account_id = ?'),
    upsertEntity: db.prepare(`
      INSERT INTO entities (
        account_id, collection, entity_id, payload_json, server_rev, deleted_at, updated_at
      ) VALUES (
        @account_id, @collection, @entity_id, @payload_json, @server_rev, @deleted_at, @updated_at
      )
      ON CONFLICT(account_id, collection, entity_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        server_rev = excluded.server_rev,
        deleted_at = excluded.deleted_at,
        updated_at = excluded.updated_at
    `),
    getEntity: db.prepare(`
      SELECT * FROM entities
      WHERE account_id = ? AND collection = ? AND entity_id = ?
    `),
    listLiveEntities: db.prepare(`
      SELECT * FROM entities
      WHERE account_id = ? AND collection = ? AND deleted_at IS NULL
      ORDER BY entity_id ASC
    `),
    insertOutbox: db.prepare(`
      INSERT INTO outbox (
        account_id, client_mutation_id, collection, entity_id, op, payload_json,
        device_id, base_server_rev, client_time, schema_version, created_at, status
      ) VALUES (
        @account_id, @client_mutation_id, @collection, @entity_id, @op, @payload_json,
        @device_id, @base_server_rev, @client_time, @schema_version, @created_at, @status
      )
    `),
    getOutbox: db.prepare(`
      SELECT * FROM outbox
      WHERE account_id = ? AND client_mutation_id = ?
    `),
    listPendingOutbox: db.prepare(`
      SELECT * FROM outbox
      WHERE account_id = ? AND collection = ? AND status = ?
      ORDER BY created_at ASC, client_mutation_id ASC
    `),
    markOutboxAcked: db.prepare(`
      UPDATE outbox SET status = ?
      WHERE account_id = ? AND client_mutation_id = ?
    `),
    listPendingUpsertsForEntity: db.prepare(`
      SELECT client_mutation_id FROM outbox
      WHERE account_id = ? AND collection = ? AND entity_id = ?
        AND status = ? AND op = 'upsert'
    `),
    rebaseOutboxBaseRev: db.prepare(`
      UPDATE outbox SET base_server_rev = ?
      WHERE account_id = ? AND collection = ? AND status = ?
    `),
    getSyncState: db.prepare(`
      SELECT * FROM sync_state WHERE account_id = ? AND collection = ?
    `),
    upsertSyncState: db.prepare(`
      INSERT INTO sync_state (account_id, collection, pull_cursor, server_rev)
      VALUES (@account_id, @collection, @pull_cursor, @server_rev)
      ON CONFLICT(account_id, collection) DO UPDATE SET
        pull_cursor = excluded.pull_cursor,
        server_rev = excluded.server_rev
    `),
  };

  function runInTransaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback errors when no transaction is open
      }
      throw error;
    }
  }

  /**
   * Ensure an account row exists (pairing / bind will populate real values later).
   */
  function ensureAccount(account) {
    if (!account || !isNonEmptyString(account.accountId)) {
      throw new Error('account_id_required');
    }
    const now = Date.now();
    statements.upsertAccount.run({
      account_id: account.accountId,
      uid: isNonEmptyString(account.uid) ? account.uid : '',
      server_id: isNonEmptyString(account.serverId) ? account.serverId : '',
      device_id: isNonEmptyString(account.deviceId) ? account.deviceId : '',
      bound_at: Number.isFinite(account.boundAt) ? account.boundAt : now,
      created_at: Number.isFinite(account.createdAt) ? account.createdAt : now,
    });
    return statements.getAccount.get(account.accountId);
  }

  function getPullCursor(accountId, collection = COLLECTIONS.TODOS) {
    const collectionCheck = assertP0Collection(collection);
    if (!collectionCheck.ok) {
      throw new Error(collectionCheck.reason);
    }
    const row = statements.getSyncState.get(accountId, collection);
    if (!row) {
      return { cursor: null, serverRev: 0 };
    }
    return {
      cursor: row.pull_cursor == null ? null : String(row.pull_cursor),
      serverRev: Number(row.server_rev) || 0,
    };
  }

  /**
   * Single SQLite transaction: update entity + enqueue outbox.
   * Duplicate clientMutationId is a no-op success (idempotent).
   *
   * @param {object} input mutation fields (+ accountId)
   * @returns {{ ok: true, deduped: boolean, mutation: object } | { ok: false, reason: string, field?: string }}
   */
  function writeLocalMutation(input) {
    if (!input || !isNonEmptyString(input.accountId)) {
      return { ok: false, reason: 'account_id_required' };
    }

    const validated = validateMutation({
      schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
      collection: input.collection,
      entityId: input.entityId,
      op: input.op,
      payload: input.payload ?? {},
      clientMutationId: input.clientMutationId,
      deviceId: input.deviceId,
      baseServerRev: input.baseServerRev,
      clientTime: input.clientTime,
    });
    if (!validated.ok) {
      return validated;
    }

    const mutation = validated.mutation;
    const existing = statements.getOutbox.get(input.accountId, mutation.clientMutationId);
    if (existing) {
      return { ok: true, deduped: true, mutation };
    }

    const now = Date.now();
    try {
      runInTransaction(() => {
        const account = statements.getAccount.get(input.accountId);
        if (!account) {
          throw Object.assign(new Error('account_missing'), { code: 'account_missing' });
        }

        if (mutation.op === 'delete') {
          statements.upsertEntity.run({
            account_id: input.accountId,
            collection: mutation.collection,
            entity_id: mutation.entityId,
            payload_json: JSON.stringify({}),
            server_rev: mutation.baseServerRev,
            deleted_at: now,
            updated_at: now,
          });
        } else {
          statements.upsertEntity.run({
            account_id: input.accountId,
            collection: mutation.collection,
            entity_id: mutation.entityId,
            payload_json: JSON.stringify(mutation.payload),
            server_rev: mutation.baseServerRev,
            deleted_at: null,
            updated_at: now,
          });
        }

        statements.insertOutbox.run({
          account_id: input.accountId,
          client_mutation_id: mutation.clientMutationId,
          collection: mutation.collection,
          entity_id: mutation.entityId,
          op: mutation.op,
          payload_json: JSON.stringify(mutation.payload),
          device_id: mutation.deviceId,
          base_server_rev: mutation.baseServerRev,
          client_time: mutation.clientTime,
          schema_version: mutation.schemaVersion,
          created_at: now,
          status: OUTBOX_STATUS_PENDING,
        });
      });
    } catch (error) {
      if (error && error.code === 'account_missing') {
        return { ok: false, reason: 'account_missing' };
      }
      // Unique race: treat as dedupe.
      const message = error && error.message ? String(error.message) : '';
      if (/UNIQUE|constraint/i.test(message) || error?.code === 'ERR_SQLITE_ERROR') {
        const again = statements.getOutbox.get(input.accountId, mutation.clientMutationId);
        if (again) {
          return { ok: true, deduped: true, mutation };
        }
      }
      throw error;
    }

    return { ok: true, deduped: false, mutation };
  }

  /**
   * Apply one pull page atomically. Cursor commits only if the whole page succeeds.
   * Change shape (suggested): { entityId, op, payload, serverRev }
   *
   * @param {{
   *   accountId: string,
   *   collection?: string,
   *   pull: unknown,
   * }} args
   */
  function applyPullPage(args) {
    if (!args || !isNonEmptyString(args.accountId)) {
      return { ok: false, reason: 'account_id_required' };
    }
    const collection = args.collection || COLLECTIONS.TODOS;
    const collectionCheck = assertP0Collection(collection);
    if (!collectionCheck.ok) {
      return { ok: false, reason: collectionCheck.reason, field: 'collection' };
    }

    const pullCheck = validatePullResponse(args.pull);
    if (!pullCheck.ok) {
      return pullCheck;
    }
    const pull = pullCheck.pull;
    const cursorCheck = validatePullCursor(pull.nextCursor);
    if (!cursorCheck.ok) {
      return cursorCheck;
    }

    const now = Date.now();
    try {
      runInTransaction(() => {
        for (const change of pull.changes) {
          if (!change || typeof change !== 'object' || Array.isArray(change)) {
            throw Object.assign(new Error('pull_change_invalid'), { code: 'pull_change_invalid' });
          }
          if (!isNonEmptyString(change.entityId)) {
            throw Object.assign(new Error('pull_change_entity_id_invalid'), {
              code: 'pull_change_entity_id_invalid',
            });
          }
          if (change.op !== 'upsert' && change.op !== 'delete') {
            throw Object.assign(new Error('pull_change_op_invalid'), { code: 'pull_change_op_invalid' });
          }
          if (!Number.isInteger(change.serverRev) || change.serverRev < 0) {
            throw Object.assign(new Error('pull_change_server_rev_invalid'), {
              code: 'pull_change_server_rev_invalid',
            });
          }

          const existing = statements.getEntity.get(args.accountId, collection, change.entityId);
          if (existing && Number(existing.server_rev) > change.serverRev) {
            // Older page fragment — skip (idempotent / out-of-order safe).
            // Also blocks stale upserts from resurrecting a newer tombstone.
            continue;
          }
          if (existing && Number(existing.server_rev) === change.serverRev) {
            continue;
          }
          // Anti-resurrection: never apply an upsert that is older than a local tombstone.
          if (
            change.op === 'upsert' &&
            existing &&
            existing.deleted_at != null &&
            Number(existing.server_rev) >= change.serverRev
          ) {
            continue;
          }

          if (change.op === 'delete') {
            statements.upsertEntity.run({
              account_id: args.accountId,
              collection,
              entity_id: change.entityId,
              payload_json: JSON.stringify({}),
              server_rev: change.serverRev,
              deleted_at: now,
              updated_at: now,
            });
          } else {
            const payload =
              change.payload && typeof change.payload === 'object' && !Array.isArray(change.payload)
                ? change.payload
                : {};
            statements.upsertEntity.run({
              account_id: args.accountId,
              collection,
              entity_id: change.entityId,
              payload_json: JSON.stringify(payload),
              server_rev: change.serverRev,
              deleted_at: null,
              updated_at: now,
            });
          }
        }

        // Cursor + serverRev only after all entity writes succeed in this transaction.
        statements.upsertSyncState.run({
          account_id: args.accountId,
          collection,
          pull_cursor: pull.nextCursor,
          server_rev: pull.serverRev,
        });

        // Rebase pending outbox baseServerRev onto the new high-water mark.
        statements.rebaseOutboxBaseRev.run(
          pull.serverRev,
          args.accountId,
          collection,
          OUTBOX_STATUS_PENDING
        );
      });
    } catch (error) {
      const code = error && error.code ? String(error.code) : '';
      if (code.startsWith('pull_')) {
        return { ok: false, reason: code };
      }
      throw error;
    }

    return {
      ok: true,
      cursor: pull.nextCursor,
      serverRev: pull.serverRev,
      hasMore: pull.hasMore,
      applied: pull.changes.length,
    };
  }

  /**
   * Intentionally fail after entity writes but before cursor commit (test helper
   * for crash / partial-page recovery). Production code must not call this.
   */
  function applyPullPageAbortBeforeCursorCommit(args) {
    if (!args || !isNonEmptyString(args.accountId)) {
      throw new Error('account_id_required');
    }
    const collection = args.collection || COLLECTIONS.TODOS;
    const pullCheck = validatePullResponse(args.pull);
    if (!pullCheck.ok) {
      throw new Error(pullCheck.reason);
    }
    const pull = pullCheck.pull;
    const now = Date.now();

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const change of pull.changes) {
        statements.upsertEntity.run({
          account_id: args.accountId,
          collection,
          entity_id: change.entityId,
          payload_json: JSON.stringify(change.payload || {}),
          server_rev: change.serverRev,
          deleted_at: change.op === 'delete' ? now : null,
          updated_at: now,
        });
      }
      throw Object.assign(new Error('simulated_crash_before_cursor'), {
        code: 'simulated_crash_before_cursor',
      });
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw error;
    }
  }

  function listPendingOutbox(accountId, collection = COLLECTIONS.TODOS) {
    const collectionCheck = assertP0Collection(collection);
    if (!collectionCheck.ok) {
      throw new Error(collectionCheck.reason);
    }
    return statements.listPendingOutbox.all(accountId, collection, OUTBOX_STATUS_PENDING).map(mapOutboxRow);
  }

  function acknowledgeOutbox(accountId, clientMutationIds) {
    const ids = Array.isArray(clientMutationIds) ? clientMutationIds : [];
    runInTransaction(() => {
      for (const id of ids) {
        if (!isNonEmptyString(id)) continue;
        statements.markOutboxAcked.run(OUTBOX_STATUS_ACKED, accountId, id);
      }
    });
  }

  /**
   * After a remote tombstone lands, drop pending local upserts for those entities
   * so a later push cannot resurrect them (防复活).
   */
  function cancelPendingUpsertsForEntities(accountId, entityIds) {
    const ids = Array.isArray(entityIds) ? entityIds.filter(isNonEmptyString) : [];
    if (ids.length === 0) {
      return { cancelled: [] };
    }
    const cancelled = [];
    runInTransaction(() => {
      for (const entityId of ids) {
        const rows = statements.listPendingUpsertsForEntity.all(
          accountId,
          COLLECTIONS.TODOS,
          entityId,
          OUTBOX_STATUS_PENDING
        );
        for (const row of rows) {
          statements.markOutboxAcked.run(
            OUTBOX_STATUS_ACKED,
            accountId,
            row.client_mutation_id
          );
          cancelled.push(row.client_mutation_id);
        }
      }
    });
    return { cancelled };
  }

  function getEntity(accountId, collection, entityId) {
    const row = statements.getEntity.get(accountId, collection, entityId);
    return row ? mapEntityRow(row) : null;
  }

  /**
   * Rebuild notch-todo-data + category names from live entities.
   * Item fields are strictly the LS projection set (no sync metadata).
   */
  function buildTodosLocalStorageProjection(accountId) {
    const rows = statements.listLiveEntities.all(accountId, COLLECTIONS.TODOS);
    const todos = { P0: [], P1: [], P2: [], P3: [] };
    const categoryNames = { P0: '课程', P1: '自媒体&写作', P2: 'Vibe coding', P3: '日常' };

    for (const row of rows) {
      const entityId = row.entity_id;
      let payload = {};
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        payload = {};
      }

      const categoryKey = parseCategoryEntityId(entityId);
      if (categoryKey) {
        if (typeof payload.name === 'string' && payload.name.trim()) {
          categoryNames[categoryKey] = payload.name.trim().slice(0, 24);
        }
        continue;
      }

      const categoryId = TODO_PRIORITIES.includes(payload.categoryId)
        ? payload.categoryId
        : 'P3';
      const item = projectTodoItemFields(payload, entityId);
      assertTodoItemFieldSet(item);
      todos[categoryId].push(item);
    }

    for (const priority of TODO_PRIORITIES) {
      todos[priority].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    }

    return {
      todos,
      categoryNames,
      todosJson: JSON.stringify(todos),
      categoryNamesJson: JSON.stringify(categoryNames),
      storageKey: TODO_STORAGE_KEY,
      categoryKey: TODO_CATEGORY_KEY,
    };
  }

  function close() {
    db.close();
  }

  return {
    dbPath: meta.dbPath || null,
    db,
    ensureAccount,
    getPullCursor,
    writeLocalMutation,
    applyPullPage,
    applyPullPageAbortBeforeCursorCommit,
    listPendingOutbox,
    acknowledgeOutbox,
    cancelPendingUpsertsForEntities,
    getEntity,
    buildTodosLocalStorageProjection,
    close,
    // exposed for tests
    _runInTransaction: runInTransaction,
  };
}

function mapEntityRow(row) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = {};
  }
  return {
    accountId: row.account_id,
    collection: row.collection,
    entityId: row.entity_id,
    payload,
    serverRev: Number(row.server_rev) || 0,
    deletedAt: row.deleted_at == null ? null : Number(row.deleted_at),
    updatedAt: Number(row.updated_at) || 0,
  };
}

function mapOutboxRow(row) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = {};
  }
  return {
    accountId: row.account_id,
    clientMutationId: row.client_mutation_id,
    collection: row.collection,
    entityId: row.entity_id,
    op: row.op,
    payload,
    deviceId: row.device_id,
    baseServerRev: Number(row.base_server_rev) || 0,
    clientTime: Number(row.client_time) || 0,
    schemaVersion: Number(row.schema_version) || SCHEMA_VERSION,
    createdAt: Number(row.created_at) || 0,
    status: row.status,
  };
}

module.exports = {
  SYNC_DB_FILENAME,
  TODO_STORAGE_KEY,
  TODO_CATEGORY_KEY,
  TODO_PRIORITIES,
  TODO_ITEM_FIELDS,
  CATEGORY_ENTITY_PREFIX,
  OUTBOX_STATUS_PENDING,
  OUTBOX_STATUS_ACKED,
  resolveSyncDbPath,
  planBoundStartupHydration,
  applyStartupHydrationOrder,
  categoryEntityId,
  openSyncStore,
  createSyncStore,
  createMutation,
  projectTodoItemFields,
};
