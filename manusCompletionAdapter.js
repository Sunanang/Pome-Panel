'use strict';

const { createHash } = require('node:crypto');
const { MANUS_ADAPTER_ID } = require('./manusApi');
const { sanitizeCompletionText } = require('./packages/sync-protocol/ai-completions');

const TRACKABLE_TYPES = new Set(['standard', 'project']);
const TASK_STATUSES = new Set(['running', 'stopped', 'waiting', 'error', 'deleted']);
const INTERNAL = Object.freeze({
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  WAITING: 'waiting',
  BACKGROUND: 'background',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  DELETED: 'deleted',
  UNKNOWN: 'unknown',
});

function clean(value, max = 160) {
  return Array.from(typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '')
    .slice(0, max).join('');
}

function secondsToMs(value) {
  if (!Number.isFinite(value)) return null;
  if (value > 1e12) return Math.trunc(value);
  if (value > 0) return Math.trunc(value * 1000);
  return null;
}

function messageTimeMs(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function deriveAccountKey(userId) {
  return createHash('sha256').update(['manus-account-v1', clean(userId, 320)].join('\0')).digest('hex');
}

function completionIdentity(accountKey, taskId, terminalEventId) {
  return createHash('sha256').update(JSON.stringify([
    'manus-completion-v1',
    clean(accountKey, 128),
    clean(taskId, 160),
    clean(terminalEventId, 320),
  ])).digest('hex');
}

function isTrackableTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) return false;
  const id = clean(task.id, 160);
  const type = clean(task.task_type || task.taskType, 40);
  return Boolean(id) && id === task.id && task.id.length <= 160 && !/[\u0000-\u0020\u007f]/.test(task.id) && TRACKABLE_TYPES.has(type);
}

function normalizeListTask(task) {
  if (!isTrackableTask(task)) return null;
  const status = clean(task.status, 40);
  return {
    id: clean(task.id, 160),
    status: TASK_STATUSES.has(status) ? status : 'unknown',
    title: redactSecrets(task.title).slice(0, 256),
    taskType: clean(task.task_type || task.taskType, 40),
    taskUrl: clean(task.task_url || task.taskUrl, 512),
    createdAtMs: secondsToMs(Number(task.created_at ?? task.createdAt)),
    updatedAtMs: secondsToMs(Number(task.updated_at ?? task.updatedAt)),
    deletedAtMs: secondsToMs(Number(task.deleted_at ?? task.deletedAt)),
    hasBackground: task.has_running_background_jobs === true,
    backgroundKnown: typeof task.has_running_background_jobs === 'boolean',
  };
}

function redactSecrets(text) {
  return sanitizeCompletionText('manus', clean(text, 4096));
}

function knownControlJson(text) {
  if (typeof text !== 'string') return false;
  const body = text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  try {
    const value = JSON.parse(body);
    const keys = value && !Array.isArray(value) && typeof value === 'object' ? Object.keys(value) : [];
    return keys.length === 1 && ['suggestions', 'exclude'].includes(keys[0]) && Array.isArray(value[keys[0]]) && !value[keys[0]].length;
  } catch { return false; }
}

function chronologicalMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row) && clean(row.id, 320))
    .map((row) => ({
      id: clean(row.id, 320),
      type: clean(row.type, 64),
      timestamp: messageTimeMs(Number(row.timestamp)),
      raw: row,
    }))
    .filter((row) => row.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp || 0);
}

function assistantResultText(message) {
  const body = message?.raw?.assistant_message;
  if (!body || typeof body !== 'object') return '';
  const kind = clean(body.delivery_kind || body.deliveryKind, 40);
  if (kind === 'opening' || kind === 'progress') return '';
  if (!kind) {
    // Absent delivery_kind should stay visible per docs; treat as candidate result.
  }
  const content = redactSecrets(body.content);
  if (!content || knownControlJson(content)) return '';
  return content.slice(0, 4096);
}

function buildTrustedEvent({
  accountKey, task, outcome, terminalEventId, occurredAt, summary = '',
}) {
  const taskId = clean(task?.id, 160);
  const eventId = completionIdentity(accountKey, taskId, terminalEventId);
  const kind = outcome === 'failed' ? 'turn.failed' : 'turn.completed';
  const safeSummary = redactSecrets(summary);
  return {
    schemaVersion: 2,
    source: 'manus',
    kind,
    eventId,
    sessionId: taskId,
    turnId: clean(terminalEventId, 320),
    taskId,
    occurredAt,
    sequence: 0,
    completionSummary: safeSummary,
    title: safeSummary,
    project: '',
    sessionTitle: redactSecrets(task?.title).slice(0, 256),
    evidence: {
      adapter: MANUS_ADAPTER_ID,
      surface: 'api',
      providerVersion: 'unverified',
      signal: outcome === 'failed' ? 'task_error' : 'task_stopped',
    },
  };
}

/**
 * Reduce detail + messages into an internal verdict for one task snapshot.
 * Does not emit waiting alerts in phase 1.
 */
function reduceTaskSnapshot({ accountKey, task, messages, listenStartedAtMs = 0, alreadyEmittedTerminalIds = new Set() }) {
  const normalized = normalizeListTask(task);
  if (!normalized) return { internal: INTERNAL.UNKNOWN, action: 'none' };
  const state = ingestMessagePage(emptyMessageState(), messages);
  state.candidates = state.candidates.filter(candidate => !alreadyEmittedTerminalIds.has(candidate.id));
  const verdict = settleMessageState({ state, task, accountKey });
  const candidate = state.candidates[0];
  const base = { internal: verdict.internal, task: normalized, latestEventId: state.lastEventId };
  if (verdict.internal === INTERNAL.DELETED) return { ...base, action: 'drop' };
  if (verdict.internal === INTERNAL.VERIFYING) return { ...base, action: 'retry', terminalEventId: candidate?.id };
  if (!verdict.consumed.length) return { ...base, action: ACTIVE_INTERNAL.has(verdict.internal) ? 'track' : 'idle' };
  if (candidate.cancelled) return { ...base, action: 'cancel', terminalEventId: candidate.id };
  const event = verdict.events[0];
  return { ...base, action: event.occurredAt < listenStartedAtMs ? 'baseline' : 'emit', terminalEventId: candidate.id, event };
}
const ACTIVE_INTERNAL = new Set([INTERNAL.RUNNING, INTERNAL.WAITING, INTERNAL.BACKGROUND]);

function taskOpenUrl(taskId) {
  if (typeof taskId !== 'string' || taskId.length > 160 || /[\u0000-\u0020\u007f]/.test(taskId)) return null;
  const id = clean(taskId, 160);
  if (!id || /^[.]+$/.test(id) || /[/?#\\]/.test(id)) return null;
  return `https://manus.im/app/${encodeURIComponent(id)}`;
}

function matchesOfficialTaskUrl(url, taskId) {
  const expected = taskOpenUrl(taskId);
  if (!expected || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://manus.im'
      && parsed.pathname === `/app/${encodeURIComponent(clean(taskId, 160))}`
      && !parsed.username && !parsed.password;
  } catch { return false; }
}

// Store only a current result and unconsumed terminal candidates, never the
// conversation transcript. Fetch progress and terminal acknowledgement are
// deliberately separate: background work may append messages after a stop.
function emptyMessageState() {
  return { lastEventId: '', cursor: '', recentIds: [], candidates: [], round: {}, afterTerminalId: '', latestStatus: '' };
}

function ingestMessagePage(previous, messages, { listenStartedAtMs = 0 } = {}) {
  const state = structuredClone(previous || emptyMessageState());
  const seen = new Set(state.recentIds || []);
  for (const row of chronologicalMessages(messages)) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    state.lastEventId = row.id;
    const after = state.candidates.find(item => item.id === state.afterTerminalId);
    if (row.type === 'user_message') {
      state.round = {}; state.afterTerminalId = '';
    } else if (row.type === 'user_stop') {
      if (after) after.cancelled = true;
      else state.round.cancelled = true;
    } else if (row.type === 'assistant_message') {
      const summary = assistantResultText(row);
      if (summary) {
        if (after) after.summary = summary;
        else state.round.summary = summary;
      }
    } else if (row.type === 'error_message') {
      const error = redactSecrets(row.raw.error_message?.content);
      if (after && after.status === 'error') after.error = error;
      else state.round.error = error;
    } else if (row.type === 'status_update') {
      const status = clean(row.raw.status_update?.agent_status, 40);
      state.latestStatus = status;
      if (status === 'running' || status === 'waiting') {
        if (state.afterTerminalId) state.round = {};
        state.afterTerminalId = '';
      } else if (status === 'stopped' || status === 'error') {
        if (row.timestamp >= listenStartedAtMs) {
          state.candidates.push({ id: row.id, status, timestamp: row.timestamp,
            summary: state.round.summary || '', error: state.round.error || '', cancelled: state.round.cancelled === true });
        }
        state.round = {}; state.afterTerminalId = row.id;
      }
    }
  }
  state.recentIds = [...seen].slice(-64);
  return state;
}

function settleMessageState({ state, task, accountKey }) {
  const normalized = normalizeListTask(task);
  if (!normalized || normalized.status === 'unknown') return { internal: INTERNAL.UNKNOWN, events: [], consumed: [] };
  const status = normalized.status;
  if (status === 'deleted') return { internal: INTERNAL.DELETED, events: [], consumed: [] };
  if (state.cursor) return { internal: INTERNAL.VERIFYING, events: [], consumed: [] };
  if (status === 'running' || status === 'waiting') return { internal: status, events: [], consumed: [] };
  if (status === 'stopped' && normalized.hasBackground) return { internal: INTERNAL.BACKGROUND, events: [], consumed: [] };
  if (status === 'stopped' && !normalized.backgroundKnown) return { internal: INTERNAL.VERIFYING, events: [], consumed: [] };
  if (state.latestStatus && state.latestStatus !== status) return { internal: INTERNAL.VERIFYING, events: [], consumed: [] };
  const events = [], consumed = [];
  for (const candidate of state.candidates.slice(0, 20)) {
    consumed.push(candidate.id);
    if (!candidate.cancelled) events.push(buildTrustedEvent({ accountKey, task: normalized,
      outcome: candidate.status === 'error' ? 'failed' : 'completed', terminalEventId: candidate.id,
      occurredAt: candidate.timestamp, summary: candidate.status === 'error' ? candidate.error : candidate.summary }));
  }
  return { internal: state.candidates.at(-1)?.cancelled ? INTERNAL.CANCELLED : status === 'error' ? INTERNAL.FAILED : INTERNAL.COMPLETED, events, consumed };
}

module.exports = {
  INTERNAL,
  MANUS_ADAPTER_ID,
  TRACKABLE_TYPES,
  clean,
  deriveAccountKey,
  completionIdentity,
  isTrackableTask,
  normalizeListTask,
  chronologicalMessages,
  reduceTaskSnapshot,
  buildTrustedEvent,
  taskOpenUrl,
  matchesOfficialTaskUrl,
  redactSecrets,
  secondsToMs,
  emptyMessageState,
  ingestMessagePage,
  settleMessageState,
};
