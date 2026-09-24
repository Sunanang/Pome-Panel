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

/** UI / sync runtime state when protocol ranges do not overlap. */
const SCHEMA_UI_STATE_INCOMPATIBLE = 'schema_incompatible';

const SCHEMA_UPGRADE_MESSAGES = {
  desktop: '协议不兼容：请升级桌面端 Pome Panel 后再同步',
  fpk: '协议不兼容：请升级 NAS 上的 Pome Panel Sync 应用后再同步',
  unknown: '协议不兼容：请升级桌面端或 NAS 应用后再同步',
};

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

/**
 * Map a negotiateSchema failure reason to who must upgrade.
 * - peer_too_new → server range above local max → upgrade desktop
 * - peer_too_old → local range above server max → upgrade FPK
 *
 * @param {string} [reason]
 * @returns {'desktop' | 'fpk' | 'unknown'}
 */
function schemaUpgradeTarget(reason) {
  if (reason === 'peer_too_new') return 'desktop';
  if (reason === 'peer_too_old') return 'fpk';
  return 'unknown';
}

/**
 * Full client-side evaluation used on pair + every sync response.
 * Incompatible → stopPull and stopPush both true (no read-only degrade).
 *
 * @param {{ schemaVersion?: unknown, minSupported?: unknown, maxSupported?: unknown }} peer
 * @param {{ minSupported?: number, maxSupported?: number }} [local]
 */
function evaluateSchemaNegotiation(peer, local = {}) {
  const negotiated = negotiateSchema(peer, local);
  if (negotiated.ok) {
    return {
      ok: true,
      compatible: true,
      stopPull: false,
      stopPush: false,
      schemaVersion: negotiated.schemaVersion,
      minSupported: negotiated.minSupported,
      maxSupported: negotiated.maxSupported,
      uiState: null,
      upgradeTarget: null,
      message: null,
      reason: null,
    };
  }

  const upgradeTarget = schemaUpgradeTarget(negotiated.reason);
  return {
    ok: false,
    compatible: false,
    stopPull: true,
    stopPush: true,
    reason: negotiated.reason,
    schemaVersion: negotiated.schemaVersion,
    minSupported: negotiated.minSupported,
    maxSupported: negotiated.maxSupported,
    uiState: SCHEMA_UI_STATE_INCOMPATIBLE,
    upgradeTarget,
    message: SCHEMA_UPGRADE_MESSAGES[upgradeTarget] || SCHEMA_UPGRADE_MESSAGES.unknown,
  };
}

/**
 * Envelope every JSON API response should carry (server advertisement).
 */
function schemaEnvelope(local = {}) {
  return {
    schemaVersion: local.schemaVersion ?? SCHEMA_VERSION,
    minSupported: local.minSupported ?? MIN_SUPPORTED_SCHEMA_VERSION,
    maxSupported: local.maxSupported ?? MAX_SUPPORTED_SCHEMA_VERSION,
  };
}

module.exports = {
  SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_UI_STATE_INCOMPATIBLE,
  SCHEMA_UPGRADE_MESSAGES,
  isPositiveInt,
  isNonNegativeInt,
  negotiateSchema,
  schemaUpgradeTarget,
  evaluateSchemaNegotiation,
  schemaEnvelope,
};
