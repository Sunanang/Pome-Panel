'use strict';

/**
 * Desktop first-bind migration helpers (T5b).
 * Pure decision + backup path utilities — no Electron deps.
 * Main process wires SyncStore / HTTP around these functions.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  MIGRATION_DECISIONS,
  MIGRATION_STATES,
  AUTHORITY,
  classifyMigrationDecision,
  resolveMigrationChoice,
  normalizeNasSyncState,
  assertMigrationState,
} = require('./packages/sync-protocol/migration');

const TODO_PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
const SYNC_BACKUPS_DIR = 'sync-backups';
const BACKUP_KEEP_COUNT = 5;
const BACKUP_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MIGRATION_BANNER_TEXT = '迁移中，稍候';

/**
 * Strict parse of notch-todo-data. Corrupt / illegal structure ≠ empty.
 * @param {string|null|undefined} raw
 */
function parseLocalTodosStrict(raw) {
  if (raw == null || raw === '') {
    return {
      ok: true,
      corrupt: false,
      data: { P0: [], P1: [], P2: [], P3: [] },
      live: 0,
      latestUpdatedAt: null,
    };
  }
  if (typeof raw !== 'string') {
    return { ok: false, corrupt: true, reason: 'not_string' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, corrupt: true, reason: 'json_parse_failed' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, corrupt: true, reason: 'not_object' };
  }
  for (const key of TODO_PRIORITIES) {
    if (!(key in parsed)) {
      return { ok: false, corrupt: true, reason: `missing_${key}` };
    }
    if (!Array.isArray(parsed[key])) {
      return { ok: false, corrupt: true, reason: `invalid_${key}` };
    }
  }
  const data = { P0: [], P1: [], P2: [], P3: [] };
  let live = 0;
  let latestUpdatedAt = null;
  for (const key of TODO_PRIORITIES) {
    for (const item of parsed[key]) {
      const coerced = coerceLocalTodoItem(item, key, data[key].length);
      if (!coerced.ok) return coerced;
      live += 1;
      const stamp = Number(coerced.item.createdAt) || 0;
      if (stamp && (!latestUpdatedAt || stamp > latestUpdatedAt)) {
        latestUpdatedAt = stamp;
      }
      data[key].push(coerced.item);
    }
  }
  return { ok: true, corrupt: false, data, live, latestUpdatedAt };
}

/**
 * The visible list accepts a plain string or an object that still needs an id.
 * Those are the same todos the desktop shows; they must count as live, not corrupt.
 */
function coerceLocalTodoItem(item, categoryId, index) {
  if (typeof item === 'string') {
    const text = item.trim();
    if (!text) return { ok: false, corrupt: true, reason: 'item_text_invalid' };
    return {
      ok: true,
      item: {
        id: `legacy-${categoryId}-${index}`,
        text,
        done: false,
        createdAt: Date.now(),
        deadline: '',
        remindedAt: 0,
        categoryId,
      },
    };
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { ok: false, corrupt: true, reason: 'item_invalid' };
  }
  if (typeof item.text !== 'string' || !item.text.trim()) {
    return { ok: false, corrupt: true, reason: 'item_text_invalid' };
  }
  const id = typeof item.id === 'string' && item.id ? item.id : `legacy-${categoryId}-${index}`;
  return {
    ok: true,
    item: {
      id,
      text: item.text.trim(),
      done: item.done === true,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      deadline: typeof item.deadline === 'string' ? item.deadline : '',
      remindedAt: Math.max(0, Number(item.remindedAt) || 0),
      categoryId,
    },
  };
}

function canonicalLocalTodosJson(data) {
  const todos = { P0: [], P1: [], P2: [], P3: [] };
  for (const key of TODO_PRIORITIES) {
    todos[key] = (data[key] || []).map((item) => ({
      id: item.id,
      text: item.text,
      done: item.done === true,
      createdAt: item.createdAt,
      deadline: item.deadline || '',
      remindedAt: item.remindedAt || 0,
    }));
  }
  return JSON.stringify(todos);
}

/**
 * Prefer the todos the screen is showing. If that list is empty, use the
 * workspace.json copy — localStorage can stay empty while the file still has them.
 * A corrupt screen payload is not replaced.
 */
function selectMigrationLocalTodos(rendererRaw, workspaceRaw) {
  const renderer = parseLocalTodosStrict(rendererRaw);
  if (!renderer.ok) {
    return {
      ok: false,
      corrupt: true,
      live: 0,
      raw: rendererRaw == null ? '' : String(rendererRaw),
      source: 'screen',
    };
  }
  if (renderer.live > 0) {
    return {
      ok: true,
      corrupt: false,
      live: renderer.live,
      raw: canonicalLocalTodosJson(renderer.data),
      source: 'screen',
    };
  }
  const workspace = parseLocalTodosStrict(workspaceRaw);
  if (workspace.ok && workspace.live > 0) {
    return {
      ok: true,
      corrupt: false,
      live: workspace.live,
      raw: canonicalLocalTodosJson(workspace.data),
      source: 'workspace',
    };
  }
  return {
    ok: true,
    corrupt: false,
    live: 0,
    raw: canonicalLocalTodosJson(renderer.data),
    source: 'screen',
  };
}

function resolveSyncBackupsRoot(userDataPath) {
  if (typeof userDataPath !== 'string' || userDataPath.trim() === '') {
    throw new Error('sync_backups_user_data_required');
  }
  return path.join(userDataPath, SYNC_BACKUPS_DIR);
}

/**
 * Path whitelist — reject sibling escape (same idea as clip image paths).
 * @param {string} backupsRoot
 * @param {string} candidate
 */
function isInsideSyncBackupDir(backupsRoot, candidate) {
  if (typeof backupsRoot !== 'string' || typeof candidate !== 'string') return false;
  const root = path.resolve(backupsRoot);
  const target = path.resolve(candidate);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return target === root || target.startsWith(rootWithSep);
}

function resolveMigrationBackupPath(userDataPath, migrationId) {
  const id = String(migrationId || '').trim();
  if (!id || /[\\/]/.test(id) || id.includes('..')) {
    throw new Error('invalid_migration_id');
  }
  const root = resolveSyncBackupsRoot(userDataPath);
  const dir = path.join(root, id);
  const file = path.join(dir, 'todos.json');
  if (!isInsideSyncBackupDir(root, file)) {
    throw new Error('backup_path_escape');
  }
  return { root, dir, file };
}

function writeMigrationBackupAtomic(userDataPath, migrationId, todosJson, { fsModule = fs } = {}) {
  const { root, dir, file } = resolveMigrationBackupPath(userDataPath, migrationId);
  fsModule.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  if (!isInsideSyncBackupDir(root, tmp)) {
    throw new Error('backup_path_escape');
  }
  const payload = typeof todosJson === 'string' ? todosJson : JSON.stringify(todosJson);
  fsModule.writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 });
  fsModule.renameSync(tmp, file);
  pruneMigrationBackups(userDataPath, { fsModule });
  return { ok: true, path: file };
}

function readMigrationBackup(userDataPath, migrationId, { fsModule = fs } = {}) {
  const { root, file } = resolveMigrationBackupPath(userDataPath, migrationId);
  if (!isInsideSyncBackupDir(root, file)) {
    return { ok: false, error: 'backup_path_escape' };
  }
  if (!fsModule.existsSync(file)) {
    return { ok: false, error: 'backup_not_found' };
  }
  const text = fsModule.readFileSync(file, 'utf8');
  const parsed = parseLocalTodosStrict(text);
  if (!parsed.ok) {
    return { ok: false, error: 'backup_corrupt', reason: parsed.reason };
  }
  return { ok: true, path: file, todosJson: text, data: parsed.data, live: parsed.live };
}

function listMigrationBackupIds(userDataPath, { fsModule = fs } = {}) {
  const root = resolveSyncBackupsRoot(userDataPath);
  if (!fsModule.existsSync(root)) return [];
  return fsModule
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(root, entry.name, 'todos.json');
      let mtimeMs = 0;
      try {
        mtimeMs = fsModule.statSync(file).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { migrationId: entry.name, mtimeMs, file };
    })
    .filter((row) => row.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneMigrationBackups(userDataPath, { fsModule = fs, now = Date.now() } = {}) {
  const rows = listMigrationBackupIds(userDataPath, { fsModule });
  const root = resolveSyncBackupsRoot(userDataPath);
  rows.forEach((row, index) => {
    const tooOld = now - row.mtimeMs > BACKUP_KEEP_MS;
    const tooMany = index >= BACKUP_KEEP_COUNT;
    if (!tooOld && !tooMany) return;
    const dir = path.join(root, row.migrationId);
    if (!isInsideSyncBackupDir(root, dir)) return;
    fsModule.rmSync(dir, { recursive: true, force: true });
  });
}

function findLatestMigrationBackup(userDataPath, { fsModule = fs } = {}) {
  const rows = listMigrationBackupIds(userDataPath, { fsModule });
  return rows[0] || null;
}

/**
 * Flatten local todos into sync entity payloads for upload.
 */
function localTodosToEntities(data) {
  const entities = [];
  for (const key of TODO_PRIORITIES) {
    for (const item of data[key] || []) {
      entities.push({
        entityId: item.id,
        collection: 'todos',
        op: 'upsert',
        payload: {
          id: item.id,
          text: item.text,
          done: item.done === true,
          createdAt: item.createdAt,
          deadline: item.deadline || '',
          remindedAt: item.remindedAt || 0,
          categoryId: key,
        },
      });
    }
  }
  return entities;
}

/**
 * Build LocalStorage projection JSON from NAS entity list (or pull changes).
 */
function entitiesToTodosProjection(entities) {
  const todos = { P0: [], P1: [], P2: [], P3: [] };
  for (const ent of entities || []) {
    if (!ent || ent.op === 'delete') continue;
    const payload = ent.payload || {};
    const categoryId = TODO_PRIORITIES.includes(payload.categoryId) ? payload.categoryId : 'P3';
    if (typeof payload.text !== 'string' || !payload.text.trim()) continue;
    const id = typeof payload.id === 'string' && payload.id ? payload.id : ent.entityId;
    if (typeof id !== 'string' || !id) continue;
    todos[categoryId].push({
      id,
      text: payload.text.trim(),
      done: payload.done === true,
      createdAt: Number.isFinite(payload.createdAt) ? payload.createdAt : Date.now(),
      deadline: typeof payload.deadline === 'string' ? payload.deadline : '',
      remindedAt: Math.max(0, Number(payload.remindedAt) || 0),
    });
  }
  return {
    todos,
    todosJson: JSON.stringify(todos),
    live: TODO_PRIORITIES.reduce((sum, key) => sum + todos[key].length, 0),
  };
}

function classifyFromLocalAndNas(localRaw, nasState) {
  const local = parseLocalTodosStrict(localRaw);
  if (!local.ok) {
    return classifyMigrationDecision({
      localOk: false,
      localCorrupt: true,
      localLive: 0,
      nas: nasState,
    });
  }
  return classifyMigrationDecision({
    localOk: true,
    localCorrupt: false,
    localLive: local.live,
    nas: nasState,
  });
}

/**
 * Advance local migration state machine with validation.
 */
function transitionMigrationState(current, next) {
  const cur = assertMigrationState(current);
  const nxt = assertMigrationState(next);
  if (!cur.ok) return cur;
  if (!nxt.ok) return nxt;
  const allowed = {
    pending: ['prepared', 'failed'],
    prepared: ['committed', 'failed'],
    committed: ['applied', 'failed'],
    applied: [],
    failed: ['pending'],
  };
  if (!(allowed[current] || []).includes(next) && current !== next) {
    return { ok: false, reason: 'illegal_transition', from: current, to: next };
  }
  return { ok: true, state: next };
}

/**
 * Run one migration attempt (CAS). Injectable transports for tests.
 *
 * @param {{
 *   decision: object,
 *   authority: 'local'|'nas'|null,
 *   localRaw: string,
 *   userDataPath: string,
 *   accountId: string,
 *   deviceId: string,
 *   api: {
 *     fetchSyncState(): Promise<object>,
 *     startMigration(body): Promise<object>,
 *     commitMigration(body): Promise<{ok:boolean,status?:number,body?:object,error?:string}>,
 *     getMigration(id): Promise<object>,
 *     pullAll?(): Promise<object>,
 *   },
 *   store: {
 *     upsertMigration(row): void,
 *     updateMigrationState(id, state, extra?): void,
 *     getMigration(id): object|null,
 *     replaceTodosFromEntities?(accountId, entities, serverRev): {ok:boolean},
 *     clearTodos?(accountId): void,
 *     buildTodosLocalStorageProjection?(accountId): object,
 *   },
 *   applyLocalProjection(todosJson): void,
 *   fsModule?: typeof fs,
 * }} ctx
 */
async function runMigrationAttempt(ctx) {
  const {
    decision,
    authority,
    localRaw,
    userDataPath,
    accountId,
    deviceId,
    api,
    store,
    applyLocalProjection,
    fsModule = fs,
  } = ctx;

  if (decision.decision === MIGRATION_DECISIONS.BLOCK_CORRUPT_LOCAL) {
    return { ok: false, error: 'local_corrupt', decision };
  }
  if (decision.decision === MIGRATION_DECISIONS.SKIP_EMPTY) {
    return { ok: true, skipped: true, decision };
  }
  if (decision.needsUserChoice && !authority) {
    return { ok: false, error: 'choice_required', decision };
  }

  const resolvedAuthority =
    authority ||
    decision.authority ||
    null;

  if (
    decision.decision !== MIGRATION_DECISIONS.ENTER_SYNC_NAS_HISTORY &&
    decision.decision !== MIGRATION_DECISIONS.SKIP_EMPTY &&
    !resolvedAuthority
  ) {
    return { ok: false, error: 'authority_required', decision };
  }

  const started = await api.startMigration({});
  if (!started || !started.migrationId) {
    return { ok: false, error: 'migration_start_failed', detail: started };
  }
  const migrationId = started.migrationId;
  const snapshotServerRev = Number(started.snapshotServerRev);

  store.upsertMigration({
    migrationId,
    accountId,
    state: 'pending',
    snapshotServerRev,
  });

  writeMigrationBackupAtomic(userDataPath, migrationId, localRaw == null || localRaw === ''
    ? JSON.stringify({ P0: [], P1: [], P2: [], P3: [] })
    : localRaw, {
    fsModule,
  });

  const prepared = transitionMigrationState('pending', 'prepared');
  if (!prepared.ok) return prepared;
  store.updateMigrationState(migrationId, 'prepared');

  const local = parseLocalTodosStrict(localRaw == null || localRaw === '' ? null : localRaw);
  const extraEntities = Array.isArray(ctx.extraEntities) ? ctx.extraEntities : [];
  const entities =
    resolvedAuthority === AUTHORITY.LOCAL && local.ok
      ? localTodosToEntities(local.data).concat(extraEntities)
      : [];

  const commitBody = {
    migrationId,
    expectedServerRev: snapshotServerRev,
    authority: resolvedAuthority === AUTHORITY.LOCAL ? AUTHORITY.LOCAL : AUTHORITY.NAS,
    entities,
    deviceId,
  };

  const commit = await api.commitMigration(commitBody);
  if (!commit.ok) {
    if (commit.status === 409 || commit.error === 'cas_conflict') {
      store.updateMigrationState(migrationId, 'failed', { reason: 'cas_conflict' });
      return {
        ok: false,
        error: 'cas_conflict',
        migrationId,
        currentServerRev: commit.body && commit.body.currentServerRev,
        reclassify: true,
      };
    }
    store.updateMigrationState(migrationId, 'failed', { reason: commit.error || 'commit_failed' });
    return { ok: false, error: commit.error || 'commit_failed', migrationId };
  }

  store.updateMigrationState(migrationId, 'committed', {
    serverRev: commit.body && commit.body.serverRev,
    backupId: commit.body && commit.body.backupId,
  });

  let remoteChanges = [];
  try {
    if (resolvedAuthority === AUTHORITY.NAS || decision.decision === MIGRATION_DECISIONS.ENTER_SYNC_NAS_HISTORY) {
      let projectionJson;
      if (typeof api.pullAll === 'function') {
        const pulled = await api.pullAll();
        remoteChanges = Array.isArray(pulled.changes) ? pulled.changes : [];
        const todoChanges = remoteChanges.filter((change) => (
          !change || !change.collection || change.collection === 'todos'
        ));
        const projection = entitiesToTodosProjection(
          todoChanges.map((c) => ({
            entityId: c.entityId,
            op: c.op,
            payload: c.payload,
          })),
        );
        projectionJson = projection.todosJson;
        if (store.replaceTodosFromEntities) {
          const applied = store.replaceTodosFromEntities(
            accountId,
            todoChanges.filter((c) => c.op !== 'delete'),
            Number(pulled.serverRev) || 0,
          );
          if (!applied.ok) throw new Error(applied.reason || 'apply_failed');
        }
      } else {
        projectionJson = JSON.stringify({ P0: [], P1: [], P2: [], P3: [] });
      }
      applyLocalProjection(projectionJson);
    } else if (resolvedAuthority === AUTHORITY.LOCAL) {
      if (store.replaceTodosFromEntities) {
        const todoEntities = entities.filter((ent) => !ent.collection || ent.collection === 'todos');
        const applied = store.replaceTodosFromEntities(accountId, todoEntities, Number(commit.body.serverRev) || 0);
        if (!applied.ok) throw new Error(applied.reason || 'apply_failed');
      }
      if (local.ok) {
        applyLocalProjection(JSON.stringify({
          P0: local.data.P0.map(stripCategory),
          P1: local.data.P1.map(stripCategory),
          P2: local.data.P2.map(stripCategory),
          P3: local.data.P3.map(stripCategory),
        }));
      }
    }
  } catch (error) {
    const restored = readMigrationBackup(userDataPath, migrationId, { fsModule });
    if (restored.ok) {
      applyLocalProjection(restored.todosJson);
    }
    store.updateMigrationState(migrationId, 'failed', {
      reason: error && error.message ? error.message : 'apply_failed',
    });
    return {
      ok: false,
      error: 'apply_failed',
      migrationId,
      rolledBack: Boolean(restored && restored.ok),
    };
  }

  store.updateMigrationState(migrationId, 'applied');
  return {
    ok: true,
    migrationId,
    authority: resolvedAuthority,
    decision,
    serverRev: commit.body && commit.body.serverRev,
    remoteChanges,
    uploadedEntities: entities,
  };
}

function stripCategory(item) {
  return {
    id: item.id,
    text: item.text,
    done: item.done === true,
    createdAt: item.createdAt,
    deadline: item.deadline || '',
    remindedAt: item.remindedAt || 0,
  };
}

/**
 * Restore last migration backup into LocalStorage projection (with confirm gate at UI).
 */
function restoreLatestMigrationBackup(userDataPath, { fsModule = fs, applyLocalProjection } = {}) {
  const latest = findLatestMigrationBackup(userDataPath, { fsModule });
  if (!latest) return { ok: false, error: 'no_backup' };
  const read = readMigrationBackup(userDataPath, latest.migrationId, { fsModule });
  if (!read.ok) return read;
  if (typeof applyLocalProjection === 'function') {
    applyLocalProjection(read.todosJson);
  }
  return { ok: true, migrationId: latest.migrationId, live: read.live, path: read.path };
}

module.exports = {
  TODO_PRIORITIES,
  SYNC_BACKUPS_DIR,
  BACKUP_KEEP_COUNT,
  BACKUP_KEEP_MS,
  MIGRATION_BANNER_TEXT,
  MIGRATION_DECISIONS,
  MIGRATION_STATES,
  AUTHORITY,
  parseLocalTodosStrict,
  selectMigrationLocalTodos,
  classifyMigrationDecision,
  resolveMigrationChoice,
  normalizeNasSyncState,
  classifyFromLocalAndNas,
  resolveSyncBackupsRoot,
  isInsideSyncBackupDir,
  resolveMigrationBackupPath,
  writeMigrationBackupAtomic,
  readMigrationBackup,
  listMigrationBackupIds,
  pruneMigrationBackups,
  findLatestMigrationBackup,
  localTodosToEntities,
  entitiesToTodosProjection,
  transitionMigrationState,
  runMigrationAttempt,
  restoreLatestMigrationBackup,
};
