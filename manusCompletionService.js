'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createManusApi } = require('./manusApi');
const { createManusCompletionStore } = require('./manusCompletionStore');
const { normalizeListTask, emptyMessageState, ingestMessagePage, settleMessageState } = require('./manusCompletionAdapter');

const DISCOVERY_ACTIVE_MS = 15_000;
const DISCOVERY_IDLE_MS = 60_000;
const DIRECTORY_RESCHEDULE_MS = 5 * 60_000;
const VERIFY_SUMMARY_MS = 2_000;
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
const ACTIVE = new Set(['running', 'waiting', 'background', 'verifying']);
const SUCCESS = new Set(['accepted', 'queued', 'duplicate']);
// Permanent rejects must not block later pending rows; acknowledge and move on.
const DROP = new Set(['ignored', 'identity_required', 'preview']);

function createManusCompletionService({ userDataPath, getToken, deliverEvent, fetchImpl,
  now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
  api: injectedApi, store: injectedStore, DatabaseSync, onStatusChanged = () => {} } = {}) {
  if (!userDataPath) throw new Error('manus_user_data_required');
  const api = injectedApi || createManusApi({ fetchImpl, now });
  const store = injectedStore || createManusCompletionStore({ dbPath: path.join(userDataPath, 'manus-completions.db'), DatabaseSync, now });
  let running = false, closed = false, timer = null, generation = 0, busy = false;
  let accountKey = store.getMeta('current_account'), activeToken = '', backoffIndex = 0, identityError = null;
  const token = () => typeof getToken === 'function' ? String(getToken() || '').trim() : '';
  const fingerprint = value => createHash('sha256').update(value).digest('hex');
  function status() {
    const result = store.publicStatus(accountKey);
    if (identityError && result.enabled) return { ...result, lastErrorCode: identityError,
      connectionState: identityError === 'manus_unauthenticated' || identityError === 'manus_token_missing' ? 'auth_invalid'
        : identityError === 'manus_permission_denied' ? 'permission_denied' : 'network_error' };
    return result;
  }
  function announce() { if (!closed) { try { onStatusChanged(status()); } catch { /* A view cannot stop collection. */ } } }
  function check(revision, expectedToken) {
    if (closed || revision !== generation || (expectedToken !== undefined && token() !== expectedToken)) throw Object.assign(new Error('manus_superseded'), { code: 'manus_superseded' });
  }
  function cancel() {
    generation++; api.bumpGeneration();
    if (timer) clearTimeoutFn(timer);
    timer = null;
  }
  function schedule(delay) {
    if (!running || closed) return;
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => { timer = null; void tick(); }, Math.max(50, delay));
    timer?.unref?.();
  }
  function backoff() { return BACKOFF_MS[Math.min(backoffIndex++, BACKOFF_MS.length - 1)] + Math.floor(Math.random() * 1000); }
  async function identify(key, revision, newPeriod = false) {
    const identity = await api.userMe(key);
    check(revision, key);
    if (newPeriod || !store.getAccount(identity.accountKey)) store.beginListenPeriod(identity.accountKey, now());
    accountKey = identity.accountKey; activeToken = key; identityError = null;
    store.setMeta('current_account', accountKey);
    store.setMeta('credential_identity', fingerprint(key));
    return identity;
  }

  async function deliverPending(revision = generation) {
    if (!running || closed || !store.enabled() || !accountKey || !activeToken || typeof deliverEvent !== 'function') return;
    for (const row of store.listPending(accountKey, 20)) {
      check(revision, activeToken);
      const result = await deliverEvent(row.event);
      check(revision, activeToken);
      if (SUCCESS.has(result) || result === true || result?.ok === true) store.confirm(accountKey, row.eventId);
      else if (DROP.has(result) || result?.drop === true) store.confirm(accountKey, row.eventId);
      else {
        store.touchAccount(accountKey, { lastErrorCode: 'manus_delivery_failed' });
        break;
      }
    }
  }

  function soonestTaskDelay() {
    let soonest = Number.POSITIVE_INFINITY;
    for (const row of store.listTasks(accountKey)) {
      if (row.internalState === 'deleted') continue;
      if (Number.isFinite(row.nextPollAt)) soonest = Math.min(soonest, row.nextPollAt);
    }
    if (!Number.isFinite(soonest)) return null;
    return Math.max(50, soonest - now());
  }

  function registerPage(page, directory = false) {
    for (const raw of page.tasks) {
      const row = normalizeListTask(raw);
      if (!row) continue;
      const existing = store.getTask(accountKey, row.id);
      const signature = JSON.stringify([row.status, row.updatedAtMs, row.hasBackground, row.backgroundKnown, row.title]);
      store.saveTask({ ...existing, accountKey, taskId: row.id, title: row.title,
        status: row.status, hasBackground: row.hasBackground, backgroundKnown: row.backgroundKnown,
        internalState: row.status === 'deleted' ? 'deleted' : existing?.internalState || 'verifying',
        nextPollAt: row.status === 'deleted' ? Number.MAX_SAFE_INTEGER
          : !existing || directory || signature !== existing.directorySignature ? Math.min(existing?.nextPollAt || now(), now()) : existing.nextPollAt,
        directorySignature: signature });
    }
  }

  async function discover(key, revision) {
    const scan = store.getScan(accountKey, 'discovery');
    if (scan?.nextAt > now()) return;
    const page = await api.taskList(key, { limit: 100 }); check(revision, key);
    store.runInTransaction(() => {
      registerPage(page);
      const active = store.listTasks(accountKey).some(row => ACTIVE.has(row.internalState));
      store.setScan(accountKey, 'discovery', { nextAt: now() + (active ? DISCOVERY_ACTIVE_MS : DISCOVERY_IDLE_MS) });
    });
  }
  async function directoryScan(key, revision) {
    const scan = store.getScan(accountKey, 'directory') || { cursor: '', nextAt: 0 };
    if (scan.nextAt > now()) return;
    const page = await api.taskList(key, { cursor: scan.cursor || undefined, limit: 100 }); check(revision, key);
    // Persist directory progress before any other endpoint can exhaust its budget.
    store.runInTransaction(() => {
      registerPage(page, true);
      store.setScan(accountKey, 'directory', { cursor: page.nextCursor, nextAt: page.hasMore ? now() : now() + DIRECTORY_RESCHEDULE_MS });
      if (!page.hasMore) store.touchAccount(accountKey, { baselineReady: true });
    });
    // Retention prune is outside the scan transaction: nested BEGIN is unsupported.
    if (!page.hasMore) store.pruneRetention(accountKey);
  }

  async function inspectTask(row, key, revision) {
    let state = row.messageState || emptyMessageState();
    const batch = await api.listMessages(key, row.taskId, {
      ...(state.cursor ? { cursor: state.cursor } : state.lastEventId ? { startEventId: state.lastEventId } : {}), limit: 50,
    });
    check(revision, key);
    state = ingestMessagePage(state, batch.messages, { listenStartedAtMs: store.getAccount(accountKey).listenStartedAt });
    state.cursor = batch.nextCursor || '';
    row = { ...row, messageState: state, lastEventId: state.lastEventId,
      lastPolledAt: now(), nextPollAt: now() + DISCOVERY_ACTIVE_MS, internalState: state.cursor ? 'verifying' : row.internalState };
    store.saveTask(row);
    if (batch.hasMore) return;
    // Read current detail after messages. Contradictions retain terminal candidates.
    const raw = await api.taskDetail(key, row.taskId); check(revision, key);
    const detail = normalizeListTask(raw);
    if (!detail || detail.id !== row.taskId) throw Object.assign(new Error('manus_invalid_task_detail'), { code: 'manus_invalid_task_detail' });
    const emitted = new Set(row.emittedTerminalIds || []);
    state.candidates = state.candidates.filter(candidate => !emitted.has(candidate.id));
    if (emitted.has(state.afterTerminalId)) state.afterTerminalId = '';
    const verdict = settleMessageState({ state, task: raw, accountKey });
    if (verdict.events.some(event => !event.completionSummary) && !state.verifyAfter) {
      state.verifyAfter = now() + VERIFY_SUMMARY_MS;
      store.saveTask({
        ...row, messageState: state, internalState: 'verifying',
        nextPollAt: Math.min(row.nextPollAt || Number.MAX_SAFE_INTEGER, state.verifyAfter),
      });
      return;
    }
    if (state.verifyAfter > now()) {
      store.saveTask({
        ...row, messageState: state, internalState: 'verifying',
        nextPollAt: Math.min(row.nextPollAt || Number.MAX_SAFE_INTEGER, state.verifyAfter),
      });
      return;
    }
    store.runInTransaction(() => {
      for (const event of verdict.events) {
        const accepted = store.enqueue(accountKey, event);
        if (!accepted.ok) throw Object.assign(new Error(accepted.error), { code: accepted.error });
      }
      const consumed = new Set(verdict.consumed);
      state.candidates = state.candidates.filter(candidate => !consumed.has(candidate.id));
      if (consumed.has(state.afterTerminalId)) state.afterTerminalId = '';
      if (consumed.size) { state.round = {}; delete state.verifyAfter; }
      store.saveTask({ ...row, messageState: state, title: detail.title, status: detail.status,
        hasBackground: detail.hasBackground, backgroundKnown: detail.backgroundKnown,
        internalState: verdict.internal, emittedTerminalIds: [...(row.emittedTerminalIds || []), ...consumed],
        nextPollAt: verdict.internal === 'deleted' ? Number.MAX_SAFE_INTEGER
          : now() + (ACTIVE.has(verdict.internal) || state.candidates.length ? DISCOVERY_ACTIVE_MS : DIRECTORY_RESCHEDULE_MS) });
    });
  }

  async function tick() {
    if (closed || !running || !store.enabled()) return;
    if (busy) { schedule(1000); return; }
    busy = true;
    const revision = generation, key = token();
    let delay = DISCOVERY_ACTIVE_MS;
    try {
      if (!key) throw Object.assign(new Error('manus_token_missing'), { code: 'manus_token_missing' });
      if (!activeToken && accountKey && store.getMeta('credential_identity') === fingerprint(key)) activeToken = key;
      if (key !== activeToken || !accountKey) await identify(key, revision);
      check(revision, key);
      store.touchAccount(accountKey, { lastCheckedAt: now(), lastErrorCode: null });
      await deliverPending(revision);
      await discover(key, revision);
      await directoryScan(key, revision);
      const due = store.listTasks(accountKey).filter(row => row.nextPollAt <= now() && row.internalState !== 'deleted')
        .sort((a, b) => a.nextPollAt - b.nextPollAt || a.lastPolledAt - b.lastPolledAt || a.taskId.localeCompare(b.taskId));
      const isActive = row => ['running', 'waiting'].includes(row.status) || row.hasBackground || row.messageState?.candidates?.length;
      const active = due.filter(isActive), cold = due.filter(row => !isActive(row)), work = [];
      // Reserve one in four slots for old/cold tasks without starving live tasks.
      for (let i = 0; i < 8 && (active.length || cold.length); i++) work.push((i % 4 === 3 ? cold.shift() || active.shift() : active.shift() || cold.shift()));
      let workError = null;
      for (const row of work) {
        try { await inspectTask(row, key, revision); }
        catch (error) {
          check(revision, key);
          const current = store.getTask(accountKey, row.taskId);
          store.saveTask({ ...current, lastPolledAt: now(), nextPollAt: now() + (error.retryAfterMs || DISCOVERY_ACTIVE_MS) });
          workError = error;
          if (error.status === 401 || error.status === 403 || error.status === 429 || error.code === 'outbox_backlog') break;
        }
      }
      await deliverPending(revision);
      if (workError) throw workError;
      store.touchAccount(accountKey, { lastSuccessAt: now() });
      backoffIndex = 0;
      if (due.length > 8 || store.getScan(accountKey, 'directory')?.cursor) delay = 1000;
      else if (!store.listTasks(accountKey).some(row => ACTIVE.has(row.internalState))) delay = DISCOVERY_IDLE_MS;
      const taskDelay = soonestTaskDelay();
      if (taskDelay != null) delay = Math.min(delay, taskDelay);
    } catch (error) {
      if (closed || revision !== generation || error.code === 'manus_superseded') return;
      const code = error.code || 'manus_fetch_failed';
      identityError = activeToken ? null : code;
      if (accountKey) store.touchAccount(accountKey, { lastErrorCode: code, lastCheckedAt: now() });
      if (error.status === 401 || error.status === 403 || code === 'manus_token_missing') running = false;
      delay = error.retryAfterMs || backoff();
    } finally {
      busy = false;
      if (!closed && revision === generation) { announce(); schedule(delay); }
    }
  }

  async function start() {
    if (closed || !store.enabled()) return status();
    cancel(); activeToken = ''; running = true; schedule(250 + Math.floor(Math.random() * 500)); announce();
    return status();
  }
  async function stop({ disable = false } = {}) {
    running = false; cancel(); activeToken = '';
    if (disable) store.setEnabled(false);
    announce(); return status();
  }
  async function setListening(enabled) {
    if (!enabled) { await stop({ disable: true }); return { ok: true, ...status() }; }
    const newPeriod = !store.enabled();
    running = false; cancel(); activeToken = '';
    const revision = generation, key = token();
    try {
      if (!key) throw Object.assign(new Error('manus_token_missing'), { code: 'manus_token_missing' });
      await identify(key, revision, newPeriod); check(revision, key);
      store.setEnabled(true); running = true; announce(); schedule(250);
      return { ok: true, ...status() };
    } catch (error) {
      if (closed || revision !== generation || error.code === 'manus_superseded') return { ok: false, superseded: true };
      identityError = error.code || 'manus_enable_failed'; announce();
      return { ...status(), ok: false, error: identityError };
    }
  }
  async function refreshCredentials() {
    if (store.enabled()) return setListening(true);
    running = false; cancel(); activeToken = ''; identityError = null; announce(); return status();
  }
  async function checkConnection() {
    const revision = generation, key = token();
    if (!key) return { ok: false, error: 'manus_token_missing' };
    try {
      await api.userMe(key); check(revision, key);
      const page = await api.taskList(key, { limit: 1 }); check(revision, key);
      const row = page.tasks.map(normalizeListTask).find(Boolean);
      if (row && row.status !== 'deleted') {
        await api.listMessages(key, row.id, { limit: 1 }); check(revision, key);
        await api.taskDetail(key, row.id); check(revision, key);
      }
      return { ok: true, verifiedTasks: Boolean(row) };
    } catch (error) { return { ok: false, error: error.code || 'manus_check_failed', status: error.status }; }
  }
  async function previewLocal({ title = '' } = {}) {
    if (typeof deliverEvent !== 'function') return { ok: false, error: 'deliver_unavailable' };
    const at = now();
    const result = await deliverEvent({ source: 'manus', eventId: `manus-preview-${at}`, sessionId: 'manus-preview',
      turnId: `preview-${at}`, taskId: '', occurredAt: at, title, completionSummary: title, _pome_preview: true });
    return { ok: SUCCESS.has(result) || result === 'preview' || result === true || result?.ok === true };
  }
  function close() { if (!closed) { running = false; cancel(); closed = true; store.close(); } }
  return { start, stop, setListening, refreshCredentials, checkConnection, previewLocal, status, tick, deliverPending, close, _store: store, _api: api };
}
module.exports = {
  createManusCompletionService,
  DISCOVERY_ACTIVE_MS,
  DISCOVERY_IDLE_MS,
  DIRECTORY_RESCHEDULE_MS,
  VERIFY_SUMMARY_MS,
  SUCCESS,
  DROP,
};
