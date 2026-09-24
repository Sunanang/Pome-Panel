'use strict';

/** Shared pairing / deviceToken policy (desktop + FPK). */

const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_MAX_ATTEMPTS = 5;
/** Default deviceToken lifetime with sliding renewal on successful use. */
const DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * HTTP / insecureBound tokens: fixed 30-day expiry, no sliding renewal
 * (nas-sync-decisions §10).
 */
const INSECURE_DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Minimum entropy for issued deviceToken raw bytes. */
const DEVICE_TOKEN_BYTES = 32;

function isValidPairingCodeFormat(code) {
  return typeof code === 'string' && new RegExp(`^\\d{${PAIRING_CODE_LENGTH}}$`).test(code.trim());
}

function tokenTtlMs({ insecureBound = false } = {}) {
  return insecureBound ? INSECURE_DEVICE_TOKEN_TTL_MS : DEVICE_TOKEN_TTL_MS;
}

/**
 * Compute expiresAt for a newly issued token.
 * @param {{ insecureBound?: boolean, now?: number }} [opts]
 */
function computeTokenExpiresAt(opts = {}) {
  const now = opts.now == null ? Date.now() : Number(opts.now);
  return now + tokenTtlMs({ insecureBound: opts.insecureBound });
}

/**
 * Sliding renewal only for secure tokens. insecureBound keeps fixed expiresAt.
 * @param {{ insecureBound?: boolean, expiresAt?: number|null, now?: number }} row
 */
function maybeSlideTokenExpiry(row, opts = {}) {
  const now = opts.now == null ? Date.now() : Number(opts.now);
  if (!row || row.insecureBound) {
    return row && row.expiresAt != null ? Number(row.expiresAt) : null;
  }
  return now + DEVICE_TOKEN_TTL_MS;
}

function isTokenExpired(row, now = Date.now()) {
  if (!row || row.expiresAt == null) return false;
  return Number(row.expiresAt) <= Number(now);
}

module.exports = {
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  DEVICE_TOKEN_TTL_MS,
  INSECURE_DEVICE_TOKEN_TTL_MS,
  DEVICE_TOKEN_BYTES,
  isValidPairingCodeFormat,
  tokenTtlMs,
  computeTokenExpiresAt,
  maybeSlideTokenExpiry,
  isTokenExpired,
};
