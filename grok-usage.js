'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('node:crypto');

const API_HOST = 'management-api.x.ai';
const CACHE_TTL_MS = 60_000;

function credentialsPath(home = os.homedir()) {
  return path.join(home, '.config', 'xai', 'credentials.json');
}

function readAuthToken({ home = os.homedir(), env = process.env } = {}) {
  if (env.XAI_MANAGEMENT_API_KEY || env.XAI_MANAGEMENT_KEY) {
    return { ok: true, token: String(env.XAI_MANAGEMENT_API_KEY || env.XAI_MANAGEMENT_KEY), source: 'env', teamId: env.XAI_TEAM_ID || null };
  }
  const filePath = credentialsPath(home);
  if (!fs.existsSync(filePath)) return { ok: false, error: 'grok_credentials_missing' };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const token = raw.managementKey || raw.management_api_key || '';
    if (!token) return { ok: false, error: 'grok_token_missing', path: filePath };
    return { ok: true, token: String(token), teamId: raw.teamId || raw.team_id || null, source: 'file' };
  } catch (error) {
    return { ok: false, error: 'grok_credentials_read_failed', detail: String(error && error.message || error) };
  }
}

function toNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildSnapshot(payload) {
  // xAI returns an inverted ledger in USD cents, not a quota entitlement.
  const raw = payload?.total?.val;
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) throw new Error('grok_invalid_balance');
  const cents = Number(raw);
  if (!Number.isSafeInteger(cents)) throw new Error('grok_invalid_balance');
  const balance = cents === 0 ? 0 : -cents / 100;
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    detected: true,
    ownership: 'xai',
    windows: [{
      id: 'prepaid',
      label: 'Prepaid',
      percent: null,
      resetsAt: null,
      balance,
      currency: 'USD',
    }],
    balance,
  };
}

async function fetchBalance(token, teamId, { fetchImpl = fetch, signal } = {}) {
  const team = String(teamId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(team)) throw new Error('grok_team_required');
  const response = await fetchImpl(`https://${API_HOST}/v1/billing/teams/${encodeURIComponent(team)}/prepaid/balance`, {
    method: 'GET', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'Pome-Panel-GrokUsage/1.0',
    },
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok) {
    const err = new Error(`grok_api_${response.status}`);
    err.status = response.status;
    throw err;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('grok_invalid_response');
  return json;
}

function createGrokUsageService({
  fetchImpl = (...args) => fetch(...args),
  readAuth = readAuthToken,
  now = Date.now,
} = {}) {
  let key = '', generation = 0, pending = null, lastAttempt = null, lastSuccess = null, authInvalid = false;
  function reset() {
    generation++; pending?.controller.abort();
    pending = null; lastAttempt = null; lastSuccess = null; key = ''; authInvalid = false;
  }
  async function getUsage({ force = false, manualToken = '', teamId = '' } = {}) {
    const manual = String(manualToken || '').trim();
    let auth;
    try {
      auth = manual
        ? { ok: true, token: manual, teamId: teamId || null, source: 'manual' }
        : readAuth();
    } catch { auth = { ok: false, error: 'grok_auth_read_failed' }; }
    const identity = createHash('sha256').update(JSON.stringify([auth.ok ? auth.token : null, auth.teamId || teamId || null])).digest('hex');
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
          const payload = await fetchBalance(auth.token, teamId || auth.teamId, { fetchImpl, signal: controller.signal });
          return { ...buildSnapshot(payload), authSource: auth.source, detected: true, configured: Boolean(manual), manualTokenConfigured: Boolean(manual) };
        } catch (error) {
          return { ok: false, error: error.status === 401 || error.status === 403 ? 'grok_token_invalid' : error.message === 'grok_team_required' ? 'grok_team_required' : 'grok_fetch_failed',
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
  return { getUsage, reset, buildSnapshot, readAuthToken };
}

module.exports = { createGrokUsageService, buildSnapshot, readAuthToken, CACHE_TTL_MS, credentialsPath };
