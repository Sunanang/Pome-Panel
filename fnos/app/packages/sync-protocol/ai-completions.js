'use strict';
const { createHash } = require('node:crypto');
const AI_COMPLETION_LIMIT = 100;
const sources = new Set(['codex', 'claude', 'cursor', 'gpt']);
const statuses = new Set(['completed', 'failed', 'awaiting', 'due']);
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function completionIdentity(row) {
  return clean(row.completionEventId, 320) || hash(['legacy', row.source, row.id]);
}
function completionSyncKey(row) {
  return hash([row.source, completionIdentity(row)]);
}

// Whitelist portable history fields. Native window identity and cwd are local.
function normalizeSyncedCompletion(row) {
  if (!row || !sources.has(row.source) || typeof row.id !== 'string' || !row.id
    || !Number.isFinite(row.receivedAt) || row.receivedAt < 0
    || (row.readAt !== null && (!Number.isFinite(row.readAt) || row.readAt < 0))) return null;
  return {
    id: completionSyncKey(row), completionEventId: completionIdentity(row), source: row.source,
    status: statuses.has(row.status) ? row.status : 'completed',
    taskId: clean(row.taskId, 160), title: clean(row.title, 4096), project: clean(row.project, 320),
    titleIsFallback: row.titleIsFallback === true, sessionTitle: clean(row.sessionTitle, 256),
    completionSummary: clean(row.completionSummary || row.title, 4096),
    receivedAt: row.receivedAt, completedAt: Number.isFinite(row.completedAt) ? row.completedAt : row.receivedAt,
    readAt: row.readAt,
  };
}

function mergeSyncedCompletions(left, right) {
  const a = normalizeSyncedCompletion(left), b = normalizeSyncedCompletion(right);
  if (!a || !b || a.id !== b.id) throw new Error('invalid_ai_completion_identity');
  // The first reception and first read mark win. Ties converge independently
  // of device/pull order; an unread stale write can never undo a read mark.
  const winner = a.receivedAt < b.receivedAt || (a.receivedAt === b.receivedAt && JSON.stringify(a) < JSON.stringify(b)) ? a : b;
  const reads = [a.readAt, b.readAt].filter(value => value !== null);
  return { ...winner, readAt: reads.length ? Math.min(...reads) : null };
}

function trimCompletionHistory(rows) {
  return rows.slice().sort((a, b) => b.receivedAt - a.receivedAt
    || completionSyncKey(a).localeCompare(completionSyncKey(b))).slice(0, AI_COMPLETION_LIMIT);
}

module.exports = { AI_COMPLETION_LIMIT, completionSyncKey, normalizeSyncedCompletion, mergeSyncedCompletions, trimCompletionHistory };
