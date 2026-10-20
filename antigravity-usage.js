'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('node:crypto');

const CACHE_TTL_MS = 60_000;
const ALLOWED_HOSTS = new Set(['cloudcode-pa.googleapis.com', 'oauth2.googleapis.com']);

function statePaths(home = os.homedir()) {
  return [
    path.join(home, '.gemini', 'antigravity', 'oauth.json'),
    path.join(home, '.config', 'antigravity', 'oauth.json'),
    path.join(home, 'Library', 'Application Support', 'Antigravity', 'oauth.json'),
  ];
}

function readAuthToken({ home = os.homedir() } = {}) {
  for (const filePath of statePaths(home)) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const token = raw.access_token || raw.accessToken || raw.token || '';
      if (!token) continue;
      return { ok: true, token: String(token), path: filePath, source: 'file', projectId: raw.projectId || raw.project_id || null };
    } catch { /* try next */ }
  }
  return { ok: false, error: 'antigravity_credentials_missing' };
}

function toNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSnapshot(payload) {
  const groups = payload?.response?.groups ?? payload?.summary?.groups ?? payload?.groups;
  if (Array.isArray(groups)) {
    const windows = groups.flatMap((group, groupIndex) => (Array.isArray(group?.buckets) ? group.buckets : []).flatMap((bucket, index) => {
      if (!bucket || bucket.disabled === true || bucket.enabled === false) return [];
      const fraction = toNumber(bucket.remainingFraction ?? bucket.remaining?.remainingFraction
        ?? (bucket.remaining?.case === 'remainingFraction' ? bucket.remaining.value : null));
      if (fraction == null || fraction < 0 || fraction > 1) return [];
      const bucketId = bucket.bucketId || bucket.id || index;
      const cadence = String(bucket.window || bucketId).toLowerCase();
      const windowMinutes = /week/.test(cadence) ? 10080 : /5h|five.hour/.test(cadence) ? 300 : null;
      const reset = bucket.resetTime || bucket.remaining?.resetTime;
      const resetsAt = typeof reset === 'string' ? Date.parse(reset) / 1000 : toNumber(reset);
      return [{ id: `${groupIndex}:${bucketId}`, label: [group.displayName || group.name, bucket.displayName || bucket.name || String(bucketId)].filter(Boolean).join(' · '),
        percent: (1 - fraction) * 100, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null, windowMinutes,
        resetDescription: typeof bucket.description === 'string' ? bucket.description : '' }];
    }));
    return { ok: windows.length > 0, fetchedAt: new Date().toISOString(), detected: true, windows,
      ...(windows.length ? {} : { error: 'antigravity_quota_unavailable' }) };
  }
  const quotas = Array.isArray(payload?.quotas) ? payload.quotas
    : Array.isArray(payload?.models) ? payload.models
      : payload?.quota ? [payload.quota] : Array.isArray(payload?.buckets) ? payload.buckets : [];
  const windows = quotas.map((row, index) => {
    const used = toNumber(row.used ?? row.usage);
    const limit = toNumber(row.limit ?? row.quota);
    const fraction = toNumber(row.remainingFraction ?? row.quotaInfo?.remainingFraction);
    const percent = fraction != null && fraction >= 0 && fraction <= 1 ? (1 - fraction) * 100 : used != null && limit > 0
      ? Math.max(0, Math.min(100, (used / limit) * 100))
      : toNumber(row.percent_used ?? row.usagePercent);
    const resetRaw = row.reset_time || row.resetsAt || row.resetAt;
    let resetsAt = null;
    if (typeof resetRaw === 'string') {
      const ms = Date.parse(resetRaw);
      resetsAt = Number.isFinite(ms) ? ms / 1000 : null;
    } else {
      const n = toNumber(resetRaw);
      resetsAt = n == null ? null : (n > 1e12 ? n / 1000 : n);
    }
    return {
      id: row.id || row.model || `quota-${index}`,
      label: row.label || row.model || row.name || `Quota ${index + 1}`,
      percent: percent == null ? null : Math.max(0, Math.min(100, percent)),
      resetsAt,
      windowMinutes: toNumber(row.window_minutes),
    };
  }).filter((row) => row.percent != null);
  return { ok: windows.length > 0, fetchedAt: new Date().toISOString(), detected: true, windows,
    ...(windows.length ? {} : { error: 'antigravity_quota_unavailable' }) };
}

async function request(token, method, body, { fetchImpl = fetch, signal } = {}) {
  const url = `https://cloudcode-pa.googleapis.com/v1internal:${method}`;
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(host)) throw new Error('antigravity_host_blocked');
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'antigravity/hub/2.9.1',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const err = new Error(`antigravity_api_${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('antigravity_invalid_response');
  return json;
}

async function fetchQuota(token, options) {
  let project = options.projectId;
  if (!project) {
    const identity = await request(token, 'loadCodeAssist', { metadata: { ideType: 'ANTIGRAVITY', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI' } }, options);
    project = typeof identity.cloudaicompanionProject === 'string' ? identity.cloudaicompanionProject : identity.cloudaicompanionProject?.id;
  }
  return request(token, 'retrieveUserQuotaSummary', project ? { project } : {}, options);
}

function createAntigravityUsageService({
  fetchImpl = (...args) => fetch(...args),
  readAuth = readAuthToken,
  now = Date.now,
} = {}) {
  let key = '', generation = 0, pending = null, lastAttempt = null, lastSuccess = null, authInvalid = false;
  function reset() {
    generation++; pending?.controller.abort();
    pending = null; lastAttempt = null; lastSuccess = null; key = ''; authInvalid = false;
  }
  async function getUsage({ force = false, manualToken = '' } = {}) {
    const manual = String(manualToken || '').trim();
    let auth;
    try { auth = manual ? { ok: true, token: manual, source: 'manual' } : readAuth(); }
    catch { auth = { ok: false, error: 'antigravity_auth_read_failed' }; }
    const identity = createHash('sha256').update(JSON.stringify([auth.ok ? auth.token : null, auth.projectId || null])).digest('hex');
    if (key !== identity) { reset(); key = identity; }
    const revision = generation;
    if (!force && lastAttempt && now() - lastAttempt.at < CACHE_TTL_MS) return { ...lastAttempt.result, cached: true };
    if (!auth.ok) {
      const result = { ok: false, detected: false, configured: Boolean(manual), manualTokenConfigured: Boolean(manual), error: auth.error };
      lastAttempt = { at: now(), result };
      return result;
    }
    if (!pending) {
      const controller = new AbortController();
      const task = (async () => {
        try {
          const payload = await fetchQuota(auth.token, { fetchImpl, signal: controller.signal, projectId: auth.projectId });
          return { ...buildSnapshot(payload), authSource: auth.source, detected: true, configured: Boolean(manual), manualTokenConfigured: Boolean(manual) };
        } catch (error) {
          return { ok: false, error: error.status === 401 || error.status === 403 ? 'antigravity_token_invalid' : 'antigravity_fetch_failed',
            status: error.status, detected: true, configured: Boolean(manual), manualTokenConfigured: Boolean(manual) };
        }
      })();
      pending = { controller, task };
    }
    const request = pending;
    let result = await request.task;
    if (revision !== generation) return { superseded: true };
    if (pending === request) pending = null;
    if (result.ok) { lastSuccess = result; authInvalid = false; }
    else if (result.status === 401 || result.status === 403 || result.error === 'antigravity_quota_unavailable') { lastSuccess = null; authInvalid ||= result.status === 401 || result.status === 403; }
    else if (lastSuccess) result = { ...lastSuccess, stale: true, cached: true, refreshError: result.error };
    if (authInvalid && !result.ok) result = { ...result, manualTokenInvalid: true };
    lastAttempt = { at: now(), result };
    return result;
  }
  return { getUsage, reset, buildSnapshot, readAuthToken };
}

module.exports = { createAntigravityUsageService, buildSnapshot, readAuthToken, CACHE_TTL_MS, ALLOWED_HOSTS };
