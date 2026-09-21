'use strict';

/**
 * Local schemaVersion constants for FPK skeleton.
 * TODO(T1): align with packages/sync-protocol when that package lands —
 * prefer require('../../packages/sync-protocol') or a shared relative path;
 * until then keep these as the single local source of truth inside fnos/.
 */
const SCHEMA_VERSION = 1;
const MIN_SUPPORTED = 1;
const MAX_SUPPORTED = 1;

function schemaEnvelope() {
  return {
    schemaVersion: SCHEMA_VERSION,
    minSupported: MIN_SUPPORTED,
    maxSupported: MAX_SUPPORTED,
  };
}

function isSchemaCompatible(clientVersion) {
  const n = Number(clientVersion);
  if (!Number.isFinite(n)) return false;
  return n >= MIN_SUPPORTED && n <= MAX_SUPPORTED;
}

module.exports = {
  SCHEMA_VERSION,
  MIN_SUPPORTED,
  MAX_SUPPORTED,
  schemaEnvelope,
  isSchemaCompatible,
};
