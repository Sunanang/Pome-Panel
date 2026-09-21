'use strict';

/** Current protocol schema version carried on mutations and negotiation responses. */
const SCHEMA_VERSION = 1;

/** Oldest schema version this package still understands. */
const MIN_SUPPORTED_SCHEMA_VERSION = 1;

/** Newest schema version this package can speak. */
const MAX_SUPPORTED_SCHEMA_VERSION = 1;

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 1;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Negotiate schema compatibility between local support and a peer advertisement.
 * On mismatch both pull and push must stop (no read-only degrade).
 *
 * @param {{ schemaVersion?: unknown, minSupported?: unknown, maxSupported?: unknown }} peer
 * @param {{ minSupported?: number, maxSupported?: number }} [local]
 * @returns {{ ok: true, schemaVersion: number, minSupported: number, maxSupported: number }
 *   | { ok: false, reason: string, schemaVersion?: number, minSupported?: number, maxSupported?: number }}
 */
function negotiateSchema(peer, local = {}) {
  if (peer == null || typeof peer !== 'object' || Array.isArray(peer)) {
    return { ok: false, reason: 'peer_schema_missing' };
  }

  const minSupported = local.minSupported ?? MIN_SUPPORTED_SCHEMA_VERSION;
  const maxSupported = local.maxSupported ?? MAX_SUPPORTED_SCHEMA_VERSION;
  const peerSchema = peer.schemaVersion;
  const peerMin = peer.minSupported;
  const peerMax = peer.maxSupported;

  if (!isPositiveInt(peerSchema) || !isPositiveInt(peerMin) || !isPositiveInt(peerMax)) {
    return { ok: false, reason: 'peer_schema_invalid' };
  }
  if (peerMin > peerMax) {
    return { ok: false, reason: 'peer_schema_range_invalid', schemaVersion: peerSchema, minSupported: peerMin, maxSupported: peerMax };
  }

  const overlapLow = Math.max(minSupported, peerMin);
  const overlapHigh = Math.min(maxSupported, peerMax);
  if (overlapLow > overlapHigh) {
    if (peerMin > maxSupported) {
      return {
        ok: false,
        reason: 'peer_too_new',
        schemaVersion: peerSchema,
        minSupported: peerMin,
        maxSupported: peerMax,
      };
    }
    return {
      ok: false,
      reason: 'peer_too_old',
      schemaVersion: peerSchema,
      minSupported: peerMin,
      maxSupported: peerMax,
    };
  }

  return {
    ok: true,
    schemaVersion: peerSchema,
    minSupported: peerMin,
    maxSupported: peerMax,
  };
}

module.exports = {
  SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
  isPositiveInt,
  isNonNegativeInt,
  negotiateSchema,
};
