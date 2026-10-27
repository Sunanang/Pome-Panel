'use strict';

const { createHash } = require('node:crypto');

const API_BASE = 'https://api.manus.ai/v2/';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BUDGET_PER_MINUTE = 20;
const ENDPOINTS = Object.freeze(['user.me', 'task.list', 'task.detail', 'task.listMessages']);
const MANUS_ADAPTER_ID = 'manus-official-readonly';

function text(value, max = 4096) {
  return Array.from(typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '')
    .slice(0, max).join('');
}

function apiError(code, status = 0, extra = {}) {
  return Object.assign(new Error(code), { code, status, ...extra });
}

function identifier(value, max, code) {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u0020\u007f]/.test(value)) throw apiError(code);
  return value;
}

function pagination(payload, currentCursor) {
  if (typeof payload.has_more !== 'boolean') throw apiError('manus_invalid_cursor');
  if (!payload.has_more) return { hasMore: false, nextCursor: '' };
  const nextCursor = identifier(payload.next_cursor, 4096, 'manus_invalid_cursor');
  if (nextCursor === currentCursor) throw apiError('manus_invalid_cursor');
  return { hasMore: true, nextCursor };
}

async function boundedText(response, max) {
  if (!response.body?.getReader) {
    // Injected legacy fetch fixtures may implement text() without a stream.
    const raw = await response.text();
    if (Buffer.byteLength(raw) > max) throw apiError('manus_body_too_large', 413);
    return raw;
  }
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) { await reader.cancel(); throw apiError('manus_body_too_large', 413); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally { reader.releaseLock(); }
}

function createRateBudget({ limit = DEFAULT_BUDGET_PER_MINUTE, now = Date.now } = {}) {
  const windows = new Map();
  function allow(endpoint) {
    const key = String(endpoint || '');
    const at = now();
    let bucket = windows.get(key);
    if (!bucket || at < bucket.startedAt || at - bucket.startedAt >= 60_000) {
      bucket = { startedAt: at, count: 0 };
      windows.set(key, bucket);
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }
  function reset() { windows.clear(); }
  function retryAfter(endpoint) { return Math.max(1, (windows.get(endpoint)?.startedAt ?? now()) + 60_000 - now()); }
  return { allow, reset, retryAfter };
}

function createManusApi({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBodyBytes = MAX_BODY_BYTES,
  budgetPerMinute = DEFAULT_BUDGET_PER_MINUTE,
  userAgent = 'Pome-Panel-ManusCompletion/1.0',
} = {}) {
  const budget = createRateBudget({ limit: budgetPerMinute, now });
  let generation = 0;
  const inflight = new Set();

  function bumpGeneration() {
    generation += 1;
    for (const controller of inflight) controller.abort();
    inflight.clear();
    return generation;
  }

  async function request(endpoint, { token, query = {}, signal, generation: expected } = {}) {
    if (!ENDPOINTS.includes(endpoint)) throw apiError('manus_unknown_endpoint');
    const key = text(token, 4096);
    if (!key) throw apiError('manus_token_missing', 401);
    if (!budget.allow(endpoint)) throw apiError('manus_rate_budget', 429, { retryAfterMs: budget.retryAfter(endpoint) });
    const url = new URL(endpoint, API_BASE);
    for (const [name, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(name, String(value));
    }
    if (url.origin !== 'https://api.manus.ai' || !url.pathname.startsWith('/v2/')) {
      throw apiError('manus_invalid_url');
    }
    const controller = new AbortController();
    inflight.add(controller);
    const revision = expected ?? generation;
    try {
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.any([
          controller.signal,
          ...(signal ? [signal] : []),
          AbortSignal.timeout(timeoutMs),
        ]),
        headers: {
          'x-manus-api-key': key,
          Accept: 'application/json',
          'User-Agent': userAgent,
        },
      });
      if (revision !== generation) throw apiError('manus_superseded');
      const length = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(length) && length > maxBodyBytes) throw apiError('manus_body_too_large', 413);
      const raw = await boundedText(response, maxBodyBytes);
      if (revision !== generation) throw apiError('manus_superseded');
      let payload;
      try { payload = JSON.parse(raw); } catch {
        if (response.status === 401 || response.status === 403) throw apiError(response.status === 401 ? 'manus_unauthenticated' : 'manus_permission_denied', response.status);
        throw apiError('manus_invalid_json', response.status || 502);
      }
      if (!response.ok || payload?.ok === false) {
        const code = text(payload?.error?.code, 80) || 'manus_api_failed';
        const status = !response.ok
          ? response.status
          : code === 'unauthenticated' || code === 'unauthorized' ? 401
            : code === 'permission_denied' ? 403
              : code === 'rate_limited' || code === 'too_many_requests' ? 429
                : 502;
        const header = response.headers.get('retry-after');
        const retryAfter = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - now() : 0;
        throw apiError(status === 401 ? 'manus_unauthenticated'
          : status === 403 ? 'manus_permission_denied'
            : status === 429 ? 'manus_rate_limited'
              : 'manus_api_failed', status, {
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
          businessCode: code,
        });
      }
      if (payload?.ok !== true) throw apiError('manus_invalid_response', response.status || 502);
      return payload;
    } finally {
      inflight.delete(controller);
    }
  }

  return {
    API_BASE,
    MANUS_ADAPTER_ID,
    bumpGeneration,
    getGeneration: () => generation,
    async userMe(token, options = {}) {
      const payload = await request('user.me', { token, ...options });
      const userId = text(payload.user_id, 320);
      if (!userId) throw apiError('manus_invalid_user');
      return {
        userId,
        accountKey: createHash('sha256').update(['manus-account-v1', userId].join('\0')).digest('hex'),
      };
    },
    async taskList(token, { cursor, limit = 100, signal, generation: expected } = {}) {
      const payload = await request('task.list', {
        token, signal, generation: expected,
        query: {
          limit: Math.min(100, Math.max(1, Number(limit) || 100)),
          scope: 'all',
          order: 'desc',
          include_deleted: 'true',
          ...(cursor ? { cursor: identifier(cursor, 4096, 'manus_invalid_cursor') } : {}),
        },
      });
      if (!Array.isArray(payload.data)) throw apiError('manus_invalid_task_list');
      return {
        tasks: payload.data,
        ...pagination(payload, cursor),
      };
    },
    async taskDetail(token, taskId, options = {}) {
      const id = identifier(taskId, 160, 'manus_invalid_task_id');
      const payload = await request('task.detail', {
        token, ...options, query: { task_id: id },
      });
      const task = payload.task;
      if (!task || typeof task !== 'object' || Array.isArray(task) || task.id !== id) {
        throw apiError('manus_invalid_task_detail');
      }
      return task;
    },
    async listMessages(token, taskId, { cursor, startEventId, limit = 50, signal, generation: expected } = {}) {
      const id = identifier(taskId, 160, 'manus_invalid_task_id');
      if (cursor && startEventId) throw apiError('manus_invalid_message_query');
      const payload = await request('task.listMessages', {
        token, signal, generation: expected,
        query: {
          task_id: id,
          verbose: 'false',
          order: 'asc',
          limit: Math.min(200, Math.max(1, Number(limit) || 50)),
          ...(cursor ? { cursor: identifier(cursor, 4096, 'manus_invalid_cursor') } : {}),
          ...(startEventId ? { start_event_id: identifier(startEventId, 320, 'manus_invalid_event_id') } : {}),
        },
      });
      if (!Array.isArray(payload.messages) || payload.task_id !== id) throw apiError('manus_invalid_messages');
      for (const message of payload.messages) {
        identifier(message?.id, 320, 'manus_invalid_messages');
        if (!Number.isSafeInteger(message.timestamp) || message.timestamp <= 0 || typeof message.type !== 'string') throw apiError('manus_invalid_messages');
      }
      return {
        taskId: text(payload.task_id, 160) || id,
        messages: payload.messages,
        ...pagination(payload, cursor),
      };
    },
  };
}

module.exports = {
  createManusApi,
  createRateBudget,
  API_BASE,
  MANUS_ADAPTER_ID,
  MAX_BODY_BYTES,
  DEFAULT_BUDGET_PER_MINUTE,
  ENDPOINTS,
};
