'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const API_BASE = 'https://api2.cursor.sh';
const PERIOD_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage';
const SAND_PATH = '/aiserver.v1.DashboardService/GetSandUsageStatus';
const CACHE_TTL_MS = 60_000;

let cache = null;

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

async function postConnect(pathname, token, body = {}) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method: 'POST',
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
  return json;
}

function toNumber(value) {
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

function buildSnapshot(period, sand, auth) {
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
    grokBot: {
      label: 'Grok Bot',
      percent: clampPercent(sand && (sand.usagePercent ?? sand.usage_percent)),
      periodStart: sand && (sand.currentPeriodStart || sand.current_period_start) || null,
      resetAt: sand && (sand.nextResetTimestampUtc || sand.next_reset_timestamp_utc) || null,
      hasAvailableUsage: sand ? sand.hasAvailableUsage !== false : null,
      detail: sand && sand.grokPlanLabel || null,
    },
    billing: {
      cycleStart: msToIso(period && period.billingCycleStart),
      cycleEnd: msToIso(period && period.billingCycleEnd),
      totalPercent: clampPercent(planUsage.totalPercentUsed),
      displayMessage: period && period.displayMessage || null,
    },
  };
}

async function fetchUsageWithToken(token, authMeta = {}) {
  const [period, sand] = await Promise.all([
    postConnect(PERIOD_PATH, token, {}),
    postConnect(SAND_PATH, token, {}),
  ]);
  return buildSnapshot(period, sand, authMeta);
}

async function fetchCursorUsage({ force = false, manualToken = '' } = {}) {
  const manual = String(manualToken || '').trim();
  const cacheKey = manual ? `manual:${manual.slice(0, 12)}` : 'local';
  if (
    !force
    && cache
    && cache.key === cacheKey
    && (Date.now() - cache.cachedAt) < CACHE_TTL_MS
    && !cache.snapshot.manualTokenInvalid
  ) {
    return { ...cache.snapshot, cached: true };
  }

  let manualTokenInvalid = false;
  let manualFailure = null;

  if (manual) {
    try {
      const snapshot = await fetchUsageWithToken(manual, { email: null, plan: null });
      snapshot.authSource = 'manual';
      snapshot.manualTokenInvalid = false;
      snapshot.manualTokenConfigured = true;
      cache = { cachedAt: Date.now(), key: cacheKey, snapshot };
      return { ...snapshot, cached: false };
    } catch (error) {
      manualFailure = error;
      if (isAuthFailure(error)) manualTokenInvalid = true;
      // 其他错误也回退本机，双保险
    }
  }

  const auth = readAuthToken();
  if (!auth.ok) {
    return {
      ok: false,
      error: manualTokenInvalid ? 'cursor_manual_token_invalid' : auth.error,
      detail: auth.detail || (manualFailure && manualFailure.message) || null,
      status: manualFailure && manualFailure.status || null,
      manualTokenInvalid,
      manualTokenConfigured: Boolean(manual),
      authSource: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  try {
    const snapshot = await fetchUsageWithToken(auth.token, auth);
    snapshot.authSource = 'local';
    snapshot.manualTokenConfigured = Boolean(manual);
    snapshot.manualTokenInvalid = manualTokenInvalid;
    if (manualTokenInvalid) {
      snapshot.warning = '手动 Token 已失效，已改用本机登录态';
    } else if (manual && manualFailure && !manualTokenInvalid) {
      snapshot.warning = '手动 Token 请求失败，已改用本机登录态';
    }
    cache = { cachedAt: Date.now(), key: 'local', snapshot };
    return { ...snapshot, cached: false };
  } catch (error) {
    return {
      ok: false,
      error: manualTokenInvalid ? 'cursor_manual_token_invalid' : (error && error.message || 'cursor_fetch_failed'),
      status: error && error.status || null,
      manualTokenInvalid,
      manualTokenConfigured: Boolean(manual),
      authSource: null,
      fetchedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  cursorStateDbPath,
  readAuthToken,
  fetchCursorUsage,
  buildSnapshot,
  CACHE_TTL_MS,
  isAuthFailure,
};
