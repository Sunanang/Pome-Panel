'use strict';

/**
 * T5 — todos dual-write + push/pull wiring.
 *
 * Bound devices: local todo/category writes → SyncStore entity + outbox,
 * then online push; pull applies remote changes and rebuilds LS projection.
 * LocalStorage `notch-todo-data` stays a {P0..P3} projection only.
 *
 * Todo rows still use the todos collection. Notes and the rest of the workspace
 * sync through workspace-sync.js; this module refuses to write them as todos.
 */

const crypto = require('node:crypto');
const {
  SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
  COLLECTIONS,
  assertP0Collection,
  createMutation,
  assertPushBatchLimits,
  P0_ENABLED_COLLECTIONS,
  evaluateSchemaNegotiation,
  SCHEMA_UI_STATE_INCOMPATIBLE,
} = require('./packages/sync-protocol');
const {
  TODO_STORAGE_KEY,
  TODO_CATEGORY_KEY,
  TODO_PRIORITIES,
  TODO_ITEM_FIELDS,
  categoryEntityId,
  projectTodoItemFields,
} = require('./sync-store');

const ACCOUNT_ID_SEP = '::';

/**
 * Stable local account id from binding identity (serverId + uid).
 * @param {{ serverId?: string, uid?: string }} binding
 * @returns {string}
 */
function accountIdFromBinding(binding = {}) {
  const serverId = typeof binding.serverId === 'string' ? binding.serverId.trim() : '';
  const uid = typeof binding.uid === 'string' ? binding.uid.trim() : '';
  if (!serverId || !uid) {
    throw new Error('sync_binding_identity_required');
  }
  return `${serverId}${ACCOUNT_ID_SEP}${uid}`;
}

function createClientMutationId(now = Date.now()) {
  return `cm-${Number(now).toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * LS projection item payload for a todo entity (plus categoryId for SQLite).
 * Sync metadata must never enter LocalStorage — categoryId stays SQLite-only.
 */
function buildTodoEntityPayload(item, categoryId) {
  const projected = projectTodoItemFields(item, item && item.id);
  if (!TODO_PRIORITIES.includes(categoryId)) {
    throw new Error('todo_category_id_invalid');
  }
  return {
    ...projected,
    categoryId,
  };
}

function buildCategoryEntityPayload(name) {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, 24) : '';
  return { name: trimmed };
}

/**
 * Assert notch-todo-data outer keys and item field set (AGENTS: structure immutable).
 * @param {unknown} todos
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function assertTodosProjectionContract(todos) {
  if (!todos || typeof todos !== 'object' || Array.isArray(todos)) {
    return { ok: false, reason: 'todos_not_object' };
  }
  const keys = Object.keys(todos).sort();
  const expected = [...TODO_PRIORITIES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return { ok: false, reason: `todos_keys_invalid:${keys.join(',')}` };
  }
  for (const priority of TODO_PRIORITIES) {
    if (!Array.isArray(todos[priority])) {
      return { ok: false, reason: `todos_${priority}_not_array` };
    }
    for (const item of todos[priority]) {
      if (!item || typeof item !== 'object') {
        return { ok: false, reason: 'todo_item_not_object' };
      }
      const itemKeys = Object.keys(item).sort();
      const fieldExpected = [...TODO_ITEM_FIELDS].sort();
      if (
        itemKeys.length !== fieldExpected.length ||
        itemKeys.some((key, index) => key !== fieldExpected[index])
      ) {
        return { ok: false, reason: `todo_item_fields_invalid:${itemKeys.join(',')}` };
      }
      for (const forbidden of ['serverRev', 'clientMutationId', 'deletedAt', 'categoryId']) {
        if (Object.prototype.hasOwnProperty.call(item, forbidden)) {
          return { ok: false, reason: `todo_item_sync_meta_leak:${forbidden}` };
        }
      }
    }
  }
  return { ok: true };
}

/**
 * @param {unknown} categoryNames
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function assertCategoryNamesProjectionContract(categoryNames) {
  if (!categoryNames || typeof categoryNames !== 'object' || Array.isArray(categoryNames)) {
    return { ok: false, reason: 'category_names_not_object' };
  }
  const keys = Object.keys(categoryNames).sort();
  const expected = [...TODO_PRIORITIES].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return { ok: false, reason: `category_names_keys_invalid:${keys.join(',')}` };
  }
  for (const priority of TODO_PRIORITIES) {
    if (typeof categoryNames[priority] !== 'string') {
      return { ok: false, reason: `category_name_${priority}_not_string` };
    }
  }
  return { ok: true };
}

/**
 * Static / runtime guard: P0 must never wire notes (or other non-enabled collections).
 * @param {string} collection
 */
function assertTodosOnlyCollection(collection) {
  const check = assertP0Collection(collection);
  if (!check.ok) {
    return check;
  }
  if (collection !== COLLECTIONS.TODOS) {
    return { ok: false, reason: 'collection_not_enabled', field: 'collection' };
  }
  return { ok: true };
}

/**
 * True only when notes are still excluded from the sync allowlist.
 * Workspace sync enables notes, so this stays false.
 */
function notesCollectionIsNotWired() {
  return !P0_ENABLED_COLLECTIONS.includes(COLLECTIONS.NOTES);
}

/**
 * Convert an outbox row into a protocol mutation (no local-only fields).
 */
function outboxRowToMutation(row) {
  return {
    schemaVersion: row.schemaVersion || SCHEMA_VERSION,
    collection: row.collection,
    entityId: row.entityId,
    op: row.op,
    payload: row.op === 'delete' ? {} : row.payload || {},
    clientMutationId: row.clientMutationId,
    deviceId: row.deviceId,
    baseServerRev: row.baseServerRev,
    clientTime: row.clientTime,
  };
}

/**
 * Strip pull envelope to protocol fields and normalize change rows for SyncStore.
 */
function normalizePullResponse(body) {
  const source = body && typeof body === 'object' ? body : {};
  const rawChanges = Array.isArray(source.changes) ? source.changes : [];
  const changes = rawChanges.map((change) => {
    const op = change && change.op === 'delete' ? 'delete' : 'upsert';
    const row = {
      entityId: change && change.entityId,
      op,
      payload: op === 'delete' ? {} : (change && change.payload) || {},
      serverRev: change && change.serverRev,
    };
    if (change && typeof change.collection === 'string' && change.collection) {
      row.collection = change.collection;
    }
    return row;
  });
  return {
    changes,
    nextCursor: Object.prototype.hasOwnProperty.call(source, 'nextCursor')
      ? source.nextCursor
      : null,
    hasMore: source.hasMore === true,
    serverRev: source.serverRev,
  };
}

/**
 * Extract schema advertisement fields from any API / pull / push JSON body.
 * @param {unknown} body
 */
function extractSchemaPeer(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  return {
    schemaVersion: body.schemaVersion,
    minSupported: body.minSupported,
    maxSupported: body.maxSupported,
  };
}

/**
 * Pair + sync gate: evaluate peer schema advertisement against local support.
 * Incompatible → stopPull && stopPush (no read-only degrade).
 *
 * @param {unknown} peerOrBody
 * @param {{ minSupported?: number, maxSupported?: number }} [local]
 */
function gateSchemaCompatibility(peerOrBody, local = {}) {
  const peer = extractSchemaPeer(peerOrBody) || peerOrBody;
  return evaluateSchemaNegotiation(peer, {
    minSupported: local.minSupported ?? MIN_SUPPORTED_SCHEMA_VERSION,
    maxSupported: local.maxSupported ?? MAX_SUPPORTED_SCHEMA_VERSION,
  });
}

function schemaIncompatibleResult(evaluation, { phase, projection, pendingCount } = {}) {
  return {
    ok: false,
    reason: evaluation.reason || 'schema_incompatible',
    error: SCHEMA_UI_STATE_INCOMPATIBLE,
    phase: phase || 'schema',
    stopPull: true,
    stopPush: true,
    uiState: evaluation.uiState || SCHEMA_UI_STATE_INCOMPATIBLE,
    upgradeTarget: evaluation.upgradeTarget || 'unknown',
    message: evaluation.message,
    schemaVersion: evaluation.schemaVersion,
    minSupported: evaluation.minSupported,
    maxSupported: evaluation.maxSupported,
    projection,
    pendingCount,
    pulledChanges: 0,
    pages: 0,
    pushed: 0,
  };
}

/**
 * Dual-write one local mutation into SyncStore (entity + outbox).
 * Does not touch LocalStorage — caller keeps LS as projection (or optimistic UI).
 *
 * @param {object} store SyncStore instance
 * @param {{
 *   accountId: string,
 *   deviceId: string,
 *   entityId: string,
 *   op: 'upsert' | 'delete',
 *   payload?: object,
 *   clientMutationId?: string,
 *   clientTime?: number,
 * }} input
 */
function writeTodosLocalMutation(store, input) {
  if (!store || typeof store.writeLocalMutation !== 'function') {
    return { ok: false, reason: 'store_required' };
  }
  if (!input || typeof input.accountId !== 'string' || !input.accountId) {
    return { ok: false, reason: 'account_id_required' };
  }
  if (!input.deviceId) {
    return { ok: false, reason: 'device_id_required' };
  }

  const collectionCheck = assertTodosOnlyCollection(COLLECTIONS.TODOS);
  if (!collectionCheck.ok) {
    return collectionCheck;
  }

  const cursor = store.getPullCursor(input.accountId, COLLECTIONS.TODOS);
  const clientMutationId = input.clientMutationId || createClientMutationId(input.clientTime);
  const clientTime = Number.isFinite(input.clientTime) && input.clientTime > 0
    ? input.clientTime
    : Date.now();

  let payload = input.payload;
  if (input.op === 'delete') {
    payload = {};
  } else if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'payload_required' };
  }

  const built = createMutation({
    schemaVersion: SCHEMA_VERSION,
    collection: COLLECTIONS.TODOS,
    entityId: input.entityId,
    op: input.op,
    payload,
    clientMutationId,
    deviceId: input.deviceId,
    baseServerRev: cursor.serverRev,
    clientTime,
  });
  if (!built.ok) {
    return built;
  }

  const written = store.writeLocalMutation({
    accountId: input.accountId,
    ...built.mutation,
  });
  if (!written.ok) {
    return written;
  }

  const projection = store.buildTodosLocalStorageProjection(input.accountId);
  const todosCheck = assertTodosProjectionContract(projection.todos);
  if (!todosCheck.ok) {
    return todosCheck;
  }
  const namesCheck = assertCategoryNamesProjectionContract(projection.categoryNames);
  if (!namesCheck.ok) {
    return namesCheck;
  }

  return {
    ok: true,
    deduped: written.deduped === true,
    mutation: written.mutation,
    projection,
    pendingCount: store.listPendingOutbox(input.accountId).length,
  };
}

function writeTodoUpsert(store, ctx, { item, categoryId, clientMutationId, clientTime }) {
  if (!item || typeof item.id !== 'string' || !item.id) {
    return { ok: false, reason: 'todo_id_required' };
  }
  let payload;
  try {
    payload = buildTodoEntityPayload(item, categoryId);
  } catch (error) {
    return { ok: false, reason: error && error.message ? error.message : 'payload_invalid' };
  }
  return writeTodosLocalMutation(store, {
    accountId: ctx.accountId,
    deviceId: ctx.deviceId,
    entityId: item.id,
    op: 'upsert',
    payload,
    clientMutationId,
    clientTime,
  });
}

function writeTodoDelete(store, ctx, { entityId, clientMutationId, clientTime }) {
  if (typeof entityId !== 'string' || !entityId) {
    return { ok: false, reason: 'entity_id_required' };
  }
  return writeTodosLocalMutation(store, {
    accountId: ctx.accountId,
    deviceId: ctx.deviceId,
    entityId,
    op: 'delete',
    payload: {},
    clientMutationId,
    clientTime,
  });
}

function writeCategoryUpsert(store, ctx, { priority, name, clientMutationId, clientTime }) {
  if (!TODO_PRIORITIES.includes(priority)) {
    return { ok: false, reason: 'category_priority_invalid' };
  }
  return writeTodosLocalMutation(store, {
    accountId: ctx.accountId,
    deviceId: ctx.deviceId,
    entityId: categoryEntityId(priority),
    op: 'upsert',
    payload: buildCategoryEntityPayload(name),
    clientMutationId,
    clientTime,
  });
}

/**
 * Apply one normalized pull page, cancel stale outbox upserts against new tombstones,
 * and return the rebuilt LS projection.
 */
function applyTodosPullPage(store, { accountId, pull }) {
  const collectionCheck = assertTodosOnlyCollection(COLLECTIONS.TODOS);
  if (!collectionCheck.ok) {
    return collectionCheck;
  }
  const normalized = normalizePullResponse(pull);
  const applied = store.applyPullPage({
    accountId,
    collection: COLLECTIONS.TODOS,
    pull: normalized,
  });
  if (!applied.ok) {
    return applied;
  }

  const deletedIds = normalized.changes
    .filter((change) => change.op === 'delete' && typeof change.entityId === 'string')
    .map((change) => change.entityId);
  if (deletedIds.length && typeof store.cancelPendingUpsertsForEntities === 'function') {
    store.cancelPendingUpsertsForEntities(accountId, deletedIds);
  }

  const projection = store.buildTodosLocalStorageProjection(accountId);
  const todosCheck = assertTodosProjectionContract(projection.todos);
  if (!todosCheck.ok) {
    return todosCheck;
  }
  return {
    ok: true,
    ...applied,
    projection,
  };
}

/**
 * Push pending outbox mutations. Server duplicates (same clientMutationId) are acked locally.
 * Schema-incompatible push responses stop without acknowledging (outbox retained).
 *
 * @param {object} store
 * @param {{
 *   accountId: string,
 *   pushMutations: (mutations: object[]) => Promise<{ ok: boolean, applied?: object[], serverRev?: number, error?: string, status?: number, body?: object }>,
 *   localSchema?: { minSupported?: number, maxSupported?: number },
 * }} args
 */
async function pushTodosOutbox(store, { accountId, pushMutations, localSchema } = {}) {
  const pending = store.listPendingOutbox(accountId, COLLECTIONS.TODOS);
  if (pending.length === 0) {
    return { ok: true, pushed: 0, acked: [], pendingCount: 0, skipped: true };
  }

  const schemaLocal = {
    minSupported: (localSchema && localSchema.minSupported) ?? MIN_SUPPORTED_SCHEMA_VERSION,
    maxSupported: (localSchema && localSchema.maxSupported) ?? MAX_SUPPORTED_SCHEMA_VERSION,
  };

  const mutations = pending.map(outboxRowToMutation);
  const limits = assertPushBatchLimits(mutations);
  if (!limits.ok) {
    // Auto-split would be nice; for P0 refuse oversize and keep queue.
    return { ok: false, reason: limits.reason, pendingCount: pending.length };
  }

  const response = await pushMutations(mutations);
  const peerBody = (response && (response.body || response.peer)) || response;
  if (peerBody && (peerBody.schemaVersion != null || peerBody.minSupported != null)) {
    const schemaGate = gateSchemaCompatibility(peerBody, schemaLocal);
    if (!schemaGate.ok) {
      return {
        ...schemaGate,
        error: SCHEMA_UI_STATE_INCOMPATIBLE,
        pendingCount: pending.length,
        pushed: 0,
      };
    }
  }

  if (!response || response.ok !== true) {
    return {
      ok: false,
      reason: (response && (response.error || response.reason)) || 'push_failed',
      status: response && response.status,
      pendingCount: pending.length,
    };
  }

  const applied = Array.isArray(response.applied) ? response.applied : [];
  const acked = [];
  for (const entry of applied) {
    if (!entry || typeof entry.clientMutationId !== 'string') continue;
    if (entry.status === 'applied' || entry.status === 'duplicate') {
      acked.push(entry.clientMutationId);
    }
  }
  // If server omitted applied[], treat full batch as accepted on HTTP 2xx.
  if (acked.length === 0 && response.ok) {
    for (const mutation of mutations) {
      acked.push(mutation.clientMutationId);
    }
  }

  store.acknowledgeOutbox(accountId, acked);
  return {
    ok: true,
    pushed: mutations.length,
    acked,
    serverRev: response.serverRev,
    pendingCount: store.listPendingOutbox(accountId).length,
  };
}

/**
 * Ordinary sync loop: pull pages → rebase (inside store) → push outbox.
 * First-bind migration must NOT use this path (T5b).
 * Schema is checked on every peer response; incompatible → stop pull AND push.
 */
async function runTodosSyncCycle(store, {
  accountId,
  pullPage,
  pushMutations,
  maxPages = 50,
  localSchema,
} = {}) {
  if (!store) {
    return { ok: false, reason: 'store_required' };
  }
  if (typeof pullPage !== 'function' || typeof pushMutations !== 'function') {
    return { ok: false, reason: 'transport_required' };
  }

  const schemaLocal = {
    minSupported: (localSchema && localSchema.minSupported) ?? MIN_SUPPORTED_SCHEMA_VERSION,
    maxSupported: (localSchema && localSchema.maxSupported) ?? MAX_SUPPORTED_SCHEMA_VERSION,
  };

  let pages = 0;
  let pulledChanges = 0;
  let hasMore = true;
  let lastProjection = store.buildTodosLocalStorageProjection(accountId);
  const pendingAtStart = store.listPendingOutbox(accountId).length;

  while (hasMore && pages < maxPages) {
    const cursorState = store.getPullCursor(accountId, COLLECTIONS.TODOS);
    const remote = await pullPage({ cursor: cursorState.cursor });
    if (!remote || remote.ok !== true) {
      // Even failed responses may carry schema advertisement (e.g. 422 envelope).
      if (remote && remote.body) {
        const schemaGate = gateSchemaCompatibility(remote.body, schemaLocal);
        if (!schemaGate.ok) {
          return schemaIncompatibleResult(schemaGate, {
            phase: 'pull',
            projection: lastProjection,
            pendingCount: pendingAtStart,
          });
        }
      }
      return {
        ok: false,
        reason: (remote && (remote.error || remote.reason)) || 'pull_failed',
        status: remote && remote.status,
        phase: 'pull',
        projection: lastProjection,
        pendingCount: store.listPendingOutbox(accountId).length,
      };
    }

    const peerBody = remote.body || remote.pull || remote;
    const schemaGate = gateSchemaCompatibility(peerBody, schemaLocal);
    if (!schemaGate.ok) {
      // Stop both pull application and subsequent push — do not pollute local cache.
      return schemaIncompatibleResult(schemaGate, {
        phase: 'pull',
        projection: lastProjection,
        pendingCount: pendingAtStart,
      });
    }

    const applied = applyTodosPullPage(store, {
      accountId,
      pull: peerBody,
    });
    if (!applied.ok) {
      return {
        ok: false,
        reason: applied.reason || 'apply_pull_failed',
        phase: 'apply',
        projection: lastProjection,
        pendingCount: store.listPendingOutbox(accountId).length,
      };
    }

    pages += 1;
    pulledChanges += applied.applied || 0;
    lastProjection = applied.projection;
    hasMore = applied.hasMore === true;
  }

  const pushed = await pushTodosOutbox(store, {
    accountId,
    pushMutations,
    localSchema: schemaLocal,
  });
  if (!pushed.ok) {
    if (pushed.error === SCHEMA_UI_STATE_INCOMPATIBLE || pushed.stopPush) {
      return schemaIncompatibleResult(pushed, {
        phase: 'push',
        projection: lastProjection,
        pendingCount: pushed.pendingCount ?? pendingAtStart,
      });
    }
    return {
      ok: false,
      reason: pushed.reason || 'push_failed',
      phase: 'push',
      status: pushed.status,
      projection: lastProjection,
      pendingCount: pushed.pendingCount,
      pulledChanges,
      pages,
    };
  }

  lastProjection = store.buildTodosLocalStorageProjection(accountId);
  return {
    ok: true,
    projection: lastProjection,
    pulledChanges,
    pages,
    pushed: pushed.pushed,
    acked: pushed.acked,
    pendingCount: pushed.pendingCount,
    skippedPush: pushed.skipped === true,
  };
}

/**
 * Apply projection JSON strings onto a LocalStorage-like bag (bound startup / after pull).
 */
function applyTodosProjectionToStorage(storage, projection) {
  if (!storage || typeof storage.setItem !== 'function') {
    throw new Error('storage_required');
  }
  if (!projection) {
    throw new Error('projection_required');
  }
  const todosCheck = assertTodosProjectionContract(projection.todos);
  if (!todosCheck.ok) {
    throw new Error(todosCheck.reason);
  }
  const namesCheck = assertCategoryNamesProjectionContract(projection.categoryNames);
  if (!namesCheck.ok) {
    throw new Error(namesCheck.reason);
  }
  storage.setItem(TODO_STORAGE_KEY, projection.todosJson || JSON.stringify(projection.todos));
  storage.setItem(
    TODO_CATEGORY_KEY,
    projection.categoryNamesJson || JSON.stringify(projection.categoryNames)
  );
  return {
    storageKey: TODO_STORAGE_KEY,
    categoryKey: TODO_CATEGORY_KEY,
  };
}

/**
 * Ensure SyncStore account row exists for a bound credential record.
 */
function ensureBoundAccount(store, binding) {
  const accountId = accountIdFromBinding(binding);
  store.ensureAccount({
    accountId,
    uid: binding.uid,
    serverId: binding.serverId,
    deviceId: binding.deviceId,
    boundAt: binding.boundAt || Date.now(),
  });
  return { accountId, deviceId: binding.deviceId };
}

module.exports = {
  ACCOUNT_ID_SEP,
  TODO_STORAGE_KEY,
  TODO_CATEGORY_KEY,
  TODO_PRIORITIES,
  TODO_ITEM_FIELDS,
  accountIdFromBinding,
  createClientMutationId,
  buildTodoEntityPayload,
  buildCategoryEntityPayload,
  assertTodosProjectionContract,
  assertCategoryNamesProjectionContract,
  assertTodosOnlyCollection,
  notesCollectionIsNotWired,
  outboxRowToMutation,
  normalizePullResponse,
  writeTodosLocalMutation,
  writeTodoUpsert,
  writeTodoDelete,
  writeCategoryUpsert,
  applyTodosPullPage,
  pushTodosOutbox,
  runTodosSyncCycle,
  applyTodosProjectionToStorage,
  ensureBoundAccount,
  categoryEntityId,
  extractSchemaPeer,
  gateSchemaCompatibility,
  schemaIncompatibleResult,
  SCHEMA_UI_STATE_INCOMPATIBLE,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
};
