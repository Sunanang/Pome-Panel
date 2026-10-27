'use strict';

const { createHash } = require('node:crypto');
const { readCodexUsage, withExpiry } = require('./codex-usage');
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const ALLOWED_HOSTS = Object.freeze(['chatgpt.com']);
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

function finite(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRemoteUsage(body, now = Date.now()) {
  function windowUsage(window) {
    if (!window || typeof window !== 'object') return null;
    const percent = finite(window.used_percent);
    const seconds = finite(window.limit_window_seconds);
    return { percent: percent == null ? null : Math.max(0, Math.min(100, percent)),
      windowMinutes: seconds == null ? null : seconds / 60, resetsAt: finite(window.reset_at) };
  }
  const credits = body?.credits;
  const windows = [];
  for (const [index, extra] of (Array.isArray(body?.additional_rate_limits) ? body.additional_rate_limits.slice(0, 16) : []).entries()) {
    for (const key of ['primary', 'secondary']) {
      const value = windowUsage(extra?.rate_limit?.[`${key}_window`]);
      if (value) windows.push({ ...value, id: `extra-${index}-${key}`, label: String(extra.limit_name || extra.metered_feature || '其他额度').slice(0, 80), labelIsFallback: !extra.limit_name && !extra.metered_feature });
    }
  }
  if (windows.length) {
    for (const key of ['secondary', 'primary']) {
      const value = windowUsage(body?.rate_limit?.[`${key}_window`]);
      if (value) windows.unshift({ ...value, id: key, label: '' });
    }
  }
  return withExpiry({ ok: true, detected: false, configured: true, authSource: 'manual',
    updatedAt: new Date(now).toISOString(),
    plan: typeof body?.plan_type === 'string' ? body.plan_type.slice(0, 80) : null,
    ...(windows.length ? { windows } : {}),
    primary: windowUsage(body?.rate_limit?.primary_window),
    secondary: windowUsage(body?.rate_limit?.secondary_window),
    credits: credits && typeof credits === 'object' ? {
      hasCredits: credits.has_credits === true, unlimited: credits.unlimited === true, balance: finite(credits.balance),
    } : null }, now);
}

async function requestRemoteUsage(token, { fetchImpl = fetch, now = Date.now, signal, timeoutMs = TIMEOUT_MS } = {}) {
  // The endpoint is fixed and redirects are forbidden: credentials cannot reach another host.
  const url = new URL(USAGE_URL);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) return { ok: false, error: 'codex_network_failed' };
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url.href, {
      method: 'GET', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: 'codex_token_invalid', manualTokenInvalid: true };
    }
    if (!response.ok) return { ok: false, error: 'codex_network_failed', manualTokenInvalid: false };
    return { ...parseRemoteUsage(await response.json(), now()), manualTokenInvalid: false };
  } catch {
    // No exceptions, response bodies, URLs containing credentials or tokens enter logs/IPC.
    return { ok: false, error: 'codex_network_failed', manualTokenInvalid: false };
  }
}

function createCodexUsageService({ fetchImpl = fetch, readLocal = readCodexUsage, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  let generation = 0;
  let key = '';
  let invalid = false;
  let lastSuccess = null;
  let lastAttempt = null;
  let pending = null;
  function reset() {
    generation++;
    pending?.controller.abort();
    pending = null; key = ''; invalid = false; lastSuccess = null; lastAttempt = null;
  }
  function tokenState() { return { manualTokenInvalid: invalid }; }
  async function getUsage({ manualToken = '', configured = Boolean(manualToken), force = false } = {}) {
    const token = String(manualToken || '').trim();
    const tokenKey = token ? createHash('sha256').update(token).digest('hex') : '';
    if (tokenKey !== key) { reset(); key = tokenKey; }
    const revision = generation;
    let result = null;
    let cached = false;
    if (token) {
      if (!force && lastAttempt && now() - lastAttempt.at < CACHE_TTL_MS) { result = lastAttempt.result; cached = true; }
      else {
        if (!pending) {
          const controller = new AbortController();
          const task = requestRemoteUsage(token, { fetchImpl, now, signal: controller.signal, timeoutMs });
          pending = { controller, task };
        }
        const request = pending;
        result = await request.task;
        if (revision !== generation) return { superseded: true };
        if (pending === request) pending = null;
        lastAttempt = { at: now(), result };
        if (result.ok) { invalid = false; lastSuccess = result; }
        else if (result.manualTokenInvalid) { invalid = true; lastSuccess = null; }
      }
      if (revision !== generation) return { superseded: true };
      if (result.ok) return { ...withExpiry(result, now()), configured, cached,
        manualTokenInvalid: false, remoteError: null };
    }
    let local;
    try { local = await readLocal({ configured, now: now() }); }
    catch { local = { ok: false, detected: false, configured, primary: null, secondary: null, updatedAt: null, error: 'codex_read_failed' }; }
    if (revision !== generation) return { superseded: true };
    const remoteError = invalid ? 'codex_token_invalid' : token || configured ? 'codex_network_failed' : null;
    if (local?.ok && local.updatedAt) {
      return { ...local, configured, authSource: 'local', manualTokenInvalid: invalid, remoteError };
    }
    if (token && !invalid && lastSuccess) {
      return { ...withExpiry(lastSuccess, now()), configured, cached: true, stale: true, manualTokenInvalid: false, remoteError };
    }
    return { ...local, configured, authSource: local?.detected ? 'local' : null,
      manualTokenInvalid: invalid, remoteError };
  }
  return { getUsage, reset, tokenState };
}

module.exports = { USAGE_URL, ALLOWED_HOSTS, TIMEOUT_MS, CACHE_TTL_MS, parseRemoteUsage, requestRemoteUsage, createCodexUsageService };
