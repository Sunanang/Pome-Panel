'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const API_HOST = 'api.github.com';
const USAGE_PATH = '/copilot_internal/user';
const CACHE_TTL_MS = 60_000;

function hostsYmlPath(home = os.homedir()) {
  return path.join(home, '.config', 'gh', 'hosts.yml');
}

function githubTokenFromHosts(text) {
  // gh's block YAML only: never consume a token belonging to another host.
  const block = String(text).match(/^(?:github\.com|'github\.com'|"github\.com"):[ \t]*(?:#.*)?\r?\n((?:[ \t]+[^\n]*\n?|[ \t]*\r?\n)*)/m)?.[1];
  const match = block?.match(/^[ \t]+oauth_token:[ \t]*(?:"([A-Za-z0-9_]+)"|'([A-Za-z0-9_]+)'|([A-Za-z0-9_]+))[ \t]*(?:#.*)?$/m);
  return match ? match[1] || match[2] || match[3] : '';
}

function readGhToken({ home = os.homedir(), env = process.env, exec = execFileSync } = {}) {
  if ((!env.GH_HOST || env.GH_HOST.toLowerCase() === API_HOST.replace(/^api\./, '')) && (env.GH_TOKEN || env.GITHUB_TOKEN)) {
    return { ok: true, token: String(env.GH_TOKEN || env.GITHUB_TOKEN), source: 'env' };
  }
  try {
    const cliEnv = { ...env };
    if (env.GH_HOST && env.GH_HOST.toLowerCase() !== 'github.com') { delete cliEnv.GH_TOKEN; delete cliEnv.GITHUB_TOKEN; }
    const token = exec('gh', ['auth', 'token', '--hostname', 'github.com'], {
      encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], env: cliEnv,
    }).trim();
    if (token) return { ok: true, token, source: 'gh' };
  } catch { /* fall through */ }
  const filePath = env.GH_CONFIG_DIR ? path.join(env.GH_CONFIG_DIR, 'hosts.yml') : hostsYmlPath(home);
  if (!fs.existsSync(filePath)) return { ok: false, error: 'copilot_token_missing' };
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const token = githubTokenFromHosts(text);
    if (!token) return { ok: false, error: 'copilot_token_missing', path: filePath };
    return { ok: true, token, source: 'hosts.yml' };
  } catch (error) {
    return { ok: false, error: 'copilot_token_read_failed', detail: String(error && error.message || error) };
  }
}

function toNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentFromQuota(quota) {
  if (!quota || typeof quota !== 'object') return null;
  const remaining = toNumber(quota.remaining ?? quota.rest);
  const limit = toNumber(quota.limit ?? quota.entitlement);
  if (remaining != null && limit > 0) return Math.max(0, Math.min(100, ((limit - remaining) / limit) * 100));
  const percent = toNumber(quota.percent_remaining ?? quota.percentRemaining);
  if (percent != null) return Math.max(0, Math.min(100, 100 - percent));
  const usedPercent = toNumber(quota.usage_percent ?? quota.usagePercent ?? quota.percent_used);
  return usedPercent == null ? null : Math.max(0, Math.min(100, usedPercent));
}

function resetsAtSeconds(quota) {
  for (const raw of [quota?.reset_date, quota?.resetDate, quota?.reset_at, quota?.resets_at,
    quota?.quota_reset_at, quota?.quota_reset_date_utc, quota?.quota_reset_date]) {
    const n = toNumber(raw);
    const seconds = n != null ? (n > 1e12 ? n / 1000 : n) : typeof raw === 'string' ? Date.parse(raw) / 1000 : null;
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

function buildSnapshot(payload) {
  const quota = payload?.quota_snapshots || payload?.quotaSnapshots || payload || {};
  const chat = quota.chat || payload?.chat;
  const completions = quota.completions || payload?.completions;
  const premium = quota.premium_interactions || quota.premiumInteractions || payload?.premium_interactions;
  const windows = [];
  const blocks = [
    ['premium', 'Premium', premium],
    ['chat', 'Chat', chat],
    ['completions', 'Completions', completions],
  ];
  for (const [id, label, block] of blocks) {
    // Unlimited buckets often report zero entitlement/remaining. Those zeroes
    // do not describe an exhausted allowance and must never rank as critical.
    if (!block || block.unlimited === true) continue;
    const percent = percentFromQuota(block);
    if (percent == null) continue;
    windows.push({ id, label, percent, resetsAt: resetsAtSeconds(block) ?? resetsAtSeconds(payload), windowMinutes: null });
  }
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    detected: true,
    plan: payload?.copilot_plan || payload?.plan_type || payload?.plan || null,
    windows,
    unlimited: blocks.some(([, , block]) => block) && blocks.filter(([, , block]) => block).every(([, , block]) => block.unlimited === true),
  };
}

async function fetchUsage(token, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(`https://${API_HOST}${USAGE_PATH}`, {
    method: 'GET', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      'User-Agent': 'Pome-Panel-CopilotUsage/1.0',
      'X-Github-Api-Version': '2022-11-28',
    },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const err = new Error(`copilot_api_${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('copilot_invalid_response');
  return json;
}

function createCopilotUsageService({
  fetchImpl = (...args) => fetch(...args),
  readAuth = readGhToken,
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
    catch { auth = { ok: false, error: 'copilot_auth_read_failed' }; }
    const identity = createHash('sha256').update(JSON.stringify([auth.ok ? auth.token : null])).digest('hex');
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
          const payload = await fetchUsage(auth.token, { fetchImpl, signal: controller.signal });
          return { ...buildSnapshot(payload), authSource: auth.source, detected: true, configured: Boolean(manual), manualTokenConfigured: Boolean(manual) };
        } catch (error) {
          return { ok: false, error: error.status === 401 || error.status === 403 ? 'copilot_token_invalid' : 'copilot_fetch_failed',
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
    else if (result.status === 401 || result.status === 403) { lastSuccess = null; authInvalid ||= result.status === 401 || result.status === 403; }
    else if (lastSuccess) result = { ...lastSuccess, stale: true, cached: true, refreshError: result.error };
    if (authInvalid && !result.ok) result = { ...result, manualTokenInvalid: true };
    lastAttempt = { at: now(), result };
    return result;
  }
  return { getUsage, reset, buildSnapshot, readGhToken };
}

module.exports = { createCopilotUsageService, buildSnapshot, readGhToken, githubTokenFromHosts, CACHE_TTL_MS };
