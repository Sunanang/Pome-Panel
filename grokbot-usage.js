'use strict';

const { createHash } = require('node:crypto');
const { readAuthToken, isAuthFailure } = require('./cursor-usage');
const { isCursorEncryptedToken } = require('./platform-adapters/cursor-secrets');

const API_BASE = 'https://api2.cursor.sh';
const SAND_PATH = '/aiserver.v1.DashboardService/GetSandUsageStatus';
const CACHE_TTL_MS = 60_000;

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

function timestampSeconds(value) {
  const n = toNumber(value);
  const seconds = n != null ? (n < 1e12 ? n : n / 1000) : typeof value === 'string' ? Date.parse(value) / 1000 : null;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function msToIso(value) {
  const seconds = timestampSeconds(value);
  if (seconds == null) return null;
  try { return new Date(seconds * 1000).toISOString(); } catch (_) { return null; }
}

async function postSand(token, { fetchImpl = fetch, signal } = {}) {
  if (isCursorEncryptedToken(token)) throw new Error('cursor_token_decrypt_failed');
  const response = await fetchImpl(`${API_BASE}${SAND_PATH}`, {
    method: 'POST', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      'User-Agent': 'Pome-Panel-GrokbotUsage/1.0',
    },
    body: '{}',
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const err = new Error(`grokbot_api_${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('grokbot_invalid_response');
  return json;
}

function buildSnapshot(sand, auth) {
  const resetAt = sand && (sand.nextResetTimestampUtc || sand.next_reset_timestamp_utc) || null;
  const resetsAt = timestampSeconds(resetAt);
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    email: auth.email || null,
    plan: sand && sand.grokPlanLabel || auth.plan || null,
    primary: {
      label: 'Grok Bot',
      percent: clampPercent(sand && (sand.usagePercent ?? sand.usage_percent)),
      resetsAt,
      windowMinutes: 10080,
      hasAvailableUsage: sand ? sand.hasAvailableUsage !== false : null,
      detail: sand && sand.grokPlanLabel || null,
    },
    periodStart: msToIso(sand && (sand.currentPeriodStart || sand.current_period_start)),
    ownership: 'cursor-sand',
  };
}

function createGrokbotUsageService({ fetchImpl = (...args) => fetch(...args), readAuth = readAuthToken, now = Date.now } = {}) {
  let key = '', generation = 0, pending = null, lastAttempt = null, lastSuccess = null, manualInvalid = false;
  function reset() {
    generation++; pending?.controller.abort();
    pending = null; lastAttempt = null; lastSuccess = null; key = ''; manualInvalid = false;
  }
  async function getUsage({ force = false, manualToken = '' } = {}) {
    const savedManual = String(manualToken || '').trim();
    const manual = isCursorEncryptedToken(savedManual) ? '' : savedManual;
    let auth;
    try { auth = readAuth(); } catch { auth = { ok: false, error: 'cursor_db_read_failed' }; }
    const identity = createHash('sha256').update(JSON.stringify([manual, auth.ok ? auth.token : null, auth.email || null])).digest('hex');
    if (key !== identity) { reset(); key = identity; }
    const revision = generation;
    if (!force && lastAttempt && now() - lastAttempt.at < CACHE_TTL_MS) return { ...lastAttempt.result, cached: true };
    if (!pending) {
      const controller = new AbortController();
      async function fetchWithToken(token, meta, source) {
        const sand = await postSand(token, { fetchImpl, signal: controller.signal });
        const snapshot = buildSnapshot(sand, meta);
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
            return { ...snapshot, manualTokenConfigured: Boolean(manual), manualTokenInvalid: false,
              ...(manualFailure ? { warning: 'manual_token_fallback' } : {}) };
          } catch (error) {
            if (isAuthFailure(error)) return { ok: false, error: 'grokbot_token_invalid', status: error.status, manualTokenInvalid, authSource: null, manualTokenConfigured: Boolean(manual) };
          }
        }
        return { ok: false, error: manualTokenInvalid ? 'grokbot_manual_token_invalid' : manual || auth.ok ? 'grokbot_fetch_failed' : auth.error,
          manualTokenInvalid, manualTokenConfigured: Boolean(manual), authSource: null, detected: auth.ok === true };
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

module.exports = { createGrokbotUsageService, buildSnapshot, CACHE_TTL_MS };
