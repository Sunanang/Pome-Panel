'use strict';
const { createHash } = require('node:crypto');
const USAGE_URL = 'https://api.manus.ai/v2/usage.availableCredits';
const CACHE_TTL_MS = 60_000;

function buildSnapshot(payload) {
  const data = payload?.data;
  // total_credits is the spendable wallet, not the monthly entitlement.
  if (payload?.ok !== true || !Number.isSafeInteger(data?.total_credits)) throw new Error('manus_invalid_response');
  const next = Number.isSafeInteger(data.next_refresh_time) && data.next_refresh_time > 0 ? data.next_refresh_time : null;
  return { ok: true, detected: true, fetchedAt: new Date().toISOString(),
    credits: { available: data.total_credits },
    windows: [{ id: 'credits', label: 'Credits', unit: 'credits', balance: data.total_credits, percent: null, resetsAt: next }] };
}

async function fetchUsage(token, { fetchImpl, signal }) {
  const response = await fetchImpl(USAGE_URL, {
    method: 'GET', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    headers: { 'x-manus-api-key': token, Accept: 'application/json', 'User-Agent': 'Pome-Panel-ManusUsage/1.0' },
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok || payload?.ok === false) {
    const status = !response.ok ? response.status : payload?.error?.code === 'unauthenticated' ? 401 : payload?.error?.code === 'permission_denied' ? 403 : 502;
    throw Object.assign(new Error('manus_api_failed'), { status });
  }
  return payload;
}

function createManusUsageService({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  let key = '', generation = 0, pending = null, lastAttempt = null, lastSuccess = null, authInvalid = false;
  function reset() {
    generation++; pending?.controller.abort();
    key = ''; pending = null; lastAttempt = null; lastSuccess = null; authInvalid = false;
  }
  async function getUsage({ force = false, manualToken = '' } = {}) {
    const manual = String(manualToken || '').trim();
    const identity = createHash('sha256').update(manual).digest('hex');
    if (key !== identity) { reset(); key = identity; }
    const revision = generation;
    if (!force && lastAttempt && now() - lastAttempt.at < CACHE_TTL_MS) return { ...lastAttempt.result, cached: true };
    if (!manual) return { ok: false, detected: false, configured: false, error: 'manus_token_missing' };
    if (!pending) {
      const controller = new AbortController();
      const task = (async () => {
        try {
          return { ...buildSnapshot(await fetchUsage(manual, { fetchImpl, signal: controller.signal })), authSource: 'manual', configured: true, manualTokenConfigured: true };
        } catch (error) {
          return { ok: false, detected: true, configured: true, manualTokenConfigured: true,
            error: error.status === 401 || error.status === 403 ? 'manus_token_invalid' : 'manus_fetch_failed', status: error.status };
        }
      })();
      pending = { controller, task };
    }
    const request = pending;
    let result = await request.task;
    if (revision !== generation) return { superseded: true };
    if (pending === request) pending = null;
    if (result.ok) { lastSuccess = result; authInvalid = false; }
    else if (result.status === 401 || result.status === 403) { lastSuccess = null; authInvalid = true; }
    else if (lastSuccess) result = { ...lastSuccess, stale: true, cached: true, refreshError: result.error };
    if (authInvalid && !result.ok) result = { ...result, manualTokenInvalid: true };
    lastAttempt = { at: now(), result };
    return result;
  }
  return { getUsage, reset };
}
module.exports = { createManusUsageService, buildSnapshot, USAGE_URL, CACHE_TTL_MS };
