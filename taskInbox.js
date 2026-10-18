'use strict';

const fs = require('node:fs');
const { statusKey } = require('./renderer/notification-domain');
const { randomUUID, createHash } = require('node:crypto');
const { readJsonStrict, writeJsonAtomic, writeAtomic } = require('./atomicStorage');
const { visibleCompletion } = require('./aiEventPolicy');

const READ_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SOURCES = new Set(['codex', 'claude', 'cursor']);
const HISTORICAL_SOURCES = new Set([...SOURCES, 'gpt']);
const RETENTION_LABEL = '默认显示最近 20 条，可查看更多；已读记录保留 30 天，未读记录不自动清理；事件去重信息随记录保留。';
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// Explicit identities survive retries. Legacy payloads without an event identity
// get a bounded reception identity; same-reception retries dedupe, new turns stay.
function completionEventId(input, receivedAt = Date.now()) {
  const source = clean(input?.source, 32);
  const explicit = clean(input?.completionEventId || input?.eventId || input?.event_id || input?.['event-id'], 320);
  const round = clean(input?.turnId || input?.turn_id || input?.['turn-id'] || String(input?.round ?? input?.roundSequence ?? input?.sequence ?? ''), 160);
  const task = clean(input?.taskId || input?.task_id || input?.session_id || input?.thread_id, 160);
  const rawTime = input?.completedAt ?? input?.completed_at ?? input?.['completed-at'];
  const parsed = typeof rawTime === 'string' && !/^\d+(\.\d+)?$/.test(rawTime) ? Date.parse(rawTime) : Number(rawTime);
  const time = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const identity = explicit ? ['id', explicit] : task && round ? ['round', task, round] : task && time ? ['time', task, time] : ['received', time || receivedAt, input];
  return createHash('sha256').update(JSON.stringify([source, ...identity])).digest('hex');
}

// No reset without confirmation. The exact original bytes are retained first.
function rebuildTaskInbox({ filePath, confirmed = false, now = Date.now, disk = fs, expectedDigest, backupPath: requestedBackupPath } = {}) {
  if (!confirmed) return { ok: false, canceled: true };
  const original = disk.readFileSync(filePath);
  if (expectedDigest && createHash('sha256').update(original).digest('hex') !== expectedDigest) return { ok: false, error: 'preview_expired' };
  const backupPath = requestedBackupPath || `${filePath}.corrupt-${new Date(now()).toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  if (!backupPath.startsWith(`${filePath}.corrupt-`) || disk.existsSync(backupPath)) throw new Error('invalid_corrupt_backup_path');
  writeAtomic(backupPath, original, disk);
  if (!disk.readFileSync(backupPath).equals(original)) throw new Error('corrupt_backup_verification_failed');
  try { writeJsonAtomic(filePath, { version: 1, records: [], dedupe: {} }, disk); }
  catch (error) { error.backupPath = backupPath; throw error; }
  return { ok: true, backupPath };
}

function createTaskInbox({ filePath, now = Date.now, disk = fs } = {}) {
  if (!filePath) throw new Error('inbox_path_required');
  let state = readJsonStrict(filePath, { version: 1, records: [], dedupe: {} }, disk);
  if (!state || state.version !== 1 || !Array.isArray(state.records)
    || !state.dedupe || typeof state.dedupe !== 'object' || Array.isArray(state.dedupe)
    || state.records.some((r) => !r || typeof r.id !== 'string' || !HISTORICAL_SOURCES.has(r.source)
      || !Number.isFinite(r.receivedAt) || (r.readAt !== null && !Number.isFinite(r.readAt)))) {
    throw Object.assign(new Error('收件箱格式损坏，原文件已保留。'), { code: 'storage_corrupt' });
  }
  if (new Set(state.records.map((r) => r.id)).size !== state.records.length || Object.values(state.dedupe).some((r) => !r || typeof r.id !== 'string' || !Number.isFinite(r.at))) throw Object.assign(new Error('收件箱格式损坏，原文件已保留。'), { code: 'storage_corrupt' });
  state.records = state.records.map(record => ({ ...record, status: statusKey(record.status, record.source) }));
  const diskVersion = () => { if (!disk.existsSync(filePath)) return null; const stat = disk.statSync(filePath); return [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':'); };
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  let lastDiskVersion = diskVersion();
  let lastDiskDigest = lastDiskVersion === null ? null : digest(disk.readFileSync(filePath));
  function checkDisk() {
    const version = diskVersion();
    if (version === lastDiskVersion) return;
    const currentDigest = version === null ? null : digest(disk.readFileSync(filePath));
    if (currentDigest === lastDiskDigest) { lastDiskVersion = version; return; }
    throw Object.assign(new Error('收件箱文件在外部发生变化，原文件已保留，请重新读取。'), { code: 'storage_changed' });
  }
  function commit(next) { checkDisk(); writeJsonAtomic(filePath, next, disk); state = next; lastDiskVersion = diskVersion(); lastDiskDigest = digest(`${JSON.stringify(next)}\n`); }
  function prune() {
    checkDisk();
    const ts = now();
    const records = state.records.filter((r) => r.readAt === null || ts - r.readAt < READ_RETENTION_MS);
    const ids = new Set(records.map(row => row.id));
    const dedupe = Object.fromEntries(Object.entries(state.dedupe).filter(([, row]) => ids.has(row.id) && row.stable === true));
    if (records.length !== state.records.length || Object.keys(dedupe).length !== Object.keys(state.dedupe).length) {
      commit({ ...state, records, dedupe });
    }
  }
  function accept(input) {
    if (!input || !SOURCES.has(input.source)) return { ok: false, error: 'invalid_source' };
    const stableId = completionEventId(input, now());
    prune();
    const ts = now();
    const taskId = clean(input.taskId, 160);
    const title = clean(input.title, 4096);
    const project = clean(input.project, 320);
    const key = `event:${stableId}`;
    const prior = state.dedupe[key];
    if (prior) return { ok: true, duplicate: true, record: get(prior.id) };
    const rawCompletedAt = input.completedAt ?? input.completed_at;
    const parsedCompletedAt = typeof rawCompletedAt === 'string' && !/^\d+(\.\d+)?$/.test(rawCompletedAt) ? Date.parse(rawCompletedAt) : Number(rawCompletedAt);
    const record = {
      id: randomUUID(), completionEventId: stableId, source: input.source, status: statusKey(input.status, input.source), taskId, title, project,
      titleIsFallback: input.titleIsFallback === true,
      sessionTitle: clean(input.sessionTitle, 256), completionSummary: clean(input.completionSummary || input.title, 4096),
      receivedAt: ts, completedAt: Number.isFinite(parsedCompletedAt) && parsedCompletedAt > 0 ? parsedCompletedAt : ts, readAt: null,
      window: input.window && typeof input.window === 'object' ? {
        app: clean(input.window.app, 160), title: clean(input.window.title, 320),
        bundleId: clean(input.window.bundleId, 240) || null, cwd: clean(input.window.cwd, 4096) || null,
      } : null,
    };
    commit({ version: 1, records: [record, ...state.records],
      dedupe: { ...state.dedupe, [key]: { id: record.id, at: ts, stable: true } } });
    return { ok: true, duplicate: false, record: { ...record } };
  }
  function get(id) { const row = state.records.find((r) => r.id === id); return row ? structuredClone(row) : null; }
  function list({ offset = 0, limit = 20 } = {}) {
    prune();
    offset = Math.max(0, Math.trunc(Number(offset) || 0));
    limit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 20)));
    const visible = state.records.filter(visibleCompletion);
    return { items: structuredClone(visible.slice(offset, offset + limit)),
      total: visible.length, unread: visible.filter((r) => r.readAt === null).length,
      offset, hasMore: offset + limit < visible.length, retentionLabel: RETENTION_LABEL };
  }
  function markRead(id) {
    checkDisk();
    const record = get(id);
    if (!record) return { ok: false, error: 'not_found' };
    if (record.readAt === null) {
      commit({ ...state, records: state.records.map((r) => r.id === id ? { ...r, readAt: now() } : r) });
    }
    return { ok: true, record: get(id) };
  }
  return { accept, get, list, markRead };
}

module.exports = { completionEventId, rebuildTaskInbox, createTaskInbox, READ_RETENTION_MS, RETENTION_LABEL };
