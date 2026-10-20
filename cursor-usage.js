'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const API_BASE = 'https://api2.cursor.sh';
const PERIOD_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const CACHE_TTL_MS = 60_000;


function cursorStateDbPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

function readAuthToken(dbPath = cursorStateDbPath()) {
  if (!fs.existsSync(dbPath)) {
    return { ok: false, error: 'cursor_db_missing', path: dbPath };
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('cursorAuth/accessToken');
    const emailRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('cursorAuth/cachedEmail');
    const planRow = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('cursorAuth/stripeMembershipType');
    const token = row && row.value != null ? String(row.value) : '';
    if (!token) return { ok: false, error: 'cursor_token_missing', path: dbPath };
    return {
      ok: true,
      token,
      email: emailRow && emailRow.value != null ? String(emailRow.value) : null,
      plan: planRow && planRow.value != null ? String(planRow.value) : null,
      path: dbPath,
    };
  } catch (error) {
    return { ok: false, error: 'cursor_db_read_failed', detail: String(error && error.message || error), path: dbPath };
  } finally {
    try { if (db) db.close(); } catch (_) {}
  }
}

function isAuthFailure(error) {
  const status = error && error.status;
  return status === 401 || status === 403;
}

async function postConnect(pathname, token, body = {}, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(`${API_BASE}${pathname}`, {
    method: 'POST', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'User-Agent': 'Pome-Panel-CursorUsage/1.0',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const err = new Error(`cursor_api_${response.status}`);
    err.status = response.status;
    err.body = json || text;
    throw err;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('cursor_invalid_response');
  return json;
}

function toNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPercent(value) {
  const n = toNumber(value);
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

function msToIso(value) {
  const n = toNumber(value);
  if (n == null) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  try { return new Date(ms).toISOString(); } catch (_) { return null; }
}

function buildSnapshot(period, auth) {
  const planUsage = period && period.planUsage ? period.planUsage : {};
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    email: auth.email || null,
    plan: auth.plan || null,
    auto: {
      label: 'Auto',
      percent: clampPercent(planUsage.autoPercentUsed),
      detail: period && period.autoModelSelectedDisplayMessage || null,
    },
    other: {
      label: 'Other',
      percent: clampPercent(planUsage.apiPercentUsed),
      detail: period && period.namedModelSelectedDisplayMessage || null,
    },
    billing: {
      cycleStart: msToIso(period && period.billingCycleStart),
      cycleEnd: msToIso(period && period.billingCycleEnd),
      totalPercent: clampPercent(planUsage.totalPercentUsed),
      displayMessage: period && period.displayMessage || null,
    },
  };
}

// Like Codex's service, requests belong to a credential generation. Never expose
// credentials (or response bodies) in IPC, errors or cache keys sent to the UI.
function createCursorUsageService({ fetchImpl = (...args) => fetch(...args), readAuth = readAuthToken, now = Date.now } = {}) {
  let key = '', generation = 0, pending = null, lastAttempt = null, lastSuccess = null, manualInvalid = false;
  function reset() {
    generation++; pending?.controller.abort();
    pending = null; lastAttempt = null; lastSuccess = null; key = ''; manualInvalid = false;
  }
  async function getUsage({ force = false, manualToken = '' } = {}) {
    const manual = String(manualToken || '').trim();
    let auth;
    try { auth = readAuth(); } catch { auth = { ok: false, error: 'cursor_db_read_failed' }; }
    // Re-read the owner's login before cache lookup: local sign-out/account switch
    // must invalidate snapshots even when a request is in flight.
    const identity = createHash('sha256').update(JSON.stringify([manual, auth.ok ? auth.token : null, auth.email || null])).digest('hex');
    if (key !== identity) { reset(); key = identity; }
    const revision = generation;
    if (!force && lastAttempt && now() - lastAttempt.at < CACHE_TTL_MS) return { ...lastAttempt.result, cached: true };
    if (!pending) {
      const controller = new AbortController();
      async function fetchWithToken(token, meta, source) {
        const period = await postConnect(PERIOD_PATH, token, {}, { fetchImpl, signal: controller.signal });
        const snapshot = buildSnapshot(period, meta);
        snapshot.fetchedAt = new Date(now()).toISOString();
        snapshot.authSource = source;
        return snapshot;
      }
      const task = (async () => {
        let manualTokenInvalid = manualInvalid, manualFailure = false;
        if (manual) {
          try { return { ...await fetchWithToken(manual, {}, 'manual'), manualTokenConfigured: true, manualTokenInvalid: false }; }
          catch (error) { manualTokenInvalid ||= isAuthFailure(error); manualFailure = true; }
        }
        if (auth.ok) {
          try {
            const snapshot = await fetchWithToken(auth.token, auth, 'local');
            return { ...snapshot, manualTokenConfigured: Boolean(manual), manualTokenInvalid,
              ...(manualFailure ? { warning: manualTokenInvalid ? '手动 Token 已失效，已改用本机登录态' : '手动 Token 请求失败，已改用本机登录态' } : {}) };
          } catch (error) {
            if (isAuthFailure(error)) return { ok: false, error: 'cursor_token_invalid', status: error.status, manualTokenInvalid, authSource: null, manualTokenConfigured: Boolean(manual) };
          }
        }
        return { ok: false, error: manualTokenInvalid ? 'cursor_manual_token_invalid' : manual || auth.ok ? 'cursor_fetch_failed' : auth.error,
          manualTokenInvalid, manualTokenConfigured: Boolean(manual), authSource: null };
      })();
      pending = { controller, task };
    }
    const request = pending;
    let result = await request.task;
    if (revision !== generation) return { superseded: true };
    if (pending === request) pending = null;
    manualInvalid = result.manualTokenInvalid === true;
    if (result.ok) lastSuccess = result;
    else if (result.manualTokenInvalid || result.status === 401 || result.status === 403) lastSuccess = null;
    else if (lastSuccess) result = { ...lastSuccess, stale: true, cached: true, refreshError: result.error };
    lastAttempt = { at: now(), result };
    return result;
  }
  return { getUsage, reset };
}
const defaultService = createCursorUsageService();
const fetchCursorUsage = options => defaultService.getUsage(options);
const resetCursorUsage = () => defaultService.reset();
module.exports = { cursorStateDbPath, readAuthToken, fetchCursorUsage, resetCursorUsage, createCursorUsageService,
  buildSnapshot, CACHE_TTL_MS, isAuthFailure };
