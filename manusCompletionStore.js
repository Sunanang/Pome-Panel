'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { probeSqliteSupport } = require('./sqliteProbe');
const { redactSecrets } = require('./manusCompletionAdapter');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  account_key TEXT PRIMARY KEY NOT NULL,
  listen_started_at INTEGER,
  baseline_ready INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  last_success_at INTEGER,
  last_error_code TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  account_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT,
  status TEXT,
  internal_state TEXT,
  has_background INTEGER,
  background_known INTEGER,
  last_event_id TEXT,
  emitted_terminal_json TEXT NOT NULL DEFAULT '[]',
  directory_signature TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_key, task_id)
);
CREATE TABLE IF NOT EXISTS scans (
  account_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  cursor TEXT,
  next_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_key, kind)
);
CREATE TABLE IF NOT EXISTS outbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  account_key TEXT NOT NULL,
  task_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status, created_at);
`;

const OUTBOX_LIMIT = 1000;
/** Keep newest confirmed identity rows per account for dedupe; drop older empty shells. */
const CONFIRMED_OUTBOX_KEEP = 2000;
/** Compact cold metadata after this age, retaining the consumed event checkpoint. */
const TASK_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const LIVE_TASK_INTERNAL = new Set(['running', 'waiting', 'background', 'verifying']);

function createManusCompletionStore({ dbPath, DatabaseSync, now = Date.now } = {}) {
  if (!dbPath || typeof dbPath !== 'string') throw new Error('manus_store_path_required');
  const probe = probeSqliteSupport();
  const Database = DatabaseSync || probe.DatabaseSync;
  if (typeof Database !== 'function') throw new Error('sqlite_unavailable');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec('PRAGMA secure_delete = ON');
  db.exec(SCHEMA_SQL);
  const columns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name));
  for (const [name, declaration] of [['message_state', 'TEXT'], ['next_poll_at', 'INTEGER NOT NULL DEFAULT 0'], ['last_polled_at', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${declaration}`);
  }
  if (process.platform !== 'win32') fs.chmodSync(dbPath, 0o600);
  db.exec("UPDATE outbox SET payload_json = '{}' WHERE status = 'confirmed' AND payload_json != '{}'");
  // Older development versions persisted unfiltered task names and pending titles.
  for (const row of db.prepare('SELECT account_key, task_id, title FROM tasks').all()) {
    const title = redactSecrets(row.title).slice(0, 256);
    if (title !== row.title) db.prepare('UPDATE tasks SET title=? WHERE account_key=? AND task_id=?').run(title, row.account_key, row.task_id);
  }
  for (const row of db.prepare("SELECT event_id, payload_json FROM outbox WHERE status='pending'").all()) {
    const event = JSON.parse(row.payload_json);
    for (const field of ['title', 'sessionTitle', 'completionSummary', 'project']) if (typeof event[field] === 'string') event[field] = redactSecrets(event[field]);
    db.prepare('UPDATE outbox SET payload_json=? WHERE event_id=?').run(JSON.stringify(event), row.event_id);
  }

  const stmts = {
    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    getAccount: db.prepare('SELECT * FROM accounts WHERE account_key = ?'),
    upsertAccount: db.prepare(`
      INSERT INTO accounts(account_key, listen_started_at, baseline_ready, last_checked_at, last_success_at, last_error_code, updated_at)
      VALUES(@account_key, @listen_started_at, @baseline_ready, @last_checked_at, @last_success_at, @last_error_code, @updated_at)
      ON CONFLICT(account_key) DO UPDATE SET
        listen_started_at = excluded.listen_started_at,
        baseline_ready = excluded.baseline_ready,
        last_checked_at = excluded.last_checked_at,
        last_success_at = excluded.last_success_at,
        last_error_code = excluded.last_error_code,
        updated_at = excluded.updated_at
    `),
    getTask: db.prepare('SELECT * FROM tasks WHERE account_key = ? AND task_id = ?'),
    listTasks: db.prepare('SELECT * FROM tasks WHERE account_key = ?'),
    upsertTask: db.prepare(`
      INSERT INTO tasks(account_key, task_id, title, status, internal_state, has_background, background_known,
        last_event_id, emitted_terminal_json, directory_signature, updated_at, message_state, next_poll_at, last_polled_at)
      VALUES(@account_key, @task_id, @title, @status, @internal_state, @has_background, @background_known,
        @last_event_id, @emitted_terminal_json, @directory_signature, @updated_at, @message_state, @next_poll_at, @last_polled_at)
      ON CONFLICT(account_key, task_id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        internal_state = excluded.internal_state,
        has_background = excluded.has_background,
        background_known = excluded.background_known,
        last_event_id = excluded.last_event_id,
        emitted_terminal_json = excluded.emitted_terminal_json,
        directory_signature = excluded.directory_signature,
        updated_at = excluded.updated_at,
        message_state = excluded.message_state,
        next_poll_at = excluded.next_poll_at,
        last_polled_at = excluded.last_polled_at
    `),
    deleteTask: db.prepare('DELETE FROM tasks WHERE account_key = ? AND task_id = ?'),
    getScan: db.prepare('SELECT * FROM scans WHERE account_key = ? AND kind = ?'),
    upsertScan: db.prepare(`
      INSERT INTO scans(account_key, kind, cursor, next_at, updated_at)
      VALUES(@account_key, @kind, @cursor, @next_at, @updated_at)
      ON CONFLICT(account_key, kind) DO UPDATE SET
        cursor = excluded.cursor, next_at = excluded.next_at, updated_at = excluded.updated_at
    `),
    insertOutbox: db.prepare(`
      INSERT INTO outbox(event_id, account_key, task_id, payload_json, status, created_at, confirmed_at)
      VALUES(@event_id, @account_key, @task_id, @payload_json, @status, @created_at, NULL)
    `),
    getOutbox: db.prepare('SELECT * FROM outbox WHERE event_id = ?'),
    listPendingOutbox: db.prepare(`SELECT * FROM outbox WHERE account_key = ? AND status = 'pending' ORDER BY created_at ASC, event_id ASC LIMIT ?`),
    confirmOutbox: db.prepare(`UPDATE outbox SET status = 'confirmed', confirmed_at = ?, payload_json = '{}' WHERE account_key = ? AND event_id = ?`),
    countPendingOutbox: db.prepare(`SELECT COUNT(*) AS count FROM outbox WHERE account_key = ? AND status = 'pending'`),
    countConfirmedOutbox: db.prepare(`SELECT COUNT(*) AS count FROM outbox WHERE account_key = ? AND status = 'confirmed'`),
    deleteOldestConfirmed: db.prepare(`
      DELETE FROM outbox WHERE rowid IN (
        SELECT rowid FROM outbox
        WHERE account_key = ? AND status = 'confirmed'
        ORDER BY confirmed_at ASC, event_id ASC
        LIMIT ?
      )
    `),
  };

  function getMeta(key, fallback = null) {
    const row = stmts.getMeta.get(key);
    return row ? row.value : fallback;
  }
  function setMeta(key, value) {
    stmts.setMeta.run(key, String(value));
  }

  function enabled() {
    return getMeta('listener_enabled', '0') === '1';
  }
  function setEnabled(value) {
    setMeta('listener_enabled', value ? '1' : '0');
  }

  function parseEmitted(raw) {
    try {
      const value = JSON.parse(raw || '[]');
      return Array.isArray(value) ? value.map((id) => String(id)).filter(Boolean) : [];
    } catch { return []; }
  }

  function mapTask(row) {
    if (!row) return null;
    return {
      accountKey: row.account_key,
      taskId: row.task_id,
      title: row.title || '',
      status: row.status || '',
      internalState: row.internal_state || '',
      hasBackground: row.has_background === 1,
      backgroundKnown: row.background_known === 1,
      lastEventId: row.last_event_id || '',
      emittedTerminalIds: parseEmitted(row.emitted_terminal_json),
      directorySignature: row.directory_signature || '',
      updatedAt: row.updated_at,
      messageState: row.message_state ? JSON.parse(row.message_state) : null,
      nextPollAt: row.next_poll_at,
      lastPolledAt: row.last_polled_at,
    };
  }

  function saveTask(task) {
    const emitted = Array.isArray(task.emittedTerminalIds) ? task.emittedTerminalIds.slice(-64) : [];
    stmts.upsertTask.run({
      account_key: task.accountKey,
      task_id: task.taskId,
      title: redactSecrets(task.title).slice(0, 256),
      status: task.status || '',
      internal_state: task.internalState || '',
      has_background: task.hasBackground ? 1 : 0,
      background_known: task.backgroundKnown ? 1 : 0,
      last_event_id: task.lastEventId || '',
      emitted_terminal_json: JSON.stringify(emitted),
      directory_signature: task.directorySignature || '',
      updated_at: now(),
      message_state: task.messageState ? JSON.stringify(task.messageState) : null,
      next_poll_at: task.nextPollAt || 0,
      last_polled_at: task.lastPolledAt || 0,
    });
  }

  function beginListenPeriod(accountKey, startedAt = now()) {
    return runInTransaction(() => {
    const existing = stmts.getAccount.get(accountKey);
    stmts.upsertAccount.run({
      account_key: accountKey,
      listen_started_at: startedAt,
      baseline_ready: 0,
      last_checked_at: existing?.last_checked_at ?? null,
      last_success_at: existing?.last_success_at ?? null,
      last_error_code: null,
      updated_at: now(),
    });
    // New listen period: clear tasks/outbox/scans for this account so closed-window
    // completions are not backfilled. Keep confirmed history in the task inbox.
    db.prepare('DELETE FROM tasks WHERE account_key = ?').run(accountKey);
    db.prepare('DELETE FROM scans WHERE account_key = ?').run(accountKey);
    db.prepare(`DELETE FROM outbox WHERE account_key = ? AND status = 'pending'`).run(accountKey);
    });
  }

  function getAccount(accountKey) {
    const row = stmts.getAccount.get(accountKey);
    if (!row) return null;
    return {
      accountKey: row.account_key,
      listenStartedAt: row.listen_started_at,
      baselineReady: row.baseline_ready === 1,
      lastCheckedAt: row.last_checked_at,
      lastSuccessAt: row.last_success_at,
      lastErrorCode: row.last_error_code || null,
    };
  }

  function touchAccount(accountKey, patch = {}) {
    const current = getAccount(accountKey) || {
      accountKey, listenStartedAt: null, baselineReady: false, lastCheckedAt: null, lastSuccessAt: null, lastErrorCode: null,
    };
    stmts.upsertAccount.run({
      account_key: accountKey,
      listen_started_at: patch.listenStartedAt !== undefined ? patch.listenStartedAt : current.listenStartedAt,
      baseline_ready: (patch.baselineReady !== undefined ? patch.baselineReady : current.baselineReady) ? 1 : 0,
      last_checked_at: patch.lastCheckedAt !== undefined ? patch.lastCheckedAt : current.lastCheckedAt,
      last_success_at: patch.lastSuccessAt !== undefined ? patch.lastSuccessAt : current.lastSuccessAt,
      last_error_code: patch.lastErrorCode !== undefined ? patch.lastErrorCode : current.lastErrorCode,
      updated_at: now(),
    });
  }

  function enqueue(accountKey, event) {
    const existing = stmts.getOutbox.get(event.eventId);
    if (existing) return { ok: true, duplicate: true };
    const pending = stmts.countPendingOutbox.get(accountKey).count;
    if (pending >= OUTBOX_LIMIT) return { ok: false, error: 'outbox_backlog' };
    const safe = { ...event };
    for (const field of ['title', 'sessionTitle', 'completionSummary', 'project']) if (typeof safe[field] === 'string') safe[field] = redactSecrets(safe[field]);
    stmts.insertOutbox.run({
      event_id: event.eventId,
      account_key: accountKey,
      task_id: event.taskId || event.sessionId,
      payload_json: JSON.stringify(safe),
      status: 'pending',
      created_at: now(),
    });
    return { ok: true, duplicate: false };
  }

  function listPending(accountKey, limit = 20) {
    if (typeof accountKey !== 'string' || !accountKey) return [];
    return stmts.listPendingOutbox.all(accountKey, limit).map((row) => ({
      eventId: row.event_id,
      accountKey: row.account_key,
      taskId: row.task_id,
      status: row.status,
      createdAt: row.created_at,
      event: JSON.parse(row.payload_json),
    }));
  }

  function pruneConfirmedOutbox(accountKey) {
    if (typeof accountKey !== 'string' || !accountKey) return { deleted: 0 };
    const count = stmts.countConfirmedOutbox.get(accountKey).count;
    if (count <= CONFIRMED_OUTBOX_KEEP) return { deleted: 0 };
    const excess = count - CONFIRMED_OUTBOX_KEEP;
    const result = stmts.deleteOldestConfirmed.run(accountKey, excess);
    return { deleted: result.changes || 0 };
  }

  function taskHasLiveWork(task) {
    if (!task) return false;
    if (LIVE_TASK_INTERNAL.has(task.internalState)) return true;
    if (task.hasBackground) return true;
    if (task.messageState?.candidates?.length) return true;
    if (task.messageState?.cursor) return true;
    if (task.messageState?.verifyAfter) return true;
    return false;
  }

  function pruneColdTasks(accountKey) {
    if (typeof accountKey !== 'string' || !accountKey) return { deleted: 0, compacted: 0 };
    const cutoff = now() - TASK_RETENTION_MS;
    let compacted = 0;
    for (const task of stmts.listTasks.all(accountKey).map(mapTask)) {
      if (taskHasLiveWork(task)) continue;
      const stamp = Math.max(task.updatedAt || 0, task.lastPolledAt || 0);
      const expired = stamp > 0 && stamp < cutoff;
      const deletedRemote = task.internalState === 'deleted' || task.status === 'deleted';
      if (!expired && !deletedRemote) continue;
      // A task can reappear after being temporarily absent. Confirmed outbox IDs
      // have bounded retention, so deleting this checkpoint would replay history.
      if (deletedRemote && !expired) continue;
      const messageState = task.messageState ? { ...task.messageState, round: {} }
        : task.lastEventId ? { lastEventId: task.lastEventId, cursor: '', recentIds: [task.lastEventId], candidates: [], round: {}, afterTerminalId: '', latestStatus: task.status } : null;
      if (task.title || task.directorySignature || JSON.stringify(messageState) !== JSON.stringify(task.messageState)) {
        saveTask({ ...task, title: '', directorySignature: '', messageState });
        compacted += 1;
      }
    }
    return { deleted: 0, compacted };
  }

  function pruneRetention(accountKey) {
    if (typeof accountKey !== 'string' || !accountKey) {
      return { confirmedDeleted: 0, tasksDeleted: 0, tasksCompacted: 0 };
    }
    return runInTransaction(() => {
      const confirmed = pruneConfirmedOutbox(accountKey);
      const tasks = pruneColdTasks(accountKey);
      return { confirmedDeleted: confirmed.deleted, tasksDeleted: tasks.deleted, tasksCompacted: tasks.compacted };
    });
  }

  function confirm(accountKey, eventId) {
    stmts.confirmOutbox.run(now(), accountKey, eventId);
    pruneConfirmedOutbox(accountKey);
  }

  function getScan(accountKey, kind) {
    const row = stmts.getScan.get(accountKey, kind);
    return row ? { cursor: row.cursor || '', nextAt: row.next_at, updatedAt: row.updated_at } : null;
  }

  function setScan(accountKey, kind, { cursor = '', nextAt = null } = {}) {
    stmts.upsertScan.run({
      account_key: accountKey,
      kind,
      cursor: cursor || '',
      next_at: nextAt,
      updated_at: now(),
    });
  }

  function runInTransaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    }
  }

  function close() {
    db.close();
  }

  function publicStatus(accountKey) {
    const account = accountKey ? getAccount(accountKey) : null;
    return {
      enabled: enabled(),
      connectionState: !enabled() ? 'disabled'
        : account?.lastErrorCode === 'manus_unauthenticated' ? 'auth_invalid'
          : account?.lastErrorCode === 'manus_permission_denied' ? 'permission_denied'
            : account?.lastErrorCode ? 'network_error'
              : account?.baselineReady ? 'listening'
              : account ? 'preparing' : 'idle',
      lastCheckedAt: account?.lastCheckedAt || null,
      lastSuccessfulAt: account?.lastSuccessAt || null,
      activeCount: accountKey
        ? stmts.listTasks.all(accountKey).filter((row) => ['running', 'waiting', 'background', 'verifying'].includes(row.internal_state)).length
        : 0,
      backlogCount: accountKey ? stmts.countPendingOutbox.get(accountKey).count : 0,
      lastErrorCode: account?.lastErrorCode || null,
      scanLagging: Boolean(account && getScan(accountKey, 'directory')?.cursor),
    };
  }

  return {
    dbPath,
    OUTBOX_LIMIT,
    CONFIRMED_OUTBOX_KEEP,
    TASK_RETENTION_MS,
    enabled,
    setEnabled,
    getMeta,
    setMeta,
    beginListenPeriod,
    getAccount,
    touchAccount,
    getTask: (accountKey, taskId) => mapTask(stmts.getTask.get(accountKey, taskId)),
    listTasks: (accountKey) => stmts.listTasks.all(accountKey).map(mapTask),
    saveTask,
    deleteTask: (accountKey, taskId) => stmts.deleteTask.run(accountKey, taskId),
    enqueue,
    listPending,
    confirm,
    pruneConfirmedOutbox,
    pruneColdTasks,
    pruneRetention,
    getScan,
    setScan,
    runInTransaction,
    publicStatus,
    close,
  };
}

module.exports = {
  createManusCompletionStore,
  SCHEMA_SQL,
  OUTBOX_LIMIT,
  CONFIRMED_OUTBOX_KEEP,
  TASK_RETENTION_MS,
};
