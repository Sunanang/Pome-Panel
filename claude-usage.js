'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const API_HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';
const CACHE_TTL_MS = 60_000;

function credentialsPath(home = os.homedir()) {
  return path.join(home, '.claude', '.credentials.json');
}

function readJsonCredentials(filePath = credentialsPath()) {
  if (!fs.existsSync(filePath)) return { ok: false, error: 'claude_credentials_missing', path: filePath };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const oauth = raw?.claudeAiOauth && typeof raw.claudeAiOauth === 'object' ? raw.claudeAiOauth : raw;
    const token = oauth?.accessToken || oauth?.access_token || raw?.accessToken || raw?.access_token || '';
    if (!token) return { ok: false, error: 'claude_token_missing', path: filePath };
    const expiresAt = Number(oauth?.expiresAt || oauth?.expires_at || 0) || null;
    return { ok: true, token: String(token), expiresAt, path: filePath, source: 'file' };
  } catch (error) {
    return { ok: false, error: 'claude_credentials_read_failed', detail: String(error && error.message || error), path: filePath };
  }
}

function readKeychainCredentials() {
  if (process.platform !== 'darwin') return { ok: false, error: 'claude_keychain_unsupported' };
  try {
    const text = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
      encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!text) return { ok: false, error: 'claude_keychain_empty' };
    const raw = JSON.parse(text);
    const oauth = raw?.claudeAiOauth && typeof raw.claudeAiOauth === 'object' ? raw.claudeAiOauth : raw;
    const token = oauth?.accessToken || oauth?.access_token || '';
    if (!token) return { ok: false, error: 'claude_keychain_token_missing' };
    return { ok: true, token: String(token), expiresAt: Number(oauth?.expiresAt || oauth?.expires_at || 0) || null, source: 'keychain' };
  } catch {
    return { ok: false, error: 'claude_keychain_read_failed' };
  }
}

function readAuthToken({ home = os.homedir(), readFile = readJsonCredentials, readKeychain = readKeychainCredentials } = {}) {
  const file = readFile(credentialsPath(home));
  const keychain = readKeychain();
  if (file.ok && keychain.ok) {
    const fileExp = file.expiresAt || 0;
    const keyExp = keychain.expiresAt || 0;
    return keyExp >= fileExp ? keychain : file;
  }
  return file.ok ? file : keychain;
}

function toNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function utilizationPercent(window) {
  if (!window || typeof window !== 'object') return null;
  const util = toNumber(window.utilization ?? window.used_percent ?? window.usedPercent);
  if (util != null) return Math.max(0, Math.min(100, util));
  const used = toNumber(window.used);
  const limit = toNumber(window.limit);
  if (used != null && limit > 0) return Math.max(0, Math.min(100, (used / limit) * 100));
  return null;
}

function resetsAtSeconds(window) {
  const raw = window?.resets_at ?? window?.resetsAt ?? window?.reset_at;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }
  const n = toNumber(raw);
  if (n == null) return null;
  return n > 1e12 ? n / 1000 : n;
}

function buildSnapshot(payload) {
  const five = payload?.five_hour || payload?.fiveHour || null;
  const seven = payload?.seven_day || payload?.sevenDay || null;
  const windows = [];
  if (five) {
    windows.push({
      id: 'five_hour',
      label: '5 小时',
      percent: utilizationPercent(five),
      resetsAt: resetsAtSeconds(five),
      windowMinutes: 300,
    });
  }
  if (seven) {
    windows.push({
      id: 'seven_day',
      label: '7 天',
      percent: utilizationPercent(seven),
      resetsAt: resetsAtSeconds(seven),
      windowMinutes: 10080,
    });
  }
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    detected: true,
    windows,
    extraUsage: payload?.extra_usage || payload?.extraUsage || null,
  };
}

async function fetchUsage(token, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(`https://${API_HOST}${USAGE_PATH}`, {
    method: 'GET', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'Pome-Panel-ClaudeUsage/1.0',
    },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const err = new Error(`claude_api_${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('claude_invalid_response');
  return json;
}

function createClaudeUsageService({
  fetchImpl = (...args) => fetch(...args),
  readAuth = readAuthToken,
  now = Date.now,
} = {}) {
  let key = '', generation = 0, pending = null, lastAttempt = null, lastSuccess = null;
  function reset() {
    generation++; pending?.controller.abort();
    pending = null; lastAttempt = null; lastSuccess = null; key = '';
  }
  async function getUsage({ force = false } = {}) {
    let auth;
    try { auth = readAuth(); } catch { auth = { ok: false, error: 'claude_auth_read_failed' }; }
    const identity = createHash('sha256').update(JSON.stringify([auth.ok ? auth.token : null, auth.source || null])).digest('hex');
    if (key !== identity) { reset(); key = identity; }
    const revision = generation;
    if (!force && lastAttempt && now() - lastAttempt.at < CACHE_TTL_MS) return { ...lastAttempt.result, cached: true };
    if (!auth.ok) {
      const result = { ok: false, detected: false, configured: false, error: auth.error };
      lastAttempt = { at: now(), result };
      return result;
    }
    if (!pending) {
      const controller = new AbortController();
      const task = (async () => {
        try {
          const payload = await fetchUsage(auth.token, { fetchImpl, signal: controller.signal });
          return { ...buildSnapshot(payload), authSource: auth.source || 'local', detected: true, configured: false };
        } catch (error) {
          return { ok: false, error: error.status === 401 || error.status === 403 ? 'claude_token_invalid' : 'claude_fetch_failed',
            status: error.status, detected: true, configured: false, authSource: null };
        }
      })();
      pending = { controller, task };
    }
    const request = pending;
    let result = await request.task;
    if (revision !== generation) return { superseded: true };
    if (pending === request) pending = null;
    if (result.ok) lastSuccess = result;
    else if (result.status === 401 || result.status === 403) lastSuccess = null;
    else if (lastSuccess) result = { ...lastSuccess, stale: true, cached: true, refreshError: result.error };
    lastAttempt = { at: now(), result };
    return result;
  }
  return { getUsage, reset, readAuthToken, buildSnapshot };
}

module.exports = {
  createClaudeUsageService, readAuthToken, readJsonCredentials, buildSnapshot, CACHE_TTL_MS, credentialsPath,
};
