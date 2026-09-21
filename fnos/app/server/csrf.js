'use strict';

const crypto = require('node:crypto');

const CSRF_TTL_MS = 30 * 60 * 1000;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'http://localhost',
  'https://localhost',
  'null', // file:// / some embedded WebViews send Origin: null
]);

function createCsrfStore({ ttlMs = CSRF_TTL_MS } = {}) {
  /** @type {Map<string, { uid: string, expiresAt: number }>} */
  const tokens = new Map();

  function issue(uid) {
    const token = crypto.randomBytes(24).toString('base64url');
    tokens.set(token, {
      uid: String(uid),
      expiresAt: Date.now() + ttlMs,
    });
    return token;
  }

  function consume(token, uid) {
    if (!token || typeof token !== 'string') return { ok: false, reason: 'csrf_missing' };
    const row = tokens.get(token);
    if (!row) return { ok: false, reason: 'csrf_invalid' };
    if (row.expiresAt <= Date.now()) {
      tokens.delete(token);
      return { ok: false, reason: 'csrf_expired' };
    }
    if (row.uid !== String(uid)) return { ok: false, reason: 'csrf_uid_mismatch' };
    tokens.delete(token);
    return { ok: true };
  }

  function peek(token) {
    return tokens.get(token) || null;
  }

  return { issue, consume, peek, tokens };
}

/**
 * Validate Origin for pair/start. Reject missing / mismatched origins.
 * @param {string|undefined} origin
 * @param {{ allowedOrigins?: string[], requestHost?: string }} [opts]
 */
function validatePairOrigin(origin, opts = {}) {
  if (origin == null || origin === '') {
    return { ok: false, reason: 'origin_missing' };
  }
  const value = String(origin).trim();
  const allowed = new Set([
    ...(opts.allowedOrigins || DEFAULT_ALLOWED_ORIGINS),
  ]);
  if (opts.requestHost) {
    const host = String(opts.requestHost).replace(/\/$/, '');
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  // Exact match or same-origin host match for NAS LAN URLs passed via allowedOrigins.
  if (allowed.has(value) || value === 'null') {
    return { ok: true, origin: value };
  }
  // Allow explicit list entries that are full origins.
  for (const entry of allowed) {
    if (entry && entry !== 'null' && value === entry) {
      return { ok: true, origin: value };
    }
  }
  return { ok: false, reason: 'origin_rejected' };
}

function readCsrfHeader(headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[String(k).toLowerCase()] = v;
  return h['x-csrf-token'] || h['x-xsrf-token'] || null;
}

module.exports = {
  CSRF_TTL_MS,
  DEFAULT_ALLOWED_ORIGINS,
  createCsrfStore,
  validatePairOrigin,
  readCsrfHeader,
};
